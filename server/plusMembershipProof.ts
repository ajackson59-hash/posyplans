import type Stripe from 'stripe';
import { stripeMode } from './checkoutState';
import { getPriceId, getStripe, type BillingInterval } from './stripe';

/** Fresh server-side billing evidence. This is not an email-ownership proof. */
export interface PlusMembershipProof {
  subscriptionId: string;
  customerId: string;
  planTier: 'plus_active' | 'plus_trial';
  trialEndsAt: number | null;
  billingInterval: BillingInterval;
  subscriptionCreatedAt: number;
  observedAt: number;
  billingEmail: string;
}

export interface PlusMembershipProofResolver {
  resolve(email: string): Promise<PlusMembershipProof | undefined>;
  refresh(subscriptionId: string, customerId: string, email: string): Promise<PlusMembershipProof | undefined>;
}

export class PlusMembershipProofServiceError extends Error {
  readonly code = 'membership_verification_unavailable';
  constructor() {
    super('Membership verification is temporarily unavailable. Please try again shortly.');
    this.name = 'PlusMembershipProofServiceError';
  }
}

// Only read methods are exposed to this service and its test doubles.
export interface PlusMembershipProofStripeClient {
  customers: {
    list(params: Stripe.CustomerListParams, options: Stripe.RequestOptions): PromiseLike<Stripe.ApiList<Stripe.Customer>>;
  };
  subscriptions: {
    retrieve(id: string, params: Stripe.SubscriptionRetrieveParams, options: Stripe.RequestOptions): PromiseLike<Stripe.Subscription>;
    list(params: Stripe.SubscriptionListParams, options: Stripe.RequestOptions): PromiseLike<Stripe.ApiList<Stripe.Subscription>>;
  };
}

type LegacyCandidate = { stripeSubscriptionId: string | null; stripeCustomerId: string | null };
export interface PlusMembershipProofDependencies {
  getStripe?: () => PlusMembershipProofStripeClient | null;
  getPriceId?: (interval: BillingInterval) => string | undefined;
  mode?: () => ReturnType<typeof stripeMode>;
  getLegacyCandidate?: (email: string) => Promise<LegacyCandidate | undefined>;
  now?: () => number;
}

const CUSTOMER_LIMIT = 5;
const SUBSCRIPTION_LIMIT = 20;
const REQUEST_TIMEOUT_MS = 2_000;
const LOOKUP_TIMEOUT_MS = 10_000;
const subscriptionIdValid = (id: string) => /^sub_[A-Za-z0-9_]+$/.test(id);
const customerIdValid = (id: string) => /^cus_[A-Za-z0-9_]+$/.test(id);
const normalizeEmail = (email: string) => email.trim().toLowerCase();
const validEmail = (email: string) => email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const objectId = (value: unknown): string | undefined => typeof value === 'string' ? value
  : value && typeof value === 'object' && 'id' in value && typeof value.id === 'string' ? value.id : undefined;
const milliseconds = (seconds: unknown): number | undefined => typeof seconds === 'number'
  && Number.isSafeInteger(seconds) && seconds > 0 && Number.isSafeInteger(seconds * 1_000) ? seconds * 1_000 : undefined;
const resourceMissing = (error: unknown) => !!error && typeof error === 'object'
  && 'code' in error && error.code === 'resource_missing' && 'statusCode' in error && error.statusCode === 404;

/** Never calls checkout fulfillment, writes membership/contact, sends mail, or
 * emits analytics. The legacy row is only a shortcut to a current Stripe read. */
export class StripePlusMembershipProofResolver implements PlusMembershipProofResolver {
  private readonly now: () => number;
  constructor(private readonly dependencies: PlusMembershipProofDependencies = {}) {
    this.now = dependencies.now ?? Date.now;
  }

  private context() {
    const stripe = (this.dependencies.getStripe ?? getStripe)();
    const mode = (this.dependencies.mode ?? stripeMode)();
    const price = this.dependencies.getPriceId ?? getPriceId;
    const monthly = price('monthly');
    const annual = price('annual');
    if (!stripe || (mode !== 'live' && mode !== 'test') || !monthly || !annual || monthly === annual) {
      throw new PlusMembershipProofServiceError();
    }
    const started = this.now();
    return { stripe, livemode: mode === 'live', prices: { monthly, annual },
      options: (): Stripe.RequestOptions => {
        const remaining = LOOKUP_TIMEOUT_MS - (this.now() - started);
        if (remaining <= 0) throw new PlusMembershipProofServiceError();
        return { maxNetworkRetries: 0, timeout: Math.min(REQUEST_TIMEOUT_MS, remaining) };
      } };
  }

  private async bounded<T>(read: () => Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([read(), new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new PlusMembershipProofServiceError()), LOOKUP_TIMEOUT_MS);
      })]);
    } catch {
      // Do not expose provider payloads, IDs, email addresses, or secrets.
      throw new PlusMembershipProofServiceError();
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private proof(subscription: Stripe.Subscription, expectedCustomer: string, email: string,
    observedAt: number, context: ReturnType<StripePlusMembershipProofResolver['context']>): PlusMembershipProof | undefined {
    const customer = subscription.customer;
    const createdAt = milliseconds(subscription.created);
    if (!subscriptionIdValid(subscription.id) || !customerIdValid(expectedCustomer)
      || !customer || typeof customer === 'string' || customer.deleted
      || customer.id !== expectedCustomer || normalizeEmail(customer.email ?? '') !== email
      || customer.livemode !== context.livemode || subscription.livemode !== context.livemode
      || subscription.metadata?.plan !== 'plus' || createdAt === undefined || subscription.pause_collection) return;

    // Posy's current Plus product is a single configured monthly/annual item.
    // Unknown extra items or truncated item lists need manual recovery.
    if (subscription.items?.has_more !== false || subscription.items.data.length !== 1) return;
    const price = subscription.items.data[0].price;
    const interval = price.id === context.prices.monthly ? 'monthly'
      : price.id === context.prices.annual ? 'annual' : undefined;
    if (!interval || price.livemode !== context.livemode || price.type !== 'recurring'
      || price.recurring?.interval !== (interval === 'monthly' ? 'month' : 'year')
      || price.recurring.interval_count !== 1) return;

    let planTier: PlusMembershipProof['planTier'];
    const trialEndsAt = subscription.trial_end === null ? null : milliseconds(subscription.trial_end);
    if (subscription.status === 'trialing') {
      if (!trialEndsAt || trialEndsAt <= this.now()) return;
      planTier = 'plus_trial';
    } else if (subscription.status === 'active') {
      const invoice = subscription.latest_invoice;
      if (!invoice || typeof invoice === 'string' || invoice.status !== 'paid'
        || invoice.amount_remaining !== 0 || invoice.livemode !== context.livemode
        || objectId(invoice.customer) !== expectedCustomer) return;
      // Older Stripe versions used invoice.subscription; current versions use
      // parent.subscription_details.subscription. Reject a mismatch in either.
      const legacy = invoice as Stripe.Invoice & { subscription?: unknown };
      const references = [legacy.subscription, invoice.parent?.subscription_details?.subscription]
        .filter(value => value !== undefined && value !== null);
      if (!references.length || references.some(value => objectId(value) !== subscription.id)) return;
      planTier = 'plus_active';
    } else return;

    return { subscriptionId: subscription.id, customerId: expectedCustomer, planTier,
      trialEndsAt: trialEndsAt ?? null, billingInterval: interval,
      subscriptionCreatedAt: createdAt, observedAt, billingEmail: email };
  }

  private async retrieve(subscriptionId: string, customerId: string, email: string,
    context: ReturnType<StripePlusMembershipProofResolver['context']>) {
    const observedAt = this.now(); // Before the read: a newer local revocation wins.
    let subscription: Stripe.Subscription;
    try {
      subscription = await context.stripe.subscriptions.retrieve(subscriptionId,
        { expand: ['customer', 'latest_invoice'] }, context.options());
    } catch (error) {
      if (resourceMissing(error)) return;
      throw error;
    }
    if (subscription.id !== subscriptionId) return;
    return this.proof(subscription, customerId, email, observedAt, context);
  }

  async refresh(subscriptionId: string, customerId: string, input: string) {
    const email = normalizeEmail(input);
    if (!validEmail(email) || !subscriptionIdValid(subscriptionId) || !customerIdValid(customerId)) return;
    return this.bounded(() => this.retrieve(subscriptionId, customerId, email, this.context()));
  }

  async resolve(input: string): Promise<PlusMembershipProof | undefined> {
    const email = normalizeEmail(input);
    if (!validEmail(email)) return;
    return this.bounded(async () => {
      const context = this.context();
      const candidate = await (this.dependencies.getLegacyCandidate
        ?? (async (recipient: string) => (await import('./storage')).storage.getEmailEntitlement(recipient)))(email);
      if (candidate?.stripeSubscriptionId && candidate.stripeCustomerId
        && subscriptionIdValid(candidate.stripeSubscriptionId) && customerIdValid(candidate.stripeCustomerId)) {
        // Do not check the legacy tier: a stale inactive row may have renewed.
        const found = await this.retrieve(candidate.stripeSubscriptionId, candidate.stripeCustomerId, email, context);
        if (found) return found;
      }

      // Stripe's email filter is case-sensitive. Try supplied and normalized
      // spelling; never scan all customers or infer authority from a list match.
      const customers = new Map<string, Stripe.Customer>();
      for (const spelling of Array.from(new Set([input.trim(), email]))) {
        const page = await context.stripe.customers.list({ email: spelling, limit: CUSTOMER_LIMIT }, context.options());
        if (page.has_more !== false || page.data.length > CUSTOMER_LIMIT) return;
        for (const customer of page.data) {
          if (customerIdValid(customer.id) && customer.livemode === context.livemode
            && normalizeEmail(customer.email ?? '') === email) customers.set(customer.id, customer);
        }
        if (customers.size > CUSTOMER_LIMIT) return;
      }

      const proofs: PlusMembershipProof[] = [];
      // Bounded parallel reads keep a collision lookup within one request window.
      const pages = await Promise.all(Array.from(customers.keys()).map(async customerId => {
        const observedAt = this.now();
        const page = await context.stripe.subscriptions.list({ customer: customerId, status: 'all',
          limit: SUBSCRIPTION_LIMIT, expand: ['data.customer', 'data.latest_invoice'] }, context.options());
        return { customerId, page, observedAt };
      }));
      for (const { customerId, page, observedAt } of pages) {
        // No eligibility decisions from a partial result set.
        if (page.has_more !== false || page.data.length > SUBSCRIPTION_LIMIT) return;
        for (const subscription of page.data) {
          const proof = this.proof(subscription, customerId, email, observedAt, context);
          if (proof) proofs.push(proof);
        }
      }
      proofs.sort((a, b) => b.subscriptionCreatedAt - a.subscriptionCreatedAt
        || a.subscriptionId.localeCompare(b.subscriptionId));
      return proofs[0];
    });
  }
}

export const plusMembershipProofResolver: PlusMembershipProofResolver = new StripePlusMembershipProofResolver();

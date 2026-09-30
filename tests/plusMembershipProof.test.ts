// @vitest-environment node
import type Stripe from 'stripe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlusMembershipProofServiceError, StripePlusMembershipProofResolver,
  type PlusMembershipProofStripeClient } from '../server/plusMembershipProof';

const NOW = 1_800_000_000_000;
const EMAIL = 'billing@example.invalid';
function customer(id = 'cus_primary', email = EMAIL): Stripe.Customer {
  return { id, object: 'customer', email, livemode: false } as Stripe.Customer;
}
function subscription(changes: Record<string, unknown> = {}): Stripe.Subscription {
  return {
    id: 'sub_primary', object: 'subscription', customer: customer(), created: NOW / 1_000 - 86_400,
    livemode: false, status: 'active', metadata: { plan: 'plus' }, trial_end: null, pause_collection: null,
    items: { data: [{ price: { id: 'price_monthly', livemode: false, type: 'recurring',
      recurring: { interval: 'month', interval_count: 1 } } }], has_more: false },
    latest_invoice: { id: 'in_paid', customer: 'cus_primary', livemode: false, status: 'paid',
      amount_remaining: 0, amount_paid: 0,
      parent: { type: 'subscription_details', subscription_details: { subscription: 'sub_primary' } } },
    ...changes,
  } as unknown as Stripe.Subscription;
}
function page<T>(data: T[], has_more = false): Stripe.ApiList<T> {
  return { object: 'list', data, has_more, url: '/synthetic' };
}
function setup(candidate: { stripeSubscriptionId: string | null; stripeCustomerId: string | null } | undefined = {
  stripeSubscriptionId: 'sub_primary', stripeCustomerId: 'cus_primary',
}) {
  const retrieve = vi.fn<PlusMembershipProofStripeClient['subscriptions']['retrieve']>().mockResolvedValue(subscription());
  const listSubscriptions = vi.fn<PlusMembershipProofStripeClient['subscriptions']['list']>().mockResolvedValue(page([]));
  const listCustomers = vi.fn<PlusMembershipProofStripeClient['customers']['list']>().mockResolvedValue(page([]));
  const getLegacyCandidate = vi.fn().mockResolvedValue(candidate);
  const now = vi.fn(() => NOW);
  const getPriceId = vi.fn((interval: 'monthly' | 'annual') => `price_${interval}`);
  const stripe = { customers: { list: listCustomers }, subscriptions: { retrieve, list: listSubscriptions } };
  const dependencies = { getStripe: () => stripe, getPriceId, mode: () => 'test' as const, getLegacyCandidate, now };
  return { resolver: new StripePlusMembershipProofResolver(dependencies), dependencies,
    retrieve, listSubscriptions, listCustomers, getLegacyCandidate, now, getPriceId };
}
const networkFetch = vi.fn(() => { throw Error('Real network forbidden in proof tests.'); });
beforeEach(() => { networkFetch.mockClear(); vi.stubGlobal('fetch', networkFetch); });
afterEach(() => { expect(networkFetch).not.toHaveBeenCalled(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('fresh Stripe Plus proof', () => {
  it('ignores the legacy tier and proves only the exact current subscription/customer', async () => {
    const test = setup();
    test.getLegacyCandidate.mockResolvedValue({ stripeSubscriptionId: 'sub_primary', stripeCustomerId: 'cus_primary',
      planTier: 'plus_expired', email: EMAIL });
    expect(await test.resolver.resolve(' BILLING@EXAMPLE.INVALID ')).toEqual({
      subscriptionId: 'sub_primary', customerId: 'cus_primary', planTier: 'plus_active', trialEndsAt: null,
      billingInterval: 'monthly', subscriptionCreatedAt: NOW - 86_400_000, observedAt: NOW, billingEmail: EMAIL,
    });
    expect(test.getLegacyCandidate).toHaveBeenCalledWith(EMAIL);
    expect(test.retrieve).toHaveBeenCalledWith('sub_primary', { expand: ['customer', 'latest_invoice'] },
      { timeout: 2_000, maxNetworkRetries: 0 });
    expect(test.listCustomers).not.toHaveBeenCalled();
  });

  it('accepts an annual configured price, including zero-dollar credit settlement and canceled-at-period-end', async () => {
    const test = setup();
    const sub = subscription({ cancel_at_period_end: true });
    sub.items.data[0].price.id = 'price_annual';
    sub.items.data[0].price.recurring!.interval = 'year';
    test.retrieve.mockResolvedValue(sub);
    expect((await test.resolver.refresh('sub_primary', 'cus_primary', EMAIL))?.billingInterval).toBe('annual');
    expect(test.getLegacyCandidate).not.toHaveBeenCalled();
  });

  it('accepts an unexpired matching Plus trial without requiring a paid trial invoice', async () => {
    const test = setup();
    test.retrieve.mockResolvedValue(subscription({ status: 'trialing', trial_end: NOW / 1_000 + 3_600, latest_invoice: null }));
    expect(await test.resolver.refresh('sub_primary', 'cus_primary', EMAIL)).toMatchObject({
      planTier: 'plus_trial', trialEndsAt: NOW + 3_600_000,
    });
  });

  it.each(['past_due', 'unpaid', 'canceled', 'incomplete', 'incomplete_expired', 'paused'])('rejects %s subscriptions', async status => {
    const test = setup();
    test.retrieve.mockResolvedValue(subscription({ status }));
    expect(await test.resolver.refresh('sub_primary', 'cus_primary', EMAIL)).toBeUndefined();
  });

  it.each([null, NOW / 1_000, NOW / 1_000 - 1])('rejects a trial without a future end (%s)', async trial_end => {
    const test = setup();
    test.retrieve.mockResolvedValue(subscription({ status: 'trialing', trial_end }));
    expect(await test.resolver.refresh('sub_primary', 'cus_primary', EMAIL)).toBeUndefined();
  });

  it.each([
    ['different returned subscription', { id: 'sub_different' }],
    ['different current customer', { customer: customer('cus_different') }],
    ['changed billing email', { customer: customer('cus_primary', 'new@example.invalid') }],
    ['unexpanded customer', { customer: 'cus_primary' }],
    ['deleted customer', { customer: { id: 'cus_primary', deleted: true } }],
    ['wrong customer environment', { customer: { ...customer(), livemode: true } }],
    ['wrong subscription environment', { livemode: true }],
    ['unrelated product metadata', { metadata: { plan: 'spark' } }],
    ['missing provenance', { metadata: {} }],
    ['paused collection', { pause_collection: { behavior: 'void' } }],
    ['invalid creation date', { created: Number.NaN }],
    ['unexpanded invoice', { latest_invoice: 'in_paid' }],
  ])('rejects %s', async (_label, changes) => {
    const test = setup();
    test.retrieve.mockResolvedValue(subscription(changes));
    expect(await test.resolver.refresh('sub_primary', 'cus_primary', EMAIL)).toBeUndefined();
  });

  it.each([
    ['unknown price', (sub: Stripe.Subscription) => { sub.items.data[0].price.id = 'price_unrelated'; }],
    ['wrong price environment', (sub: Stripe.Subscription) => { sub.items.data[0].price.livemode = true; }],
    ['wrong interval', (sub: Stripe.Subscription) => { sub.items.data[0].price.recurring!.interval = 'year'; }],
    ['wrong interval count', (sub: Stripe.Subscription) => { sub.items.data[0].price.recurring!.interval_count = 2; }],
    ['truncated items', (sub: Stripe.Subscription) => { sub.items.has_more = true; }],
    ['extra product', (sub: Stripe.Subscription) => { sub.items.data.push(sub.items.data[0]); }],
    ['no product', (sub: Stripe.Subscription) => { sub.items.data = []; }],
  ])('rejects %s', async (_label, change) => {
    const test = setup();
    const sub = subscription(); change(sub); test.retrieve.mockResolvedValue(sub);
    expect(await test.resolver.refresh('sub_primary', 'cus_primary', EMAIL)).toBeUndefined();
  });

  it.each([
    ['unpaid invoice', { status: 'open' }], ['remaining balance', { amount_remaining: 1 }],
    ['wrong invoice customer', { customer: 'cus_other' }], ['wrong invoice environment', { livemode: true }],
    ['wrong invoice subscription', { parent: { subscription_details: { subscription: 'sub_other' } } }],
    ['missing invoice subscription identity', { parent: null }],
    ['conflicting legacy invoice identity', { subscription: 'sub_other' }],
  ])('rejects %s', async (_label, changes) => {
    const test = setup();
    const sub = subscription(); sub.latest_invoice = { ...(sub.latest_invoice as Stripe.Invoice), ...changes } as Stripe.Invoice;
    test.retrieve.mockResolvedValue(sub);
    expect(await test.resolver.refresh('sub_primary', 'cus_primary', EMAIL)).toBeUndefined();
  });

  it('supports the legacy invoice.subscription shape and expanded invoice references', async () => {
    const test = setup();
    const sub = subscription();
    sub.latest_invoice = { ...(sub.latest_invoice as Stripe.Invoice), parent: undefined,
      customer: customer(), subscription: { id: 'sub_primary' } } as unknown as Stripe.Invoice;
    test.retrieve.mockResolvedValue(sub);
    expect(await test.resolver.refresh('sub_primary', 'cus_primary', EMAIL)).toMatchObject({ planTier: 'plus_active' });
  });

  it('refresh rechecks identity and status without trying a different membership', async () => {
    const test = setup();
    expect(await test.resolver.refresh('sub_primary', 'cus_primary', EMAIL)).toBeDefined();
    test.retrieve.mockResolvedValue(subscription({ status: 'canceled' }));
    expect(await test.resolver.refresh('sub_primary', 'cus_primary', EMAIL)).toBeUndefined();
    expect(test.listCustomers).not.toHaveBeenCalled();
    expect(test.getLegacyCandidate).not.toHaveBeenCalled();
  });

  it('records observation before the remote read', async () => {
    const test = setup();
    test.retrieve.mockImplementation(async () => { test.now.mockReturnValue(NOW + 1_000); return subscription(); });
    expect((await test.resolver.refresh('sub_primary', 'cus_primary', EMAIL))?.observedAt).toBe(NOW);
  });
});

describe('bounded membership discovery', () => {
  it('recovers a standalone or changed-email membership using current Stripe customer and subscription data', async () => {
    const test = setup(); test.getLegacyCandidate.mockResolvedValue(undefined);
    test.listCustomers.mockResolvedValue(page([customer()]));
    test.listSubscriptions.mockResolvedValue(page([subscription()]));
    expect((await test.resolver.resolve(EMAIL))?.subscriptionId).toBe('sub_primary');
    expect(test.listCustomers).toHaveBeenCalledWith({ email: EMAIL, limit: 5 }, { timeout: 2_000, maxNetworkRetries: 0 });
    expect(test.listSubscriptions).toHaveBeenCalledWith({ customer: 'cus_primary', status: 'all', limit: 20,
      expand: ['data.customer', 'data.latest_invoice'] }, { timeout: 2_000, maxNetworkRetries: 0 });
    expect(test.retrieve).not.toHaveBeenCalled();
  });

  it('tries supplied and normalized case-sensitive email filters but does not strip plus suffixes or dots', async () => {
    const test = setup(); test.getLegacyCandidate.mockResolvedValue(undefined);
    await test.resolver.resolve(' Billing.Name+Event@Example.Invalid ');
    expect(test.listCustomers.mock.calls.map(call => call[0].email)).toEqual([
      'Billing.Name+Event@Example.Invalid', 'billing.name+event@example.invalid',
    ]);
  });

  it('falls back after a missing or inactive stale legacy candidate and deterministically chooses the newest eligible membership', async () => {
    const test = setup(); test.retrieve.mockRejectedValue({ statusCode: 404, code: 'resource_missing' });
    test.listCustomers.mockResolvedValue(page([customer()]));
    const older = subscription();
    const newer = subscription({ id: 'sub_newer', created: NOW / 1_000 - 10,
      latest_invoice: { ...(subscription().latest_invoice as Stripe.Invoice),
        parent: { subscription_details: { subscription: 'sub_newer' } } } });
    const canceled = subscription({ id: 'sub_canceled', status: 'canceled', created: NOW / 1_000 - 1 });
    test.listSubscriptions.mockResolvedValue(page([older, canceled, newer]));
    expect((await test.resolver.resolve(EMAIL))?.subscriptionId).toBe('sub_newer');
    test.retrieve.mockResolvedValue(subscription({ status: 'canceled' }));
    expect((await test.resolver.resolve(EMAIL))?.subscriptionId).toBe('sub_newer');
  });

  it('checks the freshly expanded customer again instead of trusting customer-list email', async () => {
    const test = setup(); test.getLegacyCandidate.mockResolvedValue(undefined);
    test.listCustomers.mockResolvedValue(page([customer()]));
    test.listSubscriptions.mockResolvedValue(page([subscription({ customer: customer('cus_primary', 'changed@example.invalid') })]));
    expect(await test.resolver.resolve(EMAIL)).toBeUndefined();
  });

  it('rejects a subscription belonging to another customer even when both use the same email', async () => {
    const test = setup(); test.getLegacyCandidate.mockResolvedValue(undefined);
    test.listCustomers.mockResolvedValue(page([customer('cus_other')]));
    test.listSubscriptions.mockResolvedValue(page([subscription()]));
    expect(await test.resolver.resolve(EMAIL)).toBeUndefined();
  });

  it('does not select from truncated customer or subscription pages', async () => {
    const test = setup(); test.getLegacyCandidate.mockResolvedValue(undefined);
    test.listCustomers.mockResolvedValue(page([customer()], true));
    expect(await test.resolver.resolve(EMAIL)).toBeUndefined();
    expect(test.listSubscriptions).not.toHaveBeenCalled();
    test.listCustomers.mockResolvedValue(page([customer()]));
    test.listSubscriptions.mockResolvedValue(page([subscription()], true));
    expect(await test.resolver.resolve(EMAIL)).toBeUndefined();
  });

  it('requires explicit pagination completeness for customer and subscription lists', async () => {
    const test = setup(); test.getLegacyCandidate.mockResolvedValue(undefined);
    test.listCustomers.mockResolvedValue({ ...page([customer()]), has_more: undefined } as unknown as Stripe.ApiList<Stripe.Customer>);
    expect(await test.resolver.resolve(EMAIL)).toBeUndefined();
    expect(test.listSubscriptions).not.toHaveBeenCalled();
    test.listCustomers.mockResolvedValue(page([customer()]));
    test.listSubscriptions.mockResolvedValue({ ...page([subscription()]), has_more: undefined } as unknown as Stripe.ApiList<Stripe.Subscription>);
    expect(await test.resolver.resolve(EMAIL)).toBeUndefined();
  });

  it('fails the whole lookup when any customer has a truncated subscription list', async () => {
    const test = setup(); test.getLegacyCandidate.mockResolvedValue(undefined);
    test.listCustomers.mockResolvedValue(page([customer(), customer('cus_other')]));
    test.listSubscriptions.mockImplementation(async params => params.customer === 'cus_primary'
      ? page([subscription()]) : page([], true));
    expect(await test.resolver.resolve(EMAIL)).toBeUndefined();
  });

  it('bounds the total distinct customers across both spellings', async () => {
    const test = setup(); test.getLegacyCandidate.mockResolvedValue(undefined);
    test.listCustomers.mockResolvedValueOnce(page([1, 2, 3].map(n => customer(`cus_${n}`))))
      .mockResolvedValueOnce(page([4, 5, 6].map(n => customer(`cus_${n}`))));
    expect(await test.resolver.resolve('BILLING@example.invalid')).toBeUndefined();
    expect(test.listSubscriptions).not.toHaveBeenCalled();
  });

  it('reports provider outages neutrally and does not fall through to a different membership', async () => {
    const test = setup(); test.retrieve.mockRejectedValue(Error('secret provider data'));
    await expect(test.resolver.resolve(EMAIL)).rejects.toEqual(new PlusMembershipProofServiceError());
    expect(test.listCustomers).not.toHaveBeenCalled();
    test.getLegacyCandidate.mockResolvedValue(undefined);
    test.listCustomers.mockRejectedValue({ statusCode: 429, message: 'private recipient' });
    await expect(test.resolver.resolve(EMAIL)).rejects.toEqual(new PlusMembershipProofServiceError());
  });

  it('does not interpret a missing resource as a provider outage during refresh', async () => {
    const test = setup(); test.retrieve.mockRejectedValue({ statusCode: 404, code: 'resource_missing' });
    expect(await test.resolver.refresh('sub_primary', 'cus_primary', EMAIL)).toBeUndefined();
  });

  it('rejects invalid identifiers and email before any storage or provider read', async () => {
    const test = setup();
    expect(await test.resolver.resolve('invalid')).toBeUndefined();
    expect(await test.resolver.refresh('not-a-subscription', 'cus_primary', EMAIL)).toBeUndefined();
    expect(await test.resolver.refresh('sub_primary', 'other', EMAIL)).toBeUndefined();
    expect(test.getLegacyCandidate).not.toHaveBeenCalled(); expect(test.retrieve).not.toHaveBeenCalled();
  });

  it('fails closed when the provider mode or configured prices are unavailable', async () => {
    const test = setup();
    const unknownMode = new StripePlusMembershipProofResolver({ ...test.dependencies, mode: () => 'unknown' });
    await expect(unknownMode.resolve(EMAIL)).rejects.toBeInstanceOf(PlusMembershipProofServiceError);
    test.getPriceId.mockReturnValue('same_price');
    await expect(test.resolver.resolve(EMAIL)).rejects.toBeInstanceOf(PlusMembershipProofServiceError);
    expect(test.retrieve).not.toHaveBeenCalled();
  });

  it('has a total deadline even if the injected transport never settles', async () => {
    vi.useFakeTimers();
    const test = setup(); test.retrieve.mockImplementation(() => new Promise(() => {}));
    const result = expect(test.resolver.refresh('sub_primary', 'cus_primary', EMAIL))
      .rejects.toBeInstanceOf(PlusMembershipProofServiceError);
    await vi.advanceTimersByTimeAsync(10_000);
    await result;
  });
});

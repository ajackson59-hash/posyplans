// Thin Stripe config layer. Lazily constructed so the app boots fine even
// before real Stripe keys exist \u2014 the checkout routes check
// isStripeConfigured() and return 503 "not configured yet" instead of
// crashing, so the Pricing page can render a graceful "launching soon"
// state until STRIPE_SECRET_KEY / STRIPE_PRICE_ID_SPARK /
// STRIPE_PRICE_ID_ANNUAL / STRIPE_PRICE_ID_MONTHLY are set (see .env.example).
import Stripe from "stripe";

export type BillingInterval = "annual" | "monthly";

// Which product a host is buying at checkout. "plus" is the recurring
// subscription ($11.99/mo or $99/yr); "spark" is the one-time $9.99 unlock
// that grants a single event its full AI-drafted plan.
export type CheckoutPlan = "plus" | "spark";

// Canonical USD amounts for each checkout, used as the conversion `value` sent
// to GA4 / Meta. Kept here alongside the price-id config so the analytics value
// and the Stripe Price stay conceptually in one place. Update if the published
// prices change.
export const CHECKOUT_PRICES = {
  spark: 9.99,
  plusMonthly: 11.99,
  plusAnnual: 99,
} as const;

// Posy's published prices are USD prices. Stripe Adaptive Pricing otherwise
// localizes from the checkout browser's IP, which can make a U.S. checkout
// appear in another currency when it passes through a remote browser.
export const USD_CHECKOUT_SESSION_DEFAULTS = {
  adaptive_pricing: { enabled: false },
} as const satisfies Pick<Stripe.Checkout.SessionCreateParams, "adaptive_pricing">;

/** Conversion value for a Plus subscription by billing interval. Defaults to
 *  the annual price when the interval is unknown. */
export function plusPriceValue(interval: BillingInterval | null | undefined): number {
  return interval === "monthly" ? CHECKOUT_PRICES.plusMonthly : CHECKOUT_PRICES.plusAnnual;
}

let stripeClient: Stripe | null = null;
let cachedKey: string | undefined;

export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!stripeClient || cachedKey !== key) {
    stripeClient = new Stripe(key);
    cachedKey = key;
  }
  return stripeClient;
}

export function getPriceId(billingInterval: BillingInterval): string | undefined {
  return billingInterval === "annual"
    ? process.env.STRIPE_PRICE_ID_ANNUAL
    : process.env.STRIPE_PRICE_ID_MONTHLY;
}

export function getSparkPriceId(): string | undefined {
  return process.env.STRIPE_PRICE_ID_SPARK;
}

export function isStripeConfigured(): boolean {
  return (
    !!getStripe() &&
    !!getSparkPriceId() &&
    !!getPriceId("annual") &&
    !!getPriceId("monthly")
  );
}

export function getWebhookSecret(): string | undefined {
  return process.env.STRIPE_WEBHOOK_SECRET;
}

/** Maps a Stripe subscription status to this app's plan-tier vocabulary
 *  (PLAN_TIERS in shared/schema.ts). Anything not actively usable collapses
 *  to "plus_expired" so gated-action checks (Phase 5) stay simple. */
export function planTierFromSubscriptionStatus(status: Stripe.Subscription.Status): "plus_trial" | "plus_active" | "plus_expired" {
  if (status === "trialing") return "plus_trial";
  if (status === "active") return "plus_active";
  return "plus_expired"; // past_due | canceled | unpaid | incomplete | incomplete_expired | paused
}

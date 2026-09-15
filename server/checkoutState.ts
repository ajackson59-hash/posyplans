import type Stripe from "stripe";

export function stripeMode(key = process.env.STRIPE_SECRET_KEY): "test" | "live" | "unconfigured" | "unknown" {
  if (!key) return "unconfigured";
  if (/^(sk|rk)_test_/.test(key)) return "test";
  if (/^(sk|rk)_live_/.test(key)) return "live";
  return "unknown";
}

export function checkoutPaymentSettled(session: Stripe.Checkout.Session): boolean {
  return session.status === "complete" && (
    session.payment_status === "paid" ||
    (session.payment_status === "no_payment_required" && session.amount_total === 0)
  );
}

export class CheckoutStateError extends Error {
  constructor(message: string, public readonly status: number, public readonly code: string) { super(message); }
}

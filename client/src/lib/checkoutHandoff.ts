export type CheckoutHandoffPhase = "none" | "confirming" | "confirmed" | "failed";

/**
 * Keeps the Stripe return path distinct from the ordinary entitlement gate.
 * A host who has just come back from Checkout must never flicker back to the
 * paywall while Posy confirms or retries the event unlock.
 */
export function getCheckoutHandoffPhase(
  returningFromCheckout: boolean,
  confirmationIsSuccess: boolean,
  confirmationIsError: boolean,
): CheckoutHandoffPhase {
  if (!returningFromCheckout) return "none";
  if (confirmationIsSuccess) return "confirmed";
  if (confirmationIsError) return "failed";
  return "confirming";
}

import { describe, expect, it } from "vitest";
import { USD_CHECKOUT_SESSION_DEFAULTS } from "../server/stripe";

describe("Stripe Checkout currency", () => {
  it("keeps Posy's advertised prices in USD instead of IP-localizing them", () => {
    expect(USD_CHECKOUT_SESSION_DEFAULTS).toEqual({
      adaptive_pricing: { enabled: false },
    });
  });
});

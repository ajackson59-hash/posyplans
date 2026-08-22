import { describe, expect, it } from "vitest";
import { getCheckoutHandoffPhase } from "@/lib/checkoutHandoff";

describe("Spark checkout handoff", () => {
  it("keeps a returning customer out of the paywall while confirmation settles", () => {
    expect(getCheckoutHandoffPhase(true, false, false)).toBe("confirming");
    expect(getCheckoutHandoffPhase(true, true, false)).toBe("confirmed");
    expect(getCheckoutHandoffPhase(true, false, true)).toBe("failed");
  });

  it("leaves ordinary entitlement checks on the normal path", () => {
    expect(getCheckoutHandoffPhase(false, false, false)).toBe("none");
  });
});

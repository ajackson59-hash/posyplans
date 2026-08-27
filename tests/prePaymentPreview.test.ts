import { describe, expect, it } from "vitest";
import { MAX_PRE_PAYMENT_PREVIEW_ATTEMPTS, canAttemptPrePaymentPreview } from "../server/prePaymentPreview";

const base = { sparkUnlockedAt: null as number | null, prePaymentPreviewAttempts: 0 };

describe("canAttemptPrePaymentPreview", () => {
  it("allows a fresh unpaid event without relying on persisted email identity", () => {
    expect(canAttemptPrePaymentPreview({ ...base })).toEqual({ ok: true });
  });

  it("refuses once attempts reach the cap", () => {
    const result = canAttemptPrePaymentPreview({
      ...base,
      prePaymentPreviewAttempts: MAX_PRE_PAYMENT_PREVIEW_ATTEMPTS,
    });
    expect(result).toEqual({ ok: false, reason: "attempts_exhausted" });
  });

  it("allows the exact last attempt before the cap", () => {
    const result = canAttemptPrePaymentPreview({
      ...base,
      prePaymentPreviewAttempts: MAX_PRE_PAYMENT_PREVIEW_ATTEMPTS - 1,
    });
    expect(result).toEqual({ ok: true });
  });

  it("reports already_paid for a Spark-unlocked event", () => {
    const result = canAttemptPrePaymentPreview({ ...base, sparkUnlockedAt: Date.now() });
    expect(result).toEqual({ ok: false, reason: "already_paid" });
  });
});

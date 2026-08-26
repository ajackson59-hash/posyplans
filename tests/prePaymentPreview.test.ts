import { describe, expect, it } from "vitest";
import { MAX_PRE_PAYMENT_PREVIEW_ATTEMPTS, canAttemptPrePaymentPreview } from "../server/prePaymentPreview";

const base = { sparkUnlockedAt: null as number | null, capturedEmail: null as string | null, prePaymentPreviewAttempts: 0 };

describe("canAttemptPrePaymentPreview", () => {
  it("refuses an event with no captured email", () => {
    expect(canAttemptPrePaymentPreview({ ...base })).toEqual({ ok: false, reason: "needs_email" });
  });

  it("allows a fresh, emailed, unpaid event", () => {
    expect(canAttemptPrePaymentPreview({ ...base, capturedEmail: "host@example.com" })).toEqual({ ok: true });
  });

  it("refuses once attempts reach the cap", () => {
    const result = canAttemptPrePaymentPreview({
      ...base,
      capturedEmail: "host@example.com",
      prePaymentPreviewAttempts: MAX_PRE_PAYMENT_PREVIEW_ATTEMPTS,
    });
    expect(result).toEqual({ ok: false, reason: "attempts_exhausted" });
  });

  it("allows the exact last attempt before the cap", () => {
    const result = canAttemptPrePaymentPreview({
      ...base,
      capturedEmail: "host@example.com",
      prePaymentPreviewAttempts: MAX_PRE_PAYMENT_PREVIEW_ATTEMPTS - 1,
    });
    expect(result).toEqual({ ok: true });
  });

  it("reports already_paid for a Spark-unlocked event even without an email", () => {
    const result = canAttemptPrePaymentPreview({ ...base, sparkUnlockedAt: Date.now() });
    expect(result).toEqual({ ok: false, reason: "already_paid" });
  });
});

// Gating logic for the pre-payment invitation preview (QA report B2a).
//
// Before this feature, the only ways to see real AI artwork were (a) already
// paid (Spark/Plus), or a generic simulated demo modal. This lets an unpaid
// host see ONE real, capped, low-resolution preview of their OWN invitation
// once they've supplied a plausible email in the current request — enough to
// build desire without making that provisional input the event's permanent
// recovery identity, and without ever letting a client loop the provider call
// for free.
//
// Pure functions only — no I/O — so this is trivially unit-testable and easy
// to reason about independent of the route/storage layer.

import type { Event } from "../shared/schema";

// Small and fixed on purpose: this is a marketing nudge, not the paid
// product. Three tries is enough to survive one quality-gate rejection
// without opening the door to unlimited free generations.
export const MAX_PRE_PAYMENT_PREVIEW_ATTEMPTS = 3;
// 160px made the teaser so soft that a host could not judge whether the
// direction matched their event. 320px is still a deliberately degraded
// preview, but it preserves enough subject/theme detail to create confidence
// before checkout while withholding the production-quality asset.
export const PRE_PAYMENT_PREVIEW_LONG_EDGE = 320;

// Preview v1 accidentally omitted the host's intake vibe and usually sent
// only the event name to the concept generator. Treat any asset created before
// the corrected route shipped as stale so a returning unpaid host receives
// one fresh preview from the brief they actually entered.
export const PRE_PAYMENT_PREVIEW_FIDELITY_CUTOFF_MS = Date.UTC(2026, 7, 27, 23, 15, 0);

export type PrePaymentPreviewDenialReason = "already_paid" | "attempts_exhausted";

export type PrePaymentPreviewAllowance =
  | { ok: true }
  | { ok: false; reason: PrePaymentPreviewDenialReason };

// The route calls canGenerateDraft() FIRST and short-circuits paid events
// (Spark unlock OR Plus subscription) before ever reaching this function —
// that's the authoritative, async-aware paid check. The sparkUnlockedAt
// check here is a cheap, synchronous, defense-in-depth guard for the Spark
// case specifically; it does not know about Plus, so it must never be the
// only paid check on the route.
export function canAttemptPrePaymentPreview(
  event: Pick<Event, "sparkUnlockedAt" | "prePaymentPreviewAttempts">,
): PrePaymentPreviewAllowance {
  if (event.sparkUnlockedAt) {
    return { ok: false, reason: "already_paid" };
  }
  if (event.prePaymentPreviewAttempts >= MAX_PRE_PAYMENT_PREVIEW_ATTEMPTS) {
    return { ok: false, reason: "attempts_exhausted" };
  }
  return { ok: true };
}

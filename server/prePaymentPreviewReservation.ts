import { and, eq, isNull, lt } from "drizzle-orm";
import { events, type Event } from "@shared/schema";
import { MAX_PRE_PAYMENT_PREVIEW_ATTEMPTS } from "./prePaymentPreview";

/** Compare-and-set in ONE UPDATE: another process cannot reserve this snapshot twice. */
export function previewReservationCondition(event: Event) {
  return and(
    eq(events.id, event.id),
    eq(events.ownerToken, event.ownerToken),
    isNull(events.sparkUnlockedAt),
    lt(events.prePaymentPreviewAttempts, MAX_PRE_PAYMENT_PREVIEW_ATTEMPTS),
    eq(events.prePaymentPreviewAttempts, event.prePaymentPreviewAttempts),
    eq(events.prePaymentPreviewUrl, event.prePaymentPreviewUrl),
    event.prePaymentPreviewUsedAt == null
      ? isNull(events.prePaymentPreviewUsedAt)
      : eq(events.prePaymentPreviewUsedAt, event.prePaymentPreviewUsedAt),
  );
}

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

/** A stale worker/read cannot overwrite a newer asset or a changed event brief. */
export function previewCompletionCondition(event: Event) {
  const briefFields = ["eventName", "eventType", "eventDate", "themeName", "vibeDescription", "paletteColors", "location", "venueName"] as const;
  return and(
    eq(events.id, event.id),
    eq(events.ownerToken, event.ownerToken),
    eq(events.prePaymentPreviewAttempts, event.prePaymentPreviewAttempts),
    eq(events.prePaymentPreviewUrl, event.prePaymentPreviewUrl),
    event.prePaymentPreviewUsedAt == null ? isNull(events.prePaymentPreviewUsedAt) : eq(events.prePaymentPreviewUsedAt, event.prePaymentPreviewUsedAt),
    ...briefFields.map((field) => eq(events[field], event[field] ?? "")),
    event.estimatedGuestCount == null ? isNull(events.estimatedGuestCount) : eq(events.estimatedGuestCount, event.estimatedGuestCount),
  );
}

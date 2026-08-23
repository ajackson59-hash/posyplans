export interface EventDetailsDraft {
  eventName: string;
  eventType: string;
  eventDate: string;
  location: string;
  hostNames: string;
  estimatedGuestCount: string;
  vibeDescription: string;
}

export interface EventDetailsUpdate {
  eventName: string;
  eventType: string;
  eventDate: string;
  location: string;
  hostNames: string;
  estimatedGuestCount: number | null;
  vibeDescription: string;
}

/**
 * Validates and normalizes the editable event foundation. This function is
 * deliberately data-only: saving these fields must never trigger generation
 * or overwrite the host's existing plan.
 */
export function buildEventDetailsUpdate(draft: EventDetailsDraft): EventDetailsUpdate {
  const guestCountText = draft.estimatedGuestCount.trim();
  const estimatedGuestCount = guestCountText === "" ? null : Number(guestCountText);

  if (
    estimatedGuestCount !== null &&
    (!Number.isInteger(estimatedGuestCount) || estimatedGuestCount < 1 || estimatedGuestCount > 2000)
  ) {
    throw new Error("Estimated guest count must be a whole number between 1 and 2,000.");
  }

  const vibeDescription = draft.vibeDescription.trim();
  if (vibeDescription.length > 500) {
    throw new Error("Planning brief must be 500 characters or fewer.");
  }

  return {
    eventName: draft.eventName.trim() || "My Celebration",
    eventType: draft.eventType,
    eventDate: draft.eventDate,
    location: draft.location.trim(),
    hostNames: draft.hostNames.trim(),
    estimatedGuestCount,
    vibeDescription,
  };
}

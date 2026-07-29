// Resolves the single canonical guest count for an event, for use anywhere
// a "how many people" number is needed (AI generation prompts, readiness
// checks, budget feasibility, etc).
//
// Mirrors the existing client-side `headcountForAi` pattern (see
// BudgetTab.tsx / Dashboard.tsx's `stats` memo): once guests exist, a
// confirmed RSVP headcount is a better signal than the invited headcount,
// which in turn beats the host's ballpark Intake estimate. Falls back to
// the estimate only when no guests have been added yet at all.

export interface GuestForCount {
  partySize: number;
  rsvpStatus: string;
  attendingCount: number | null;
}

export function resolveGuestCount(
  estimatedGuestCount: number | null | undefined,
  guests: GuestForCount[],
): number {
  if (guests.length > 0) {
    const invitedHeadcount = guests.reduce((sum, g) => sum + g.partySize, 0);
    const confirmedHeadcount = guests
      .filter((g) => g.rsvpStatus === "yes")
      .reduce((sum, g) => sum + (g.attendingCount ?? g.partySize), 0);

    const headcount = confirmedHeadcount > 0 ? confirmedHeadcount : invitedHeadcount;
    if (headcount > 0) return headcount;
  }

  if (typeof estimatedGuestCount === "number" && estimatedGuestCount > 0) {
    return estimatedGuestCount;
  }

  return 1;
}

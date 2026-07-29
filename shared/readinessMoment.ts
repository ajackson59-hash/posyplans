// The "readiness moment" trigger (Product Constitution "Quick Wow" — named
// verbatim in the Phase 3 report's Signature Wow Moments section): a single
// calm message during the final week before the event, once the Event
// Readiness Score (shared/readinessScore.ts) is high enough to say the plan
// is genuinely solid.
//
// Pure date math plus a threshold check over data that already exists — the
// event's own date field and the already-computed readiness score. No new
// AI cost, no schema change, no new endpoint. Deliberately silent (returns
// show: false) whenever the event date can't be confidently parsed, the
// event has already passed, the event is more than a week out, or the
// score isn't high enough yet — same "only speak up when there is
// something real to say" discipline as shared/eventDna.ts.

import { parse, isValid, differenceInCalendarDays } from "date-fns";

// Mirrors the parseable formats DatePickerField.tsx accepts, since eventDate
// is stored as a friendly display string (or free text like "TBD"), not a
// strict ISO date.
const PARSE_FORMATS = [
  "EEE, MMM d, yyyy",
  "MMMM d, yyyy",
  "MMM d, yyyy",
  "M/d/yyyy",
  "MM/dd/yyyy",
  "yyyy-MM-dd",
];

// Matches readinessScore.ts's "Nearly ready" band cutoff — deliberately
// reuses that existing boundary rather than inventing a new one.
const READY_THRESHOLD = 75;
// "~7 days out," per the Phase 3 report's wording for this moment.
const WINDOW_DAYS = 7;

export function parseEventDate(value: string, referenceDate: Date = new Date()): Date | null {
  if (!value) return null;
  for (const fmt of PARSE_FORMATS) {
    const parsed = parse(value, fmt, referenceDate);
    if (isValid(parsed)) return parsed;
  }
  return null;
}

/** Calendar days from `now` to the parsed event date. Null if unparseable. */
export function getDaysUntilEvent(eventDate: string, now: Date = new Date()): number | null {
  const parsed = parseEventDate(eventDate, now);
  if (!parsed) return null;
  return differenceInCalendarDays(parsed, now);
}

export interface ReadinessMomentResult {
  show: boolean;
  daysUntil: number | null;
}

export function getReadinessMoment(
  eventDate: string,
  overall: number,
  now: Date = new Date(),
): ReadinessMomentResult {
  const daysUntil = getDaysUntilEvent(eventDate, now);
  const show = daysUntil !== null && daysUntil >= 0 && daysUntil <= WINDOW_DAYS && overall >= READY_THRESHOLD;
  return { show, daysUntil };
}

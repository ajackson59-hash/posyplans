import { parse, isValid, differenceInCalendarDays, addDays, format, max } from "date-fns";

// #25 from the Engineering Backlog — Automatic RSVP deadline calculation.
//
// rsvpDeadline is a free-text field the host can set manually (see
// shared/schema.ts). This module never overwrites that choice. It only
// computes a suggested value for the UI to offer as a one-click default
// when the host has not set a deadline yet — consistent with the Product
// Constitution's "infer instead of asking" lens: reduce the decision the
// host has to make, without taking the decision away from them.
//
// Note on scope: the original backlog note also mentioned factoring in
// "vendor lock-in dates already in budget items" — budgetItems has no date
// field in the schema (shared/schema.ts), so there is no vendor-date data
// to pull from today. This implementation is the event-date-only half of
// the rule; a vendor-deadline input would need its own schema field first.

// Mirrors DatePickerField.tsx / readinessMoment.ts's parse format list,
// since eventDate is stored as free-text in one of these common shapes.
const DISPLAY_FORMAT = "EEE, MMM d, yyyy";
const PARSE_FORMATS = [
  DISPLAY_FORMAT,
  "MMMM d, yyyy",
  "MMM d, yyyy",
  "d MMMM yyyy",
  "d MMM yyyy",
  "M/d/yyyy",
  "MM/dd/yyyy",
  "yyyy-MM-dd",
];

export function parseEventDate(value: string, referenceDate: Date = new Date()): Date | null {
  if (!value) return null;
  for (const fmt of PARSE_FORMATS) {
    const parsed = parse(value, fmt, referenceDate);
    if (isValid(parsed)) return parsed;
  }
  return null;
}

// Response-lag rule of thumb: the closer the event, the less lag time is
// left to ask for, so the requested lag shrinks with the runway. Inside 4
// days there usually is not enough runway left for a deadline to change
// host behavior (they should just be calling/texting stragglers directly),
// so no suggestion is offered.
function lagDaysFor(daysUntilEvent: number): number | null {
  if (daysUntilEvent >= 21) return 14;
  if (daysUntilEvent >= 10) return 7;
  if (daysUntilEvent >= 4) return 2;
  return null;
}

/**
 * Suggests a friendly-format RSVP deadline string, or null when there is
 * not enough information (unparseable/empty eventDate) or not enough
 * runway (event already happened, or is under 4 days out) to make a
 * meaningful suggestion.
 */
export function suggestRsvpDeadline(eventDate: string, now: Date = new Date()): string | null {
  const parsedEventDate = parseEventDate(eventDate, now);
  if (!parsedEventDate) return null;

  const daysUntilEvent = differenceInCalendarDays(parsedEventDate, now);
  if (daysUntilEvent < 0) return null;

  const lagDays = lagDaysFor(daysUntilEvent);
  if (lagDays === null) return null;

  // Defensive clamp: never suggest a deadline before today, even though the
  // lagDaysFor buckets above are chosen so this should not trigger in
  // practice.
  const suggestedDate = max([addDays(parsedEventDate, -lagDays), now]);
  return format(suggestedDate, DISPLAY_FORMAT);
}

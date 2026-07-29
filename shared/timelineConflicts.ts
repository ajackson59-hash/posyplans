// Timeline conflict detection: flags scheduling problems within the day-of
// timeline itself — two things happening at the exact same clock time, or
// items whose listed running order disagrees with their actual clock times
// (a strong signal of a data-entry mistake or a genuinely mis-scheduled
// step, e.g. "Setup" timed after "Guests arrive").
//
// Deliberately rule-based, not a separate AI call. The `time` field is
// free text (e.g. "2:00 PM" or "30 min before guests arrive"), so this only
// reasons about items with a recognizable absolute clock time — anything
// written as relative or descriptive text is silently skipped rather than
// guessed at. A close but imperfect back-to-back gap (e.g. 5 minutes
// between "Cake cutting" and "Speeches") is intentionally NOT flagged as a
// "tight buffer" — for most parties that's completely normal, and treating
// every close gap as a conflict would be noisy. Computed fresh on every
// read — never persisted — same pattern as shared/contradictions.ts.
//
// Kept framework-agnostic (plain objects, no React/Express types) so this
// file can be imported by both the Express server and the React client.

export type TimelineConflictSeverity = "notice" | "warning";

export interface TimelineConflict {
  id: string;
  severity: TimelineConflictSeverity;
  title: string;
  detail: string;
  modules: string[];
}

/** Minimal shape needed from a timeline item — matches shared/schema.ts's TimelineItem. */
export interface TimelineItemSignalInput {
  id: number;
  title: string;
  time: string;
  sortOrder: number;
}

/**
 * Parses a free-text time string into minutes since midnight, or null if it
 * isn't a recognizable absolute clock time (e.g. "30 min before guests
 * arrive", "TBD", or empty).
 */
export function parseTimeToMinutes(raw: string): number | null {
  const text = raw.trim().toLowerCase();
  if (!text) return null;
  if (text === "noon") return 12 * 60;
  if (text === "midnight") return 0;

  // 12-hour clock, optional minutes, required am/pm — e.g. "2 pm", "2:30pm".
  const twelveHour = text.match(/^(\d{1,2})(?::([0-5]\d))?\s*(am|pm)$/);
  if (twelveHour) {
    let hour = parseInt(twelveHour[1], 10);
    const minute = twelveHour[2] ? parseInt(twelveHour[2], 10) : 0;
    if (hour < 1 || hour > 12) return null;
    if (hour === 12) hour = 0;
    if (twelveHour[3] === "pm") hour += 12;
    return hour * 60 + minute;
  }

  // 24-hour clock — e.g. "14:00", "09:30".
  const twentyFourHour = text.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (twentyFourHour) {
    return parseInt(twentyFourHour[1], 10) * 60 + parseInt(twentyFourHour[2], 10);
  }

  return null;
}

function formatMinutes(minutes: number): string {
  const hour24 = Math.floor(minutes / 60);
  const min = minutes % 60;
  const period = hour24 < 12 ? "AM" : "PM";
  let hour12 = hour24 % 12;
  if (hour12 === 0) hour12 = 12;
  return `${hour12}:${min.toString().padStart(2, "0")} ${period}`;
}

export function detectTimelineConflicts(items: TimelineItemSignalInput[]): TimelineConflict[] {
  const conflicts: TimelineConflict[] = [];

  // Reason in the host's intended running order (sortOrder), not DB fetch order.
  const ordered = [...items].sort((a, b) => a.sortOrder - b.sortOrder);
  const parsed = ordered
    .map((item) => ({ item, minutes: parseTimeToMinutes(item.time) }))
    .filter((p): p is { item: TimelineItemSignalInput; minutes: number } => p.minutes !== null);

  // 1. Exact-time collisions — two or more items claim the same clock time.
  const byMinute = new Map<number, TimelineItemSignalInput[]>();
  for (const { item, minutes } of parsed) {
    const bucket = byMinute.get(minutes) ?? [];
    bucket.push(item);
    byMinute.set(minutes, bucket);
  }
  for (const [minutes, bucket] of Array.from(byMinute.entries())) {
    if (bucket.length < 2) continue;
    const titles = bucket.map((b: TimelineItemSignalInput) => `"${b.title}"`).join(" and ");
    conflicts.push({
      id: `timeline-collision-${minutes}`,
      severity: "notice",
      title: "Two timeline items are set at the same time",
      detail: `${titles} are both scheduled for ${formatMinutes(minutes)}. If that's intentional (things happening in parallel), no action needed — otherwise, one may need a new time.`,
      modules: ["timeline"],
    });
  }

  // 2. Out-of-order items — listed earlier in the running order but timed
  // later in the day than the very next item (or vice versa), which usually
  // means the list order and the actual clock times disagree.
  for (let i = 0; i < parsed.length - 1; i++) {
    const current = parsed[i];
    const next = parsed[i + 1];
    if (next.minutes < current.minutes) {
      conflicts.push({
        id: `timeline-order-${current.item.id}-${next.item.id}`,
        severity: "warning",
        title: "Timeline items may be out of order",
        detail: `"${next.item.title}" (${formatMinutes(next.minutes)}) is listed right after "${current.item.title}" (${formatMinutes(current.minutes)}), but it's timed earlier in the day. Worth double-checking the order or the times.`,
        modules: ["timeline"],
      });
    }
  }

  return conflicts;
}

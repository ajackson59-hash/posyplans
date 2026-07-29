// Day-of timeline generation for the AI Master Planner's first draft.
//
// Deliberately rule-based, NOT an AI call (see Engineering Breakdown §1) —
// scheduling logic like "how much setup buffer a guest count needs" or
// "should a cake-cutting moment appear" is deterministic given the inputs,
// so this module costs zero AI calls, can be tested exhaustively for free,
// and is instantly explainable to a host who asks "why is this here?".
//
// This is a *materially rebuilt* version of the static per-event-type
// lookup table that already exists for the manual "insert template" button
// in client/src/components/TimelineTab.tsx (see SUGGESTED_TIMELINE_TEMPLATES
// in client/src/lib/types.ts). That lookup is untouched — it's a different
// UI affordance (a host manually inserting a starter list). This module is
// the one the orchestrator calls to produce the *first-draft* timeline,
// and it varies its output by guest count and by what's actually on the
// menu, rather than returning the exact same list for every event of a
// given type.
//
// Kept framework-agnostic (plain objects, no React/Express types) so this
// file can be imported by both the Express server and the React client —
// same convention as shared/missingItems.ts and shared/timelineConflicts.ts.

export interface GeneratedTimelineItem {
  time: string;
  title: string;
  category: string;
  sortOrder: number;
}

export interface GenerateTimelineInput {
  eventType: string;
  /** Resolved headcount — caller decides real guest/RSVP count vs. estimatedGuestCount fallback. */
  guestCount: number;
  /** Whether the generated/current menu includes a Cake-course item. */
  hasCakeMenuItem: boolean;
}

interface BaseTemplateItem {
  time: string;
  title: string;
  category: string;
}

// One base scaffold per event type — the deterministic starting point this
// module then adjusts for guest count and menu contents. Mirrors the shape
// (not a re-export) of SUGGESTED_TIMELINE_TEMPLATES in client/src/lib/types.ts,
// duplicated here rather than cross-imported since that file lives under
// client/ and isn't reachable from the server build (same rationale as the
// SUGGESTED_SHOPPING_ITEMS duplication in shared/missingItems.ts).
const BASE_TEMPLATES: Record<string, BaseTemplateItem[]> = {
  "Birthday Party": [
    { time: "1 hr before", title: "Decorate & set up food table", category: "Setup" },
    { time: "Start time", title: "Guests start arriving", category: "Arrival" },
    { time: "+30 min", title: "Games / activities", category: "Activities" },
    { time: "+1 hr", title: "Serve food", category: "Food & Toasts" },
    { time: "+1.5 hr", title: "Sing happy birthday & cut cake", category: "Special Moments" },
    { time: "+2 hr", title: "Open gifts", category: "Special Moments" },
    { time: "End time", title: "Party favors & goodbyes", category: "Wind Down" },
    { time: "After", title: "Breakdown & cleanup", category: "Cleanup" },
  ],
  "Baby Shower": [
    { time: "1 hr before", title: "Decorate & set up food/drinks", category: "Setup" },
    { time: "Start time", title: "Guests arrive & mingle", category: "Arrival" },
    { time: "+30 min", title: "Games (guess the baby food, etc.)", category: "Activities" },
    { time: "+1 hr", title: "Serve food & cake", category: "Food & Toasts" },
    { time: "+1.5 hr", title: "Open gifts", category: "Special Moments" },
    { time: "End time", title: "Thank-you & favors", category: "Wind Down" },
    { time: "After", title: "Cleanup", category: "Cleanup" },
  ],
  "Wedding": [
    { time: "3 hr before", title: "Vendors arrive & set up (florist, caterer, DJ)", category: "Setup" },
    { time: "1 hr before", title: "Guests arrive & are seated", category: "Arrival" },
    { time: "Start time", title: "Ceremony", category: "Special Moments" },
    { time: "+30 min", title: "Cocktail hour / photos", category: "Activities" },
    { time: "+1.5 hr", title: "Reception entrance", category: "Arrival" },
    { time: "+2 hr", title: "Dinner served", category: "Food & Toasts" },
    { time: "+2.5 hr", title: "Toasts & speeches", category: "Special Moments" },
    { time: "+3 hr", title: "First dance", category: "Special Moments" },
    { time: "+3.5 hr", title: "Cake cutting", category: "Special Moments" },
    { time: "+4 hr", title: "Open dancing", category: "Activities" },
    { time: "End time", title: "Send-off (sparklers, bubbles, etc.)", category: "Wind Down" },
    { time: "After", title: "Vendor breakdown & venue cleanup", category: "Cleanup" },
  ],
  "Bridal Shower": [
    { time: "1 hr before", title: "Decorate & set up food/drinks", category: "Setup" },
    { time: "Start time", title: "Guests arrive & mingle", category: "Arrival" },
    { time: "+30 min", title: "Games / advice cards for the bride", category: "Activities" },
    { time: "+1 hr", title: "Serve food & drinks", category: "Food & Toasts" },
    { time: "+1.5 hr", title: "Open gifts", category: "Special Moments" },
    { time: "End time", title: "Thank-you & favors", category: "Wind Down" },
    { time: "After", title: "Cleanup", category: "Cleanup" },
  ],
  "Graduation": [
    { time: "1 hr before", title: "Decorate & set up food table", category: "Setup" },
    { time: "Start time", title: "Guests arrive", category: "Arrival" },
    { time: "+30 min", title: "Serve food", category: "Food & Toasts" },
    { time: "+1 hr", title: "Toast to the graduate", category: "Special Moments" },
    { time: "+1.5 hr", title: "Photos & mingling", category: "Activities" },
    { time: "End time", title: "Guests depart", category: "Wind Down" },
    { time: "After", title: "Cleanup", category: "Cleanup" },
  ],
  "Anniversary": [
    { time: "1 hr before", title: "Decorate & set up food table", category: "Setup" },
    { time: "Start time", title: "Guests arrive", category: "Arrival" },
    { time: "+30 min", title: "Dinner served", category: "Food & Toasts" },
    { time: "+1.5 hr", title: "Toasts, speeches / slideshow", category: "Special Moments" },
    { time: "+2 hr", title: "Dancing / mingling", category: "Activities" },
    { time: "End time", title: "Guests depart", category: "Wind Down" },
    { time: "After", title: "Cleanup", category: "Cleanup" },
  ],
  "Holiday Gathering": [
    { time: "1 hr before", title: "Decorate & set up food table", category: "Setup" },
    { time: "Start time", title: "Guests arrive", category: "Arrival" },
    { time: "+45 min", title: "Food served (potluck / buffet)", category: "Food & Toasts" },
    { time: "+1.5 hr", title: "Gift exchange / games", category: "Activities" },
    { time: "End time", title: "Guests depart", category: "Wind Down" },
    { time: "After", title: "Cleanup", category: "Cleanup" },
  ],
  "Housewarming": [
    { time: "1 hr before", title: "Set up food & drinks", category: "Setup" },
    { time: "Start time", title: "Guests arrive, house tour", category: "Arrival" },
    { time: "+45 min", title: "Food & drinks served", category: "Food & Toasts" },
    { time: "+1.5 hr", title: "Mingling", category: "Activities" },
    { time: "End time", title: "Guests depart", category: "Wind Down" },
    { time: "After", title: "Cleanup", category: "Cleanup" },
  ],
  "Corporate Event": [
    { time: "2 hr before", title: "AV/tech check & room setup", category: "Setup" },
    { time: "Start time", title: "Registration / check-in", category: "Arrival" },
    { time: "+15 min", title: "Welcome remarks", category: "Special Moments" },
    { time: "+30 min", title: "Main program / presentations", category: "Activities" },
    { time: "+1.5 hr", title: "Meal / networking break", category: "Food & Toasts" },
    { time: "End time", title: "Closing remarks", category: "Wind Down" },
    { time: "After", title: "Breakdown & load-out", category: "Cleanup" },
  ],
  "Other Celebration": [
    { time: "1 hr before", title: "Decorate & set up", category: "Setup" },
    { time: "Start time", title: "Guests arrive", category: "Arrival" },
    { time: "+30 min", title: "Main activity", category: "Activities" },
    { time: "+1 hr", title: "Food & drinks served", category: "Food & Toasts" },
    { time: "End time", title: "Guests depart", category: "Wind Down" },
    { time: "After", title: "Cleanup", category: "Cleanup" },
  ],
};

const FALLBACK_TEMPLATE_KEY = "Other Celebration";

/**
 * Reads a "N hr before" / "N.N hr before" Setup-item time string into hours.
 * Returns null for anything else (e.g. "Start time", "After") — those are
 * left untouched since there's nothing to scale.
 */
function parseHoursBefore(raw: string): number | null {
  const match = raw.trim().toLowerCase().match(/^([\d.]+)\s*hr before$/);
  if (!match) return null;
  const hours = parseFloat(match[1]);
  return Number.isFinite(hours) ? hours : null;
}

function formatHoursBefore(hours: number): string {
  // Keep whole numbers clean ("2 hr before") and only show a decimal when needed.
  const rounded = Math.round(hours * 10) / 10;
  return `${rounded % 1 === 0 ? rounded : rounded.toFixed(1)} hr before`;
}

/**
 * How much Setup lead time a guest count realistically needs, regardless of
 * event type. Only ever used to push a template's buffer UP, never down —
 * an event type's own baseline (e.g. a wedding's 3 hr vendor setup) reflects
 * something this module has no basis to shrink.
 */
function requiredSetupHours(guestCount: number): number {
  if (guestCount > 100) return 3;
  if (guestCount > 60) return 2;
  if (guestCount > 25) return 1.5;
  return 1;
}

/** Large guest counts realistically take longer to arrive and settle than a fixed 30-minute window implies. */
const STAGGERED_ARRIVAL_THRESHOLD = 75;

export function generateTimeline(input: GenerateTimelineInput): GeneratedTimelineItem[] {
  const template = BASE_TEMPLATES[input.eventType] ?? BASE_TEMPLATES[FALLBACK_TEMPLATE_KEY];
  const guestCount = Math.max(0, input.guestCount || 0);

  // 1. Scale Setup buffer up if the guest count warrants more lead time than
  // this event type's baseline already provides.
  const needed = requiredSetupHours(guestCount);
  const scaled: BaseTemplateItem[] = template.map((item) => {
    if (item.category !== "Setup") return item;
    const existingHours = parseHoursBefore(item.time);
    if (existingHours === null || existingHours >= needed) return item;
    return { ...item, time: formatHoursBefore(needed) };
  });

  // 2. Insert a staggered-arrival moment for large guest counts, right after
  // the last Arrival-category item and before whatever comes next.
  const withArrival: BaseTemplateItem[] = [];
  for (let i = 0; i < scaled.length; i++) {
    withArrival.push(scaled[i]);
    const isLastArrivalItem =
      scaled[i].category === "Arrival" && (i === scaled.length - 1 || scaled[i + 1].category !== "Arrival");
    if (isLastArrivalItem && guestCount > STAGGERED_ARRIVAL_THRESHOLD) {
      withArrival.push({
        time: "+20 min",
        title: "Guests continue arriving (staggered)",
        category: "Arrival",
      });
    }
  }

  // 3. Insert a "Cake cutting" Special Moment if the menu actually has a
  // Cake item and the template doesn't already reference cake in some form
  // (Wedding and Birthday templates already do — leave those untouched
  // rather than duplicating the moment).
  const alreadyMentionsCake = withArrival.some((item) => item.title.toLowerCase().includes("cake"));
  const result: GeneratedTimelineItem[] = [];
  let inserted = false;
  for (let i = 0; i < withArrival.length; i++) {
    result.push({ ...withArrival[i], sortOrder: 0 }); // sortOrder assigned below
    const isLastFoodItem =
      withArrival[i].category === "Food & Toasts" &&
      (i === withArrival.length - 1 || withArrival[i + 1].category !== "Food & Toasts");
    if (isLastFoodItem && input.hasCakeMenuItem && !alreadyMentionsCake && !inserted) {
      result.push({
        time: "Shortly after the meal",
        title: "Cake cutting",
        category: "Special Moments",
        sortOrder: 0,
      });
      inserted = true;
    }
  }

  return result.map((item, index) => ({ ...item, sortOrder: index }));
}

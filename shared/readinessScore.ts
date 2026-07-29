// "Event Readiness Score": one synthesized number (0-100) that answers
// "how ready is this event, right now?" by combining budget health, menu
// completeness, RSVP response rate, shopping-list coverage, and timeline
// planning into a single weighted average.
//
// Deliberately rule-based, not a separate AI call: every sub-score here is
// a transparent, explainable function of real data already on the event,
// so there is no added AI cost and nothing to keep in sync. Computed fresh
// on read — never persisted — so it can never go stale relative to the
// event's current data. Same "quiet, deterministic-first" pattern as
// shared/eventDna.ts and shared/contradictions.ts.
//
// Unlike Event DNA (which stays silent when there isn't enough signal to
// have an opinion), an empty module here IS the finding: a host with zero
// budget items really is 0% ready on budget. So every dimension always
// counts, using fixed importance weights rather than data-presence weights.
//
// Kept framework-agnostic (plain objects, no React/Express types) so this
// file can be imported by both the Express server and the React client.

export type ReadinessDimension = "budget" | "menu" | "rsvp" | "shopping" | "timeline";

export interface ReadinessDimensionResult {
  score: number; // 0-100
  label: string; // short human-readable dimension name
}

export interface NextAction {
  dimension: ReadinessDimension;
  label: string; // dimension's short human-readable name
  action: string; // one-line, actionable next step
  tab: string; // Dashboard tab id to jump to for this action
}

export interface ReadinessScoreResult {
  overall: number; // 0-100
  band: string; // e.g. "On track"
  dimensions: Record<ReadinessDimension, ReadinessDimensionResult>;
  reasons: string[]; // short, actionable explanations — biggest gap first (top 2, for compact display)
  // Every dimension below 90%, ranked biggest-gap-first — the full "what's
  // actually left to decide" queue (Engineering Backlog #29). A thin
  // re-ranking layer over the same rawScores this file already computes:
  // no new inputs, no new AI cost. `reasons` is kept for the compact score
  // card; `nextActions` is the same underlying gaps, unlimited and paired
  // with a tab to jump to, for a dedicated actionable list.
  nextActions: NextAction[];
}

/** Minimal shape needed from a budget item — matches shared/schema.ts's BudgetItem. */
export interface BudgetSignalInput {
  estimatedCost: number;
}

/** Minimal shape needed from a menu item — matches shared/schema.ts's MenuItem. */
export interface MenuSignalInput {
  course: string;
}

/** Minimal shape needed from a guest — matches shared/schema.ts's Guest. */
export interface GuestSignalInput {
  rsvpStatus: string; // "yes" | "no" | "maybe" | "pending"
}

/** Minimal shape needed from a shopping item — matches shared/schema.ts's ShoppingListItem. */
export interface ShoppingSignalInput {
  status: string; // "need" | "have" | "borrowing"
}

/** Minimal shape needed from a timeline item — matches shared/schema.ts's TimelineItem. */
export interface TimelineSignalInput {
  title: string;
}

export interface ReadinessScoreInput {
  budgetTotal: number | null | undefined;
  budgetItems: BudgetSignalInput[];
  menuItems: MenuSignalInput[];
  guests: GuestSignalInput[];
  shoppingItems: ShoppingSignalInput[];
  timelineItems: TimelineSignalInput[];
}

// Must stay in sync with client/src/lib/types.ts's MENU_COURSES.
const EXPECTED_MENU_COURSES = ["Appetizers", "Main Course", "Sides", "Dessert", "Drinks & Bar"];

// A well-planned timeline for a typical event covers roughly this many
// distinct moments (setup, arrival, main activity, food, wind-down/cleanup).
const EXPECTED_TIMELINE_ITEMS = 5;
// A well-scoped budget for a typical event has roughly this many line items.
const EXPECTED_BUDGET_ITEMS = 6;

/** How much each dimension counts toward the overall score. Sums to 1. */
const DIMENSION_WEIGHTS: Record<ReadinessDimension, number> = {
  budget: 0.2,
  menu: 0.2,
  rsvp: 0.25,
  shopping: 0.15,
  timeline: 0.2,
};

const DIMENSION_LABELS: Record<ReadinessDimension, string> = {
  budget: "Budget",
  menu: "Menu",
  rsvp: "RSVPs",
  shopping: "Shopping list",
  timeline: "Timeline",
};

// Which Dashboard.tsx tab each dimension's fix lives on, so "what's left to
// decide" items can jump the host straight there instead of just naming it.
const DIMENSION_TABS: Record<ReadinessDimension, string> = {
  budget: "budget",
  menu: "menu",
  rsvp: "guests",
  shopping: "shopping",
  timeline: "timeline",
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function scoreBudget(budgetTotal: number | null | undefined, budgetItems: BudgetSignalInput[]): number {
  if (budgetItems.length === 0) return 0;
  const itemsTotal = budgetItems.reduce((sum, b) => sum + (b.estimatedCost || 0), 0);
  let completeness = clamp((budgetItems.length / EXPECTED_BUDGET_ITEMS) * 100, 0, 100);
  // Can't credit full "budget readiness" without an overall number to plan against.
  if (budgetTotal == null || budgetTotal <= 0) completeness = Math.min(completeness, 50);
  let overrunPenalty = 0;
  if (budgetTotal != null && budgetTotal > 0 && itemsTotal > budgetTotal * 1.05) {
    overrunPenalty = clamp(((itemsTotal / budgetTotal) - 1) * 100, 0, 30);
  }
  return clamp(completeness - overrunPenalty, 0, 100);
}

function scoreMenu(menuItems: MenuSignalInput[]): number {
  if (menuItems.length === 0) return 0;
  const coursesPresent = new Set(menuItems.map((m) => m.course));
  const covered = EXPECTED_MENU_COURSES.filter((c) => coursesPresent.has(c)).length;
  return clamp((covered / EXPECTED_MENU_COURSES.length) * 100, 0, 100);
}

function scoreRsvp(guests: GuestSignalInput[]): number {
  if (guests.length === 0) return 0;
  const responded = guests.filter((g) => g.rsvpStatus !== "pending").length;
  return clamp((responded / guests.length) * 100, 0, 100);
}

function scoreShopping(shoppingItems: ShoppingSignalInput[]): number {
  if (shoppingItems.length === 0) return 0;
  const covered = shoppingItems.filter((s) => s.status !== "need").length;
  return clamp((covered / shoppingItems.length) * 100, 0, 100);
}

function scoreTimeline(timelineItems: TimelineSignalInput[]): number {
  if (timelineItems.length === 0) return 0;
  // Completeness only for now — true overlap/conflict detection (Engineering
  // Backlog #19) would penalize this further once the `time` field is
  // structured enough to parse reliably.
  return clamp((timelineItems.length / EXPECTED_TIMELINE_ITEMS) * 100, 0, 100);
}

function bandFor(overall: number): string {
  if (overall < 25) return "Just getting started";
  if (overall < 50) return "Making progress";
  if (overall < 75) return "On track";
  if (overall < 90) return "Nearly ready";
  return "Ready to go";
}

export function computeReadinessScore(input: ReadinessScoreInput): ReadinessScoreResult {
  const { budgetTotal, budgetItems, menuItems, guests, shoppingItems, timelineItems } = input;

  const rawScores: Record<ReadinessDimension, number> = {
    budget: scoreBudget(budgetTotal, budgetItems),
    menu: scoreMenu(menuItems),
    rsvp: scoreRsvp(guests),
    shopping: scoreShopping(shoppingItems),
    timeline: scoreTimeline(timelineItems),
  };

  const overall = clamp(
    (Object.keys(rawScores) as ReadinessDimension[]).reduce(
      (sum, dim) => sum + rawScores[dim] * DIMENSION_WEIGHTS[dim],
      0,
    ),
    0,
    100,
  );

  const dimensions: Record<ReadinessDimension, ReadinessDimensionResult> = {
    budget: { score: rawScores.budget, label: DIMENSION_LABELS.budget },
    menu: { score: rawScores.menu, label: DIMENSION_LABELS.menu },
    rsvp: { score: rawScores.rsvp, label: DIMENSION_LABELS.rsvp },
    shopping: { score: rawScores.shopping, label: DIMENSION_LABELS.shopping },
    timeline: { score: rawScores.timeline, label: DIMENSION_LABELS.timeline },
  };

  // Surface the lowest-scoring dimension(s) as the next actionable step —
  // sorted ascending so the biggest gap comes first.
  const ranked = (Object.keys(rawScores) as ReadinessDimension[]).sort((a, b) => rawScores[a] - rawScores[b]);
  const gaps = ranked.filter((dim) => rawScores[dim] < 90); // don't call out things that are basically done

  const reasons: string[] = gaps.slice(0, 2).map((dim) => reasonFor(dim, rawScores[dim]));
  if (reasons.length === 0) {
    reasons.push("Every module looks in good shape — you're close to fully ready.");
  }

  // Same gaps, unlimited and tab-linked — the full decision queue instead of
  // a flat two-line summary.
  const nextActions: NextAction[] = gaps.map((dim) => ({
    dimension: dim,
    label: DIMENSION_LABELS[dim],
    action: reasonFor(dim, rawScores[dim]),
    tab: DIMENSION_TABS[dim],
  }));

  return { overall: Math.round(overall), band: bandFor(overall), dimensions, reasons, nextActions };
}

function reasonFor(dim: ReadinessDimension, score: number): string {
  switch (dim) {
    case "budget":
      return score === 0
        ? "No budget items yet — add a few to start tracking spend."
        : "Budget could use more line items or a check against your overall total.";
    case "menu":
      return score === 0
        ? "No menu items yet — add dishes across a few courses."
        : "Menu is missing a course or two (appetizers, sides, dessert, drinks).";
    case "rsvp":
      return score === 0
        ? "No guests added yet, or none have responded — invite people and follow up."
        : "Some guests still haven't responded — a reminder email could help.";
    case "shopping":
      return score === 0
        ? "No shopping list yet — jot down what you still need to get."
        : "Several shopping items are still marked \"need\" — check them off as you gather them.";
    case "timeline":
      return score === 0
        ? "No timeline yet — sketch out the day's key moments."
        : "Timeline could use a few more key moments (setup, arrival, wind-down).";
  }
}

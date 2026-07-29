// Budget-feasibility scoring: compares what a host has actually budgeted per
// category against a rough, hardcoded "typical for a group this size"
// benchmark, so a host can see "this category is running well above what
// most parties this size spend" before they commit to a vendor or a
// number, rather than after they're already over.
//
// This is a different signal than the Readiness Score's budget dimension
// (shared/readinessScore.ts), which only measures how many line items exist
// (completeness). This module asks a different question — "are the dollar
// amounts themselves plausible for this headcount?" — so the two are
// complementary, not overlapping.
//
// Deliberately rule-based, not a separate AI call: the benchmark table
// below is a static, hand-set rule of thumb (not derived from live market
// data), the same "hardcoded reference table" pattern already used for
// SUGGESTED_SHOPPING_ITEMS (shared/missingItems.ts) and EXPECTED_MENU_COURSES
// (shared/readinessScore.ts). Computed fresh on every read — never persisted.
//
// Kept framework-agnostic (plain objects, no React/Express types) so this
// file can be imported by both the Express server and the React client —
// the client also uses BUDGET_BENCHMARKS directly to show inline "typical
// range" hints right on the budget entry form, which is the "before the
// host commits" moment the backlog calls for.

export type FeasibilityStatus = "under" | "typical" | "over" | "not-benchmarked";
export type FeasibilitySeverity = "notice" | "warning";

export interface CategoryBenchmark {
  category: string;
  /** Whether this category's typical cost scales with guest count, or is closer to a flat fee regardless of headcount. */
  unit: "perGuest" | "flat";
  low: number;
  high: number;
}

export interface CategoryAssessment {
  category: string;
  allocated: number;
  status: FeasibilityStatus;
  benchmark: CategoryBenchmark | null;
  /** The value actually compared against the benchmark — allocated/headcount for perGuest categories, or allocated itself for flat ones. */
  comparedValue: number | null;
}

export interface BudgetFeasibilityFlag {
  id: string;
  severity: FeasibilitySeverity;
  title: string;
  detail: string;
  modules: string[];
}

export interface BudgetFeasibilityResult {
  categories: CategoryAssessment[];
  flags: BudgetFeasibilityFlag[];
}

/** Minimal shape needed from a budget item — matches shared/schema.ts's BudgetItem. */
export interface BudgetItemSignalInput {
  category: string;
  estimatedCost: number;
}

/** Minimal shape needed from a guest — matches shared/schema.ts's Guest. */
export interface GuestSignalInput {
  partySize: number;
}

export interface BudgetFeasibilityInput {
  budgetItems: BudgetItemSignalInput[];
  guests: GuestSignalInput[];
}

// Rough rule-of-thumb ranges for a typical home/backyard-to-modest-venue
// party (Posy's core use case, not a luxury/formal event) — meant as
// a sanity-check guide, not an authoritative pricing source. "Venue",
// "Entertainment", "Photography", and "Attire" are treated as roughly flat
// fees since they don't scale cleanly with headcount at this event scale;
// the rest scale per guest. "Other" is intentionally left unbenchmarked —
// too broad a catch-all category to give a meaningful range.
export const BUDGET_BENCHMARKS: CategoryBenchmark[] = [
  { category: "Venue", unit: "flat", low: 0, high: 600 },
  { category: "Food & Beverage", unit: "perGuest", low: 8, high: 35 },
  { category: "Décor", unit: "perGuest", low: 2, high: 12 },
  { category: "Entertainment", unit: "flat", low: 0, high: 500 },
  { category: "Rentals", unit: "perGuest", low: 2, high: 10 },
  { category: "Photography", unit: "flat", low: 0, high: 500 },
  { category: "Favors & Gifts", unit: "perGuest", low: 2, high: 8 },
  { category: "Attire", unit: "flat", low: 0, high: 300 },
];

/** Below this invited headcount, a per-guest read is too noisy to be worth comparing (a $/guest benchmark means little for 3 people). */
const MIN_HEADCOUNT_FOR_PER_GUEST_CHECK = 5;
/** How many reallocation sources to suggest pulling from for a single over-budget category, so a suggestion never reads like a spreadsheet. */
const MAX_REALLOCATION_SOURCES_PER_TARGET = 2;
/** How many flags of any kind (over / reallocation / under) to surface at once, so the combined alerts feed stays quiet even with several flagged categories. */
const MAX_TOTAL_FLAGS = 6;

export function getBenchmarkForCategory(category: string): CategoryBenchmark | null {
  return BUDGET_BENCHMARKS.find((b) => b.category === category) ?? null;
}

export function formatBenchmarkRange(benchmark: CategoryBenchmark): string {
  const suffix = benchmark.unit === "perGuest" ? "/guest" : " total";
  if (benchmark.low === 0) return `up to $${benchmark.high.toLocaleString()}${suffix}`;
  return `$${benchmark.low.toLocaleString()}–$${benchmark.high.toLocaleString()}${suffix}`;
}

/**
 * Total-dollar amount a category's spend sits above (positive) or below
 * (negative) its typical "high" bound — scaled by headcount for perGuest
 * categories, or the raw dollar gap for flat ones. Shared arithmetic used
 * by both the over/under classification above and the reallocation
 * suggestions below, so the two always agree on what "over" means.
 */
function dollarsAboveTypicalHigh(c: CategoryAssessment, invitedHeadcount: number): number {
  if (!c.benchmark || c.comparedValue == null) return 0;
  const perUnitDiff = c.comparedValue - c.benchmark.high;
  return c.benchmark.unit === "perGuest" ? perUnitDiff * invitedHeadcount : perUnitDiff;
}

/**
 * #7 — Automatic reallocation suggestions. Direct extension of #6: for
 * every category flagged "over", proposes moving money from categories
 * already flagged "under" (i.e. already known to have slack up to their
 * own typical range) to help close the gap. Purely arithmetic on data
 * assessBudgetFeasibility() already computed — no new inputs, no AI call.
 *
 * Deliberately only pulls from "under" categories, not "typical" ones —
 * a category sitting comfortably in its typical range hasn't been flagged
 * as having spare room, so suggesting a host raid it would be presumptuous.
 * "Under" categories, by definition, already have headroom up to their own
 * typical-high bound before they'd need a flag of their own.
 */
function generateReallocationSuggestions(categories: CategoryAssessment[], invitedHeadcount: number): BudgetFeasibilityFlag[] {
  const overCategories = categories.filter((c) => c.status === "over");
  const underCategories = categories.filter((c) => c.status === "under");
  if (overCategories.length === 0 || underCategories.length === 0) return [];

  // Slack available per under-category, claimed down as earlier (larger) gaps draw from it.
  const remainingSlack = new Map<string, number>();
  for (const c of underCategories) {
    remainingSlack.set(c.category, Math.abs(dollarsAboveTypicalHigh(c, invitedHeadcount)));
  }

  const sortedOver = [...overCategories].sort(
    (a, b) => dollarsAboveTypicalHigh(b, invitedHeadcount) - dollarsAboveTypicalHigh(a, invitedHeadcount)
  );

  const suggestions: BudgetFeasibilityFlag[] = [];
  for (const over of sortedOver) {
    const totalGap = dollarsAboveTypicalHigh(over, invitedHeadcount);
    if (totalGap <= 0) continue;
    let remainingGap = totalGap;

    const sortedUnder = [...underCategories].sort(
      (a, b) => (remainingSlack.get(b.category) ?? 0) - (remainingSlack.get(a.category) ?? 0)
    );
    const sources: { category: string; amount: number }[] = [];
    for (const under of sortedUnder) {
      if (remainingGap <= 0 || sources.length >= MAX_REALLOCATION_SOURCES_PER_TARGET) break;
      const slack = remainingSlack.get(under.category) ?? 0;
      if (slack <= 0) continue;
      const take = Math.min(slack, remainingGap);
      sources.push({ category: under.category, amount: take });
      remainingSlack.set(under.category, slack - take);
      remainingGap -= take;
    }

    if (sources.length === 0) continue;

    const plural = sources.length > 1;
    const sourceText = sources.map((s) => `~$${Math.round(s.amount).toLocaleString()} from ${s.category}`).join(" and ");
    const covered = totalGap - remainingGap;
    const coverageNote =
      remainingGap > 1
        ? ` That covers about $${Math.round(covered).toLocaleString()} of the $${Math.round(totalGap).toLocaleString()} gap — the rest may need a higher overall budget.`
        : "";

    suggestions.push({
      id: `budget-reallocation-${over.category}`,
      severity: "notice",
      title: `Consider reallocating to cover "${over.category}"`,
      detail: `Move ${sourceText} toward ${over.category.toLowerCase()} — ${plural ? "those categories are" : "that category is"} still under its typical range, so shifting some of that room over could help close the gap.${coverageNote}`,
      modules: ["budget"],
    });
  }

  return suggestions;
}

export function assessBudgetFeasibility(input: BudgetFeasibilityInput): BudgetFeasibilityResult {
  const { budgetItems, guests } = input;
  const invitedHeadcount = guests.reduce((sum, g) => sum + (g.partySize || 0), 0);
  const canCheckPerGuest = invitedHeadcount >= MIN_HEADCOUNT_FOR_PER_GUEST_CHECK;

  const allocatedByCategory = new Map<string, number>();
  for (const item of budgetItems) {
    allocatedByCategory.set(item.category, (allocatedByCategory.get(item.category) ?? 0) + (item.estimatedCost || 0));
  }

  const categories: CategoryAssessment[] = [];
  const overFlags: BudgetFeasibilityFlag[] = [];
  const underFlags: BudgetFeasibilityFlag[] = [];

  for (const [category, allocated] of Array.from(allocatedByCategory.entries())) {
    if (allocated <= 0) continue; // nothing planned yet — a completeness question, not a feasibility one (see Readiness Score)
    const benchmark = getBenchmarkForCategory(category);

    if (!benchmark || (benchmark.unit === "perGuest" && !canCheckPerGuest)) {
      categories.push({ category, allocated, status: "not-benchmarked", benchmark: benchmark ?? null, comparedValue: null });
      continue;
    }

    const comparedValue = benchmark.unit === "perGuest" ? allocated / invitedHeadcount : allocated;
    const status: FeasibilityStatus = comparedValue < benchmark.low ? "under" : comparedValue > benchmark.high ? "over" : "typical";
    categories.push({ category, allocated, status, benchmark, comparedValue });

    if (status === "over") {
      const displayValue = benchmark.unit === "perGuest" ? `$${Math.round(comparedValue)}/guest` : `$${Math.round(comparedValue).toLocaleString()}`;
      overFlags.push({
        id: `budget-feasibility-over-${category}`,
        severity: "warning",
        title: `"${category}" budget is running above typical`,
        detail: `You've budgeted ${displayValue} for ${category.toLowerCase()}, above the typical range of ${formatBenchmarkRange(benchmark)} for a similar-sized event. Worth double-checking, or it may just reflect a nicer version of this category.`,
        modules: ["budget"],
      });
    } else if (status === "under" && benchmark.unit === "perGuest") {
      // Only flag "under" for per-guest categories — a low flat fee (e.g. photography) is common and not worth second-guessing.
      const displayValue = `$${Math.round(comparedValue)}/guest`;
      underFlags.push({
        id: `budget-feasibility-under-${category}`,
        severity: "notice",
        title: `"${category}" budget looks light for this guest count`,
        detail: `You've budgeted ${displayValue} for ${category.toLowerCase()}, below the typical range of ${formatBenchmarkRange(benchmark)} for a similar-sized event — worth a second look if that wasn't intentional.`,
        modules: ["budget", "guests"],
      });
    }
  }

  // #7: for each over-budget category, look for an under-budget category with
  // slack that could help cover it, and surface the two right next to each
  // other in the feed (the warning, then the constructive suggestion for it).
  const reallocationFlags = generateReallocationSuggestions(categories, invitedHeadcount);
  const reallocationByCategory = new Map(
    reallocationFlags.map((f) => [f.id.replace("budget-reallocation-", ""), f])
  );
  const overAndReallocation: BudgetFeasibilityFlag[] = [];
  for (const overFlag of overFlags) {
    overAndReallocation.push(overFlag);
    const category = overFlag.id.replace("budget-feasibility-over-", "");
    const realloc = reallocationByCategory.get(category);
    if (realloc) overAndReallocation.push(realloc);
  }

  // Warnings (+ their reallocation suggestion) surface before under-budget notices, capped to stay quiet.
  const flags = [...overAndReallocation, ...underFlags].slice(0, MAX_TOTAL_FLAGS);

  return { categories, flags };
}

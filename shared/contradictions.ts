// Cross-module contradiction detection: flags places where two choices the
// host has made in *different* parts of the app quietly disagree with each
// other — e.g. a playful invitation design paired with an elegant, catered
// menu, or a stated budget that the line items already blow past.
//
// Deliberately rule-based, not a separate AI call: every check here is a
// transparent, explainable comparison of real data already on the event
// (Event DNA scores, budget totals, guest counts, menu sourcing), so there
// is no added AI cost and nothing to keep in sync. Computed fresh on every
// read — never persisted — so it can never go stale relative to the
// event's current data. Read-only, same pattern as shared/eventDna.ts.
//
// Kept framework-agnostic (plain objects, no React/Express types) so this
// file can be imported by both the Express server and the React client.

import { computeEventDna, DNA_AXES, CONCEPT_INFERABLE_AXES, type DnaAxis, type MenuSignalInput, type BudgetSignalInput } from "./eventDna";

export type ContradictionSeverity = "notice" | "warning";

export interface Contradiction {
  id: string;
  severity: ContradictionSeverity;
  title: string;
  detail: string;
  /** Which parts of the app fed this contradiction, for icon/badge display. */
  modules: string[];
}

export interface GuestSignalInput {
  partySize: number;
}

export interface ContradictionInput {
  eventType: string;
  budgetTotal: number | null | undefined;
  guests: GuestSignalInput[];
  menuItems: MenuSignalInput[];
  budgetItems: BudgetSignalInput[];
  /** Dimensions hinted by the currently-applied Invitation Intelligence concept, if any. */
  appliedConceptDnaHints?: Partial<Record<DnaAxis, number>> | null;
}

const CATERED_MENU_SOURCES = new Set(["Caterer", "Restaurant delivery"]);

/** Minimum magnitude on an axis, on either side, before a style clash is worth surfacing. */
const STYLE_CLASH_THRESHOLD = 0.3;
/** Minimum invited headcount before a per-guest budget read is meaningful. */
const MIN_HEADCOUNT_FOR_BUDGET_CHECK = 10;
/** Below this $/guest, a catered menu is very unlikely to be affordable. */
const LOW_PER_GUEST_BUDGET_THRESHOLD = 15;
/** How far budget line items can run over the stated total before flagging. */
const BUDGET_OVERRUN_TOLERANCE = 1.05;

function axisMeta(axis: DnaAxis) {
  return DNA_AXES.find((a) => a.key === axis)!;
}

function poleLabel(axis: DnaAxis, score: number): string {
  const { poleA, poleB } = axisMeta(axis);
  return score < 0 ? poleA : poleB;
}

export function detectContradictions(input: ContradictionInput): Contradiction[] {
  const { eventType, budgetTotal, guests, menuItems, budgetItems, appliedConceptDnaHints } = input;
  const contradictions: Contradiction[] = [];

  const invitedHeadcount = guests.reduce((sum, g) => sum + (g.partySize || 0), 0);
  const budgetItemsTotal = budgetItems.reduce((sum, b) => sum + (b.estimatedCost || 0), 0);
  const hasCateredMenu = menuItems.some((m) => CATERED_MENU_SOURCES.has(m.source));

  // 1. Invitation design formality/elegance vs. what the menu and budget actually say.
  // Compare the concept's own hints against a "base" DNA computed from menu + budget
  // + event type alone (no concept), so we're comparing design intent against
  // substance rather than the concept's own contribution to itself.
  if (appliedConceptDnaHints) {
    const baseDna = computeEventDna({ eventType, menuItems, budgetItems, appliedConceptDnaHints: null });
    for (const axis of CONCEPT_INFERABLE_AXES) {
      const conceptScore = appliedConceptDnaHints[axis];
      const baseScore = baseDna.scores[axis];
      const baseConfidence = baseDna.confidence[axis];
      if (
        typeof conceptScore !== "number" ||
        typeof baseScore !== "number" ||
        baseConfidence === "none" ||
        baseConfidence === undefined
      ) {
        continue;
      }
      const oppositeSigns = Math.sign(conceptScore) !== 0 && Math.sign(baseScore) !== 0 && Math.sign(conceptScore) !== Math.sign(baseScore);
      if (oppositeSigns && Math.abs(conceptScore) >= STYLE_CLASH_THRESHOLD && Math.abs(baseScore) >= STYLE_CLASH_THRESHOLD) {
        const conceptPole = poleLabel(axis, conceptScore).toLowerCase();
        const basePole = poleLabel(axis, baseScore).toLowerCase();
        contradictions.push({
          id: `style-${axis}`,
          severity: "notice",
          title: "Invitation design doesn't quite match your menu and budget",
          detail: `Your invitation design leans ${conceptPole}, but your menu and budget choices lean ${basePole}. Worth a second look, or a different design concept.`,
          modules: ["invitation", "menu", "budget"],
        });
      }
    }
  }

  // 2. Guest count vs. budget total, when the menu is catered.
  // A tight per-guest budget paired with a caterer/delivery menu rarely adds up.
  if (budgetTotal != null && budgetTotal > 0 && invitedHeadcount >= MIN_HEADCOUNT_FOR_BUDGET_CHECK && hasCateredMenu) {
    const perGuest = budgetTotal / invitedHeadcount;
    if (perGuest < LOW_PER_GUEST_BUDGET_THRESHOLD) {
      contradictions.push({
        id: "budget-vs-catered-headcount",
        severity: "warning",
        title: "Budget may not stretch to cover catering for this group",
        detail: `Your budget of $${budgetTotal.toLocaleString()} works out to about $${Math.round(perGuest)} per guest across ${invitedHeadcount} invited guests, but your menu includes catered or delivered items — catering for a group this size usually costs more than that.`,
        modules: ["budget", "menu", "guests"],
      });
    }
  }

  // 3. Budget line items vs. the stated overall budget.
  if (budgetTotal != null && budgetTotal > 0 && budgetItemsTotal > budgetTotal * BUDGET_OVERRUN_TOLERANCE) {
    const over = budgetItemsTotal - budgetTotal;
    contradictions.push({
      id: "budget-items-over-total",
      severity: "warning",
      title: "Budget items add up to more than your stated total",
      detail: `Your budget items total $${budgetItemsTotal.toLocaleString()}, which is $${over.toLocaleString()} over your stated overall budget of $${budgetTotal.toLocaleString()}.`,
      modules: ["budget"],
    });
  }

  return contradictions;
}

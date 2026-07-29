// "Event DNA": a lightweight, per-event style profile inferred from choices
// the host has already made elsewhere in the app (menu sourcing, budget
// allocation, event type, applied invitation design) — never from a form or
// quiz. It exists to make AI features (starting with Invitation Intelligence)
// feel coherent with the event as a whole instead of stateless per-module
// guesses.
//
// Deliberately rule-based, not a separate AI call: every score here is a
// transparent, explainable function of real data already on the event, so
// there is no added AI cost and no risk of the profile drifting from what
// the host actually did. Computed fresh on read — never persisted — so it
// can never go stale relative to the event's current data.
//
// Kept framework-agnostic (plain objects, no React/Express types) so this
// file can be imported by both the Express server and the React client.

export type DnaAxis =
  | "elegantCasual"
  | "traditionalModern"
  | "indoorOutdoor"
  | "formalPlayful"
  | "diyCatered"
  | "familyCorporate";

export const DNA_AXES: { key: DnaAxis; poleA: string; poleB: string }[] = [
  { key: "elegantCasual", poleA: "Elegant", poleB: "Casual" },
  { key: "traditionalModern", poleA: "Traditional", poleB: "Modern" },
  { key: "indoorOutdoor", poleA: "Indoor", poleB: "Outdoor" },
  { key: "formalPlayful", poleA: "Formal", poleB: "Playful" },
  { key: "diyCatered", poleA: "DIY", poleB: "Catered" },
  { key: "familyCorporate", poleA: "Family", poleB: "Corporate" },
];

/** Only these axes are reasonable for an LLM to infer purely from a visual/thematic
 *  design concept. diyCatered and familyCorporate come exclusively from real
 *  transactional data (menu sourcing, event type) elsewhere in computeEventDna. */
export const CONCEPT_INFERABLE_AXES: DnaAxis[] = [
  "elegantCasual",
  "traditionalModern",
  "indoorOutdoor",
  "formalPlayful",
];

export type Confidence = "none" | "low" | "medium" | "high";

export interface EventDnaProfile {
  scores: Partial<Record<DnaAxis, number>>; // -1..1, absent = insufficient signal
  confidence: Partial<Record<DnaAxis, Confidence>>;
  summary: string; // short human-readable line for a read-only display
  reasons: string[]; // short explanations of where the signal came from
}

interface DnaSignal {
  score: number; // -1..1
  weight: number; // relative confidence of this one signal
}

const EVENT_TYPE_FAMILY_CORPORATE: Record<string, number> = {
  "Corporate Event": 0.9,
  "Birthday Party": -0.7,
  "Baby Shower": -0.8,
  "Bridal Shower": -0.8,
  Wedding: -0.5,
  Graduation: -0.6,
  Anniversary: -0.6,
  "Holiday Gathering": -0.4,
  Housewarming: -0.5,
  "Other Celebration": 0,
};

const MENU_SOURCE_DIY_CATERED: Record<string, number> = {
  Caterer: 1,
  "Restaurant delivery": 0.6,
  "Store-bought": 0.2,
  Homemade: -0.8,
  "Potluck / guests bringing": -0.9,
  Other: 0,
};

const ELEGANT_LEANING_BUDGET_CATEGORIES = new Set(["D\u00e9cor", "Photography", "Attire", "Venue"]);
const PLAYFUL_LEANING_BUDGET_CATEGORIES = new Set(["Entertainment"]);

const AXIS_POLE_LABELS: Record<DnaAxis, [string, string]> = {
  elegantCasual: ["elegant", "casual"],
  traditionalModern: ["traditional", "modern"],
  indoorOutdoor: ["indoor", "outdoor"],
  formalPlayful: ["formal", "playful"],
  diyCatered: ["DIY", "catered"],
  familyCorporate: ["family", "corporate"],
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function weightedAverage(signals: DnaSignal[]): number | null {
  const totalWeight = signals.reduce((sum, s) => sum + s.weight, 0);
  if (totalWeight <= 0) return null;
  const sum = signals.reduce((acc, s) => acc + s.score * s.weight, 0);
  return clamp(sum / totalWeight, -1, 1);
}

function confidenceFromWeight(weight: number): Confidence {
  if (weight <= 0) return "none";
  if (weight < 0.6) return "low";
  if (weight < 1.4) return "medium";
  return "high";
}

/** Minimal shape needed from a menu item — matches shared/schema.ts's MenuItem. */
export interface MenuSignalInput {
  source: string;
}

/** Minimal shape needed from a budget item — matches shared/schema.ts's BudgetItem. */
export interface BudgetSignalInput {
  category: string;
  estimatedCost: number;
}

export function computeEventDna(params: {
  eventType: string;
  menuItems: MenuSignalInput[];
  budgetItems: BudgetSignalInput[];
  /** Dimensions hinted by the currently-applied Invitation Intelligence concept, if any. */
  appliedConceptDnaHints?: Partial<Record<DnaAxis, number>> | null;
}): EventDnaProfile {
  const { eventType, menuItems, budgetItems, appliedConceptDnaHints } = params;

  const signalsByAxis: Record<DnaAxis, DnaSignal[]> = {
    elegantCasual: [],
    traditionalModern: [],
    indoorOutdoor: [],
    formalPlayful: [],
    diyCatered: [],
    familyCorporate: [],
  };
  const reasons: string[] = [];

  // Event type -> family/corporate. Always available once an event type is set.
  if (eventType && eventType in EVENT_TYPE_FAMILY_CORPORATE) {
    signalsByAxis.familyCorporate.push({ score: EVENT_TYPE_FAMILY_CORPORATE[eventType], weight: 1 });
    reasons.push(`Event type "${eventType}" informs the family/corporate read.`);
  }

  // Menu sourcing -> DIY/catered. Real signal from the menu module.
  if (menuItems.length > 0) {
    const perItemScores = menuItems.map((m) => MENU_SOURCE_DIY_CATERED[m.source] ?? 0);
    const avg = perItemScores.reduce((a, b) => a + b, 0) / perItemScores.length;
    signalsByAxis.diyCatered.push({ score: avg, weight: Math.min(1, menuItems.length / 3) });
    reasons.push(
      `${menuItems.length} menu item${menuItems.length === 1 ? "" : "s"} lean ${avg >= 0 ? "catered" : "DIY"}.`,
    );
  }

  // Budget category allocation -> soft elegant/casual and formal/playful signal.
  const totalBudget = budgetItems.reduce((sum, b) => sum + (b.estimatedCost || 0), 0);
  if (totalBudget > 0) {
    let elegantSpend = 0;
    let playfulSpend = 0;
    for (const item of budgetItems) {
      if (ELEGANT_LEANING_BUDGET_CATEGORIES.has(item.category)) elegantSpend += item.estimatedCost || 0;
      if (PLAYFUL_LEANING_BUDGET_CATEGORIES.has(item.category)) playfulSpend += item.estimatedCost || 0;
    }
    const elegantShare = elegantSpend / totalBudget;
    const playfulShare = playfulSpend / totalBudget;
    signalsByAxis.elegantCasual.push({ score: clamp(-elegantShare * 2, -1, 0.3), weight: 0.6 });
    signalsByAxis.formalPlayful.push({ score: clamp(playfulShare * 2 - elegantShare, -1, 1), weight: 0.5 });
    if (elegantShare > 0.15) {
      reasons.push(
        `Budget skews toward d\u00e9cor, photography, attire, and venue (${Math.round(elegantShare * 100)}% of spend) \u2014 an elegant lean.`,
      );
    }
    if (playfulShare > 0.1) {
      reasons.push(`${Math.round(playfulShare * 100)}% of budget on entertainment \u2014 a playful lean.`);
    }
  }

  // Applied Invitation Intelligence concept -> secondary flavor signal.
  if (appliedConceptDnaHints) {
    let usedHint = false;
    for (const axis of Object.keys(appliedConceptDnaHints) as DnaAxis[]) {
      const val = appliedConceptDnaHints[axis];
      if (typeof val === "number" && signalsByAxis[axis]) {
        signalsByAxis[axis].push({ score: val, weight: 0.6 });
        usedHint = true;
      }
    }
    if (usedHint) reasons.push("Your applied invitation design also informs this profile.");
  }

  const scores: Partial<Record<DnaAxis, number>> = {};
  const confidence: Partial<Record<DnaAxis, Confidence>> = {};
  for (const axis of Object.keys(signalsByAxis) as DnaAxis[]) {
    const signals = signalsByAxis[axis];
    const avg = weightedAverage(signals);
    const totalWeight = signals.reduce((sum, s) => sum + s.weight, 0);
    confidence[axis] = confidenceFromWeight(totalWeight);
    if (avg !== null) scores[axis] = avg;
  }

  return { scores, confidence, summary: buildSummary(scores, confidence), reasons };
}

function buildSummary(
  scores: Partial<Record<DnaAxis, number>>,
  confidence: Partial<Record<DnaAxis, Confidence>>,
): string {
  const labels: string[] = [];
  for (const axis of Object.keys(AXIS_POLE_LABELS) as DnaAxis[]) {
    const score = scores[axis];
    if (score === undefined || confidence[axis] === "none") continue;
    if (Math.abs(score) < 0.15) continue; // too neutral to call out
    const [poleA, poleB] = AXIS_POLE_LABELS[axis];
    labels.push(score < 0 ? poleA : poleB);
  }
  if (labels.length === 0) {
    return "Not enough choices yet to read a style \u2014 add a few menu or budget items and it'll sharpen up.";
  }
  return `Leaning ${labels.join(", ")} \u2014 based on your choices so far.`;
}

/** Returns null when there isn't enough signal to be worth passing to the concept generator. */
export function dnaSummaryForPrompt(profile: EventDnaProfile): string | null {
  if (profile.summary.startsWith("Not enough")) return null;
  return profile.summary;
}

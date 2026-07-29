import type { InviteDesignConcept } from "@shared/inviteDesign";
import { getStyleLane } from "@shared/inviteDesign";

// ── Quality Gate: Concept Scoring ──────────────────────────────────────
//
// After generating 6 concepts (one per style lane), each is scored on:
// 1. Distinctiveness — how different from the other surviving concepts
// 2. Theme fit — does the concept name/description relate to the theme
// 3. Palette harmony — are the 4 colors visually balanced
// 4. Composition clarity — is the layout/medium combination coherent
//
// The top 4 concepts are returned. This ensures the host always sees the
// strongest, most diverse set — not just the first 4 the LLM happened to emit.

export interface ConceptScore {
  concept: InviteDesignConcept;
  index: number;
  distinctiveness: number;
  themeFit: number;
  paletteHarmony: number;
  compositionClarity: number;
  total: number;
}

// Computes color distance in RGB space — smaller means more similar palettes.
function paletteDistance(a: string[], b: string[]): number {
  let dist = 0;
  for (let i = 0; i < 4; i++) {
    const ca = parseInt(a[i].slice(1), 16);
    const cb = parseInt(b[i].slice(1), 16);
    const dr = ((ca >> 16) & 0xff) - ((cb >> 16) & 0xff);
    const dg = ((ca >> 8) & 0xff) - ((cb >> 8) & 0xff);
    const db = (ca & 0xff) - (cb & 0xff);
    dist += Math.sqrt(dr * dr + dg * dg + db * db);
  }
  return dist;
}

// Scores palette harmony — measures how balanced the palette is.
// High-scoring palettes have good light/dark range and non-repetitive hues.
function scorePaletteHarmony(colors: string[]): number {
  if (colors.length < 4) return 0.5;
  // Check light/dark range (contrast)
  const lights = colors.map((c) => {
    const v = parseInt(c.slice(1), 16);
    return (((v >> 16) & 0xff) + ((v >> 8) & 0xff) + (v & 0xff)) / 3;
  });
  const range = Math.max(...lights) - Math.min(...lights);
  // Good range = 100-200 (has both light and dark tones)
  const rangeScore = Math.min(range / 150, 1);
  // Check for duplicate colors (penalize)
  const unique = new Set(colors.map((c) => c.toLowerCase())).size;
  const uniquenessScore = unique / 4;
  return (rangeScore + uniquenessScore) / 2;
}

// Scores composition clarity — does the layout + medium combination make sense?
function scoreCompositionClarity(concept: InviteDesignConcept): number {
  const lane = concept.styleLaneId ? getStyleLane(concept.styleLaneId) : null;
  if (!lane) return 0.6; // No lane info — neutral score

  // Does the layout match the lane's preferred layouts?
  const layoutMatch = lane.preferredLayouts.includes(concept.layoutStyle);
  // Does the art direction have all required fields?
  const ad = concept.artDirection;
  const adCompleteness = ad
    ? [
        ad.illustrationMedium,
        ad.subjectFocus,
        ad.compositionType,
        ad.negativeSpace,
        ad.colorTreatment,
        ad.texture,
        ad.avoidList,
      ].filter((f) => f && f.length > 0).length / 7
    : 0.5;

  return (layoutMatch ? 0.6 : 0.3) + adCompleteness * 0.4;
}

// Scores theme fit — checks if concept name/description share words with the theme.
function scoreThemeFit(concept: InviteDesignConcept, themePrompt: string): number {
  const themeWords = themePrompt.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  if (themeWords.length === 0) return 0.7; // No theme to compare — neutral

  const conceptText = (concept.conceptName + " " + concept.description).toLowerCase();
  const matches = themeWords.filter((w) => conceptText.includes(w)).length;
  // Also check if the illustration prompt relates to the theme
  const illMatches = themeWords.filter((w) => concept.illustrationPrompt.toLowerCase().includes(w)).length;
  return Math.min((matches + illMatches * 0.5) / Math.max(themeWords.length, 1) + 0.3, 1);
}

// Scores distinctiveness — how different this concept is from the others.
// Based on palette distance, layout difference, and style lane difference.
function scoreDistinctiveness(concept: InviteDesignConcept, others: InviteDesignConcept[]): number {
  if (others.length === 0) return 1;

  let paletteScore = 0;
  let layoutScore = 0;
  let laneScore = 0;

  for (const other of others) {
    paletteScore += Math.min(paletteDistance(concept.paletteColors, other.paletteColors) / 400, 1);
    layoutScore += concept.layoutStyle !== other.layoutStyle ? 1 : 0;
    laneScore += concept.styleLaneId !== other.styleLaneId ? 1 : 0;
  }

  const n = others.length;
  return (paletteScore / n + layoutScore / n + laneScore / n) / 3;
}

// Main scoring function: scores all concepts and returns them sorted by total score.
export function scoreConcepts(
  concepts: InviteDesignConcept[],
  themePrompt: string,
): ConceptScore[] {
  return concepts.map((concept, index) => {
    const others = concepts.filter((_, i) => i !== index);
    const distinctiveness = scoreDistinctiveness(concept, others);
    const themeFit = scoreThemeFit(concept, themePrompt);
    const paletteHarmony = scorePaletteHarmony(concept.paletteColors);
    const compositionClarity = scoreCompositionClarity(concept);
    const total =
      distinctiveness * 0.25 +
      themeFit * 0.30 +
      paletteHarmony * 0.20 +
      compositionClarity * 0.25;
    return { concept, index, distinctiveness, themeFit, paletteHarmony, compositionClarity, total };
  }).sort((a, b) => b.total - a.total);
}

// Quality gate: takes 6 concepts, scores them, and returns the top 4.
// Guarantees each returned concept is in a different style lane.
export function selectTopConcepts(
  concepts: InviteDesignConcept[],
  themePrompt: string,
  count: number = 4,
): InviteDesignConcept[] {
  if (concepts.length <= count) return concepts;

  const scored = scoreConcepts(concepts, themePrompt);

  // Greedy selection: pick the highest-scoring concept from each style lane,
  // ensuring no two returned concepts share a lane.
  const selected: InviteDesignConcept[] = [];
  const usedLanes = new Set<string>();

  for (const { concept } of scored) {
    const laneId = concept.styleLaneId ?? `unknown-${selected.length}`;
    if (usedLanes.has(laneId)) continue;
    usedLanes.add(laneId);
    selected.push(concept);
    if (selected.length >= count) break;
  }

  // If we still need more (not enough unique lanes), fill from remaining
  if (selected.length < count) {
    for (const { concept } of scored) {
      if (!selected.includes(concept)) {
        selected.push(concept);
        if (selected.length >= count) break;
      }
    }
  }

  return selected;
}

// Guest-count + Event DNA driven default for which invite "voice" best fits
// this party (see backlog #26). Extends the existing dnaHints/Event DNA
// wiring (shared/eventDna.ts) with one signal it didn't use yet: guest
// count. Deliberately rule-based, not a separate AI call — reuses the same
// DNA scores that are already computed for free on every read, so this adds
// zero AI cost. Framework-agnostic (no React/Express types) so it can be
// imported by both the Express server (to bias the existing Invitation
// Intelligence prompt) and the React client (to highlight a recommended
// tone instead of leaving the "Write it for me" picker as an undifferentiated
// row of 4 identical-weight buttons).

import type { EventDnaProfile } from "./eventDna";
import type { InviteTone } from "./inviteTokens";

export interface InviteFormatRecommendation {
  recommendedTone: InviteTone;
  /** Short, host-facing explanation for why this tone is recommended. */
  reason: string;
  /** One line of guidance for the Invitation Intelligence concept-generation
   *  prompt — how guest count + DNA should bias layoutStyle/formality across
   *  the 4 generated concepts. Not shown to the host. */
  conceptGuidance: string;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Guest-count scale bias: bigger parties nudge toward a more polished
 *  default even when DNA itself is only mildly formal — a 100-person
 *  gathering reads differently than an 8-person one regardless of theme.
 *  Never pushes toward playful; scale alone doesn't imply casual. */
function scaleBias(guestCount: number): number {
  if (guestCount >= 75) return 0.45;
  if (guestCount >= 40) return 0.25;
  if (guestCount >= 15) return 0.1;
  return 0;
}

/**
 * Returns null when there isn't enough signal to be worth recommending
 * anything yet (no DNA confidence on any relevant axis AND no guests
 * invited) — mirrors dnaSummaryForPrompt's "not enough signal" convention
 * rather than presuming a default out of thin air.
 */
export function recommendInviteFormat(
  dna: EventDnaProfile,
  guestCount: number,
): InviteFormatRecommendation | null {
  const hasDnaSignal =
    (dna.confidence.formalPlayful ?? "none") !== "none" ||
    (dna.confidence.elegantCasual ?? "none") !== "none" ||
    (dna.confidence.familyCorporate ?? "none") !== "none";
  if (!hasDnaSignal && guestCount <= 0) return null;

  // Note the sign convention from shared/eventDna.ts: formalPlayful and
  // elegantCasual are negative toward their first-named pole (formal,
  // elegant) and positive toward their second (playful, casual);
  // familyCorporate is negative toward family, positive toward corporate.
  const formalPlayful = dna.scores.formalPlayful ?? 0;
  const elegantCasual = dna.scores.elegantCasual ?? 0;
  const familyCorporate = dna.scores.familyCorporate ?? 0;

  const formalitySignal = clamp(
    -formalPlayful * 0.45 + -elegantCasual * 0.3 + familyCorporate * 0.15 + scaleBias(guestCount),
    -1,
    1,
  );

  const scaleNote = guestCount >= 40 ? `with ${guestCount} guests invited` : null;

  if (formalitySignal >= 0.3) {
    return {
      recommendedTone: "elegant",
      reason: scaleNote
        ? `${scaleNote[0].toUpperCase()}${scaleNote.slice(1)} and a polished Event DNA, a formal tone tends to read best.`
        : "Your Event DNA leans elegant, so a formal tone tends to fit best.",
      conceptGuidance: `This event has ${guestCount} guest${guestCount === 1 ? "" : "s"} invited and its DNA/scale signal leans formal (score ${formalitySignal.toFixed(2)} on a -1 playful..+1 formal scale). Let at least 3 of the 4 concepts' layoutStyle and concept names lean more refined and polished — soft backdrop-style art and elevated wording tend to suit this — while still keeping all 4 genuinely distinct.`,
    };
  }
  if (formalitySignal <= -0.3) {
    return {
      recommendedTone: "playful",
      reason: "Your Event DNA leans playful and casual, so a fun tone tends to fit best.",
      conceptGuidance: `This event has ${guestCount} guest${guestCount === 1 ? "" : "s"} invited and its DNA signal leans playful (score ${formalitySignal.toFixed(2)} on a -1 playful..+1 formal scale). Let at least 3 of the 4 concepts' layoutStyle and concept names lean bolder and more fun — vibrant banner-style art and playful wording tend to suit this — while still keeping all 4 genuinely distinct.`,
    };
  }
  return {
    recommendedTone: "warm",
    reason: scaleNote
      ? `${scaleNote[0].toUpperCase()}${scaleNote.slice(1)}, a warm, welcoming tone tends to read well at this scale.`
      : "A warm, friendly tone is a safe default for this party.",
    conceptGuidance: `This event has ${guestCount} guest${guestCount === 1 ? "" : "s"} invited and its DNA signal is fairly neutral on formality (score ${formalitySignal.toFixed(2)} on a -1 playful..+1 formal scale). Keep the 4 concepts genuinely varied across the formal-to-playful range rather than clustering them all at one extreme.`,
  };
}

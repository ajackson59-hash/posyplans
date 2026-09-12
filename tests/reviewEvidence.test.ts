import { describe, expect, it } from "vitest";
import { REVIEW_CRITERIA, validateReviewEvidence } from "../server/aiFirst/reviewEvidence";

const five = { textLogoWatermarkFree: 5, artifactFree: 5, premiumFinish: 5,
  briefFidelity: 5, compositionQuality: 5, ageAppropriate: 5 };
const facts = { missingRequired: false, identityAccurate: true, milestoneCorrect: true,
  excludedFound: false, purchaseDesire: true };
const clear = () => Object.fromEntries(Object.keys(five).map(key => [key,
  { status: "clear", criterion: "none", location: "Full canvas", observation: "Visible positive support for fixture only" }]));

describe("located review integrity, separate from visual correctness", () => {
  it("accepts an internally complete report without inventing an artistic deduction", () => {
    expect(validateReviewEvidence(clear(), five, facts).integrity.valid).toBe(true);
  });
  it("blocks the retained clean-balanced-composition / 4-score contradiction without raising the score", () => {
    const scores = { ...five, compositionQuality: 4 };
    const rows = clear(); rows.compositionQuality.observation = "Clean, balanced, intentional diptych";
    expect(validateReviewEvidence(rows, scores, facts).integrity.issues).toContain("compositionQuality:clear-score-conflict");
    expect(scores.compositionQuality).toBe(4);
  });
  it.each(Object.keys(REVIEW_CRITERIA) as (keyof typeof five)[])("blocks an undocumented deduction in %s", key => {
    expect(validateReviewEvidence(clear(), { ...five, [key]: 4 }, facts).integrity.valid).toBe(false);
  });
  it.each(["location", "observation"])("refuses empty %s on an otherwise perfect report", field => {
    const rows = clear(); rows.premiumFinish[field] = " ";
    expect(validateReviewEvidence(rows, five, facts).integrity.valid).toBe(false);
  });
  it("keeps character errors in fidelity with independently excellent craft and composition", () => {
    const rows = clear(); rows.briefFidelity = { status: "defect", criterion: "identity-mismatch",
      location: "Right portrait", observation: "Purple braided hair matches Rumi, not requested Zoey's dark bangs" };
    const result = validateReviewEvidence(rows, { ...five, briefFidelity: 2 },
      { ...facts, identityAccurate: false, missingRequired: true, purchaseDesire: false });
    expect(result.integrity.valid).toBe(true);
    expect(result.assessments.premiumFinish?.status).toBe("clear");
  });
  it.each(["premiumFinish", "compositionQuality"])("refuses to classify an identity error as %s", key => {
    const rows = clear(); rows[key] = { status: "defect", criterion: "identity-mismatch", location: "Right portrait", observation: "Wrong character" };
    expect(validateReviewEvidence(rows, { ...five, [key]: 2 }, facts).integrity.issues).toContain(`${key}:wrong-dimension-criterion`);
  });
  it("does not waive a real composition defect because the identity is also wrong", () => {
    const rows = clear();
    rows.briefFidelity = { status: "defect", criterion: "identity-mismatch", location: "Right figure", observation: "Wrong hairstyle" };
    rows.compositionQuality = { status: "defect", criterion: "edge-clipping", location: "Top edge", observation: "Required face is cut across the eyes" };
    expect(validateReviewEvidence(rows, { ...five, briefFidelity: 2, compositionQuality: 3 },
      { ...facts, identityAccurate: false, purchaseDesire: false }).integrity.valid).toBe(true);
  });
  it("keeps an unresolved feature private even when the report is complete", () => {
    const rows = clear(); rows.briefFidelity = { status: "uncertain", criterion: "identity-mismatch", location: "Wrist", observation: "Requested cuff cannot be resolved" };
    expect(validateReviewEvidence(rows, { ...five, briefFidelity: 4 }, { ...facts, identityAccurate: false }).integrity.issues)
      .toContain("briefFidelity:unresolved-observation");
  });
  it.each(["missingRequired", "identityAccurate", "milestoneCorrect", "excludedFound"] as const)("detects %s contradicting perfect fidelity", key => {
    expect(validateReviewEvidence(clear(), five, { ...facts, [key]: !facts[key] }).integrity.issues)
      .toContain("briefFidelity:binary-check-conflict");
  });
  it("does not turn a false purchase verdict into an invented craft score", () => {
    const result = validateReviewEvidence(clear(), five, { ...facts, purchaseDesire: false });
    expect(result.integrity.issues).toContain("purchase:all-clear-conflict");
    expect(result.assessments.premiumFinish?.status).toBe("clear");
  });
  it("refuses legacy prose-only reports instead of guessing semantic defects or regrading old pixels", () => {
    expect(validateReviewEvidence(undefined, five, facts).integrity.valid).toBe(false);
  });
});

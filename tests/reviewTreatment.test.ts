import { expect, it } from "vitest";
import { validateMediumAssessment } from "../server/aiFirst/reviewTreatment";
import { validateReviewEvidence } from "../server/aiFirst/reviewEvidence";
import { resolveArtDirection } from "../server/aiFirst/artDirection";

const scores = { textLogoWatermarkFree: 5, artifactFree: 5, premiumFinish: 5,
  briefFidelity: 5, compositionQuality: 5, ageAppropriate: 5 };
const observed = { status: "matched", observedTreatment: "Painted gouache shapes", location: "Full canvas",
  observation: "Opaque matte pigment builds the figures and background" };
const item = { requirementId: "r3", requirement: "Requested medium", present: true, evidence: "Visible pigment",
  reviewStatus: "reported" as const };

it.each(["gouache", "flat vector", "photographic", "3D", "cut-paper and embroidery", "lacquer inlay"])(
  "validates explicit treatment evidence without restricting %s to a theme catalog", requested => {
    expect(validateMediumAssessment({ ...observed, observedTreatment: requested }, requested, [item], scores).issues).toEqual([]);
  });
it("keeps a genuine medium mismatch separate from excellent craft without accepting the brief", () => {
  const medium = validateMediumAssessment({ ...observed, status: "mismatched", observedTreatment: "Digital cel shading" },
    "gouache", [{ ...item, present: false }], { ...scores, briefFidelity: 2 });
  expect(medium.issues).toEqual([]);
  expect(medium.assessment?.status).toBe("mismatched"); expect(scores.premiumFinish).toBe(5);
});
it.each([
  [{ ...observed, status: "mismatched" }, [item], scores, "medium:checklist-conflict"],
  [{ ...observed, status: "mismatched" }, [{ ...item, present: false }], scores, "medium:fidelity-score-conflict"],
  [observed, [{ ...item, present: false }], scores, "medium:checklist-conflict"],
  [{ ...observed, status: "unresolved" }, [item], scores, "medium:unresolved-observation"],
  [{ ...observed, status: "not-requested" }, [item], scores, "medium:requested-treatment-omitted"],
  [undefined, [item], scores, "medium:missing-located-assessment"],
] as const)("rejects medium contradictions without raising any score (%s)", (report, rows, grades, issue) => {
  const before = structuredClone(grades);
  expect(validateMediumAssessment(report, "gouache", rows, grades).issues).toContain(issue);
  expect(grades).toEqual(before);
});
it("does not invent a medium requirement for a general celebration", () => {
  expect(validateMediumAssessment({ ...observed, status: "not-requested" }, null, [], scores).issues).toEqual([]);
  expect(validateMediumAssessment(observed, null, [], scores).issues).toContain("medium:unrequested-treatment-judgment");
});
it("retains independent real craft and layout defects even when medium is also wrong", () => {
  const rows = Object.fromEntries(Object.keys(scores).map(key => [key,
    { status: "clear", criterion: "none", location: "Full canvas", observation: "Synthetic visible support" }]));
  rows.premiumFinish = { status: "defect", criterion: "careless-edge-work", basis: "observed-craft",
    location: "Left portrait edge", observation: "Unintentional jagged contour intrudes into the eye" } as any;
  rows.compositionQuality = { status: "defect", criterion: "edge-clipping", basis: "observed-layout",
    location: "Top canvas edge", observation: "Requested face is accidentally cut across the eyes" } as any;
  rows.briefFidelity = { status: "defect", criterion: "medium-substitution", location: "Full canvas",
    observation: "Digital cel shading instead of requested gouache" };
  expect(validateReviewEvidence(rows, { ...scores, premiumFinish: 3, compositionQuality: 2, briefFidelity: 2 },
    { missingRequired: true, identityAccurate: true, milestoneCorrect: true, excludedFound: false, purchaseDesire: false }).integrity.valid).toBe(true);
});
it("does not turn identity-shape descriptions into a silhouette-art commission", () => {
  for (const vibe of ["Pikachu's tail silhouette", "Elmo's furry silhouette", "Preserve the hair silhouette"]) {
    expect(resolveArtDirection({ themeName: "", vibe }).requestedTreatment).toBeNull();
  }
  expect(resolveArtDirection({ themeName: "", vibe: "Use silhouette art of Pikachu" }).requestedTreatment).toBe("silhouette");
});

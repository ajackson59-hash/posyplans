/** Server-owned review rules. A valid report is not proof that its visual judgment is correct. */
import type { VisionScores } from "@shared/aiFirstStream";

export const REVIEW_EVIDENCE_VERSION = "located-medium-review-v2";
export const REVIEW_CRITERIA = {
  textLogoWatermarkFree: ["lettering", "logo", "watermark"],
  artifactFree: ["malformed-anatomy", "malformed-object", "composite-seam", "duplicated-pattern", "incoherent-light"],
  premiumFinish: ["careless-edge-work", "uncontrolled-palette", "incoherent-material", "unresolved-detail", "generic-execution"],
  briefFidelity: ["identity-mismatch", "missing-requested-detail", "wrong-setting-or-activity", "medium-substitution", "wrong-explicit-count", "excluded-content"],
  compositionQuality: ["edge-clipping", "accidental-overlap", "unbalanced-layout", "unclear-hierarchy", "unrequested-panel"],
  ageAppropriate: ["graphic-content", "sexualized-content", "frightening-treatment", "wrong-maturity", "wrong-explicit-count"],
} as const satisfies Record<keyof VisionScores, readonly string[]>;

export interface DimensionAssessment {
  status: "clear" | "defect" | "uncertain";
  criterion: string;
  location: string;
  observation: string;
}
export type DimensionAssessments = Record<keyof VisionScores, DimensionAssessment>;

export const ASSESSMENT_SCHEMA = {
  type: "object",
  properties: Object.fromEntries(Object.entries(REVIEW_CRITERIA).map(([dimension, criteria]) => [dimension, {
    type: "object",
    properties: {
      status: { type: "string", enum: ["clear", "defect", "uncertain"] },
      criterion: { type: "string", enum: ["none", ...criteria] },
      location: { type: "string" },
      observation: { type: "string" },
    },
    required: ["status", "criterion", "location", "observation"],
    additionalProperties: false,
  }])),
  required: Object.keys(REVIEW_CRITERIA),
  additionalProperties: false,
};

export const REVIEW_EVIDENCE_INSTRUCTION = `CONSISTENT DIMENSION RULES:
Report dimensionAssessments before scores. Each dimension needs status, criterion, location and observation. Use the schema's criterion belonging to that dimension. For clear, criterion is none and the score is 5; cite positive visible support. For defect, choose the violated criterion, name a concrete visible flaw and its location, and score 1-4. A 4 still needs an observable flaw: "professional but not exceptional" is not evidence. For uncertain, identify the unresolved feature and location, use the relevant criterion, score below 5 and keep the image private. Never resolve uncertainty by assuming a pass. Inspect all applicable criteria; report the most consequential finding per dimension.
Wrong identity, missing requested details, a substituted medium or unwanted content belong to briefFidelity. They must not lower premiumFinish or compositionQuality unless there is a separately observed craft or layout defect. Wrong character does not imply bad drawing. Unknown photograph provenance is not a visible craft defect. A requested diptych, collage or photograph is not a defect. A false purchase check may result from failed fidelity even when craft is excellent; do not invent a craft deduction to match it.
Do not pair praise such as "clean, balanced, intentional" with a reduced composition score unless you also identify the actual layout defect. Do not restate a brief mismatch as generic-execution. That criterion requires visible repetitive or default craft decisions, with their location and effect. Missing required facts or failed identity cannot coexist with a 5 for briefFidelity. All-clear assessments cannot coexist with a false purchase check; identify the actual limiting dimension or report uncertainty. Scores are never averaged or automatically raised.
MEDIUM-SPECIFIC CRAFT ANCHORS (principles, not a list of allowed media):
- Flat vector / graphic art: deliberate contours, shape rhythm, controlled palette and hierarchy; absent gradients or depth are not defects.
- Painting / drawing: controlled marks, purposeful edges and coherent texture; visible brushwork or paper texture is not careless execution by itself.
- Photography: coherent subject detail, light, contact, focus and color; photographic realism or an unidentified photographer is not a failure.
- 3D / clay / animation: coherent stylized forms, material response and contact; intentional stylized anatomy differs from broken anatomy.
- Collage / mixed media / textile / unfamiliar treatments: inspect the requested construction's internal consistency; intentional seams, flatness and varied textures are valid. Preserve free-form host intent. Never impose another medium's surface, gloss, depth or realism.
These anchors apply to original scenes, adult events and every named character or franchise. Judge only visible evidence at the supplied resolution. Notes must not hide a defect omitted from its dimension assessment.`;

const evidence = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

/** Structural contradictions are deterministic; semantic truth still requires visual calibration. */
export function validateReviewEvidence(raw: unknown, scores: VisionScores, facts: {
  missingRequired: boolean; identityAccurate: boolean; milestoneCorrect: boolean;
  excludedFound: boolean; purchaseDesire: boolean;
}) {
  const issues: string[] = [];
  const assessments: Partial<DimensionAssessments> = {};
  const record = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, any> : {};
  for (const key of Object.keys(REVIEW_CRITERIA) as (keyof VisionScores)[]) {
    const row = record[key];
    if (!row || !["clear", "defect", "uncertain"].includes(row.status) ||
        !evidence(row.location) || !evidence(row.observation)) {
      issues.push(`${key}:missing-located-assessment`); continue;
    }
    assessments[key] = { status: row.status, criterion: row.criterion,
      location: row.location.trim(), observation: row.observation.trim() };
    const allowed: readonly string[] = REVIEW_CRITERIA[key];
    if (row.status === "clear") {
      if (row.criterion !== "none" || scores[key] !== 5) issues.push(`${key}:clear-score-conflict`);
    } else {
      if (!allowed.includes(row.criterion)) issues.push(`${key}:wrong-dimension-criterion`);
      if (!(scores[key] >= 1 && scores[key] < 5)) issues.push(`${key}:defect-score-conflict`);
      if (row.status === "uncertain") issues.push(`${key}:unresolved-observation`);
    }
  }
  if ((facts.missingRequired || !facts.identityAccurate || !facts.milestoneCorrect || facts.excludedFound) &&
      (scores.briefFidelity === 5 || assessments.briefFidelity?.status === "clear")) {
    issues.push("briefFidelity:binary-check-conflict");
  }
  if (!facts.purchaseDesire && Object.values(scores).every(score => score === 5)) {
    issues.push("purchase:all-clear-conflict");
  }
  return { assessments, integrity: { version: REVIEW_EVIDENCE_VERSION, valid: issues.length === 0, issues } };
}

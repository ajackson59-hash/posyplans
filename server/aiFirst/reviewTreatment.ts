import type { VisionScores } from "@shared/aiFirstStream";
import type { BoundRequirement } from "./reviewChecklist";

export interface MediumAssessment {
  status: "matched" | "mismatched" | "unresolved" | "not-requested";
  observedTreatment: string; location: string; observation: string;
}
export const MEDIUM_ASSESSMENT_SCHEMA = {
  type: "object", properties: {
    status: { type: "string", enum: ["matched", "mismatched", "unresolved", "not-requested"] },
    observedTreatment: { type: "string" }, location: { type: "string" }, observation: { type: "string" },
  }, required: ["status", "observedTreatment", "location", "observation"], additionalProperties: false,
};
export const MEDIUM_REVIEW_INSTRUCTION = `SEPARATE MEDIUM COMPLIANCE FROM EXECUTION:
First describe the treatment actually visible in mediumAssessment.observedTreatment, including mixed or unfamiliar media without forcing a catalog label. Compare it to REQUESTED REVIEW TREATMENT: matched, mismatched, unresolved, or not-requested when that field is null. Give located evidence. A mismatch still fails briefFidelity and its medium checklist item; it never becomes acceptable because craft or identity is good.
Then assess premiumFinish against the execution actually visible, using basis observed-craft. Evaluate composition against the actual intended layout, using basis observed-layout. These assessments must stand independently of whether the right character, theme or medium was delivered. If the only rationale is failure to follow the brief, mark basis brief-compliance: the server will reject that as an invalid craft/layout report rather than alter its score. Use unresolved for a feature you cannot judge. Never manufacture a craft flaw to make scores agree with a failed medium, identity or purchase check.
This separation applies to human and nonhuman characters, every franchise, original subjects, general themes and scenes with no characters. Medium compliance, character/version accuracy, scene facts, exclusions, craft, and layout remain independently binding.`;

export function validateMediumAssessment(raw: unknown, requested: string | null, mediumRows: readonly BoundRequirement[], scores: VisionScores) {
  const row = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const issues: string[] = [];
  const nonempty = (value: unknown) => typeof value === "string" && value.trim().length > 0;
  if (!["matched", "mismatched", "unresolved", "not-requested"].includes(String(row.status)) ||
      ![row.observedTreatment, row.location, row.observation].every(nonempty)) {
    return { assessment: undefined, issues: ["medium:missing-located-assessment"] };
  }
  const assessment = row as unknown as MediumAssessment;
  if (assessment.status === "unresolved") issues.push("medium:unresolved-observation");
  if (requested) {
    if (assessment.status === "not-requested") issues.push("medium:requested-treatment-omitted");
    if (assessment.status === "matched" && (!mediumRows.length || mediumRows.some(r => r.reviewStatus !== "reported" || !r.present)))
      issues.push("medium:checklist-conflict");
    if (assessment.status === "mismatched") {
      if (!mediumRows.some(r => r.reviewStatus === "reported" && !r.present)) issues.push("medium:checklist-conflict");
      if (scores.briefFidelity >= 5) issues.push("medium:fidelity-score-conflict");
    }
  } else if (assessment.status !== "not-requested") issues.push("medium:unrequested-treatment-judgment");
  return { assessment, issues };
}

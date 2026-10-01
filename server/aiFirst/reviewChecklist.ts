/** IDs are scoped to a retained request manifest, never inferred from model prose. */
export const REVIEW_CHECKLIST_VERSION = "requirement-ids-v1";
export interface ReviewRequirement { id: string; requirement: string; kind: "identity" | "medium" | "scene" }
export interface BoundRequirement {
  requirementId: string; requirement: string; present: boolean; evidence: string;
  /** Unresolved is a review-contract failure, not an observation that a subject is absent. */
  reviewStatus: "reported" | "unresolved";
}
export function reviewRequirementManifest(requirements: readonly string[], identities: readonly string[], media: readonly string[]): ReviewRequirement[] {
  return requirements.map((requirement, index) => ({ id: `r${index + 1}`, requirement,
    kind: identities.includes(requirement) ? "identity" : media.includes(requirement) ? "medium" : "scene" }));
}
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
export function bindReviewChecklist(raw: unknown, requirements: readonly ReviewRequirement[]) {
  const issues: string[] = [];
  if (!Array.isArray(raw)) issues.push("checklist:missing-array");
  const rows: Record<string, unknown>[] = Array.isArray(raw) ? raw.map(row =>
    row && typeof row === "object" && !Array.isArray(row) ? row : {}) : [];
  for (const row of rows) {
    if (!requirements.some(item => item.id === row.requirementId)) issues.push("checklist:unknown-requirement-id");
  }
  const requiredPresent: BoundRequirement[] = requirements.map(item => {
    const matches = rows.filter(row => row.requirementId === item.id), row = matches[0];
    if (matches.length !== 1) issues.push(`${item.id}:${matches.length ? "duplicate-answer" : "missing-answer"}`);
    const complete = matches.length === 1 && typeof row.present === "boolean" && text(row.evidence);
    if (matches.length === 1 && !complete) issues.push(`${item.id}:invalid-answer`);
    return { requirementId: item.id, requirement: item.requirement,
      present: complete && row.present === true, evidence: complete ? String(row.evidence).trim() : "",
      reviewStatus: complete ? "reported" : "unresolved" };
  });
  return { requiredPresent, checklist: { version: REVIEW_CHECKLIST_VERSION, requirements: [...requirements],
    valid: issues.length === 0, issues: Array.from(new Set(issues)) } };
}

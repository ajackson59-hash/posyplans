/** Explicit comparisons: structural validity is not proof of visual correctness. */
import type { ReviewReference } from "./reviewReferences";
export const IDENTITY_COMPARISON_VERSION = "reference-feature-comparison-v1";
export const IDENTITY_FEATURES = ["facialProportions", "eyesAndBrows", "noseAndMouth", "hairStructure"] as const;
type Decision = "match" | "mismatch" | "unresolved";
interface FeatureComparison {
  referenceObservation: string; candidateObservation: string; assessment: Decision; explanation: string;
}
export interface IdentityComparisonTarget { key: string; referenceIndex: number; subject: string; requirements: string[] }
interface IdentityComparison {
  referenceIndex: number; subject: string; candidateLocation: string;
  candidateVisibility: "clear" | "insufficient" | "absent";
  referenceVisibility: "clear" | "insufficient";
  features: Record<typeof IDENTITY_FEATURES[number], FeatureComparison>; decision: Decision;
}
export interface IdentityComparisonReview {
  version: string; comparisons: IdentityComparison[]; valid: boolean; allMatched: boolean; issues: string[];
}
const wordSeparators = new RegExp("[^\\p{L}\\p{N}]+", "gu");
const normalized = (s: string) => ` ${s.normalize("NFKC").toLowerCase().replace(wordSeparators, " ").trim()} `;
/** Other references may help recognition but never add unrequested cast. */
export function identityComparisonTargets(references: readonly ReviewReference[], requirements: readonly string[], context: string) {
  return references.flatMap((reference, index): IdentityComparisonTarget[] => {
    if (reference.role !== "identity") return [];
    const subject = normalized(reference.subject);
    const relevant = requirements.filter(requirement => normalized(requirement).includes(subject));
    if (!relevant.length && !normalized(context).includes(subject)) return [];
    return [{ key: `reference${index + 1}`, referenceIndex: index + 1, subject: reference.subject, requirements: relevant }];
  });
}
const featureSchema = {
  type: "object", properties: { referenceObservation: { type: "string" }, candidateObservation: { type: "string" },
    assessment: { type: "string", enum: ["match", "mismatch", "unresolved"] }, explanation: { type: "string" } },
  required: ["referenceObservation", "candidateObservation", "assessment", "explanation"], additionalProperties: false,
};
export function identityComparisonSchema(targets: readonly IdentityComparisonTarget[]) {
  return { type: "object", properties: Object.fromEntries(targets.map(target => [target.key, {
    type: "object", properties: { candidateLocation: { type: "string" },
      candidateVisibility: { type: "string", enum: ["clear", "insufficient", "absent"] },
      referenceVisibility: { type: "string", enum: ["clear", "insufficient"] },
      features: { type: "object", properties: Object.fromEntries(IDENTITY_FEATURES.map(key => [key, featureSchema])),
        required: [...IDENTITY_FEATURES], additionalProperties: false } },
    required: ["candidateLocation", "candidateVisibility", "referenceVisibility", "features"], additionalProperties: false,
  }])), required: targets.map(target => target.key), additionalProperties: false };
}
export const IDENTITY_COMPARISON_INSTRUCTION = `REFERENCE FEATURE COMPARISON — complete identityComparisons BEFORE any identity verdict or score.
For each required reference key, locate only that requested subject in the CANDIDATE. Independently observe the labeled reference and candidate, then compare them. Do not start with recognition by costume and rationalize a match afterward.
For every feature supply separate referenceObservation and candidateObservation, assessment (match, mismatch, unresolved), and a short explanation comparing those observations:
- facialProportions: face length/width, cheek shape, jaw and chin contours and their relative proportions.
- eyesAndBrows: eye shape, spacing, eyelid appearance and brow shape/placement.
- noseAndMouth: nose width/shape, mouth shape, smile structure and proportions in the face.
- hairStructure: hairline, overall silhouette, distribution of volume, parting/bangs, loose versus gathered construction and arrangement. Shared hair color or the word curly is insufficient evidence of matching structure.
Describe visible geometry concretely. Broad praise such as recognizable, distinct, same proportions, or matching reference is a conclusion, not an observation. Clothing, skin color, a bow or other accessories do not establish these feature matches. For nonhuman or stylized subjects compare corresponding visible forms; a feature deliberately absent from the character can match when both observations establish that absence. Occlusion or insufficient detail is not deliberate absence.
Allow the requested medium and natural differences from head angle, expression, lighting and pose; explain them without demanding identical pixels. Preserve likeness within the medium without requiring photography. Never require a pose, costume, badge, letter or background copied from a reference. Do not invent hidden features. When either image lacks enough visible detail, record insufficient visibility and unresolved features; never infer a match from costume or prompt.
Only four supported feature matches with clear visibility support a reference likeness pass. Any mismatch or unresolved feature requires a negative identity verdict and keeps the candidate private. Keep requiredPresent, teaser identity and fidelity consistent with these comparisons. A match for one subject does not establish other identities, the scene, premium craft or purchase appeal. Do not alter unrelated scores merely to echo an identity failure.`;
const object = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
export function validateIdentityComparisons(raw: unknown, targets: readonly IdentityComparisonTarget[], facts: {
  identityAccurate?: boolean; requiredPresent: { requirement: string; present: boolean }[];
}): IdentityComparisonReview {
  const record = object(raw), issues: string[] = [], comparisons: IdentityComparison[] = [];
  if (Object.keys(record).some(key => !targets.some(target => target.key === key))) issues.push("unrequested-reference-comparison");
  for (const target of targets) {
    const row = object(record[target.key]), features = object(row.features);
    let complete = text(row.candidateLocation) && ["clear", "insufficient", "absent"].includes(row.candidateVisibility) &&
      ["clear", "insufficient"].includes(row.referenceVisibility);
    for (const feature of IDENTITY_FEATURES) {
      const part = object(features[feature]);
      if (!text(part.referenceObservation) || !text(part.candidateObservation) || !text(part.explanation) ||
          !["match", "mismatch", "unresolved"].includes(part.assessment)) complete = false;
    }
    if (!complete) { issues.push(`${target.key}:incomplete-feature-comparison`); continue; }
    const observed = features as IdentityComparison["features"];
    const visible = row.candidateVisibility === "clear" && row.referenceVisibility === "clear";
    const assessments = IDENTITY_FEATURES.map(key => observed[key].assessment);
    const decision: Decision = assessments.includes("mismatch") ? "mismatch"
      : !visible || assessments.includes("unresolved") ? "unresolved" : "match";
    comparisons.push({ referenceIndex: target.referenceIndex, subject: target.subject,
      candidateLocation: row.candidateLocation.trim(), candidateVisibility: row.candidateVisibility,
      referenceVisibility: row.referenceVisibility, features: observed, decision });
    if (!visible && assessments.every(assessment => assessment === "match")) issues.push(`${target.key}:visibility-match-conflict`);
    if (decision !== "match") {
      if (facts.identityAccurate === true) issues.push(`${target.key}:identity-verdict-conflict`);
      if (facts.requiredPresent.some(requirement => target.requirements.includes(requirement.requirement) && requirement.present)) {
        issues.push(`${target.key}:required-identity-conflict`);
      }
    }
  }
  return { version: IDENTITY_COMPARISON_VERSION, comparisons, valid: issues.length === 0,
    allMatched: issues.length === 0 && comparisons.length === targets.length && comparisons.every(row => row.decision === "match"), issues };
}

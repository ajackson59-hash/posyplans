import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Event } from "@shared/schema";
import { IDENTITY_FEATURES, identityComparisonTargets, validateIdentityComparisons } from "../server/aiFirst/identityComparison";
import { runVisionGate } from "../server/aiFirst/visionGate";
import { encodePng } from "../server/aiFirst/png";
import { buildQualityLockedPreviewBrief } from "../server/prePaymentPreviewQuality";
import type { ReviewReference } from "../server/aiFirst/reviewReferences";

const bytes = encodePng({ width: 80, height: 100, rgb: new Uint8Array(80 * 100 * 3).fill(140) });
const reference: ReviewReference = { bytes, sha256: createHash("sha256").update(bytes).digest("hex"),
  role: "identity", subject: "Meekah", region: "Face and hair", sourceUrl: "https://example.com/identity" };
const requirement = "Meekah is visibly identifiable with faithful facial proportions and hair structure";
const targets = identityComparisonTargets([reference], [requirement], "");
const facts = (accurate: boolean) => ({ identityAccurate: accurate, requiredPresent: [{ requirement, present: accurate }] });
const row = (assessment: "match" | "mismatch" | "unresolved" = "match") => ({ candidateLocation: "Right-hand figure",
  candidateVisibility: "clear", referenceVisibility: "clear", features: Object.fromEntries(IDENTITY_FEATURES.map(feature => [feature, {
    referenceObservation: `${feature}: visible reference geometry in offline fixture`,
    candidateObservation: `${feature}: visible candidate geometry in offline fixture`,
    assessment: feature === "hairStructure" ? assessment : "match", explanation: "Located comparison in offline fixture only",
  }])) });

describe("reference feature comparison contract", () => {
  it("allows complete matching observations without demanding identical poses or pixels", () => {
    const r = row(); r.features.eyesAndBrows.explanation = "Squint follows the broader smile; eye spacing and brow arcs correspond";
    expect(validateIdentityComparisons({ reference1: r }, targets, facts(true))).toMatchObject({ valid: true, allMatched: true });
  });
  it("holds a supported hair mismatch even when facial features match", () => {
    expect(validateIdentityComparisons({ reference1: row("mismatch") }, targets, facts(false)))
      .toMatchObject({ valid: true, allMatched: false, comparisons: [{ decision: "mismatch" }] });
  });
  it("rejects a positive identity claim contradicted by the feature observations", () => {
    const result = validateIdentityComparisons({ reference1: row("mismatch") }, targets, facts(true));
    expect(result.valid).toBe(false); expect(result.allMatched).toBe(false);
    expect(result.issues).toContain("reference1:identity-verdict-conflict");
    expect(result.issues).toContain("reference1:required-identity-conflict");
  });
  it("keeps uncertainty private without inventing a visible mismatch", () => {
    const result = validateIdentityComparisons({ reference1: row("unresolved") }, targets, facts(false));
    expect(result).toMatchObject({ valid: true, allMatched: false, comparisons: [{ decision: "unresolved" }] });
  });
  it("does not allow confident matches when the image is too small to resolve them", () => {
    const r = row(); r.candidateVisibility = "insufficient";
    expect(validateIdentityComparisons({ reference1: r }, targets, facts(true)).issues).toContain("reference1:visibility-match-conflict");
  });
  it.each(IDENTITY_FEATURES)("requires independent reference/candidate evidence for %s", feature => {
    const r = row(); r.features[feature].candidateObservation = " ";
    expect(validateIdentityComparisons({ reference1: r }, targets, facts(true)).allMatched).toBe(false);
  });
  it("refuses the old generic identity report with no feature comparison", () => {
    expect(validateIdentityComparisons(undefined, targets, facts(true)))
      .toMatchObject({ valid: false, allMatched: false, issues: ["reference1:incomplete-feature-comparison"] });
  });
  it("does not promote a different missing identity merely because the referenced subject matches", () => {
    expect(validateIdentityComparisons({ reference1: row() }, targets,
      { identityAccurate: false, requiredPresent: [{ requirement, present: true }, { requirement: "Blippi", present: false }] }))
      .toMatchObject({ valid: true, allMatched: true });
  });
  it("binds comparisons to requested subjects and preserves original reference numbering", () => {
    const refs = [{ ...reference, subject: "Anna" }, reference];
    expect(identityComparisonTargets(refs, [requirement], "").map(r => r.key)).toEqual(["reference2"]);
    expect(identityComparisonTargets([{ ...reference, subject: "Ann" }], ["Anna is present"], "")).toEqual([]);
    expect(validateIdentityComparisons({ reference1: row(), reference2: row() }, targets, facts(true)).valid).toBe(false);
  });
});

it.each(["match", "mismatch", "missing"] as const)("enforces %s evidence through the real vision adapter without altering the reported verdict", async assessment => {
  const { brief, concept } = await buildQualityLockedPreviewBrief({ eventName: "Portrait study", eventType: "Portrait study",
    themeName: "", paletteColors: "[]", vibeDescription: "A photographic portrait of Meekah." } as Event);
  brief.requirements = { required: [`[VISIBLE NAMED IDENTITY] ${requirement}`], preferred: [], excluded: [] };
  const scores = { textLogoWatermarkFree: 5, artifactFree: 5, premiumFinish: 5, briefFidelity: 5, compositionQuality: 5, ageAppropriate: 5 };
  const create = vi.fn(async (body: any) => ({ stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 100 },
    content: [{ type: "text", text: JSON.stringify({ ...scores,
      ...(assessment === "missing" ? {} : { identityComparisons: { reference1: row(assessment) } }),
      requiredPresent: body.output_config.format.schema.properties.requiredPresent.items.properties.requirement.enum.map(
        (requirement: string) => ({ requirement, present: true, evidence: "Visible subject in offline fixture" })),
      excludedFound: [], notes: "Offline fixture only", dimensionAssessments: Object.fromEntries(Object.keys(scores).map(key => [key,
        { status: "clear", criterion: "none", location: "Entire canvas", observation: "Positive offline fixture support" }])),
      teaserChecks: { identity: { accurate: true, evidence: "Generic identity claim from fixture" },
        milestone: { correct: true, evidence: "No count requested" }, purchase: { wouldCreatePurchaseDesire: true, evidence: "Fixture only" } },
    }) }] }));
  const result = await runVisionGate({ bytes, brief, concept, referenceImages: [reference], reviewMode: "teaser",
    maxFormatRepairs: 0, client: { messages: { create } } as any });
  expect(result.passed).toBe(assessment === "match");
  expect(result.teaserChecks?.identity.accurate).toBe(true); // preserve the model's report for diagnosis
  expect(result.identityComparison?.allMatched).toBe(assessment === "match");
  expect(create).toHaveBeenCalledTimes(1);
  const body = create.mock.calls[0][0];
  expect(body.output_config.format.schema.required).toContain("identityComparisons");
  expect(body.messages[0].content.filter((p: any) => p.type === "image")).toHaveLength(2);
  expect(body.max_tokens).toBeLessThanOrEqual(4000);
});

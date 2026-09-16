// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { buildEventBrief } from "../server/aiFirst/brief";
import { buildBriefFidelityRequest, validateBriefFidelity, type BriefFidelityInput } from "../server/aiFirst/briefFidelityReview";
import { prepareSeparatedReview, combineSeparatedReview, type SeparatedReviewReceipt } from "../server/aiFirst/separatedArtworkReview";
import { validateIndependentCraft } from "../server/aiFirst/independentCraftReview";
import { IDENTITY_FEATURES } from "../server/aiFirst/identityComparison";
import { encodePng } from "../server/aiFirst/png";
import { concept } from "./aiFirstFixtures";
import { crossThemeProfile, CROSS_THEME_CASES } from "../server/crossThemeReviewProfiles";
import type { Event } from "@shared/schema";

const bytes = encodePng({ width: 8, height: 8, rgb: new Uint8Array(192).fill(120) });
function input(vibe = "Flat vector gallery: three cobalt arches on ivory; no people"): BriefFidelityInput {
  const brief = buildEventBrief({ event: { eventName: "Gallery", eventType: "Opening", themeName: "", vibeDescription: vibe,
    paletteColors: "[]" } as Event, dna: {}, guestCount: null });
  brief.requirements = { required: ["[VISIBLE HOST DETAIL] Exactly three cobalt arches"], preferred: ["Symmetry if useful"], excluded: ["People"] };
  return { bytes, brief, concept: concept(), reviewMode: "teaser" };
}
const located = () => ({ status: "matched", location: "canvas", observation: "Synthetic located evidence; not a visual judgment" });
const clear = () => ({ score: 5, status: "clear", criterion: "none", location: "canvas", observation: "Synthetic positive support" });
function fidelityReply(packet: ReturnType<typeof buildBriefFidelityRequest>): any {
  return { requirements: packet.context.requirements.map(r => ({ requirementId: r.id, ...located() })),
    exclusions: packet.context.exclusions.map(r => ({ requirementId: r.id, ...located() })),
    fullBrief: located(), intendedLayout: located(), purchase: located(),
    medium: { ...located(), status: packet.context.requestedTreatment ? "matched" : "not-requested", observedTreatment: "Synthetic treatment" },
    assessments: { textLogoWatermarkFree: clear(), briefFidelity: clear(), ageAppropriate: clear() },
    ...(packet.context.comparisonTargets.length ? { identityComparisons: packet.context.comparisonTargets.flatMap(t => IDENTITY_FEATURES.map(feature => ({ referenceKey: t.key, feature,
      candidateLocation: "central face", candidateVisibility: "clear", referenceVisibility: "clear",
      referenceObservation: "Synthetic geometry in reference", candidateObservation: "Synthetic geometry in candidate",
      assessment: "match", explanation: "Synthetic paired comparison" }))) } : {}) };
}
function craftReply(): any { return { artifactFree: clear(), premiumFinish: clear(), compositionQuality: clear() }; }
function receipt(packet: { imageHash: string; requestFingerprint: string; schemaHash: string }, raw: unknown): SeparatedReviewReceipt {
  return { imageHash: packet.imageHash, requestFingerprint: packet.requestFingerprint, schemaHash: packet.schemaHash,
    model: "claude-sonnet-4-6", requestCount: 1, stopReason: "end_turn", rawText: JSON.stringify(raw), usage: { inputTokens: 1, outputTokens: 1 } };
}
function mismatch(report: any, criterion = "missing-requested-detail", unresolved = false) {
  report.fullBrief.status = report.purchase.status = unresolved ? "unresolved" : "mismatched";
  report.assessments.briefFidelity = { score: 2, status: unresolved ? "uncertain" : "defect", criterion,
    location: "canvas", observation: "Synthetic mismatch, not a craft deduction" };
}

it("isolates craft while binding every full-brief field, counts, preferences and exclusions to fidelity", () => {
  const first = input(), second = input("Watercolor gallery with three cobalt arches; no people");
  const a = prepareSeparatedReview(first), b = prepareSeparatedReview(second);
  expect(a.craft.requestFingerprint).toBe(b.craft.requestFingerprint);
  expect(a.fidelity.requestFingerprint).not.toBe(b.fidelity.requestFingerprint);
  const text = JSON.stringify(a.fidelity.body);
  for (const value of [first.brief.vibe, "Exactly three cobalt arches", "People", "Symmetry if useful"]) expect(text).toContain(value);
  expect(JSON.stringify(a.craft.body)).not.toContain(first.brief.vibe);
  expect(a.fidelity.context.requirements.some(r => r.requirement === "Symmetry if useful")).toBe(false);
});

it.each(CROSS_THEME_CASES)("prepares full coverage for retained $caseId without paid calls or brand exceptions", async c => {
  const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(Error("offline"));
  try {
    const profile = await crossThemeProfile(c.caseId);
    const p = prepareSeparatedReview({ ...profile, bytes, reviewMode: "teaser" });
    const task = JSON.stringify(p.fidelity.body);
    const encoded = (s: string) => JSON.stringify(JSON.stringify(s)).slice(1, -1);
    expect(task).toContain(encoded(profile.brief.vibe));
    expect(task).toContain(encoded(profile.brief.inspirationNotes));
    expect(p.fidelity.context.exclusions).toHaveLength(new Set(profile.brief.requirements.excluded).size);
    expect(p.fidelity.context.comparisonTargets).toHaveLength(0);
    expect(p.fidelity.body.output_config?.format?.schema.properties).not.toHaveProperty("identityComparisons");
    expect((p.fidelity.body.messages[0].content as any[]).filter(c => c.type === "image")).toHaveLength(1);
    expect(network).not.toHaveBeenCalled();
  } finally { network.mockRestore(); }
});

it("rejects reference-image claims invented from written identity descriptions", async () => {
  const p = buildBriefFidelityRequest({ ...await crossThemeProfile("c01"), bytes, reviewMode: "teaser" });
  const raw = fidelityReply(p);
  raw.identityComparisons = IDENTITY_FEATURES.map(feature => ({ referenceKey: "Elsa (Disney Frozen)", feature,
    candidateLocation: "central face", candidateVisibility: "clear", referenceVisibility: "clear",
    referenceObservation: "From the written description", candidateObservation: "Visible candidate feature",
    assessment: "match", explanation: "Claimed description comparison" }));
  expect(validateBriefFidelity(raw, p.context)).toMatchObject({ valid: false, passed: false });
});

it.each(["watercolor", "flat vector", "photographic", "3D", "collage", "medium: lacquer inlay"])("preserves free-form %s treatment", medium => {
  const p = buildBriefFidelityRequest(input(`${medium}. Three cobalt arches. No people.`));
  expect(p.context.requestedTreatment).toBeTruthy();
  expect(p.context.requirements.some(r => r.kind === "medium")).toBe(true);
});

describe.each(["requirements", "exclusions"] as const)("%s answer binding", list => {
  it.each(["missing", "duplicate", "unknown", "no-evidence", "unexpected-field"])("rejects %s", problem => {
    const p = buildBriefFidelityRequest(input()), raw = fidelityReply(p);
    if (problem === "missing") raw[list].pop();
    if (problem === "duplicate") raw[list].push({ ...raw[list][0] });
    if (problem === "unknown") raw[list][0].requirementId = "invented";
    if (problem === "no-evidence") raw[list][0].observation = " ";
    if (problem === "unexpected-field") raw[list][0].autoApprove = true;
    expect(validateBriefFidelity(raw, p.context)).toMatchObject({ valid: false, passed: false });
  });
});

it.each(["identity-mismatch", "wrong-explicit-count", "excluded-content", "wrong-setting-or-activity"])("keeps %s rejected without lowering craft", criterion => {
  const i = input(), p = prepareSeparatedReview(i), raw = fidelityReply(p.fidelity), craft = craftReply();
  if (criterion === "excluded-content") raw.exclusions[0].status = "mismatched";
  else raw.requirements[0].status = "mismatched";
  mismatch(raw, criterion);
  const result = combineSeparatedReview(i, { craft: receipt(p.craft, craft), fidelity: receipt(p.fidelity, raw) });
  expect(result).toMatchObject({ valid: true, passed: false, disposition: "rejected" });
  expect(result.craft.assessments.premiumFinish?.score).toBe(5);
  expect(result.fidelity.report?.assessments.briefFidelity.score).toBe(2);
});

it("reuses one exact-image craft receipt across the paired medium requests, without any score replacement", () => {
  const original = input(), watercolor = input("Watercolor gallery with three cobalt arches. No people.");
  const a = prepareSeparatedReview(original), b = prepareSeparatedReview(watercolor);
  const craft = receipt(a.craft, craftReply()), matching = fidelityReply(a.fidelity), wrongMedium = fidelityReply(b.fidelity);
  wrongMedium.medium.status = "mismatched";
  for (const r of b.fidelity.context.requirements.filter(r => r.kind === "medium"))
    wrongMedium.requirements.find((x: any) => x.requirementId === r.id).status = "mismatched";
  mismatch(wrongMedium, "medium-substitution");
  const before = JSON.stringify(craft);
  expect(combineSeparatedReview(original, { craft, fidelity: receipt(a.fidelity, matching) }).passed).toBe(true);
  const result = combineSeparatedReview(watercolor, { craft, fidelity: receipt(b.fidelity, wrongMedium) });
  expect(result).toMatchObject({ valid: true, passed: false, disposition: "rejected" });
  expect(JSON.stringify(craft)).toBe(before); expect(result.craft.assessments.premiumFinish?.score).toBe(5);
});

it.each(["craft", "fidelity"] as const)("keeps honest %s uncertainty rejected", component => {
  const i = input(), p = prepareSeparatedReview(i), craft = craftReply(), fidelity = fidelityReply(p.fidelity);
  if (component === "craft") craft.premiumFinish = { score: 4, status: "uncertain", criterion: "unresolved-detail", location: "small trim", observation: "Edge unresolved" };
  else { fidelity.requirements[0].status = "unresolved"; mismatch(fidelity, "missing-requested-detail", true); }
  const result = combineSeparatedReview(i, { craft: receipt(p.craft, craft), fidelity: receipt(p.fidelity, fidelity) });
  expect(result).toMatchObject({ valid: true, passed: false, unresolved: true, disposition: "unresolved" });
});

it.each(["fullBrief", "purchase", "score"])("rejects a %s pass contradicting a failed fact", conflict => {
  const p = buildBriefFidelityRequest(input()), raw = fidelityReply(p);
  raw.requirements[0].status = "mismatched"; mismatch(raw);
  if (conflict === "score") raw.assessments.briefFidelity = clear(); else raw[conflict].status = "matched";
  expect(validateBriefFidelity(raw, p.context)).toMatchObject({ valid: false, passed: false });
});

it("retains the observed c08 composition contradiction as a failure", () => {
  const raw = craftReply();
  raw.compositionQuality = { score: 4, status: "clear", criterion: "none", location: "entire canvas",
    observation: "Asymmetrical arrangement of arches, circles and diagonal planes across the canvas is intentional and balanced with generous negative space" };
  expect(validateIndependentCraft(raw)).toMatchObject({ passed: false, issues: ["compositionQuality:clear-score-conflict"] });
});

it.each(["craft", "fidelity"] as const)("requires the %s component to pass independently", component => {
  const i = input(), p = prepareSeparatedReview(i), craft = craftReply(), fidelity = fidelityReply(p.fidelity);
  if (component === "craft") craft.premiumFinish = { score: 2, status: "defect", criterion: "careless-edge-work", location: "left arch", observation: "Broken edge" };
  else { fidelity.assessments.textLogoWatermarkFree = { score: 4, status: "defect", criterion: "lettering", location: "shoulder patch", observation: "Partial text" }; fidelity.purchase.status = "mismatched"; }
  const result = combineSeparatedReview(i, { craft: receipt(p.craft, craft), fidelity: receipt(p.fidelity, fidelity) });
  expect(result).toMatchObject({ valid: true, passed: false, disposition: "rejected" });
});

it.each(["image", "brief", "schema", "fingerprint", "model", "stop", "retry", "usage", "json", "missing"])("rejects %s receipt failures", failure => {
  const i = input(), p = prepareSeparatedReview(i), c = receipt(p.craft, craftReply()), f = receipt(p.fidelity, fidelityReply(p.fidelity));
  if (failure === "image") i.bytes = encodePng({ width: 8, height: 8, rgb: new Uint8Array(192).fill(121) });
  if (failure === "brief") i.brief.vibe += " Extra red arch.";
  if (failure === "schema") f.schemaHash = "stale";
  if (failure === "fingerprint") c.requestFingerprint = "stale";
  if (failure === "model") c.model = "other";
  if (failure === "stop") f.stopReason = "max_tokens";
  if (failure === "retry") c.requestCount = 2;
  if (failure === "usage") f.usage.outputTokens = NaN;
  if (failure === "json") c.rawText = "```json\n{}\n```";
  const result = combineSeparatedReview(i, { craft: failure === "missing" ? null : c, fidelity: f });
  expect(result).toMatchObject({ valid: false, passed: false, disposition: "invalid" });
});

it("covers supplied references feature by feature, and rejects unseen-face matches", () => {
  const i = input("Nova from an unfamiliar Star Academy, within watercolor. Three cobalt arches.");
  i.brief.requirements.required.push("[VISIBLE NAMED IDENTITY] Nova in the requested original version");
  i.referenceImages = [{ bytes, sha256: createHash("sha256").update(bytes).digest("hex"), role: "identity", subject: "Nova", region: "face", sourceUrl: "https://example.com/reference" }];
  const p = buildBriefFidelityRequest(i), raw = fidelityReply(p);
  expect(raw.identityComparisons).toHaveLength(4);
  expect(validateBriefFidelity(raw, p.context).passed).toBe(true);
  raw.identityComparisons[0].candidateVisibility = "insufficient";
  expect(validateBriefFidelity(raw, p.context)).toMatchObject({ valid: false, passed: false });
});

it("separates final type protection from image-only craft and binds changed layouts", () => {
  const i = input(), teaser = prepareSeparatedReview(i);
  i.reviewMode = "invitation"; i.concept.minOverlay = "plate";
  const plate = prepareSeparatedReview(i);
  i.concept.minOverlay = "veil";
  const veil = prepareSeparatedReview(i);
  expect(teaser.craft.requestFingerprint).toBe(plate.craft.requestFingerprint);
  expect(plate.craft.requestFingerprint).toBe(veil.craft.requestFingerprint);
  expect(plate.fidelity.requestFingerprint).not.toBe(veil.fidelity.requestFingerprint);
  const data = JSON.parse((plate.fidelity.body.messages[0].content as any[]).at(-1).text.split("\n").slice(1).join("\n"));
  expect(data.surface).toMatchObject({ mode: "invitation", protection: "plate" }); expect(data.surface.typeBox.width).toBeGreaterThan(0);
});

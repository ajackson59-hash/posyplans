// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { buildEventBrief } from "../server/aiFirst/brief";
import type { BriefFidelityInput } from "../server/aiFirst/briefFidelityReview";
import { prepareSeparatedReview, combineSeparatedReview, validateEvidenceReview, type EvidenceContext,
  type SeparatedReviewReceipt } from "../server/aiFirst/separatedArtworkReview";
import { prepareSeparatedReview as prepareLegacy } from "../server/aiFirst/legacySeparatedArtworkReview";
import { validateBriefFidelity } from "../server/aiFirst/briefFidelityReview";
import { validateIndependentCraft } from "../server/aiFirst/independentCraftReview";
import { explicitCountRule, sourceClauses } from "../server/aiFirst/reviewRequirementPlan";
import { IDENTITY_FEATURES } from "../server/aiFirst/identityComparison";
import { crossThemeProfile, CROSS_THEME_CASES } from "../server/crossThemeReviewProfiles";
import { encodePng } from "../server/aiFirst/png";
import retained from "./fixtures/reviewerBatch20260916.json";
import { concept } from "./aiFirstFixtures";
import type { Event } from "@shared/schema";

const bytes = encodePng({ width: 8, height: 8, rgb: new Uint8Array(192).fill(120) });
function input(vibe = "Flat vector gallery. Exactly three cobalt arches. Generous negative space and intentional asymmetry."): BriefFidelityInput {
  const brief = buildEventBrief({ event: { eventName: "Gallery", eventType: "Opening", themeName: "", vibeDescription: vibe,
    paletteColors: "[]" } as Event, dna: {}, guestCount: null });
  brief.requirements = { required: [], preferred: ["Symmetry if useful"], excluded: ["People"] };
  return { bytes, brief, concept: concept(), reviewMode: "teaser" };
}
/** Synthetic contract answers, NEVER visual or human approvals. */
function reply(context: EvidenceContext): any {
  return { judgments: context.checks.filter(c => !c.countRule).map(c => ({ checkId: c.id, ...c.binding,
    finding: "fulfilled", location: "canvas", observation: "Synthetic positive visible support" })),
    counts: context.checks.filter(c => c.countRule).map(c => ({ checkId: c.id, ...c.binding, visibility: "complete",
      items: Array.from({ length: c.countRule!.value }, (_, i) => ({ location: `object ${i + 1}`, observation: "Synthetic visible object" })),
      observation: "Synthetic complete object enumeration" })),
    ...(context.comparisonTargets.length ? { identityComparisons: context.comparisonTargets.flatMap(t => IDENTITY_FEATURES.map(feature => ({
      referenceKey: t.key, feature, candidateLocation: "face", candidateVisibility: "clear", referenceVisibility: "clear",
      referenceObservation: "Synthetic reference form", candidateObservation: "Synthetic candidate form", assessment: "match", explanation: "Synthetic form correspondence" }))) } : {}) };
}
function receipt(packet: { imageHash: string; requestFingerprint: string; schemaHash: string }, raw: unknown): SeparatedReviewReceipt {
  return { ...packet, model: "claude-sonnet-4-6", requestCount: 1, stopReason: "end_turn", rawText: JSON.stringify(raw), usage: { inputTokens: 1, outputTokens: 1 } };
}
function combine(i: BriefFidelityInput, mutate: (craft: any, fidelity: any) => void = () => {}) {
  const p = prepareSeparatedReview(i), craft = reply(p.craft.context), fidelity = reply(p.fidelity.context);
  mutate(craft, fidelity);
  return combineSeparatedReview(i, { craft: receipt(p.craft, craft), fidelity: receipt(p.fidelity, fidelity) });
}
afterEach(() => vi.restoreAllMocks());

describe("one finding, server-owned eligibility", () => {
  it("has no model-generated score/status pairs, purchase or aggregate verdict", () => {
    const p = prepareSeparatedReview(input());
    for (const component of [p.craft, p.fidelity]) {
      const schema = JSON.stringify(component.body.output_config!.format!.schema);
      expect(schema).not.toMatch(/"(?:score|scores|status|purchase|fullBrief|passed|overall)"/);
      expect(validateEvidenceReview(reply(component.context), component.context).passed).toBe(true);
    }
    expect(combine(input())).toMatchObject({ valid: true, passed: true, disposition: "passed", customerActivation: "disabled" });
  });
  it.each(["score", "status", "purchase", "fullBrief", "passed"])("refuses injected redundant %s instead of repairing it", field => {
    const p = prepareSeparatedReview(input()), raw = reply(p.fidelity.context);
    raw[field] = field === "score" ? 5 : "matched";
    const before = JSON.stringify(raw);
    expect(validateEvidenceReview(raw, p.fidelity.context)).toMatchObject({ valid: false, passed: false });
    expect(JSON.stringify(raw)).toBe(before);
  });
  it.each(["craft", "fidelity"] as const)("keeps %s uncertainty private without inventing an overall answer", role => {
    expect(combine(input(), (craft, fidelity) => (role === "craft" ? craft : fidelity).judgments[0].finding = "uncertain"))
      .toMatchObject({ valid: true, passed: false, unresolved: true, disposition: "unresolved" });
  });
  it("retains a real text failure even when another dimension is uncertain", () => {
    const result = combine(input(), (craft, fidelity) => {
      craft.judgments[0].finding = "uncertain";
      fidelity.judgments.find((r: any) => r.checkId === "policy:textLogoWatermarkFree").finding = "lettering";
    });
    expect(result).toMatchObject({ valid: true, passed: false, unresolved: true, disposition: "rejected" });
  });
  it.each(["careless-edge-work", "uncontrolled-palette", "incoherent-material", "generic-execution"])("still blocks actual %s", finding => {
    expect(combine(input(), craft => craft.judgments.find((r: any) => r.checkId === "policy:premiumFinish").finding = finding))
      .toMatchObject({ valid: true, passed: false, disposition: "rejected" });
  });
});

describe("source and quantifier authority", () => {
  it.each(["missing", "duplicate", "unknown-id", "changed-quote", "changed-source", "wrong-dimension", "empty-evidence", "extra-field"])("blocks %s", mutation => {
    const p = prepareSeparatedReview(input()), raw = reply(p.fidelity.context), row = raw.judgments[0];
    if (mutation === "missing") raw.judgments.shift();
    if (mutation === "duplicate") raw.judgments.push({ ...row });
    if (mutation === "unknown-id") row.checkId = "invented";
    if (mutation === "changed-quote") row.quote += " on every character";
    if (mutation === "changed-source") row.sourceId = "host:invented";
    if (mutation === "wrong-dimension") row.finding = "lettering";
    if (mutation === "empty-evidence") row.observation = " ";
    if (mutation === "extra-field") row.requiredCount = 3;
    expect(validateEvidenceReview(raw, p.fidelity.context)).toMatchObject({ valid: false, passed: false });
  });
  it("never converts Visible microphones into an all-three count", async () => {
    const p = prepareSeparatedReview({ ...await crossThemeProfile("c10"), bytes, reviewMode: "teaser" });
    const c = p.fidelity.context.checks.find(c => c.binding.quote.startsWith("Visible microphones"))!;
    expect(c.binding.quote).toBe("Visible microphones, a city skyline and ribbons of concert light.");
    expect(c.countRule).toBeNull();
    expect(c.findings).not.toContain("wrong-explicit-count");
    expect(p.fidelity.context.checks.some(c => c.binding.quote === "the complete host direction, including every requested subject and scene detail")).toBe(false);
    expect(p.fidelity.context.derivedCoverage).toHaveLength(2);
    expect(p.fidelity.context.derivedCoverage.every(c => c.checkIds.includes("host:3"))).toBe(true);
    const raw = reply(p.fidelity.context), row = raw.judgments.find((r: any) => r.checkId === c.id);
    row.finding = "wrong-explicit-count";
    expect(validateEvidenceReview(raw, p.fidelity.context).issues).toContain(`${c.id}:unsupported-finding`);
    row.finding = "different-required-content";
    row.observation = "The host explicitly requires visible microphones on all three performers.";
    expect(validateEvidenceReview(raw, p.fidelity.context).issues).toContain(`${c.id}:policy-claim-in-observation`);
    row.observation = "One central headset microphone is visible; the other figures' mouths are partly occluded.";
    row.finding = "uncertain";
    expect(validateEvidenceReview(raw, p.fidelity.context)).toMatchObject({ valid: true, passed: false, unresolved: true });
  });
  it.each(["Exactly three arches.", "At least two arches.", "At most one arch."])("derives %s from enumerated objects, not a model pass flag", phrase => {
    const i = input(phrase), p = prepareSeparatedReview(i), raw = reply(p.fidelity.context);
    expect(raw.counts).toHaveLength(1);
    expect(validateEvidenceReview(raw, p.fidelity.context).passed).toBe(true);
    if (phrase.startsWith("At most")) raw.counts[0].items.push({ location: "extra arch", observation: "Another distinct arch" });
    else raw.counts[0].items.pop();
    expect(validateEvidenceReview(raw, p.fidelity.context)).toMatchObject({ valid: true, passed: false });
    raw.counts[0].visibility = "insufficient";
    expect(validateEvidenceReview(raw, p.fidelity.context)).toMatchObject({ valid: true, passed: false, unresolved: true });
  });
  it.each(["Visible microphones", "A sixth birthday", "Exactly three arches per panel", "Not exactly three arches", "Exactly three arches or four circles", "Exactly three figures holding two balloons", "Exactly three arches with gold edges"])("does not invent a global numeric rule for %s", clause => {
    expect(explicitCountRule(clause)).toBeNull();
  });
  it("preserves unsupported counts and relational scope as written, not silently dropping them", () => {
    const phrase = "Each of three performers has a microphone. Exactly three arches per panel.";
    const p = prepareSeparatedReview(input(phrase));
    expect(p.fidelity.context.checks.filter(c => c.id.startsWith("host:")).map(c => c.binding.quote))
      .toEqual(["Each of three performers has a microphone.", "Exactly three arches per panel."]);
    expect(p.fidelity.context.checks.filter(c => c.id.startsWith("host:")).every(c => c.countRule === null)).toBe(true);
  });
  it("rejects duplicated count locations, fake counts and model-supplied thresholds", () => {
    const p = prepareSeparatedReview(input()), raw = reply(p.fidelity.context);
    raw.counts[0].items[1] = { ...raw.counts[0].items[0] };
    expect(validateEvidenceReview(raw, p.fidelity.context).issues.some(i => i.includes("duplicate-object-location"))).toBe(true);
    const fresh = reply(p.fidelity.context);
    fresh.counts[0].requiredCount = 2;
    expect(validateEvidenceReview(fresh, p.fidelity.context).valid).toBe(false);
    const unsolicited = reply(p.fidelity.context);
    unsolicited.counts.push({ ...unsolicited.counts[0], checkId: unsolicited.judgments[0].checkId });
    unsolicited.judgments.shift();
    expect(validateEvidenceReview(unsolicited, p.fidelity.context).issues.some(i => i.includes("unrequested-count"))).toBe(true);
  });
  it("preserves decimals, URLs, comma lists and unfamiliar direction words", () => {
    expect(sourceClauses("Use a 2.5-inch motif. See https://example.com/image. A, B and C together."))
      .toEqual(["Use a 2.5-inch motif.", "See https://example.com/image.", "A, B and C together."]);
    const p = prepareSeparatedReview(input("Medium: lacquer inlay. Iridescent silver foliage over dark lacquer."));
    expect(JSON.stringify(p.fidelity.body)).toContain("Iridescent silver foliage over dark lacquer");
  });
});

describe("composition has complete intent and real surface", () => {
  it.each(["c03", "c05", "c07"] as const)("moves $0 crop/diptych/negative-space review out of blind craft", async caseId => {
    const profile = await crossThemeProfile(caseId), p = prepareSeparatedReview({ ...profile, bytes, reviewMode: "teaser" });
    expect(p.craft.context.checks.map(c => c.dimension)).toEqual(["artifactFree", "premiumFinish"]);
    expect(p.fidelity.context.checks.some(c => c.dimension === "compositionQuality")).toBe(true);
    const task = (p.fidelity.body.messages[0].content as any[]).at(-1).text;
    expect(task).toContain(JSON.stringify(profile.brief.vibe));
    if (profile.brief.visualIdentityOverride) expect(task).toContain(JSON.stringify(profile.brief.visualIdentityOverride));
    expect(task).toContain('"overlays":"none","crop":"none"');
    const raw = reply(p.craft.context);
    raw.judgments[1].finding = "unbalanced-layout";
    expect(validateEvidenceReview(raw, p.craft.context)).toMatchObject({ valid: false, passed: false });
  });
  it("changes contextual review, but not craft, when only the requested medium changes", () => {
    const a = prepareSeparatedReview(input("Flat vector abstract forms. Generous negative space."));
    const b = prepareSeparatedReview(input("Watercolor abstract forms. Generous negative space."));
    expect(a.craft.requestFingerprint).toBe(b.craft.requestFingerprint);
    expect(a.fidelity.requestFingerprint).not.toBe(b.fidelity.requestFingerprint);
    expect(combine(input(), (_c, f) => f.judgments.find((r: any) => r.checkId.startsWith("host:")).finding = "different-required-content").passed).toBe(false);
  });
  it("does not exempt a real overlap or unresolved hierarchy just because space was requested", () => {
    for (const finding of ["accidental-overlap", "uncertain"]) {
      const result = combine(input(), (_c, f) => f.judgments.find((r: any) => r.checkId === "policy:compositionQuality").finding = finding);
      expect(result.valid).toBe(true); expect(result.passed).toBe(false);
    }
  });
  it("binds the actual invitation type surface, never an invented teaser overlay", () => {
    const i = input(), a = prepareSeparatedReview(i), b = prepareSeparatedReview({ ...i, reviewMode: "invitation" });
    expect(a.craft.requestFingerprint).toBe(b.craft.requestFingerprint);
    expect(b.fidelity.requestFingerprint).not.toBe(a.fidelity.requestFingerprint);
    expect((b.fidelity.body.messages[0].content as any[]).at(-1).text).toContain('"typeBox"');
  });
});

describe("historical structural regressions and coverage", () => {
  it.each(retained.rows)("replays sanitized $requestId structure without relabeling it as v2", async row => {
    const raw = JSON.parse(row.rawText), profile = await crossThemeProfile(row.role === "fidelity" ? row.requestId.replace("fidelity-", "") as any : "c01");
    const i = { ...profile, bytes, reviewMode: "teaser" as const }, legacy = prepareLegacy(i), next = prepareSeparatedReview(i);
    const before = JSON.stringify(raw);
    const oldResult = row.role === "craft" ? validateIndependentCraft(raw) : validateBriefFidelity(raw, legacy.fidelity.context);
    expect(oldResult.valid).toBe(row.historicalValid); expect(oldResult.passed).toBe(row.historicalPassed); expect(oldResult.issues).toEqual(row.historicalIssues);
    expect(validateEvidenceReview(raw, row.role === "craft" ? next.craft.context : next.fidelity.context)).toMatchObject({ valid: false, passed: false });
    expect(JSON.stringify(raw)).toBe(before);
  });
  it.each(CROSS_THEME_CASES)("prepares full $caseId input offline, with no brand exceptions or fabricated references", async c => {
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(Error("offline-only"));
    const profile = await crossThemeProfile(c.caseId), p = prepareSeparatedReview({ ...profile, bytes, reviewMode: "teaser" });
    const text = (p.fidelity.body.messages[0].content as any[]).at(-1).text;
    expect(text).toContain(JSON.stringify(profile.brief.vibe));
    expect(text).toContain(JSON.stringify(profile.brief.inspirationNotes));
    expect(p.fidelity.context.comparisonTargets).toHaveLength(0);
    expect(p.fidelity.body.output_config!.format!.schema.properties).not.toHaveProperty("identityComparisons");
    expect(network).not.toHaveBeenCalled();
  });
  it("pins closed research runners to the old contract and does not mount a v2 route", () => {
    for (const file of ["server/separatedResearchStudy.ts", "server/separatedReviewStudy.ts"])
      expect(readFileSync(file, "utf8")).toContain('from "./aiFirst/legacySeparatedArtworkReview"');
    expect(readFileSync("server/prePaymentPreviewQualityRoutes.ts", "utf8")).not.toContain("evidence-owned-decisions-v2");
  });
});

describe("transport binding and bounded provider grammar", () => {
  it.each(["wrong-image", "wrong-packet", "wrong-schema", "wrong-model", "retry", "truncation", "no-usage", "invalid-json", "missing-receipt"])("blocks %s", mutation => {
    const i = input(), p = prepareSeparatedReview(i), craft = receipt(p.craft, reply(p.craft.context)), fidelity = receipt(p.fidelity, reply(p.fidelity.context));
    if (mutation === "wrong-image") craft.imageHash = "wrong";
    if (mutation === "wrong-packet") fidelity.requestFingerprint = "old";
    if (mutation === "wrong-schema") fidelity.schemaHash = "old";
    if (mutation === "wrong-model") fidelity.model = "other";
    if (mutation === "retry") fidelity.requestCount = 2;
    if (mutation === "truncation") fidelity.stopReason = "max_tokens";
    if (mutation === "no-usage") fidelity.usage.inputTokens = 0;
    if (mutation === "invalid-json") fidelity.rawText = "{";
    expect(combineSeparatedReview(i, { craft: mutation === "missing-receipt" ? null : craft, fidelity }))
      .toMatchObject({ valid: false, passed: false, disposition: "invalid-review", customerActivation: "disabled" });
  });
  it("handles supplied identity pixels without a redundant summary identity verdict", () => {
    const i = input("A portrait of Ada in watercolor.");
    i.brief.requirements.required = ["Ada is visibly recognizable"];
    i.referenceImages = [{ bytes, sha256: createHash("sha256").update(bytes).digest("hex"), role: "identity", subject: "Ada", region: "face", sourceUrl: "https://example.com/ada" }];
    const p = prepareSeparatedReview(i), raw = reply(p.fidelity.context);
    expect(raw.identityComparisons).toHaveLength(4);
    raw.identityComparisons[0].assessment = "mismatch";
    expect(validateEvidenceReview(raw, p.fidelity.context)).toMatchObject({ valid: true, passed: false });
    raw.identityComparisons[0].assessment = "match"; raw.identityComparisons[0].candidateVisibility = "insufficient";
    expect(validateEvidenceReview(raw, p.fidelity.context)).toMatchObject({ valid: false, passed: false });
  });
  it.each(["craft", "fidelity"] as const)("serializes %s with the real SDK to a fake transport only", async role => {
    const p = prepareSeparatedReview(input());
    let wire: any;
    const transport = vi.fn(async (_url: any, init: any) => {
      wire = JSON.parse(init.body);
      return new Response(JSON.stringify({ id: "offline", type: "message", role: "assistant", model: wire.model,
        stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text: JSON.stringify(reply(p[role].context)) }] }),
      { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const client = new Anthropic({ apiKey: "offline-test", maxRetries: 0, fetch: transport });
    await client.messages.create(p[role].body);
    expect(transport).toHaveBeenCalledTimes(1);
    expect(createHash("sha256").update(JSON.stringify(wire)).digest("hex")).toBe(p[role].requestFingerprint);
    function check(schema: any) {
      for (const key of Object.keys(schema)) expect(["type", "properties", "required", "additionalProperties", "items", "enum"]).toContain(key);
      if (schema.type === "object") { expect(schema.additionalProperties).toBe(false); Object.values(schema.properties).forEach(check); }
      if (schema.items) check(schema.items);
    }
    check(wire.output_config.format.schema);
  });
});

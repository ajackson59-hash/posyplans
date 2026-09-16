// @vitest-environment node
import { expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { Event } from "@shared/schema";
import { encodePng } from "../server/aiFirst/png";
import { InMemoryArtworkAttemptStore, REVIEW_CALIBRATION_MODEL } from "../server/aiFirst/artworkAttemptStore";
import { MEDIUM_FEASIBILITY_CASES } from "../server/aiFirst/mediumFeasibilityCases";
import { crossThemeProfile, type CrossThemeCaseId } from "../server/crossThemeReviewProfiles";
import { prepareSeparatedReview } from "../server/aiFirst/separatedArtworkReview";
import { runSeparatedResearchStudy, type ResearchRegistration } from "../server/separatedResearchStudy";
import proposed from "../server/separatedResearchRegistration.json";

const hash = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");
const bytes = encodePng({ width: 8, height: 8, rgb: new Uint8Array(192).fill(125) });
const environment = { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "codex/launch-blockers", VERCEL_GIT_COMMIT_SHA: "research-test" };
const event = { id: 61, ownerToken: "test-owner", eventName: "Artwork evaluation", eventType: "Artwork evaluation",
  inviteStatus: "draft", themeName: "", paletteColors: "[]", vibeDescription: MEDIUM_FEASIBILITY_CASES[0].hostBrief } as Event;
const clear = () => ({ score: 5, status: "clear", criterion: "none", location: "canvas", observation: "Synthetic positive evidence" });
const matched = () => ({ status: "matched", location: "canvas", observation: "Synthetic located evidence" });
function reportFor(body: any) {
  if (body.output_config.format.schema.properties.artifactFree) return { artifactFree: clear(), premiumFinish: clear(), compositionQuality: clear() };
  const task = JSON.parse(body.messages[0].content.at(-1).text.split("\n").slice(1).join("\n"));
  return { requirements: task.requirements.map((r: any) => ({ requirementId: r.id, ...matched() })),
    exclusions: task.exclusions.map((r: any) => ({ requirementId: r.id, ...matched() })),
    fullBrief: matched(), intendedLayout: matched(), purchase: matched(),
    medium: { ...matched(), status: task.requestedTreatment ? "matched" : "not-requested", observedTreatment: "Synthetic treatment" },
    assessments: { textLogoWatermarkFree: clear(), briefFidelity: clear(), ageAppropriate: clear() } };
}
async function fixture(edit: (report: any, response: any, call: number) => void = () => {}) {
  const registration = structuredClone(proposed) as ResearchRegistration;
  registration.authorizationStatus = "approved"; // Synthetic-only fixture; never sends a live request.
  const store = new InMemoryArtworkAttemptStore();
  for (const c of registration.cases) {
    const profile = await crossThemeProfile(c.caseId as CrossThemeCaseId), plan = prepareSeparatedReview({ ...profile, bytes, reviewMode: "teaser" });
    c.reviewedHash = plan.imageHash; c.contextHash = plan.fidelity.contextHash; c.combinedFingerprint = plan.fingerprint;
    for (const r of registration.requests.filter(r => r.requestId === c.craftRequestId || r.requestId === c.fidelityRequestId)) {
      const packet = r.role === "craft" ? plan.craft : plan.fidelity;
      r.imageHash = packet.imageHash; r.requestFingerprint = packet.requestFingerprint; r.schemaHash = packet.schemaHash;
    }
  }
  const profile = await crossThemeProfile("c01"), plan = prepareSeparatedReview({ ...profile, bytes, reviewMode: "teaser" });
  const reuse = registration.reusedCraft[0];
  Object.assign(reuse, { imageHash: plan.imageHash, requestFingerprint: plan.craft.requestFingerprint, schemaHash: plan.craft.schemaHash });
  const receipt = { imageHash: reuse.imageHash, requestFingerprint: reuse.requestFingerprint, schemaHash: reuse.schemaHash,
    model: "claude-sonnet-4-6", requestCount: 1, stopReason: "end_turn", rawText: JSON.stringify(reportFor(plan.craft.body)),
    usage: { inputTokens: 1873, outputTokens: 385 } };
  reuse.responseHash = hash(receipt.rawText);
  const prior = await store.record({ eventId: event.id, ownerToken: event.ownerToken, runId: reuse.dataset,
    idempotencyKey: `${reuse.dataset}:${reuse.requestId}:completed`, directionIndex: 0, attempt: 0, status: "rejected",
    bytes, concept: profile.concept, model: REVIEW_CALIBRATION_MODEL, quality: "not-applicable", costUsdMicros: 0,
    failureCodes: [], tier1Findings: [], visionScores: null,
    reviewEvidence: { version: 1, reviewedAssetHash: reuse.imageHash, verdict: null, generationDurationMs: 0,
      customerEvaluation: { dataset: reuse.dataset, requestId: reuse.requestId, role: "craft", stage: "completed",
        deploymentSha: reuse.deploymentSha, receipt, responseHash: reuse.responseHash, costMicros: reuse.costMicros,
        physicalRequests: 1, requestVerified: true, accountingKnown: true, contractValid: true, customerActivation: "disabled",
        providerUsage: { input_tokens: 1873, output_tokens: 385, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } } });
  prior.id = reuse.attemptId;
  let calls = 0;
  const transport = vi.fn(async (_url: any, init: any) => {
    const body = JSON.parse(init.body), report = reportFor(body);
    const response = { id: "msg_offline", type: "message", role: "assistant", model: "claude-sonnet-4-6", stop_reason: "end_turn",
      usage: { input_tokens: 1000, output_tokens: 400 }, content: [{ type: "text", text: "" }] };
    edit(report, response, ++calls);
    if (!response.content[0].text) response.content[0].text = JSON.stringify(report);
    return new Response(JSON.stringify(response), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as unknown as ReturnType<typeof vi.fn> & typeof fetch;
  const options = { candidate: bytes, environment, fetch: transport };
  return { registration, store, prior, transport, options,
    run: (id: string, overrides = {}) => runSeparatedResearchStudy(event, store, id, { ...options, ...overrides }, registration) };
}

it("has explicit approval but still blocks an unapproved registration without claims or calls", async () => {
  expect(proposed.authorizationStatus).toBe("approved");
  const f = await fixture(); f.registration.authorizationStatus = "pending";
  expect(await f.run("fidelity-c01", { preflightOnly: true })).toMatchObject({ kind: "preflight", providerCalls: 0, authorizationStatus: "pending", reusedReceiptIds: ["336"] });
  expect(await f.run("fidelity-c01")).toMatchObject({ kind: "blocked", reason: "research-awaiting-fresh-approval" });
  expect(f.store.all).toHaveLength(1); expect(f.transport).not.toHaveBeenCalled();
});
it("runs exactly nineteen once, reuses original craft without recharging or rewriting it, and closes", async () => {
  const f = await fixture(), historical = structuredClone(f.prior), before = structuredClone(event);
  for (const r of f.registration.requests) {
    const result = await f.run(r.requestId);
    expect(result).toMatchObject({ kind: "completed", physicalRequests: 1, costMicros: 9000, continuationAllowed: true });
    if (r.role === "fidelity") expect(result).toMatchObject({ combined: { valid: true, passed: true, customerActivation: "disabled" } });
  }
  expect(f.transport).toHaveBeenCalledTimes(19); expect(f.store.all).toHaveLength(40);
  expect(f.store.all.at(-1)?.idempotencyKey).toBe(`${proposed.dataset}:closed`);
  expect(f.prior).toEqual(historical); expect(event).toEqual(before);
  expect(f.store.all.every(r => r.status === "rejected" && !r.previewId)).toBe(true);
  expect(await f.run("fidelity-c01")).toMatchObject({ kind: "blocked", reason: "separated-study-closed" });
});
it.each(["contradiction", "extra-field", "invalid-json", "max-tokens", "refusal", "mixed-content"])("retains %s as a failed report, then completes all independent cases", async mode => {
  const f = await fixture((raw, response, call) => {
    if (call !== 1) return;
    if (mode === "contradiction") raw.assessments.briefFidelity.score = 4;
    if (mode === "extra-field") raw.identityComparisons = [];
    if (mode === "invalid-json") response.content[0].text = "{broken";
    if (mode === "max-tokens") response.stop_reason = "max_tokens";
    if (mode === "refusal") { response.stop_reason = "refusal"; response.content[0].text = "Cannot review this"; }
    if (mode === "mixed-content") response.content.push({ type: "text", text: "" });
  });
  const first = await f.run("fidelity-c01");
  expect(first).toMatchObject({ kind: "completed", closed: false, continuationAllowed: true, reportDisposition: "invalid", combined: { valid: false, passed: false } });
  const failed = f.store.all[2].reviewEvidence!.customerEvaluation!;
  expect(failed).toMatchObject({ contractValid: false, accountingKnown: true, costMicros: 9000, providerOutcome: "retained-invalid-review" });
  expect(failed.providerContent).toBeDefined();
  for (const r of f.registration.requests.slice(1)) expect(await f.run(r.requestId)).toMatchObject({ kind: "completed" });
  expect(f.transport).toHaveBeenCalledTimes(19);
  expect(f.store.all.every(r => r.status === "rejected" && !r.previewId)).toBe(true);
});
it("an invalid craft report cannot yield a combined pass, but unrelated cases still run", async () => {
  const f = await fixture((raw, _response, call) => { if (call === 3) raw.compositionQuality.score = 4; });
  for (const r of f.registration.requests) {
    const result = await f.run(r.requestId);
    expect(result.kind).toBe("completed");
    if (["fidelity-c03", "fidelity-c04"].includes(r.requestId))
      expect(result).toMatchObject({ reportDisposition: "invalid", combined: { valid: false, passed: false } });
    if (r.requestId === "fidelity-c05") expect(result).toMatchObject({ combined: { passed: true } });
  }
  expect(f.transport).toHaveBeenCalledTimes(19);
});
it("preserves honest uncertainty and visible failures without escalating their scores", async () => {
  const f = await fixture((raw, _response, call) => {
    if (call === 3) raw.premiumFinish = { score: 4, status: "uncertain", criterion: "unresolved-detail", location: "edge", observation: "Unresolved trim" };
  });
  for (const r of f.registration.requests.slice(0, 4)) {
    const result = await f.run(r.requestId);
    expect(result.kind).toBe("completed");
    if (r.requestId === "fidelity-c03") expect(result).toMatchObject({ reportDisposition: "unresolved", combined: { valid: true, unresolved: true, passed: false } });
  }
});
it.each(["accounting", "model", "over-reserve", "hidden-cache", "regional-price", "nonstandard-tier"])("halts permanently for %s", async mode => {
  const f = await fixture((_raw, response) => {
    if (mode === "accounting") response.usage.output_tokens = 0;
    if (mode === "model") response.model = "different";
    if (mode === "over-reserve") response.usage.input_tokens = 100000;
    if (mode === "hidden-cache") response.usage.cache_read_input_tokens = 100;
    if (mode === "regional-price") response.usage.inference_geo = "us";
    if (mode === "nonstandard-tier") response.usage.service_tier = "priority";
  });
  expect(await f.run("fidelity-c01")).toMatchObject({ kind: "stopped", closed: true, continuationAllowed: false });
  expect((await f.run("fidelity-c02")).kind).toBe("blocked"); expect(f.transport).toHaveBeenCalledTimes(1);
});
it("never retries an SDK error and retains its redacted diagnostic", async () => {
  const f = await fixture();
  f.transport.mockResolvedValue(new Response(JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "test-owner rate limited" } }),
    { status: 429, headers: { "Content-Type": "application/json", "request-id": "req_offline" } }));
  expect(await f.run("fidelity-c01")).toMatchObject({ kind: "stopped", physicalRequests: 1, costMicros: null, closed: true });
  expect(JSON.stringify(f.store.all[2].reviewEvidence)).not.toContain("test-owner");
  expect(f.transport).toHaveBeenCalledTimes(1);
});
it.each(["response", "pixels", "request", "owner", "usage", "cost"])("refuses corrupted reused %s before any new call", async mode => {
  const f = await fixture(), proof = f.prior.reviewEvidence!.customerEvaluation!;
  if (mode === "response") (proof.receipt as any).rawText += " ";
  if (mode === "pixels") f.prior.assetBytesBase64 = Buffer.from("changed").toString("base64");
  if (mode === "request") (proof.receipt as any).requestFingerprint = "changed";
  if (mode === "owner") f.prior.ownerToken = "different";
  if (mode === "usage") (proof.providerUsage as any).cache_read_input_tokens = 1;
  if (mode === "cost") proof.costMicros = 0;
  expect((await f.run("fidelity-c01")).kind).toBe("blocked"); expect(f.transport).not.toHaveBeenCalled();
});
it("blocks skipped requests, changed inputs/deployment, budget exhaustion, and concurrent replay", async () => {
  const f = await fixture();
  expect((await f.run("fidelity-c02")).kind).toBe("blocked");
  expect((await f.run("fidelity-c01", { candidate: Buffer.from("changed") })).kind).toBe("blocked");
  expect((await f.run("fidelity-c01", { environment: { ...environment, VERCEL_ENV: "production" } })).kind).toBe("blocked");
  const results = await Promise.all([f.run("fidelity-c01"), f.run("fidelity-c01")]);
  expect(results.map(r => r.kind).sort()).toEqual(["blocked", "completed"]);
  expect((await f.run("fidelity-c02", { environment: { ...environment, VERCEL_GIT_COMMIT_SHA: "changed" } })).kind).toBe("blocked");
  f.registration.budgetMicros = 9001;
  expect((await f.run("fidelity-c02")).kind).toBe("blocked"); expect(f.transport).toHaveBeenCalledTimes(1);
});
it("blocks later cases after stored result corruption, even when the failed report was allowed to continue", async () => {
  const f = await fixture(raw => { raw.identityComparisons = []; });
  await f.run("fidelity-c01"); f.store.all[2].reviewEvidence!.customerEvaluation!.responseHash = "changed";
  expect((await f.run("fidelity-c02")).kind).toBe("blocked"); expect(f.transport).toHaveBeenCalledTimes(1);
});
it("halts after result-retention failure and cannot replay the claimed request", async () => {
  const f = await fixture(), find = f.store.findById.bind(f.store);
  vi.spyOn(f.store, "findById").mockImplementation(async (...args) => {
    const row = await find(...args);
    return row?.idempotencyKey === `${proposed.dataset}:fidelity-c01:completed` ? undefined : row;
  });
  await expect(f.run("fidelity-c01")).rejects.toThrow("retention");
  expect((await f.run("fidelity-c01")).kind).toBe("blocked");
  expect((await f.run("fidelity-c02")).kind).toBe("blocked"); expect(f.transport).toHaveBeenCalledTimes(1);
});
it("checks exact SDK wire packets and never sends labels or prior grades", async () => {
  const f = await fixture(); await f.run("fidelity-c01");
  const wire = String(f.transport.mock.calls[0][1].body);
  expect(hash(JSON.stringify(JSON.parse(wire)))).toBe(f.registration.requests[0].requestFingerprint);
  expect(wire).not.toContain("reusedCraft"); expect(wire).not.toContain("Synthetic positive evidence");
});

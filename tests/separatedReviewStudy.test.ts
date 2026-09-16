// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type { Event } from "@shared/schema";
import { encodePng } from "../server/aiFirst/png";
import { InMemoryArtworkAttemptStore } from "../server/aiFirst/artworkAttemptStore";
import { MEDIUM_FEASIBILITY_CASES } from "../server/aiFirst/mediumFeasibilityCases";
import { crossThemeProfile, type CrossThemeCaseId } from "../server/crossThemeReviewProfiles";
import { prepareSeparatedReview } from "../server/aiFirst/separatedArtworkReview";
import { runSeparatedReviewStudy, SEPARATED_STUDY_DATASET } from "../server/separatedReviewStudy";
import registration from "../server/separatedReviewCorrectionRegistration.json";
const original = structuredClone(registration);
const bytes = encodePng({ width: 8, height: 8, rgb: new Uint8Array(192).fill(125) });
const environment = { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "codex/launch-blockers", VERCEL_GIT_COMMIT_SHA: "study-test" };
const event = { id: 61, ownerToken: "test-owner", eventName: "Artwork evaluation", eventType: "Artwork evaluation",
  inviteStatus: "draft", themeName: "", paletteColors: "[]", vibeDescription: MEDIUM_FEASIBILITY_CASES[0].hostBrief } as Event;
beforeEach(async () => {
  for (const c of registration.cases) {
    const profile = await crossThemeProfile(c.caseId as CrossThemeCaseId), plan = prepareSeparatedReview({ ...profile, bytes, reviewMode: "teaser" });
    c.reviewedHash = plan.imageHash; c.contextHash = plan.fidelity.contextHash; c.combinedFingerprint = plan.fingerprint;
    for (const r of registration.requests.filter(r => r.requestId === c.craftRequestId || r.requestId === c.fidelityRequestId)) {
      const packet = r.role === "craft" ? plan.craft : plan.fidelity;
      r.imageHash = packet.imageHash; r.requestFingerprint = packet.requestFingerprint; r.schemaHash = packet.schemaHash;
    }
  }
});
afterEach(() => {
  registration.requests.forEach((r, i) => Object.assign(r, original.requests[i]));
  registration.cases.forEach((c, i) => Object.assign(c, original.cases[i]));
  registration.budgetMicros = original.budgetMicros;
});
const clear = () => ({ score: 5, status: "clear", criterion: "none", location: "canvas", observation: "Synthetic positive evidence" });
const matched = () => ({ status: "matched", location: "canvas", observation: "Synthetic located evidence" });
function reportFor(body: any) {
  if (body.output_config.format.schema.properties.artifactFree) return { artifactFree: clear(), premiumFinish: clear(), compositionQuality: clear() };
  const task = JSON.parse(body.messages[0].content.at(-1).text.split("\n").slice(1).join("\n"));
  return { requirements: task.requirements.map((r: any) => ({ requirementId: r.id, ...matched() })),
    exclusions: task.exclusions.map((r: any) => ({ requirementId: r.id, ...matched() })),
    fullBrief: matched(), intendedLayout: matched(), purchase: matched(),
    medium: { ...matched(), status: task.requestedTreatment ? "matched" : "not-requested", observedTreatment: "Synthetic treatment" },
    assessments: { textLogoWatermarkFree: clear(), briefFidelity: clear(), ageAppropriate: clear() }, identityComparisons: [] };
}
function fixture(edit: (report: any, response: any) => void = () => {}) {
  const store = new InMemoryArtworkAttemptStore();
  const transport = vi.fn(async (_url: any, init: any) => {
    const body = JSON.parse(init.body), report = reportFor(body);
    const response = { id: "msg_offline", type: "message", role: "assistant", model: "claude-sonnet-4-6", stop_reason: "end_turn",
      usage: { input_tokens: 1000, output_tokens: 400 }, content: [{ type: "text", text: "" }] };
    edit(report, response); response.content[0].text = JSON.stringify(report);
    return new Response(JSON.stringify(response), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as unknown as ReturnType<typeof vi.fn> & typeof fetch;
  return { store, transport, options: { candidate: bytes, environment, fetch: transport } };
}

it("runs all twenty once, reuses eight craft receipts, closes permanently and never activates artwork", async () => {
  const f = fixture(), before = structuredClone(event);
  for (const r of registration.requests) {
    const result = await runSeparatedReviewStudy(event, f.store, r.requestId, f.options);
    expect(result).toMatchObject({ kind: "completed", physicalRequests: 1, costMicros: 9000, continuationAllowed: true });
    if (r.role === "fidelity") expect(result).toMatchObject({ combined: { passed: true, customerActivation: "disabled" } });
  }
  expect(f.transport).toHaveBeenCalledTimes(20); expect(f.store.all).toHaveLength(41);
  expect(f.store.all.at(-1)?.idempotencyKey).toBe(`${SEPARATED_STUDY_DATASET}:closed`);
  expect(event).toEqual(before); expect(f.store.all.every(r => r.status === "rejected" && !r.previewId)).toBe(true);
  expect((await runSeparatedReviewStudy(event, f.store, "craft-elsa", f.options)).kind).toBe("blocked");
});
it("has zero-cost preflights and blocks skipped order, changed pixels, wrong owner, Production and concurrent duplicates", async () => {
  const f = fixture();
  expect(await runSeparatedReviewStudy(event, f.store, "craft-elsa", { ...f.options, preflightOnly: true })).toMatchObject({ kind: "preflight", providerCalls: 0, prerequisitesValid: true });
  expect(f.store.all).toHaveLength(0); expect(f.transport).not.toHaveBeenCalled();
  for (const [ev, id, opt] of [
    [event, "fidelity-c01", f.options], [event, "craft-elsa", { ...f.options, candidate: Buffer.from("changed") }],
    [{ ...event, id: 41 }, "craft-elsa", f.options], [event, "craft-elsa", { ...f.options, environment: { ...environment, VERCEL_ENV: "production" } }],
  ] as const) expect((await runSeparatedReviewStudy(ev, f.store, id, opt)).kind).toBe("blocked");
  const results = await Promise.all([1, 2].map(() => runSeparatedReviewStudy(event, f.store, "craft-elsa", f.options)));
  expect(results.map(r => r.kind).sort()).toEqual(["blocked", "completed"]); expect(f.transport).toHaveBeenCalledTimes(1);
});
it("preserves valid uncertainty and continues while combined artwork stays rejected", async () => {
  const f = fixture(raw => { if (raw.premiumFinish) raw.premiumFinish = { score: 4, status: "uncertain", criterion: "unresolved-detail", location: "edge", observation: "Small trim unresolved" }; });
  expect(await runSeparatedReviewStudy(event, f.store, "craft-elsa", f.options)).toMatchObject({ kind: "completed", reportDisposition: "unresolved" });
  expect(await runSeparatedReviewStudy(event, f.store, "fidelity-c01", f.options)).toMatchObject({ kind: "completed", combined: { passed: false, unresolved: true } });
});
it.each(["contradiction", "extra-field", "accounting", "max-tokens", "model", "over-reserve", "hidden-cache"])("stops permanently on %s", mode => {
  return (async () => {
    const f = fixture((raw, response) => {
      if (mode === "contradiction") raw.compositionQuality.score = 4;
      if (mode === "extra-field") raw.premiumFinish.promote = true;
      if (mode === "accounting") response.usage.output_tokens = 0;
      if (mode === "max-tokens") response.stop_reason = "max_tokens";
      if (mode === "model") response.model = "different";
      if (mode === "over-reserve") response.usage.input_tokens = 100000;
      if (mode === "hidden-cache") response.usage.cache_read_input_tokens = 100;
    });
    expect(await runSeparatedReviewStudy(event, f.store, "craft-elsa", f.options)).toMatchObject({ kind: "stopped", closed: true, continuationAllowed: false });
    expect((await runSeparatedReviewStudy(event, f.store, "fidelity-c01", f.options)).kind).toBe("blocked");
    expect(f.transport).toHaveBeenCalledTimes(1);
  })();
});
it("does not retry an actual SDK transport failure", async () => {
  const f = fixture(); f.transport.mockResolvedValue(new Response(JSON.stringify({ type: "error", error: { type: "rate_limit_error", message: "offline" } }), { status: 429, headers: { "Content-Type": "application/json" } }));
  expect(await runSeparatedReviewStudy(event, f.store, "craft-elsa", f.options)).toMatchObject({ kind: "stopped", physicalRequests: 1, costMicros: null, closed: true });
  expect(f.transport).toHaveBeenCalledTimes(1);
});
it("retains actionable provider errors with request IDs while removing private values", async () => {
  const f = fixture();
  f.transport.mockResolvedValue(new Response(JSON.stringify({ type: "error", error: { type: "invalid_request_error",
    message: "output_config.format.schema: unsupported minimum; test-owner sk-private-example https://private.example/secret " + "a".repeat(150) } }),
    { status: 400, headers: { "Content-Type": "application/json", "request-id": "req_offline400" } }));
  expect(await runSeparatedReviewStudy(event, f.store, "craft-elsa", f.options)).toMatchObject({ kind: "stopped", physicalRequests: 1, costMicros: null, closed: true });
  const error = f.store.all[1].reviewEvidence!.customerEvaluation!.providerError;
  expect(error).toMatchObject({ status: 400, type: "invalid_request_error", requestId: "req_offline400" });
  expect(JSON.stringify(error)).toContain("unsupported minimum");
  expect(JSON.stringify(error)).not.toMatch(/test-owner|sk-private|private\.example|a{128}/);
  expect(f.transport).toHaveBeenCalledTimes(1);
});
it("blocks changed deployment, budget exhaustion and corrupted prior receipt before another call", async () => {
  const f = fixture(); await runSeparatedReviewStudy(event, f.store, "craft-elsa", f.options);
  expect((await runSeparatedReviewStudy(event, f.store, "fidelity-c01", { ...f.options, environment: { ...environment, VERCEL_GIT_COMMIT_SHA: "changed" } })).kind).toBe("blocked");
  registration.budgetMicros = 9001;
  expect((await runSeparatedReviewStudy(event, f.store, "fidelity-c01", f.options)).kind).toBe("blocked");
  registration.budgetMicros = original.budgetMicros;
  f.store.all[1].reviewEvidence!.customerEvaluation!.responseHash = "changed";
  expect((await runSeparatedReviewStudy(event, f.store, "fidelity-c01", f.options)).kind).toBe("blocked");
  expect(f.transport).toHaveBeenCalledTimes(1);
});
it("blocks replay and later cases after result readback failure", async () => {
  const f = fixture(), find = f.store.findById.bind(f.store); let calls = 0;
  vi.spyOn(f.store, "findById").mockImplementation(async (...args) => ++calls === 1 ? find(...args) : undefined);
  await expect(runSeparatedReviewStudy(event, f.store, "craft-elsa", f.options)).rejects.toThrow("retention");
  expect((await runSeparatedReviewStudy(event, f.store, "fidelity-c01", f.options)).kind).toBe("blocked");
  expect(f.transport).toHaveBeenCalledTimes(1);
});
it("verifies SDK request bytes against the frozen packet before dispatch", async () => {
  const f = fixture(); const result = await runSeparatedReviewStudy(event, f.store, "craft-elsa", f.options);
  expect(result.kind).toBe("completed");
  const raw = String(f.transport.mock.calls[0][1].body);
  expect(createHash("sha256").update(JSON.stringify(JSON.parse(raw))).digest("hex")).toBe(registration.requests[0].requestFingerprint);
});

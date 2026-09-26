// @vitest-environment node
import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { Event } from "@shared/schema";
import { InMemoryArtworkAttemptStore } from "../server/aiFirst/artworkAttemptStore";
import { ArtworkNormalizationError, ArtworkProviderError, GOOGLE_ARTWORK_MODEL } from "../server/aiFirst/artwork";
import { encodePng } from "../server/aiFirst/png";
import { MEDIUM_FEASIBILITY_CASES } from "../server/aiFirst/mediumFeasibilityCases";
import { buildQualityLockedPreviewBrief, customerVisiblePreviewBytes } from "../server/prePaymentPreviewQuality";
import { runRetainedSceneRepaint, SCENE_REPAINT_EXPERIMENT, SCENE_LIKENESS_EXPERIMENT } from "../server/retainedSceneRepaint";
import { runVisionGate, type VisionGateInput, type VisionVerdict } from "../server/aiFirst/visionGate";

const environment = { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "codex/launch-blockers" };
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const verdict = (passed = false): VisionVerdict => ({ passed, unavailable: false,
  scores: { textLogoWatermarkFree: passed ? 5 : 2, artifactFree: 5, premiumFinish: 5,
    briefFidelity: passed ? 5 : 2, compositionQuality: 5, ageAppropriate: 5 },
  requiredPresent: [], excludedFound: passed ? [] : ["lettering"], failureCodes: passed ? [] : ["text-detected"],
  notes: "Offline test only", durationMs: 1, requestCount: 1, usage: { inputTokens: 10, outputTokens: 20 } });

async function fixture() {
  const event = { id: 61, ownerToken: "test-owner", eventName: "Artwork evaluation", eventType: "Artwork evaluation",
    inviteStatus: "draft", themeName: "", paletteColors: "[]", vibeDescription: MEDIUM_FEASIBILITY_CASES[0].hostBrief,
    prePaymentPreviewAttempts: 1, prePaymentPreviewUrl: "existing-failure" } as Event;
  const { concept } = await buildQualityLockedPreviewBrief(event);
  const rgb = new Uint8Array(768 * 1376 * 3);
  for (let y = 0; y < 1376; y++) for (let x = 0; x < 768; x++) {
    const i = (y * 768 + x) * 3; rgb[i] = 40 + x / 5; rgb[i + 1] = 40 + y / 8; rgb[i + 2] = 90;
  }
  const bytes = encodePng({ width: 768, height: 1376, rgb });
  const store = new InMemoryArtworkAttemptStore();
  const original = await store.record({ eventId: event.id, ownerToken: event.ownerToken, bytes, concept,
    directionIndex: 0, attempt: 1, status: "rejected", model: GOOGLE_ARTWORK_MODEL, quality: "medium",
    size: "768x1376", costUsdMicros: 0, failureCodes: ["text-detected"], tier1Findings: [], visionScores: verdict().scores,
    reviewEvidence: { version: 1, reviewedAssetHash: hash(customerVisiblePreviewBytes(bytes)), verdict: verdict(), generationDurationMs: 1000 } });
  const registration = { ...SCENE_REPAINT_EXPERIMENT, attemptId: original.id, sourceHash: hash(bytes) };
  const generate = vi.fn(async () => ({ bytes, dataUrl: "unused", durationMs: 10,
    telemetry: { outputFormat: "jpeg" as const, providerRequestCount: 1,
      google: { model: GOOGLE_ARTWORK_MODEL, imageSize: "1K" as const, aspectRatio: "9:16" as const,
        size: "768x1376" as const, interactionId: "test", usage: { total_input_tokens: 10, total_output_tokens: 1120 } } } }));
  const review = vi.fn(async (_input: VisionGateInput) => verdict());
  const options = { environment, registration, generate, review };
  return { event, store, original, bytes, options, generate, review };
}

it("refuses Production, other branches, other owners, changed briefs and altered source hashes before any spend", async () => {
  const f = await fixture();
  for (const [event, options] of [
    [f.event, { ...f.options, environment: { ...environment, VERCEL_ENV: "production" } }],
    [f.event, { ...f.options, environment: { ...environment, VERCEL_GIT_COMMIT_REF: "main" } }],
    [{ ...f.event, ownerToken: "wrong-owner" }, f.options],
    [{ ...f.event, vibeDescription: "changed" }, f.options],
    [f.event, { ...f.options, registration: { ...f.options.registration, sourceHash: "0".repeat(64) } }],
  ] as const) expect((await runRetainedSceneRepaint(event, f.store, options)).kind).toBe("blocked");
  expect(f.generate).not.toHaveBeenCalled(); expect(f.review).not.toHaveBeenCalled(); expect(f.store.all).toHaveLength(1);
});

it.each([true, false])("retains one edit and exact teaser review without activating customer artwork or resetting allowances (pass=%s)", async passed => {
  const f = await fixture(); f.review.mockResolvedValue(verdict(passed));
  const eventBefore = structuredClone(f.event);
  const result = await runRetainedSceneRepaint(f.event, f.store, f.options);
  expect(result).toMatchObject({ kind: "evaluated", gatePassed: passed });
  expect(f.generate).toHaveBeenCalledTimes(1); expect(f.review).toHaveBeenCalledTimes(1);
  const request = (f.generate.mock.calls[0] as any)[0];
  expect(request.referenceImages).toHaveLength(1); expect(request.referenceImages[0].bytes.equals(f.bytes)).toBe(true);
  expect(request.prompt).toContain(f.event.vibeDescription); expect(request.maxTransientRetries).toBe(0);
  const reviewInput = (f.review.mock.calls[0] as any)[0];
  expect(reviewInput.bytes.equals(customerVisiblePreviewBytes(f.bytes))).toBe(true);
  expect(reviewInput.maxFormatRepairs).toBe(0); expect(reviewInput.reviewMode).toBe("teaser");
  expect(f.store.all.every(row => row.status === "rejected" && !row.previewId)).toBe(true);
  expect(f.store.all.at(-1)?.reviewEvidence?.customerEvaluation).toMatchObject({ imageRequests: 1, criticRequests: 1,
    classifierRequests: 0, customerActivation: "disabled", uninterruptedCustomerLatencyMs: null });
  expect(f.event).toEqual(eventBefore);
  expect((await runRetainedSceneRepaint(f.event, f.store, f.options)).kind).toBe("blocked");
  expect(f.generate).toHaveBeenCalledTimes(1);
});

it("claims one global experiment atomically when two submissions race", async () => {
  const f = await fixture();
  const results = await Promise.all([runRetainedSceneRepaint(f.event, f.store, f.options), runRetainedSceneRepaint(f.event, f.store, f.options)]);
  expect(results.map(r => r.kind).sort()).toEqual(["blocked", "evaluated"]);
  expect(f.generate).toHaveBeenCalledTimes(1); expect(f.review).toHaveBeenCalledTimes(1);
});

it("does not dispatch when the durable claim cannot be verified", async () => {
  const f = await fixture(); const originalFind = f.store.findById.bind(f.store);
  vi.spyOn(f.store, "findById").mockImplementation((id, owner, recordId) => recordId === f.original.id
    ? originalFind(id, owner, recordId) : Promise.resolve(undefined));
  expect((await runRetainedSceneRepaint(f.event, f.store, f.options)).kind).toBe("blocked");
  expect(f.generate).not.toHaveBeenCalled(); expect(f.review).not.toHaveBeenCalled();
});

it("stops on an image provider refusal and never retries or asks the critic", async () => {
  const f = await fixture(); f.generate.mockRejectedValue(new ArtworkProviderError({ model: GOOGLE_ARTWORK_MODEL,
    quality: "medium", size: "768x1376", status: 400, code: "invalid_request", type: "google_image_error",
    requestId: null, moderationStage: "unknown", moderationCategories: [], outputFormat: "jpeg", operation: "edit",
    providerRequestCount: 1, providerDurationMs: 1, promptSha256: "0".repeat(64), contentPolicyBlocked: true }));
  expect((await runRetainedSceneRepaint(f.event, f.store, f.options)).kind).toBe("unavailable");
  expect(f.review).not.toHaveBeenCalled();
  expect((await runRetainedSceneRepaint(f.event, f.store, f.options)).kind).toBe("blocked");
  expect(f.generate).toHaveBeenCalledTimes(1);
});

it("retains generated pixels if the critic fails, keeping unknown accounting and no approval", async () => {
  const f = await fixture(); f.review.mockRejectedValue(new Error("secret error details"));
  const result = await runRetainedSceneRepaint(f.event, f.store, f.options);
  expect(result).toMatchObject({ kind: "unavailable", evidence: { criticRequests: null } });
  const retained = f.store.all.at(-1)!;
  expect(retained.assetHash).toBe(hash(f.bytes)); expect(retained.status).toBe("rejected");
  expect(JSON.stringify(result)).not.toContain("secret error details");
  expect(f.generate).toHaveBeenCalledTimes(1); expect(f.review).toHaveBeenCalledTimes(1);
});

it("retains an unreviewable provider response without spending on a critic or inventing approved pixels", async () => {
  const f = await fixture(); const returned = await f.generate(); f.generate.mockClear();
  const raw = Buffer.from("undecodable provider result");
  f.generate.mockRejectedValue(new ArtworkNormalizationError("normalization failed", { ...returned, bytes: raw }));
  expect((await runRetainedSceneRepaint(f.event, f.store, f.options)).kind).toBe("unavailable");
  expect(f.store.all.at(-1)?.assetHash).toBe(hash(raw));
  expect(f.store.all.at(-1)?.reviewEvidence?.reviewedAssetHash).toBeNull();
  expect(f.review).not.toHaveBeenCalled(); expect(f.generate).toHaveBeenCalledTimes(1);
});

async function likenessFixture() {
  const f = await fixture();
  const bytes = encodePng({ width: 64, height: 64, rgb: new Uint8Array(64 * 64 * 3).fill(150) });
  const identity = { ...SCENE_LIKENESS_EXPERIMENT.identity, sha256: hash(bytes) };
  const options = { ...f.options, registration: { ...f.options.registration,
    datasetId: SCENE_LIKENESS_EXPERIMENT.datasetId, identity }, identityReferenceBytes: bytes };
  return { ...f, options, identityBytes: bytes };
}

it("binds separate scene and identity pixels to one edit and the exact identity-backed teaser review", async () => {
  const f = await likenessFixture();
  const referenceEvidence = [{ role: "identity" as const, subject: "Meekah", region: "Face and hair",
    sha256: hash(f.identityBytes), sourceUrl: SCENE_LIKENESS_EXPERIMENT.identity.sourceUrl }];
  f.review.mockResolvedValue({ ...verdict(true), referenceEvidence });
  const result = await runRetainedSceneRepaint(f.event, f.store, f.options);
  expect(result).toMatchObject({ kind: "evaluated", gatePassed: true });
  const request = (f.generate.mock.calls[0] as any)[0];
  expect(request.referenceImages.map((r: any) => hash(r.bytes))).toEqual([hash(f.bytes), hash(f.identityBytes)]);
  expect(request.prompt).toContain("IMAGE 1 — scene and finish reference");
  expect(request.prompt).toContain("IMAGE 2 — identity reference for Meekah only");
  expect(request.prompt).toContain(f.event.vibeDescription);
  expect(request.maxTransientRetries).toBe(0);
  const reviewInput = f.review.mock.calls[0][0];
  expect(reviewInput.referenceImages).toHaveLength(1);
  expect(reviewInput.referenceImages![0]).toMatchObject({ subject: "Meekah", role: "identity", sha256: hash(f.identityBytes) });
  expect(reviewInput.referenceImages![0].bytes.equals(f.identityBytes)).toBe(true);
  expect(reviewInput.bytes.equals(customerVisiblePreviewBytes(f.bytes))).toBe(true);
  expect(f.store.all.find(r => r.idempotencyKey?.endsWith(":identity-reference"))?.assetHash).toBe(hash(f.identityBytes));
  expect(f.store.all.every(r => r.status === "rejected" && !r.previewId)).toBe(true);
  expect((await runRetainedSceneRepaint(f.event, f.store, f.options)).kind).toBe("blocked");
  expect(f.generate).toHaveBeenCalledTimes(1); expect(f.review).toHaveBeenCalledTimes(1);
});

it("sends exact candidate and identity bytes through the real reviewer adapter and retains their provenance", async () => {
  const f = await likenessFixture();
  // Stub only the external transport: exercise the actual adapter contract.
  const create = vi.fn(async (_request: unknown, _options: unknown) => ({
    content: [{ type: "text", text: "{}" }], stop_reason: "end_turn",
    usage: { input_tokens: 10, output_tokens: 20 },
  }));
  const client = { messages: { create } } as unknown as NonNullable<VisionGateInput["client"]>;
  const review = (input: VisionGateInput) => runVisionGate({ ...input, client });
  const result = await runRetainedSceneRepaint(f.event, f.store, { ...f.options, review });
  expect(create).toHaveBeenCalledTimes(1);
  const request = create.mock.calls[0][0] as { messages: { content: Array<Record<string, any>> }[] };
  const content = request.messages[0].content;
  expect(content.filter(part => part.type === "image").map(part => hash(Buffer.from(part.source.data, "base64")))).toEqual([
    hash(customerVisiblePreviewBytes(f.bytes)), hash(f.identityBytes),
  ]);
  expect(content.some(part => part.type === "text" && part.text.includes('"role":"identity-only"'))).toBe(true);
  expect(create.mock.calls[0][1]).toMatchObject({ maxRetries: 0 });
  expect(result).toMatchObject({ kind: "evaluated", gatePassed: false,
    verdict: { referenceEvidence: [{ role: "identity", subject: "Meekah", sha256: hash(f.identityBytes) }] } });
  expect(f.store.all.at(-1)?.reviewEvidence?.verdict?.referenceEvidence?.[0]).toMatchObject({ sha256: hash(f.identityBytes) });
});

it("refuses missing or changed identity bytes before claiming or spending", async () => {
  const f = await likenessFixture();
  for (const bytes of [undefined, Buffer.from("wrong identity")]) {
    expect((await runRetainedSceneRepaint(f.event, f.store, { ...f.options, identityReferenceBytes: bytes })).kind).toBe("blocked");
  }
  expect(f.store.all).toHaveLength(1); expect(f.generate).not.toHaveBeenCalled(); expect(f.review).not.toHaveBeenCalled();
});

it("does not reopen the original experiment by supplying a new reference", async () => {
  const f = await fixture();
  expect((await runRetainedSceneRepaint(f.event, f.store, { ...f.options, identityReferenceBytes: f.bytes })).kind).toBe("blocked");
  expect(f.generate).not.toHaveBeenCalled(); expect(f.store.all).toHaveLength(1);
});

it("cannot pass when the critic omits proof of the registered identity reference", async () => {
  const f = await likenessFixture(); f.review.mockResolvedValue(verdict(true));
  const result = await runRetainedSceneRepaint(f.event, f.store, f.options);
  expect(result).toMatchObject({ kind: "evaluated", gatePassed: false, evidence: { outcome: "review-unavailable" } });
  expect(f.generate).toHaveBeenCalledTimes(1); expect(f.review).toHaveBeenCalledTimes(1);
});

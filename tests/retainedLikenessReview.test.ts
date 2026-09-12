// @vitest-environment node
import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { Event } from "@shared/schema";
import { InMemoryArtworkAttemptStore } from "../server/aiFirst/artworkAttemptStore";
import { encodePng } from "../server/aiFirst/png";
import { MEDIUM_FEASIBILITY_CASES } from "../server/aiFirst/mediumFeasibilityCases";
import { buildQualityLockedPreviewBrief, customerVisiblePreviewBytes } from "../server/prePaymentPreviewQuality";
import { SCENE_LIKENESS_EXPERIMENT } from "../server/retainedSceneRepaint";
import { RETAINED_LIKENESS_REVIEW, runRetainedLikenessReview } from "../server/retainedLikenessReview";
import { runVisionGate, type VisionGateInput } from "../server/aiFirst/visionGate";

const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const environment = { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "codex/launch-blockers" };
async function fixture(accurate = false) {
  const event = { id: 61, ownerToken: "fixture-owner", eventName: "Artwork evaluation", eventType: "Artwork evaluation",
    inviteStatus: "draft", themeName: "", paletteColors: "[]", vibeDescription: MEDIUM_FEASIBILITY_CASES[0].hostBrief,
    prePaymentPreviewAttempts: 1 } as Event;
  const { concept } = await buildQualityLockedPreviewBrief(event);
  const bytes = encodePng({ width: 120, height: 180, rgb: new Uint8Array(120 * 180 * 3).fill(120) });
  const identity = encodePng({ width: 64, height: 64, rgb: new Uint8Array(64 * 64 * 3).fill(180) });
  const store = new InMemoryArtworkAttemptStore();
  const record = async (pixels: Buffer, stage: string) => store.record({ eventId: event.id, ownerToken: event.ownerToken,
    runId: SCENE_LIKENESS_EXPERIMENT.datasetId, bytes: pixels, concept, directionIndex: 0, attempt: 1,
    status: "rejected", model: "gemini-3.1-flash-image", quality: "medium", size: null, costUsdMicros: 0,
    failureCodes: [], tier1Findings: [], visionScores: null,
    reviewEvidence: { version: 1, reviewedAssetHash: hash(customerVisiblePreviewBytes(pixels)), verdict: null,
      generationDurationMs: 0, customerEvaluation: { stage } } });
  const source = await record(bytes, "completed"), reference = await record(identity, "identity-reference");
  const registration = { ...RETAINED_LIKENESS_REVIEW, sourceAttemptId: source.id, referenceAttemptId: reference.id,
    sourceHash: hash(bytes), reviewedHash: hash(customerVisiblePreviewBytes(bytes)), referenceHash: hash(identity) };
  const scores = { textLogoWatermarkFree: 5, artifactFree: 5, premiumFinish: 3,
    briefFidelity: 3, compositionQuality: 5, ageAppropriate: 5 };
  const create = vi.fn(async (body: any, _options: unknown) => ({ stop_reason: "end_turn",
    usage: { input_tokens: 100, output_tokens: 80 }, content: [{ type: "text", text: JSON.stringify({ ...scores,
      requiredPresent: body.output_config.format.schema.properties.requiredPresent.items.properties.requirement.enum.map(
        (requirement: string) => ({ requirement, present: requirement.startsWith("Meekah ") ? accurate : false,
          evidence: "Fixture observation of differing face and hair, not a real visual judgment" })),
      excludedFound: [], notes: "Offline transport fixture",
      dimensionAssessments: Object.fromEntries(Object.keys(scores).map(key => [key, {
        status: "clear", criterion: "none", location: "Full canvas", observation: "Fixture observation" }])),
      teaserChecks: { milestone: { correct: true, evidence: "No count required" },
        identity: { accurate, evidence: "Fixture face and hair comparison" },
        purchase: { wouldCreatePurchaseDesire: false, evidence: "Fixture medium failure" } },
    }) }] }));
  const client = { messages: { create } } as unknown as NonNullable<VisionGateInput["client"]>;
  const review = (input: VisionGateInput) => runVisionGate({ ...input, client });
  const options = { environment, registration, review };
  return { event, store, source, reference, bytes, identity, create, options };
}

it.each([true, false])("measures likeness independently of overall quality rejection (accurate=%s)", async accurate => {
  const f = await fixture(accurate), before = structuredClone(f.event);
  const result = await runRetainedLikenessReview(f.event, f.store, f.options);
  expect(result).toMatchObject({ kind: "reviewed", evidence: { imageProviderCalls: 0, criticRequests: 1,
    referenceVerified: true, mismatchDetected: !accurate,
    outcome: accurate ? "likeness-mismatch-missed" : "likeness-mismatch-detected" } });
  expect(f.create).toHaveBeenCalledTimes(1);
  const body = f.create.mock.calls[0][0];
  expect(body.messages[0].content.filter((p: any) => p.type === "image").map((p: any) => hash(Buffer.from(p.source.data, "base64"))))
    .toEqual([hash(customerVisiblePreviewBytes(f.bytes)), hash(f.identity)]);
  expect(JSON.stringify(body)).not.toMatch(/expectedMeekahIdentity|human-rejected|meekah-reference-review-20260912/);
  expect(f.create.mock.calls[0][1]).toMatchObject({ maxRetries: 0 });
  expect(f.store.all.every(row => row.status === "rejected" && !row.previewId)).toBe(true);
  expect(f.event).toEqual(before);
  expect((await runRetainedLikenessReview(f.event, f.store, f.options)).kind).toBe("blocked");
  expect(f.create).toHaveBeenCalledTimes(1);
});

it("allows one durable review under concurrent submissions", async () => {
  const f = await fixture();
  const results = await Promise.all([runRetainedLikenessReview(f.event, f.store, f.options), runRetainedLikenessReview(f.event, f.store, f.options)]);
  expect(results.map(r => r.kind).sort()).toEqual(["blocked", "reviewed"]);
  expect(f.create).toHaveBeenCalledTimes(1);
});

it("blocks incorrect environment, owner, brief and fixed hashes before dispatch", async () => {
  const f = await fixture();
  for (const [event, options] of [
    [f.event, { ...f.options, environment: { ...environment, VERCEL_ENV: "production" } }],
    [f.event, { ...f.options, environment: { ...environment, VERCEL_GIT_COMMIT_REF: "main" } }],
    [{ ...f.event, ownerToken: "different-owner" }, f.options],
    [{ ...f.event, vibeDescription: "changed" }, f.options],
    [f.event, { ...f.options, registration: { ...f.options.registration, sourceHash: "0".repeat(64) } }],
    [f.event, { ...f.options, registration: { ...f.options.registration, referenceHash: "0".repeat(64) } }],
    [f.event, { ...f.options, registration: { ...f.options.registration, reviewedHash: "0".repeat(64) } }],
  ] as const) expect((await runRetainedLikenessReview(event, f.store, options)).kind).toBe("blocked");
  expect(f.create).not.toHaveBeenCalled(); expect(f.store.all).toHaveLength(2);
});

it("checks retained bytes and claim readback before dispatch", async () => {
  const f = await fixture(), find = f.store.findById.bind(f.store);
  vi.spyOn(f.store, "findById").mockImplementation(async (id, owner, recordId) => {
    const row = await find(id, owner, recordId);
    return row && recordId === f.reference.id ? { ...row, assetBytesBase64: Buffer.from("altered").toString("base64") } : row;
  });
  expect((await runRetainedLikenessReview(f.event, f.store, f.options)).kind).toBe("blocked");
  vi.mocked(f.store.findById).mockImplementation((id, owner, recordId) => [f.source.id, f.reference.id].includes(recordId)
    ? find(id, owner, recordId) : Promise.resolve(undefined));
  expect((await runRetainedLikenessReview(f.event, f.store, f.options)).kind).toBe("blocked");
  expect(f.create).not.toHaveBeenCalled();
});

it("retains an unavailable review without retries or a reusable claim", async () => {
  const f = await fixture(); f.create.mockRejectedValue(new Error("transport failed"));
  const result = await runRetainedLikenessReview(f.event, f.store, f.options);
  expect(result).toMatchObject({ kind: "reviewed", evidence: { outcome: "review-unavailable", criticRequests: 1 } });
  expect((await runRetainedLikenessReview(f.event, f.store, f.options)).kind).toBe("blocked");
  expect(f.create).toHaveBeenCalledTimes(1);
});

it("cannot report a detected mismatch without the returned reference proof", async () => {
  const f = await fixture();
  const review = async (input: VisionGateInput) => {
    const result = await f.options.review(input);
    return { ...result, referenceEvidence: undefined };
  };
  expect(await runRetainedLikenessReview(f.event, f.store, { ...f.options, review }))
    .toMatchObject({ kind: "reviewed", evidence: { outcome: "review-unavailable", mismatchDetected: false } });
  expect(f.create).toHaveBeenCalledTimes(1);
});

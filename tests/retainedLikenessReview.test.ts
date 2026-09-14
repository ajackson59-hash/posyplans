import { runBlindLikenessReview } from "../server/aiFirst/blindLikenessReview";
import { blindReport, blindFixtureClient } from "./helpers/blindReviewFixture";
// @vitest-environment node
import { visionRequestRequirements } from "./helpers/visionRequestRequirements";
import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { Event } from "@shared/schema";
import { InMemoryArtworkAttemptStore } from "../server/aiFirst/artworkAttemptStore";
import { encodePng } from "../server/aiFirst/png";
import { MEDIUM_FEASIBILITY_CASES } from "../server/aiFirst/mediumFeasibilityCases";
import { buildQualityLockedPreviewBrief, customerVisiblePreviewBytes } from "../server/prePaymentPreviewQuality";
import { SCENE_LIKENESS_EXPERIMENT } from "../server/retainedSceneRepaint";
import { RETAINED_LIKENESS_REVIEW, FEATURE_COMPARISON_CONTROLS, FEATURE_COMPARISON_V2_CONTROLS, STREAM_COMPARISON_CONTROLS, BLIND_COMPARISON_CONTROLS, ACCEPTED_ILLUSTRATION_CONTROL, runRetainedLikenessReview } from "../server/retainedLikenessReview";
import { IDENTITY_FEATURES } from "../server/aiFirst/identityComparison";
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
      ...(body.output_config.format.schema.properties.identityComparisons ? { identityComparisons: IDENTITY_FEATURES.map(feature => ({
          referenceKey: "reference1", feature, candidateLocation: "Right figure", candidateVisibility: "clear", referenceVisibility: "clear",
          referenceObservation: "Reference geometry fixture", candidateObservation: "Candidate geometry fixture",
          assessment: feature === "hairStructure" && !accurate ? "mismatch" : "match", explanation: "Offline fixture comparison",
        })),
      } : {}),
      requiredPresent: visionRequestRequirements(body).map(
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

it.each(["matched", "mismatched"] as const)("validates a %s feature fixture without reopening an old claim", async caseId => {
  const accurate = caseId === "matched", f = await fixture(accurate);
  await runRetainedLikenessReview(f.event, f.store, f.options);
  const source = accurate ? f.reference : f.source, bytes = accurate ? f.identity : f.bytes;
  const registration = { ...FEATURE_COMPARISON_CONTROLS[caseId], sourceAttemptId: source.id,
    datasetId: `offline-fixture-${caseId}`,
    referenceAttemptId: f.reference.id, sourceHash: hash(bytes), referenceHash: hash(f.identity),
    reviewedHash: hash(customerVisiblePreviewBytes(bytes)) };
  const options = { ...f.options, registration };
  const result = await runRetainedLikenessReview(f.event, f.store, options);
  expect(result).toMatchObject({ kind: "reviewed", evidence: { identityCorrect: true, imageProviderCalls: 0,
    criticRequests: 1, outcome: "identity-control-correct", expectedMeekahIdentity: accurate } });
  expect((await runRetainedLikenessReview(f.event, f.store, options)).kind).toBe("blocked");
  expect((await runRetainedLikenessReview(f.event, f.store, f.options)).kind).toBe("blocked");
  expect(f.create).toHaveBeenCalledTimes(2); // one old offline fixture and one new control
  expect(JSON.stringify(f.create.mock.calls[1][0])).not.toMatch(/expectedIdentity|expectedMeekahIdentity|feature-comparison-20260912/);
});

it("retains a provider grammar rejection without retrying or producing a visual verdict", async () => {
  const f = await fixture();
  f.create.mockRejectedValue(new Error("400 invalid_request_error: The compiled grammar is too large"));
  const result = await runRetainedLikenessReview(f.event, f.store, f.options);
  expect(result).toMatchObject({ kind: "reviewed", evidence: { outcome: "review-unavailable", criticRequests: 1 },
    verdict: { unavailable: true, passed: false, requiredPresent: [] } });
  expect((await runRetainedLikenessReview(f.event, f.store, f.options)).kind).toBe("blocked");
  expect(f.create).toHaveBeenCalledTimes(1);
});

it.each(["matched", "mismatched"] as const)("keeps the live %s v1 control closed after the first provider error", async caseId => {
  const f = await fixture();
  expect(await runRetainedLikenessReview(f.event, f.store, { ...f.options, registration: FEATURE_COMPARISON_CONTROLS[caseId] }))
    .toMatchObject({ kind: "blocked", reason: "feature-comparison-v1-closed-after-provider-error" });
  expect(f.create).not.toHaveBeenCalled();
  expect(f.store.all).toHaveLength(2);
});

async function pairedFixture(accurate = false) {
  const f = await fixture(accurate);
  const controls = Object.fromEntries((["mismatched", "matched"] as const).map(caseId => {
    const positive = caseId === "matched", pixels = positive ? f.identity : f.bytes;
    return [caseId, { ...FEATURE_COMPARISON_V2_CONTROLS[caseId], sourceAttemptId: positive ? f.reference.id : f.source.id,
      referenceAttemptId: f.reference.id, sourceHash: hash(pixels), reviewedHash: hash(customerVisiblePreviewBytes(pixels)),
      referenceHash: hash(f.identity) }];
  }));
  return { ...f, run: (caseId: "mismatched" | "matched") => runRetainedLikenessReview(f.event, f.store,
    { ...f.options, registration: controls[caseId] }) };
}

it.each([true, false])("runs the v2 pair once and allows an accounted semantic miss before the matching control (accurate=%s)", async accurate => {
  const f = await pairedFixture(accurate);
  expect(await f.run("matched")).toMatchObject({ kind: "blocked", reason: "feature-comparison-prerequisite-unavailable" });
  expect(f.create).not.toHaveBeenCalled();
  expect(await f.run("mismatched")).toMatchObject({ kind: "reviewed", evidence: { identityCorrect: !accurate, criticRequests: 1 } });
  expect(await f.run("matched")).toMatchObject({ kind: "reviewed", evidence: { identityCorrect: accurate, criticRequests: 1 } });
  expect((await f.run("mismatched")).kind).toBe("blocked");
  expect((await f.run("matched")).kind).toBe("blocked");
  expect(f.create).toHaveBeenCalledTimes(2);
});

it("stops the v2 pair at a provider error without spending the second request", async () => {
  const f = await pairedFixture();
  f.create.mockRejectedValue(new Error("400 compiled grammar too large"));
  expect(await f.run("mismatched")).toMatchObject({ kind: "reviewed", evidence: { outcome: "review-unavailable" } });
  expect(await f.run("matched")).toMatchObject({ kind: "blocked", reason: "feature-comparison-prerequisite-unavailable" });
  expect(f.create).toHaveBeenCalledTimes(1);
});

it("rejects a registration for a different reviewer version before dispatch", async () => {
  const f = await fixture();
  expect(await runRetainedLikenessReview(f.event, f.store, { ...f.options,
    registration: { ...f.options.registration, reviewerVersion: "different-version" } }))
    .toMatchObject({ kind: "blocked", reason: "feature-comparison-version-mismatch" });
  expect(f.create).not.toHaveBeenCalled();
});

it("requires complete timing evidence before allowing the streaming matching control", async () => {
  const f = await fixture();
  const makeRegistration = (caseId: "mismatched" | "matched") => ({ ...STREAM_COMPARISON_CONTROLS[caseId],
    sourceAttemptId: caseId === "matched" ? f.reference.id : f.source.id, referenceAttemptId: f.reference.id,
    sourceHash: caseId === "matched" ? hash(f.identity) : hash(f.bytes),
    reviewedHash: hash(customerVisiblePreviewBytes(caseId === "matched" ? f.identity : f.bytes)), referenceHash: hash(f.identity) });
  const review = vi.fn(async (input: VisionGateInput) => {
    expect(input.streamDiagnostics).toBe(true);
    // A substituted legacy reviewer cannot satisfy the new measurement registration.
    return f.options.review({ ...input, streamDiagnostics: false });
  });
  const run = (caseId: "mismatched" | "matched") => runRetainedLikenessReview(f.event, f.store,
    { ...f.options, registration: makeRegistration(caseId), review });
  expect(await run("mismatched")).toMatchObject({ kind: "reviewed", evidence: { outcome: "review-unavailable" } });
  expect(await run("matched")).toMatchObject({ kind: "blocked", reason: "feature-comparison-prerequisite-unavailable" });
  expect((await run("mismatched")).kind).toBe("blocked");
  expect(review).toHaveBeenCalledTimes(1);
});

async function blindPairedFixture(negativeCorrect = true) {
  const f = await fixture(), capture = vi.fn();
  const client = blindFixtureClient(body => {
    const candidate = body.messages[0].content.find((p: any) => p.type === "image").source.data;
    const positive = hash(Buffer.from(candidate, "base64")) === hash(customerVisiblePreviewBytes(f.identity));
    return blindReport(positive || !negativeCorrect);
  }, capture);
  const blindReview = vi.fn(input => {
    expect(Object.keys(input).sort()).toEqual(["candidate", "reference", "signal"]);
    return runBlindLikenessReview({ ...input, client });
  });
  const registrations = Object.fromEntries((["mismatched", "matched"] as const).map(caseId => {
    const pixels = caseId === "matched" ? f.identity : f.bytes;
    return [caseId, { ...BLIND_COMPARISON_CONTROLS[caseId], sourceAttemptId: caseId === "matched" ? f.reference.id : f.source.id,
      referenceAttemptId: f.reference.id, sourceHash: hash(pixels), reviewedHash: hash(customerVisiblePreviewBytes(pixels)), referenceHash: hash(f.identity) }];
  }));
  const run = (caseId: "mismatched" | "matched") => runRetainedLikenessReview(f.event, f.store,
    { ...f.options, registration: registrations[caseId], blindReview });
  return { ...f, run, capture, blindReview };
}

it("runs the isolated pair once without a combined critic or fabricated artwork scores", async () => {
  const f = await blindPairedFixture(), before = structuredClone(f.event);
  expect((await f.run("matched")).kind).toBe("blocked");
  const negative = await Promise.all([f.run("mismatched"), f.run("mismatched")]);
  expect(negative.map(r => r.kind).sort()).toEqual(["blocked", "reviewed"]);
  expect(negative.find(r => r.kind === "reviewed")).toMatchObject({ evidence: { outcome: "identity-control-correct", criticRequests: 1 },
    review: { decision: "mismatch", scope: "reference-likeness-only" } });
  expect(await f.run("matched")).toMatchObject({ evidence: { outcome: "identity-control-correct", criticRequests: 1 }, review: { decision: "match" } });
  expect((await f.run("matched")).kind).toBe("blocked");
  expect(f.capture).toHaveBeenCalledTimes(2); expect(f.create).not.toHaveBeenCalled();
  expect(f.event).toEqual(before);
  expect(f.store.all.slice(2).every(row => row.status === "rejected" && !row.previewId && row.visionScores === null && row.reviewEvidence?.verdict === null)).toBe(true);
});

it("stops the isolated pair on an incorrect negative without spending on the portrait", async () => {
  const f = await blindPairedFixture(false);
  expect(await f.run("mismatched")).toMatchObject({ evidence: { outcome: "identity-control-incorrect" } });
  expect(await f.run("matched")).toMatchObject({ kind: "blocked", reason: "feature-comparison-prerequisite-unavailable" });
  expect(f.capture).toHaveBeenCalledTimes(1); expect(f.create).not.toHaveBeenCalled();
});

async function acceptedIllustrationFixture(accurate = true) {
  const f = await fixture(), candidate = customerVisiblePreviewBytes(f.bytes), capture = vi.fn();
  const client = blindFixtureClient(() => blindReport(accurate), capture);
  const blindReview = vi.fn(input => {
    expect(Object.keys(input).sort()).toEqual(["candidate", "reference", "signal"]);
    return runBlindLikenessReview({ ...input, client });
  });
  const options = { ...f.options, candidate, blindReview, registration: { ...ACCEPTED_ILLUSTRATION_CONTROL,
    sourceHash: hash(candidate), reviewedHash: hash(candidate), referenceHash: hash(f.identity), referenceAttemptId: f.reference.id } };
  const run = () => runRetainedLikenessReview(f.event, f.store, options);
  return { ...f, candidate, capture, blindReview, options, run };
}

it.each([true, false])("records one registered illustration judgment without changing its human label (model match=%s)", async accurate => {
  const f = await acceptedIllustrationFixture(accurate), before = structuredClone(f.event);
  const results = await Promise.all([f.run(), f.run()]);
  expect(results.map(r => r.kind).sort()).toEqual(["blocked", "reviewed"]);
  expect(results.find(r => r.kind === "reviewed")).toMatchObject({
    evidence: { expectedMeekahIdentity: true, sourceInput: "registered-preview", criticRequests: 1,
      outcome: accurate ? "identity-control-correct" : "identity-control-incorrect" },
    review: { decision: accurate ? "match" : "mismatch" },
  });
  expect(f.blindReview).toHaveBeenCalledTimes(1); expect(f.capture).toHaveBeenCalledTimes(1);
  expect(f.create).not.toHaveBeenCalled(); expect(f.event).toEqual(before);
  const body = f.capture.mock.calls[0][0];
  expect(body.messages[0].content.filter((x: any) => x.type === "image").map((x: any) => hash(Buffer.from(x.source.data, "base64"))))
    .toEqual([hash(f.candidate), hash(f.identity)]);
  expect(JSON.stringify(body)).not.toMatch(/Meekah|Blippi|expectedMeekahIdentity|would pass|accepted-illustration/);
  expect(f.store.all.slice(2).every(row => row.status === "rejected" && !row.previewId && row.assetHash === hash(f.candidate) &&
    row.visionScores === null && row.reviewEvidence?.verdict === null)).toBe(true);
  expect((await f.run()).kind).toBe("blocked"); expect(f.capture).toHaveBeenCalledTimes(1);
});

it("rejects missing, changed, oversized and misregistered illustration input before any claim or reviewer call", async () => {
  const f = await acceptedIllustrationFixture();
  for (const candidate of [undefined, Buffer.from("different"), Buffer.alloc(800_001)]) {
    expect(await runRetainedLikenessReview(f.event, f.store, { ...f.options, candidate }))
      .toMatchObject({ kind: "blocked", reason: "likeness-review-registered-preview-mismatch" });
  }
  for (const registration of [
    { ...f.options.registration, reviewKind: undefined },
    { ...f.options.registration, reviewedHash: "0".repeat(64) },
    { ...f.options.registration, referenceHash: "0".repeat(64) },
  ]) expect((await runRetainedLikenessReview(f.event, f.store, { ...f.options, registration })).kind).toBe("blocked");
  expect(f.capture).not.toHaveBeenCalled(); expect(f.store.all).toHaveLength(2);
});

it("requires the retained reference owner and durable candidate readback before the illustration call", async () => {
  const f = await acceptedIllustrationFixture();
  expect((await runRetainedLikenessReview({ ...f.event, ownerToken: "wrong-owner" }, f.store, f.options)).kind).toBe("blocked");
  const find = f.store.findById.bind(f.store);
  vi.spyOn(f.store, "findById").mockImplementation((id, owner, recordId) => recordId === f.reference.id
    ? find(id, owner, recordId) : Promise.resolve(undefined));
  expect((await f.run()).kind).toBe("blocked"); expect(f.capture).not.toHaveBeenCalled();
  expect(f.store.all).toHaveLength(3); // The claim remains consumed despite failed readback.
  expect((await f.run()).kind).toBe("blocked"); expect(f.store.all).toHaveLength(3);
});

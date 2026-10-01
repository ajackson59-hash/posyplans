// @vitest-environment node
import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { Event } from "@shared/schema";
import { InMemoryArtworkAttemptStore } from "../server/aiFirst/artworkAttemptStore";
import { encodePng } from "../server/aiFirst/png";
import { GOOGLE_ARTWORK_MODEL } from "../server/aiFirst/artwork";
import { MEDIUM_FEASIBILITY_CASES } from "../server/aiFirst/mediumFeasibilityCases";
import type { VisionVerdict } from "../server/aiFirst/visionGate";
import { buildQualityLockedPreviewBrief, customerVisiblePreviewBytes } from "../server/prePaymentPreviewQuality";
import { CURRENT_RESOLUTION_CONTROLS, CURRENT_RESOLUTION_REVIEW_VERSION, runCurrentResolutionReview } from "../server/currentResolutionReview";

const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const environment = { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "codex/launch-blockers", VERCEL_GIT_COMMIT_SHA: "test-deployment" };
const verdict = (lettering = true): VisionVerdict => ({ passed: !lettering, unavailable: false,
  scores: { textLogoWatermarkFree: lettering ? 2 : 5, artifactFree: 5, premiumFinish: 5, briefFidelity: lettering ? 2 : 5,
    compositionQuality: 5, ageAppropriate: 5 }, requiredPresent: [], excludedFound: lettering ? ["menu lettering"] : [],
  notes: "Synthetic transport result, not a visual judgment", failureCodes: lettering ? ["text-logo-watermark"] : [],
  requestCount: 1, durationMs: 10, usage: { inputTokens: 5000, outputTokens: 1000 },
  reviewIntegrity: { version: "located-medium-review-v2", valid: true, issues: [] },
  dimensionAssessments: { textLogoWatermarkFree: { status: lettering ? "defect" : "clear",
    criterion: lettering ? "lettering" : "none", location: "upper right", observation: "Menu contains words" } },
  teaserChecks: { identity: { required: true, accurate: true, evidence: "Synthetic" },
    milestone: { required: false, correct: true, evidence: "Not requested" },
    purchase: { wouldCreatePurchaseDesire: !lettering, evidence: "Synthetic" } } });

async function fixture(accepted = false) {
  const event = { id: 61, ownerToken: "current-review-owner", eventName: "Artwork evaluation", eventType: "Artwork evaluation",
    inviteStatus: "draft", themeName: "", paletteColors: "[]", vibeDescription: MEDIUM_FEASIBILITY_CASES[0].hostBrief } as Event;
  const rgb = new Uint8Array(768 * 1376 * 3);
  for (let y = 0; y < 1376; y++) for (let x = 0; x < 768; x++) {
    const i = (y * 768 + x) * 3; rgb[i] = 40 + x / 5; rgb[i + 1] = 40 + y / 8; rgb[i + 2] = 90;
  }
  const bytes = encodePng({ width: 768, height: 1376, rgb });
  const { concept } = await buildQualityLockedPreviewBrief(event);
  const store = new InMemoryArtworkAttemptStore();
  const source = await store.record({ eventId: event.id, ownerToken: event.ownerToken, bytes, concept,
    directionIndex: 0, attempt: 0, status: "rejected", model: GOOGLE_ARTWORK_MODEL, quality: "medium",
    size: "768x1376", failureCodes: [], tier1Findings: [], visionScores: null, costUsdMicros: 0 });
  const registration = { ...CURRENT_RESOLUTION_CONTROLS[accepted ? "accepted-scene-a" : "lettering"],
    sourceHash: hash(bytes), reviewedHash: hash(customerVisiblePreviewBytes(bytes, "detail-v1")),
    ...(accepted ? {} : { sourceAttemptId: source.id }) };
  const review = vi.fn(async () => verdict(!accepted));
  return { event, store, registration, bytes, review,
    options: { environment, review, ...(accepted ? { candidate: bytes } : {}) } };
}

it("preflights exact detailed pixels without claiming or calling the reviewer", async () => {
  const f = await fixture(), before = structuredClone(f.event);
  const result = await runCurrentResolutionReview(f.event, f.store, f.registration, { ...f.options, preflightOnly: true });
  expect(result).toMatchObject({ kind: "preflight", width: 768, height: 1376, tier1: { passed: true },
    alreadyClaimed: false, prerequisitePassed: true, criticRequests: 0, customerActivation: "disabled" });
  expect(f.review).not.toHaveBeenCalled(); expect(f.store.all).toHaveLength(1); expect(f.event).toEqual(before);
  expect(JSON.stringify(result).length).toBeLessThan(1500);
  expect(result).not.toHaveProperty("tier1.image");
});

it("blocks environment, ownership, brief and pixel drift before a claim", async () => {
  const f = await fixture();
  for (const [event, options, registration] of [
    [f.event, { ...f.options, environment: { ...environment, VERCEL_ENV: "production" } }, f.registration],
    [{ ...f.event, ownerToken: "wrong" }, f.options, f.registration],
    [{ ...f.event, vibeDescription: "changed" }, f.options, f.registration],
    [f.event, f.options, { ...f.registration, sourceHash: "0".repeat(64) }],
    [f.event, f.options, { ...f.registration, reviewedHash: "0".repeat(64) }],
    [f.event, { ...f.options, signal: AbortSignal.abort() }, f.registration],
  ] as const) expect((await runCurrentResolutionReview(event, f.store, registration, options)).kind).toBe("blocked");
  expect(f.review).not.toHaveBeenCalled(); expect(f.store.all).toHaveLength(1);
});

it("allows only one dispatch under concurrent requests and keeps all evidence private", async () => {
  const f = await fixture(), before = structuredClone(f.event);
  const results = await Promise.all([1, 2].map(() => runCurrentResolutionReview(f.event, f.store, f.registration, f.options)));
  expect(results.map(r => r.kind).sort()).toEqual(["blocked", "completed"]);
  expect(results.find(r => r.kind === "completed")).toMatchObject({ controlPassed: true, fullGatePassed: false });
  expect(f.review).toHaveBeenCalledTimes(1);
  const input = (f.review.mock.calls[0] as any)[0];
  expect(input.bytes.equals(customerVisiblePreviewBytes(f.bytes, "detail-v1"))).toBe(true);
  expect(input).toMatchObject({ reviewMode: "teaser", maxFormatRepairs: 0 });
  expect(input).not.toHaveProperty("humanFinish"); expect(input).not.toHaveProperty("registration");
  expect(input).not.toHaveProperty("referenceImages");
  expect(f.event).toEqual(before);
  for (const row of f.store.all.slice(1)) {
    expect(row).toMatchObject({ status: "rejected", previewId: null });
    expect(row.reviewEvidence?.customerEvaluation).toMatchObject({ customerActivation: "disabled", imageProviderCalls: 0 });
  }
  expect((await runCurrentResolutionReview(f.event, f.store, f.registration, f.options)).kind).toBe("blocked");
});

it.each(["miss", "unavailable", "wrong-reason", "invalid-evidence", "missing-usage"])(
  "does not certify the lettering control for %s", async mode => {
    const f = await fixture(); const v = verdict(mode !== "miss");
    if (mode === "unavailable") v.unavailable = true;
    if (mode === "wrong-reason") v.dimensionAssessments!.textLogoWatermarkFree!.criterion = "watermark";
    if (mode === "invalid-evidence") v.reviewIntegrity!.valid = false;
    if (mode === "missing-usage") v.usage.inputTokens = 0;
    f.review.mockResolvedValue(v);
    const result = await runCurrentResolutionReview(f.event, f.store, f.registration, f.options);
    expect(result).toMatchObject({ controlPassed: false, customerActivation: "disabled" });
    expect(f.review).toHaveBeenCalledTimes(1);
  });

it("requires a successful negative on this deployment before spending the positive", async () => {
  const f = await fixture(true);
  const preflight = await runCurrentResolutionReview(f.event, f.store, f.registration, { ...f.options, preflightOnly: true });
  expect(preflight).toMatchObject({ kind: "preflight", prerequisitePassed: false });
  expect(await runCurrentResolutionReview(f.event, f.store, f.registration, f.options))
    .toMatchObject({ kind: "blocked", reason: "current-review-negative-prerequisite-failed" });
  expect(f.review).not.toHaveBeenCalled(); expect(f.store.all).toHaveLength(1);
});

it("does not retry a claimed review after a thrown provider failure", async () => {
  const f = await fixture(); f.review.mockRejectedValue(new Error("provider failure"));
  expect(await runCurrentResolutionReview(f.event, f.store, f.registration, f.options)).toMatchObject({ kind: "unavailable" });
  expect((await runCurrentResolutionReview(f.event, f.store, f.registration, f.options)).kind).toBe("blocked");
  expect(f.review).toHaveBeenCalledTimes(1);
  expect(f.store.all.at(-1)?.reviewEvidence?.customerEvaluation).toMatchObject({ stage: "unavailable", criticRequests: null });
});

it("reviews the accepted control only after a valid same-deployment negative and preserves limited human labels", async () => {
  const f = await fixture(true), before = structuredClone(f.event);
  const source = f.store.all[0];
  const prior = await f.store.record({ ...source, bytes: f.bytes, runId: CURRENT_RESOLUTION_CONTROLS.lettering.datasetId,
    reviewEvidence: { version: 1, previewImageProfile: "detail-v1", reviewedAssetHash: CURRENT_RESOLUTION_CONTROLS.lettering.reviewedHash,
      verdict: verdict(), generationDurationMs: 0, customerEvaluation: {
        ...CURRENT_RESOLUTION_CONTROLS.lettering, stage: "completed", version: CURRENT_RESOLUTION_REVIEW_VERSION,
        deploymentSha: "stale-deployment", customerActivation: "disabled", controlPassed: true, criticRequests: 1,
      } } });
  expect((await runCurrentResolutionReview(f.event, f.store, f.registration, f.options)).kind).toBe("blocked");
  expect(f.review).not.toHaveBeenCalled();
  prior.reviewEvidence!.customerEvaluation!.deploymentSha = environment.VERCEL_GIT_COMMIT_SHA;
  expect(await runCurrentResolutionReview(f.event, f.store, f.registration, f.options))
    .toMatchObject({ kind: "completed", controlPassed: true, fullGatePassed: true, customerActivation: "disabled" });
  expect(f.review).toHaveBeenCalledTimes(1); expect(f.event).toEqual(before);
  expect(f.store.all.at(-1)?.reviewEvidence?.customerEvaluation).toMatchObject({
    humanLikeness: "accepted", humanFinish: "accepted", fullArtworkApprovalByHuman: null,
  });
});

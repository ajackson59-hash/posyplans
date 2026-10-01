/** Fixed Preview-only review experiment. No generation, promotion or event writes. */
import { createHash } from "node:crypto";
import type { Event } from "@shared/schema";
import { REVIEW_CALIBRATION_MODEL, type AiFirstArtworkAttemptStore, type ArtworkAttemptInput } from "./aiFirst/artworkAttemptStore";
import { GOOGLE_ARTWORK_MODEL } from "./aiFirst/artwork";
import { MEDIUM_FEASIBILITY_CASES } from "./aiFirst/mediumFeasibilityCases";
import { runTier1Checks } from "./aiFirst/tier1";
import { runVisionGate, visionCostUsd, type VisionVerdict } from "./aiFirst/visionGate";
import { namedReferenceIdentityNotes } from "./namedReferenceResolver";
import { buildQualityLockedPreviewBrief, customerVisiblePreviewBytes, detectNamedCreativeReferenceSync } from "./prePaymentPreviewQuality";

const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export const CURRENT_RESOLUTION_REVIEW_VERSION = "current-resolution-gate-v1";
export interface CurrentResolutionControl {
  caseId: "lettering" | "accepted-scene-a";
  datasetId: string;
  sourceHash: string;
  reviewedHash: string;
  sourceAttemptId?: string;
  requiresCompletedDataset?: string;
}
export const CURRENT_RESOLUTION_CONTROLS: Record<CurrentResolutionControl["caseId"], CurrentResolutionControl> = {
  lettering: { caseId: "lettering", datasetId: "current-resolution-20260916-v1-lettering",
    sourceAttemptId: "281", sourceHash: "265cfeed3a076ecbf7afde4a9835f67465bde8173cb9334195425c117195b565",
    reviewedHash: "dcfc60f28fea7d45a16918a9db1d8619deca90a708658596c55ad1127e6a8f21" },
  "accepted-scene-a": { caseId: "accepted-scene-a", datasetId: "current-resolution-20260916-v1-accepted-scene-a",
    sourceHash: "47c3d7ee71ca21fedc624e6b10d8db5a5cead8d738bbf91027fbe58f752f241d",
    reviewedHash: "8f6f8dce768cd36e09d872bd07dc52ad970abca772279fd807a0e6df05c0e105",
    requiresCompletedDataset: "current-resolution-20260916-v1-lettering" },
};

export async function prepareCurrentResolutionReview(event: Event, store: AiFirstArtworkAttemptStore,
  registration: CurrentResolutionControl, options: { environment?: NodeJS.ProcessEnv; candidate?: Buffer } = {}) {
  const environment = options.environment ?? process.env;
  if (environment.VERCEL_ENV !== "preview" || environment.VERCEL_GIT_COMMIT_REF !== "codex/launch-blockers" ||
      !environment.VERCEL_GIT_COMMIT_SHA || event.id !== 61 || !event.ownerToken || !store.recordOnce ||
      event.eventName !== "Artwork evaluation" || event.eventType !== "Artwork evaluation" || event.inviteStatus !== "draft" ||
      event.themeName !== "" || event.paletteColors !== "[]" ||
      hash(event.vibeDescription) !== MEDIUM_FEASIBILITY_CASES[0].hostBriefSha256) throw new Error("current-review-context-mismatch");
  let sourceBytes: Buffer;
  if (registration.sourceAttemptId) {
    if (options.candidate) throw new Error("current-review-unexpected-pixels");
    const source = await store.findById(event.id, event.ownerToken, registration.sourceAttemptId);
    if (!source || source.status !== "rejected" || source.previewId || source.model !== GOOGLE_ARTWORK_MODEL ||
        source.assetHash !== registration.sourceHash) throw new Error("current-review-source-mismatch");
    sourceBytes = Buffer.from(source.assetBytesBase64, "base64");
  } else {
    if (!options.candidate || options.candidate.length > 2_500_000) throw new Error("current-review-source-required");
    sourceBytes = Buffer.from(options.candidate);
  }
  if (hash(sourceBytes) !== registration.sourceHash) throw new Error("current-review-source-integrity");
  const bytes = customerVisiblePreviewBytes(sourceBytes, "detail-v1");
  if (hash(bytes) !== registration.reviewedHash) throw new Error("current-review-transform-integrity");
  const named = detectNamedCreativeReferenceSync(event.vibeDescription);
  const { brief, concept } = await buildQualityLockedPreviewBrief(event, named ? namedReferenceIdentityNotes(named) : "", named);
  const tier1 = runTier1Checks({ bytes, brief, concept, artworkModel: GOOGLE_ARTWORK_MODEL,
    overlayCoverage: 0, artworkOpacity: 1, layoutApplied: false, ocr: true });
  return { bytes, sourceBytes, brief, concept, tier1,
    contextHash: hash(JSON.stringify({ brief, concept, previewImageProfile: "detail-v1" })) };
}

export async function runCurrentResolutionReview(event: Event, store: AiFirstArtworkAttemptStore,
  registration: CurrentResolutionControl, options: { environment?: NodeJS.ProcessEnv; candidate?: Buffer;
    signal?: AbortSignal; review?: typeof runVisionGate; preflightOnly?: boolean } = {}) {
  const environment = options.environment ?? process.env;
  const blocked = (reason: string) => ({ kind: "blocked" as const, reason, customerActivation: "disabled" as const });
  if (options.signal?.aborted) return blocked("current-review-cancelled");
  let input: Awaited<ReturnType<typeof prepareCurrentResolutionReview>>;
  try { input = await prepareCurrentResolutionReview(event, store, registration, options); }
  catch (error) { return blocked(error instanceof Error ? error.message : "current-review-input-unavailable"); }
  const records = await store.listForOwner(event.id, event.ownerToken);
  const alreadyClaimed = records.some(row => row.idempotencyKey === `${registration.datasetId}:claimed`);
  const prerequisite = records.filter(row => row.runId === registration.requiresCompletedDataset &&
    row.reviewEvidence?.customerEvaluation?.stage === "completed");
  const prior = prerequisite[0], proof = prior?.reviewEvidence?.customerEvaluation;
  const prerequisitePassed = !registration.requiresCompletedDataset || (prerequisite.length === 1 &&
    prior.status === "rejected" && !prior.previewId && proof?.customerActivation === "disabled" &&
    proof?.version === CURRENT_RESOLUTION_REVIEW_VERSION && proof.deploymentSha === environment.VERCEL_GIT_COMMIT_SHA &&
    proof.controlPassed === true && proof.criticRequests === 1 && proof.caseId === "lettering" &&
    proof.sourceHash === CURRENT_RESOLUTION_CONTROLS.lettering.sourceHash &&
    proof.reviewedHash === CURRENT_RESOLUTION_CONTROLS.lettering.reviewedHash &&
    prior.reviewEvidence?.verdict?.unavailable === false);
  if (options.preflightOnly) return { kind: "preflight" as const, caseId: registration.caseId,
    sourceHash: hash(input.sourceBytes), reviewedHash: hash(input.bytes), contextHash: input.contextHash,
    width: input.bytes.readUInt32BE(16), height: input.bytes.readUInt32BE(20), reviewedBytes: input.bytes.length,
    tier1: { passed: input.tier1.passed, findings: input.tier1.findings }, alreadyClaimed, prerequisitePassed, customerActivation: "disabled" as const,
    imageProviderCalls: 0, criticRequests: 0 };
  if (alreadyClaimed) return blocked("current-review-already-claimed");
  if (!prerequisitePassed) return blocked("current-review-negative-prerequisite-failed");
  const evidence: Record<string, unknown> = { ...registration, version: CURRENT_RESOLUTION_REVIEW_VERSION,
    stage: "claimed", deploymentSha: environment.VERCEL_GIT_COMMIT_SHA, contextHash: input.contextHash,
    previewImageProfile: "detail-v1", imageProviderCalls: 0, classifierRequests: 0, criticRequests: null,
    customerActivation: "disabled", controlPassed: null, fullArtworkApprovalByHuman: null,
    humanLikeness: registration.caseId === "accepted-scene-a" ? "accepted" : null,
    humanFinish: registration.caseId === "accepted-scene-a" ? "accepted" : null };
  const base: ArtworkAttemptInput = { eventId: event.id, ownerToken: event.ownerToken, runId: registration.datasetId,
    directionIndex: 0, attempt: 0, status: "rejected", previewId: null, bytes: input.sourceBytes, concept: input.concept,
    model: REVIEW_CALIBRATION_MODEL, quality: "not-applicable", size: null, costUsdMicros: 0,
    failureCodes: ["calibration-only-no-customer-approval"], tier1Findings: input.tier1.findings, visionScores: null };
  const save = async (stage: string, verdict: VisionVerdict | null) => {
    evidence.stage = stage;
    const saved = await store.recordOnce!({ ...base, idempotencyKey: `${registration.datasetId}:${stage}`,
      visionScores: verdict?.scores ?? null, reviewEvidence: { version: 1, previewImageProfile: "detail-v1",
        reviewedAssetHash: registration.reviewedHash, verdict, generationDurationMs: 0,
        customerEvaluation: structuredClone(evidence) } });
    if (!saved.created || !saved.record) throw new Error("current-review-claim-or-retention-failed");
    const read = await store.findById(event.id, event.ownerToken, saved.record.id);
    if (!read || read.status !== "rejected" || read.previewId || read.assetHash !== registration.sourceHash ||
        hash(Buffer.from(read.assetBytesBase64, "base64")) !== registration.sourceHash ||
        JSON.stringify(read.reviewEvidence?.customerEvaluation) !== JSON.stringify(evidence)) {
      throw new Error("current-review-claim-or-retention-failed");
    }
    return read.id;
  };
  try { await save("claimed", null); } catch { return blocked("current-review-already-claimed-or-retention-failed"); }
  if (!input.tier1.passed) {
    evidence.criticRequests = 0; evidence.controlPassed = false;
    await save("structural-rejection", null);
    return { kind: "structural-rejection" as const, imageProviderCalls: 0, criticRequests: 0,
      tier1: { passed: input.tier1.passed, findings: input.tier1.findings },
      customerActivation: "disabled" as const };
  }
  const signal = AbortSignal.any([AbortSignal.timeout(45_000), ...(options.signal ? [options.signal] : [])]);
  let verdict: VisionVerdict;
  try {
    signal.throwIfAborted();
    // Match ordinary customer review inputs exactly. Human labels and case IDs stay in private evidence only.
    verdict = await (options.review ?? runVisionGate)({ bytes: input.bytes, brief: input.brief, concept: input.concept,
      reviewMode: "teaser", maxFormatRepairs: 0, signal });
  } catch {
    evidence.controlPassed = false; evidence.error = "current-review-unavailable";
    await save("unavailable", null);
    return { kind: "unavailable" as const, imageProviderCalls: 0, criticRequests: null, customerActivation: "disabled" as const };
  }
  evidence.criticRequests = verdict.requestCount ?? null; evidence.criticUsage = verdict.usage;
  evidence.criticMs = verdict.durationMs; evidence.criticCostUsdFromUsage = visionCostUsd(verdict.usage);
  const available = !signal.aborted && !verdict.unavailable && verdict.requestCount === 1 &&
    Number.isFinite(verdict.usage.inputTokens) && verdict.usage.inputTokens > 0 &&
    Number.isFinite(verdict.usage.outputTokens) && verdict.usage.outputTokens > 0;
  if (!available) verdict = { ...verdict, passed: false, unavailable: true };
  const lettering = verdict.dimensionAssessments?.textLogoWatermarkFree;
  evidence.controlPassed = available && verdict.reviewIntegrity?.valid === true &&
    (registration.caseId === "lettering"
      ? !verdict.passed && verdict.scores.textLogoWatermarkFree < 5 && lettering?.status === "defect" && lettering.criterion === "lettering"
      : verdict.scores.premiumFinish === 5 && verdict.teaserChecks?.identity.accurate === true);
  evidence.fullGatePassed = verdict.passed;
  const attemptId = await save("completed", verdict);
  return { kind: verdict.unavailable ? "unavailable" as const : "completed" as const, attemptId,
    imageProviderCalls: 0, criticRequests: verdict.requestCount ?? null, controlPassed: evidence.controlPassed,
    fullGatePassed: verdict.passed, customerActivation: "disabled" as const, verdict };
}

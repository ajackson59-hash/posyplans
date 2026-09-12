/** One authorized reviewer calibration; no generation or customer activation. */
import { createHash } from "node:crypto";
import type { Event } from "@shared/schema";
import { REVIEW_CALIBRATION_MODEL, type AiFirstArtworkAttemptStore, type ArtworkAttemptInput } from "./aiFirst/artworkAttemptStore";
import { prepareReviewReferences, type ReviewReference } from "./aiFirst/reviewReferences";
import { runVisionGate, type VisionVerdict } from "./aiFirst/visionGate";
import { namedReferenceIdentityNotes } from "./namedReferenceResolver";
import { buildQualityLockedPreviewBrief, customerVisiblePreviewBytes, detectNamedCreativeReferenceSync } from "./prePaymentPreviewQuality";
import { SCENE_LIKENESS_EXPERIMENT } from "./retainedSceneRepaint";

const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export const RETAINED_LIKENESS_REVIEW = {
  datasetId: "meekah-reference-review-20260912-v1", eventId: 61,
  sourceAttemptId: "293", referenceAttemptId: "289",
  sourceHash: "3ed9ff2d1da11a7a8553272b071b16c521519efa638649ffb3c0bda430f6cc9e",
  reviewedHash: "7d16340d64c38bf1a24f218b5db3f5e59666d6b1e2ff3d57ce26e972f18181f0",
  hostBriefHash: SCENE_LIKENESS_EXPERIMENT.hostBriefHash,
  referenceHash: SCENE_LIKENESS_EXPERIMENT.identity.sha256,
};

export async function runRetainedLikenessReview(event: Event, store: AiFirstArtworkAttemptStore,
  options: { environment?: NodeJS.ProcessEnv; signal?: AbortSignal; review?: typeof runVisionGate;
    registration?: typeof RETAINED_LIKENESS_REVIEW } = {}) {
  const registration = options.registration ?? RETAINED_LIKENESS_REVIEW;
  const environment = options.environment ?? process.env;
  const blocked = (reason: string) => ({ kind: "blocked" as const, reason, customerActivation: "disabled" as const });
  if (environment.VERCEL_ENV !== "preview" || environment.VERCEL_GIT_COMMIT_REF !== "codex/launch-blockers" ||
      event.id !== registration.eventId || !event.ownerToken || !store.recordOnce || options.signal?.aborted ||
      event.eventName !== "Artwork evaluation" || event.eventType !== "Artwork evaluation" || event.inviteStatus !== "draft" ||
      event.themeName !== "" || event.paletteColors !== "[]" || hash(event.vibeDescription) !== registration.hostBriefHash) {
    return blocked("likeness-review-context-mismatch");
  }
  const [source, reference] = await Promise.all([
    store.findById(event.id, event.ownerToken, registration.sourceAttemptId),
    store.findById(event.id, event.ownerToken, registration.referenceAttemptId),
  ]);
  if (!source || !reference || [source, reference].some(row => row.status !== "rejected" || row.previewId ||
      row.runId !== SCENE_LIKENESS_EXPERIMENT.datasetId) ||
      source.reviewEvidence?.customerEvaluation?.stage !== "completed" ||
      reference.reviewEvidence?.customerEvaluation?.stage !== "identity-reference" ||
      source.assetHash !== registration.sourceHash || reference.assetHash !== registration.referenceHash) {
    return blocked("likeness-review-source-mismatch");
  }
  const sourceBytes = Buffer.from(source.assetBytesBase64, "base64");
  const identityBytes = Buffer.from(reference.assetBytesBase64, "base64");
  if (hash(sourceBytes) !== registration.sourceHash || hash(identityBytes) !== registration.referenceHash) {
    return blocked("likeness-review-input-integrity");
  }
  const reviewed = customerVisiblePreviewBytes(sourceBytes);
  if (hash(reviewed) !== registration.reviewedHash) return blocked("likeness-review-teaser-integrity");
  const referenceImages: ReviewReference[] = [{ bytes: identityBytes, sha256: registration.referenceHash,
    sourceUrl: SCENE_LIKENESS_EXPERIMENT.identity.sourceUrl, role: "identity", subject: "Meekah",
    region: "The named co-host's face, hair and visible natural proportions; identity only" }];
  try { prepareReviewReferences(referenceImages); } catch { return blocked("likeness-review-reference-invalid"); }
  const named = detectNamedCreativeReferenceSync(event.vibeDescription);
  const { brief, concept } = await buildQualityLockedPreviewBrief(event, named ? namedReferenceIdentityNotes(named) : "", named);
  // The user's negative judgment and this expected result never enter the model request.
  const evidence: Record<string, unknown> = { ...registration, stage: "claimed", expectedMeekahIdentity: false,
    imageProviderCalls: 0, classifierRequests: 0, criticRequests: null,
    deploymentSha: environment.VERCEL_GIT_COMMIT_SHA ?? null, customerActivation: "disabled",
    uninterruptedCustomerLatencyMs: null };
  let verdict: VisionVerdict | undefined;
  const base: ArtworkAttemptInput = { eventId: event.id, ownerToken: event.ownerToken,
    runId: registration.datasetId, directionIndex: 0, attempt: 0, status: "rejected", previewId: null,
    bytes: sourceBytes, concept, model: REVIEW_CALIBRATION_MODEL, quality: "not-applicable", size: null,
    costUsdMicros: 0, failureCodes: ["calibration-only-no-customer-approval"], tier1Findings: [], visionScores: null };
  const save = async (stage: string) => {
    evidence.stage = stage;
    const saved = await store.recordOnce!({ ...base, idempotencyKey: `${registration.datasetId}:${stage}`,
      visionScores: verdict?.scores ?? null, reviewEvidence: { version: 1, reviewedAssetHash: registration.reviewedHash,
        verdict: verdict ?? null, generationDurationMs: 0, customerEvaluation: structuredClone(evidence) } });
    if (!saved.created || !saved.record) throw new Error("likeness-review-claim-or-retention");
    const read = await store.findById(event.id, event.ownerToken, saved.record.id);
    if (!read || read.status !== "rejected" || read.previewId || read.assetHash !== registration.sourceHash ||
        hash(Buffer.from(read.assetBytesBase64, "base64")) !== registration.sourceHash ||
        JSON.stringify(read.reviewEvidence?.customerEvaluation) !== JSON.stringify(evidence)) {
      throw new Error("likeness-review-claim-or-retention");
    }
    return read.id;
  };
  try { await save("claimed"); } catch { return blocked("likeness-review-already-claimed-or-retention-failed"); }
  const signal = AbortSignal.any([AbortSignal.timeout(45_000), ...(options.signal ? [options.signal] : [])]);
  const started = Date.now();
  try {
    signal.throwIfAborted();
    verdict = await (options.review ?? runVisionGate)({ bytes: reviewed, brief, concept, referenceImages,
      reviewMode: "teaser", maxFormatRepairs: 0, signal });
    evidence.criticRequests = verdict.requestCount ?? null;
    evidence.criticUsage = verdict.usage;
    evidence.criticMs = verdict.durationMs;
    const proof = verdict.referenceEvidence;
    const referenceVerified = proof?.length === 1 && proof[0].role === "identity" &&
      "subject" in proof[0] && proof[0].subject === "Meekah" && proof[0].sha256 === registration.referenceHash;
    const accounted = referenceVerified && !signal.aborted && !verdict.unavailable && verdict.requestCount === 1 &&
      [verdict.usage.inputTokens, verdict.usage.outputTokens].every(n => Number.isSafeInteger(n) && n >= 0);
    const observed = verdict.requiredPresent.find(row => row.requirement.startsWith("Meekah "));
    const mismatchDetected = accounted && observed?.present === false && Boolean(observed.evidence?.trim()) &&
      verdict.teaserChecks?.identity.required === true && verdict.teaserChecks.identity.accurate === false;
    evidence.referenceVerified = Boolean(referenceVerified);
    evidence.mismatchDetected = Boolean(mismatchDetected);
    evidence.outcome = !accounted ? "review-unavailable" : mismatchDetected ? "likeness-mismatch-detected" : "likeness-mismatch-missed";
    evidence.elapsedMs = Date.now() - started;
    const attemptId = await save("completed");
    return { kind: "reviewed" as const, attemptId, verdict, evidence };
  } catch {
    evidence.outcome = "review-unavailable";
    evidence.elapsedMs = Date.now() - started;
    const attemptId = await save("unavailable");
    return { kind: "unavailable" as const, attemptId, evidence };
  }
}

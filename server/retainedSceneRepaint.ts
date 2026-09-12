// One separately registered Preview experiment. Does not reopen a customer allowance.
import { createHash } from "node:crypto";
import type { Event } from "@shared/schema";
import type { AiFirstArtworkAttemptStore, ArtworkAttemptInput } from "./aiFirst/artworkAttemptStore";
import { ArtworkNormalizationError, ArtworkProviderError, GOOGLE_ARTWORK_MODEL, generateArtwork, type ArtworkGenerator, type ArtworkResult } from "./aiFirst/artwork";
import { MEDIUM_FEASIBILITY_CASES } from "./aiFirst/mediumFeasibilityCases";
import { buildSceneRepaintPrompt, buildSceneLikenessPrompt } from "./aiFirst/sceneRepaint";
import { prepareReviewReferences, type ReviewReference } from "./aiFirst/reviewReferences";
import { runTier1Checks } from "./aiFirst/tier1";
import { runVisionGate, type VisionVerdict } from "./aiFirst/visionGate";
import { namedReferenceIdentityNotes } from "./namedReferenceResolver";
import { buildQualityLockedPreviewBrief, customerVisiblePreviewBytes, detectNamedCreativeReferenceSync } from "./prePaymentPreviewQuality";

const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export const SCENE_REPAINT_EXPERIMENT = {
  datasetId: "google-retained-scene-repaint-20260912-v1", eventId: 61, attemptId: "281",
  sourceHash: "265cfeed3a076ecbf7afde4a9835f67465bde8173cb9334195425c117195b565",
  hostBriefHash: MEDIUM_FEASIBILITY_CASES[0].hostBriefSha256,
} as const;
export const SCENE_LIKENESS_EXPERIMENT = {
  datasetId: "google-meekah-likeness-20260912-v1", eventId: 61, attemptId: "287",
  sourceHash: "f996272faa7870d529b62c798ce11af297e0e81581323082d966fe35505ffb29",
  hostBriefHash: MEDIUM_FEASIBILITY_CASES[0].hostBriefSha256,
  identity: { subject: "Meekah", sha256: "347745ce1d75a4e5e8e7cacf20ca7fa693d4cb66c17d99f010e7c010113994b8",
    sourceUrl: "https://www.blippi.com/about",
    originalUrl: "https://static.wixstatic.com/media/d70790_9f3656b5950649a0b97994a75c065b84~mv2.png",
    originalSha256: "9668d4330ec2611c5f2700f55144dcb40e9070f0ddd24e49b7c222d888220c19" },
} as const;
type Registration = { datasetId: string; eventId: number; attemptId: string; sourceHash: string; hostBriefHash: string;
  identity?: { subject: string; sha256: string; sourceUrl: string; originalUrl: string; originalSha256: string } };

export async function runRetainedSceneRepaint(event: Event, store: AiFirstArtworkAttemptStore,
  options: { environment?: NodeJS.ProcessEnv; generate?: ArtworkGenerator; review?: typeof runVisionGate;
    signal?: AbortSignal; registration?: Registration; identityReferenceBytes?: Buffer } = {}) {
  const environment = options.environment ?? process.env;
  const registration: Registration = options.registration ?? SCENE_REPAINT_EXPERIMENT;
  const blocked = (reason: string) => ({ kind: "blocked" as const, reason, customerActivation: "disabled" as const });
  if (environment.VERCEL_ENV !== "preview" || environment.VERCEL_GIT_COMMIT_REF !== "codex/launch-blockers" ||
      event.id !== registration.eventId || !event.ownerToken || !store.recordOnce || options.signal?.aborted ||
      event.eventName !== "Artwork evaluation" || event.eventType !== "Artwork evaluation" || event.inviteStatus !== "draft" ||
      event.themeName !== "" || event.paletteColors !== "[]" || hash(event.vibeDescription) !== registration.hostBriefHash) {
    return blocked("repaint-context-mismatch");
  }
  const source = await store.findById(event.id, event.ownerToken, registration.attemptId);
  if (!source || source.status !== "rejected" || source.model !== GOOGLE_ARTWORK_MODEL || source.previewId ||
      source.assetHash !== registration.sourceHash || source.reviewEvidence?.providerFailure ||
      !source.reviewEvidence?.verdict || source.reviewEvidence.verdict.unavailable) return blocked("repaint-source-mismatch");
  const sourceBytes = Buffer.from(source.assetBytesBase64, "base64");
  if (hash(sourceBytes) !== registration.sourceHash) return blocked("repaint-source-integrity");
  const references: ReviewReference[] = [];
  if (registration.identity) {
    const identity = registration.identity;
    if (!options.identityReferenceBytes || hash(options.identityReferenceBytes) !== identity.sha256) {
      return blocked("likeness-reference-integrity");
    }
    references.push({ bytes: options.identityReferenceBytes, sha256: identity.sha256,
      sourceUrl: identity.sourceUrl, role: "identity", subject: identity.subject,
      region: "The named co-host's face, hair and visible natural proportions; identity only" });
    try { prepareReviewReferences(references); } catch { return blocked("likeness-reference-format"); }
  } else if (options.identityReferenceBytes) return blocked("unregistered-identity-reference");
  const named = detectNamedCreativeReferenceSync(event.vibeDescription);
  const { brief, concept } = await buildQualityLockedPreviewBrief(event, named ? namedReferenceIdentityNotes(named) : "", named);
  const prompt = registration.identity ? buildSceneLikenessPrompt(brief, registration.identity.subject) : buildSceneRepaintPrompt(brief);
  const signal = AbortSignal.any([AbortSignal.timeout(80_000), ...(options.signal ? [options.signal] : [])]);
  const evidence: Record<string, unknown> = {
    datasetId: registration.datasetId, sourceAttemptId: source.id, sourceHash: registration.sourceHash,
    hostBriefSha256: registration.hostBriefHash, deploymentSha: environment.VERCEL_GIT_COMMIT_SHA ?? null,
    stage: "registered", imageRequests: 0, criticRequests: 0, classifierRequests: 0,
    originalGenerationMs: source.reviewEvidence.generationDurationMs,
    originalCriticMs: source.reviewEvidence.verdict.durationMs,
    ...(registration.identity ? { identityReference: registration.identity,
      sourceLineage: { sourceAttemptId: source.reviewEvidence.customerEvaluation?.sourceAttemptId ?? null,
        originalGenerationMs: source.reviewEvidence.customerEvaluation?.originalGenerationMs ?? null,
        originalCriticMs: source.reviewEvidence.customerEvaluation?.originalCriticMs ?? null } } : {}),
    uninterruptedCustomerLatencyMs: null, customerActivation: "disabled",
    imageRequest: { model: GOOGLE_ARTWORK_MODEL, prompt, promptSha256: hash(prompt), aspectRatio: "9:16",
      quality: "medium", outputFormat: "jpeg", referenceHashes: [registration.sourceHash, ...references.map(r => r.sha256)], maxTransientRetries: 0 },
  };
  // Every experiment row remains private/rejected, even if its measured gates pass.
  const base: ArtworkAttemptInput = { eventId: event.id, ownerToken: event.ownerToken,
    runId: registration.datasetId, directionIndex: 0, attempt: 1, status: "rejected", previewId: null,
    bytes: Buffer.alloc(0), concept, model: GOOGLE_ARTWORK_MODEL, quality: "medium", size: "768x1376",
    costUsdMicros: 0, failureCodes: ["research-only-no-customer-approval"], tier1Findings: [], visionScores: null };
  let generated: ArtworkResult | undefined;
  let reviewed: Buffer | undefined;
  let verdict: VisionVerdict | undefined;
  const save = async (stage: string, referenceBytes?: Buffer) => {
    evidence.stage = stage;
    const bytes = referenceBytes ?? generated?.bytes ?? Buffer.alloc(0);
    const input = { ...base, bytes, visionScores: verdict?.scores ?? null,
      // Reference dimensions are encoded in its PNG; it is not a generated artwork size.
      ...(referenceBytes ? { size: null } : {}),
      idempotencyKey: `${registration.datasetId}:${stage}`,
      reviewEvidence: { version: 1 as const, reviewedAssetHash: reviewed ? hash(reviewed) : null,
        verdict: verdict ?? null, generationDurationMs: generated?.durationMs ?? 0,
        generationTelemetry: generated?.telemetry, customerEvaluation: structuredClone(evidence) } };
    const saved = await store.recordOnce!(input);
    if (!saved.created || !saved.record) throw new Error("repaint-claim-or-retention-failed");
    const read = await store.findById(event.id, event.ownerToken, saved.record.id);
    if (!read || read.status !== "rejected" || read.previewId || read.assetHash !== hash(bytes) ||
        hash(Buffer.from(read.assetBytesBase64, "base64")) !== hash(bytes) ||
        JSON.stringify(read.reviewEvidence?.customerEvaluation) !== JSON.stringify(evidence)) {
      throw new Error("repaint-claim-or-retention-failed");
    }
    return read.id;
  };
  try { await save("claimed"); } catch { return blocked("experiment-already-claimed-or-retention-failed"); }
  const started = Date.now();
  try {
    if (references.length) await save("identity-reference", references[0].bytes);
    evidence.imageRequests = null; await save("image-claimed"); signal.throwIfAborted();
    generated = await (options.generate ?? generateArtwork)({ model: GOOGLE_ARTWORK_MODEL, prompt,
      aspectRatio: "9:16", quality: "medium", outputFormat: "jpeg", maxTransientRetries: 0,
      referenceImages: [{ bytes: sourceBytes, mimeType: "image/png" },
        ...references.map(r => ({ bytes: r.bytes, mimeType: "image/png" as const }))], signal });
    evidence.imageRequests = generated.telemetry?.providerRequestCount ?? null;
    evidence.imageUsage = generated.telemetry?.google?.usage ?? null;
    await save("image-returned"); signal.throwIfAborted();
    if (evidence.imageRequests !== 1 || !evidence.imageUsage) throw new Error("repaint-image-accounting");
    reviewed = customerVisiblePreviewBytes(generated.bytes);
    const tier1 = runTier1Checks({ bytes: reviewed, brief, concept, artworkModel: GOOGLE_ARTWORK_MODEL,
      overlayCoverage: 0, artworkOpacity: 1, layoutApplied: false, ocr: true });
    base.tier1Findings = tier1.findings;
    if (!tier1.passed) {
      evidence.outcome = "structural-rejection";
      const attemptId = await save("completed");
      return { kind: "evaluated" as const, gatePassed: false, attemptId, evidence };
    }
    evidence.criticRequests = null; await save("review-claimed"); signal.throwIfAborted();
    verdict = await (options.review ?? runVisionGate)({ bytes: reviewed, brief, concept,
      reviewMode: "teaser", maxFormatRepairs: 0, ...(references.length ? { references } : {}), signal });
    evidence.criticRequests = verdict.requestCount ?? null;
    evidence.criticUsage = verdict.usage; evidence.criticMs = verdict.durationMs;
    evidence.elapsedMs = Date.now() - started;
    const identityReviewed = !registration.identity || (verdict.referenceEvidence?.length === 1 &&
      verdict.referenceEvidence[0].role === "identity" && "subject" in verdict.referenceEvidence[0] &&
      verdict.referenceEvidence[0].subject === registration.identity.subject &&
      verdict.referenceEvidence[0].sha256 === registration.identity.sha256);
    const accounted = identityReviewed && verdict.requestCount === 1 && !signal.aborted && !verdict.unavailable &&
      [verdict.usage.inputTokens, verdict.usage.outputTokens].every(value => Number.isSafeInteger(value) && value >= 0);
    evidence.outcome = accounted ? (verdict.passed ? "gate-passed-human-review-pending" : "quality-rejected") : "review-unavailable";
    const attemptId = await save("completed");
    return { kind: "evaluated" as const, gatePassed: accounted && verdict.passed,
      attemptId, sourceHash: hash(generated.bytes), reviewedHash: hash(reviewed), verdict, evidence };
  } catch (error) {
    if (error instanceof ArtworkNormalizationError) {
      generated = error.result;
      evidence.imageRequests = generated.telemetry?.providerRequestCount ?? null;
      evidence.imageUsage = generated.telemetry?.google?.usage ?? null;
    }
    evidence.outcome = "unavailable"; evidence.elapsedMs = Date.now() - started;
    // Do not copy arbitrary exception messages, credentials or private URLs.
    evidence.error = error instanceof ArtworkProviderError ? "image-provider-error" : "repaint-unavailable";
    if (error instanceof ArtworkProviderError) {
      evidence.providerFailure = error.diagnostics;
      evidence.imageRequests = error.diagnostics.providerRequestCount;
      if (error.privateProviderMessage) evidence.privateProviderMessage = error.privateProviderMessage;
    }
    const attemptId = await save("unavailable");
    return { kind: "unavailable" as const, attemptId, evidence };
  }
}

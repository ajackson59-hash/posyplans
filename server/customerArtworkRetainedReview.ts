// Finish the unused review allowance on retained pixels. No image dispatch.
import { createHash } from "node:crypto";
import type { Event } from "@shared/schema";
import type { AiFirstArtworkAttemptStore, ArtworkAttemptInput } from "./aiFirst/artworkAttemptStore";
import { GOOGLE_ARTWORK_MODEL, type ArtworkModel } from "./aiFirst/artwork";
import { MEDIUM_FEASIBILITY_CASES } from "./aiFirst/mediumFeasibilityCases";
import { runTier1Checks } from "./aiFirst/tier1";
import { runVisionGate, visionCostUsd } from "./aiFirst/visionGate";
import { buildQualityLockedPreviewBrief, customerVisiblePreviewBytes } from "./prePaymentPreviewQuality";

const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export const ORIGINAL_CONTROL_REVIEW = {
  eventId: 53, attemptId: "255", datasetId: "google-original-control-20260911",
  sourceHash: "cf67d0856a1c211fd32476d405f31e1366c0eda88d0181564195352bff3b54b1",
  hostBriefHash: MEDIUM_FEASIBILITY_CASES[4].hostBriefSha256,
  model: GOOGLE_ARTWORK_MODEL as ArtworkModel,
};

/** Registration is server-owned; routes never accept it from a request. */
export async function reviewRetainedCustomerArtwork(event: Event, store: AiFirstArtworkAttemptStore,
  registration: typeof ORIGINAL_CONTROL_REVIEW, environment: NodeJS.ProcessEnv = process.env,
  review: typeof runVisionGate = runVisionGate) {
  const blocked = (reason: string) => ({ kind: "blocked" as const, reason, imageProviderCalls: 0 });
  if (environment.VERCEL_ENV !== "preview" || environment.VERCEL_GIT_COMMIT_REF !== "codex/launch-blockers" ||
      event.id !== registration.eventId || !store.recordOnce || event.eventName !== "Artwork evaluation" ||
      event.eventType !== "Artwork evaluation" || event.inviteStatus !== "draft" ||
      event.themeName !== "" || event.paletteColors !== "[]" || hash(event.vibeDescription) !== registration.hostBriefHash) {
    return blocked("retained-review-context-mismatch");
  }
  const source = await store.findById(event.id, event.ownerToken, registration.attemptId);
  if (!source || source.model !== registration.model || source.assetHash !== registration.sourceHash ||
      source.status !== "rejected" || source.reviewEvidence?.providerFailure) return blocked("retained-source-mismatch");
  const bytes = Buffer.from(source.assetBytesBase64, "base64");
  if (hash(bytes) !== registration.sourceHash) return blocked("retained-source-integrity");
  // Preserve the original preview brief and review mode, including exclusions.
  const { brief, concept } = await buildQualityLockedPreviewBrief(event, "", null);
  const reviewed = customerVisiblePreviewBytes(bytes);
  const tier1 = runTier1Checks({ bytes: reviewed, brief, concept, artworkModel: registration.model,
    overlayCoverage: 0, artworkOpacity: 1, layoutApplied: false, ocr: true });
  const evidence: Record<string, unknown> = {
    datasetId: registration.datasetId, stage: "retained-review-claimed", sourceAttemptId: source.id,
    hostBriefSha256: registration.hostBriefHash, sourceHash: source.assetHash,
    deploymentSha: environment.VERCEL_GIT_COMMIT_SHA, imageRequests: 0, classifierRequests: 0,
    criticRequests: 0, humanReview: "pending", originalGenerationMs: source.reviewEvidence?.generationDurationMs,
  };
  const base: ArtworkAttemptInput = {
    eventId: event.id, ownerToken: event.ownerToken, runId: registration.datasetId,
    directionIndex: 4, attempt: 1, status: "rejected", bytes, concept,
    model: registration.model, quality: source.quality, size: source.size, costUsdMicros: 0,
    failureCodes: tier1.findings.filter(f => f.critical).map(f => f.code),
    tier1Findings: tier1.findings, visionScores: null,
  };
  const save = async (stage: string, verdict: Awaited<ReturnType<typeof runVisionGate>> | null) => {
    evidence.stage = stage;
    const saved = await store.recordOnce!({ ...base,
      status: verdict?.passed && !verdict.unavailable && tier1.passed ? "accepted" : "rejected",
      idempotencyKey: `${registration.datasetId}:retained-review:${stage}`,
      failureCodes: [...base.failureCodes, ...(verdict?.failureCodes ?? [])], visionScores: verdict?.scores ?? null,
      reviewEvidence: { version: 1, reviewedAssetHash: hash(reviewed), verdict,
        generationDurationMs: 0, customerEvaluation: structuredClone(evidence) },
    });
    if (!saved.created || !saved.record) throw new Error("retained-review-already-claimed");
    const read = await store.findById(event.id, event.ownerToken, saved.record.id);
    if (!read || read.assetHash !== registration.sourceHash || hash(Buffer.from(read.assetBytesBase64, "base64")) !== registration.sourceHash ||
        JSON.stringify(read.reviewEvidence?.customerEvaluation) !== JSON.stringify(evidence)) throw new Error("retained-review-retention-mismatch");
    return saved.record.id;
  };
  try { await save("claimed", null); } catch { return blocked("retained-review-claimed-or-retention-failed"); }
  if (!tier1.passed) {
    await save("structural-rejection", null);
    return { kind: "rejected" as const, imageProviderCalls: 0, criticRequests: 0, tier1Findings: tier1.findings };
  }
  const signal = AbortSignal.timeout(45_000);
  let verdict: Awaited<ReturnType<typeof runVisionGate>>;
  try {
    verdict = await review({ bytes: reviewed, brief, concept, reviewMode: "teaser", maxFormatRepairs: 0, signal });
  } catch {
    evidence.criticRequests = null; evidence.error = "retained-review-unavailable";
    await save("unavailable", null);
    return { kind: "unavailable" as const, imageProviderCalls: 0, criticRequests: null };
  }
  evidence.criticRequests = verdict.requestCount ?? null;
  evidence.criticUsage = verdict.usage ?? null;
  evidence.criticMs = verdict.durationMs;
  evidence.criticCostUsd = verdict.usage ? visionCostUsd(verdict.usage) : null;
  const accounted = verdict.requestCount === 1 && Boolean(verdict.usage) && !signal.aborted;
  if (!accounted) { verdict = { ...verdict, passed: false, unavailable: true }; }
  const attemptId = await save("completed", verdict);
  if (!verdict.passed || verdict.unavailable) return { kind: verdict.unavailable ? "unavailable" as const : "rejected" as const,
    imageProviderCalls: 0, criticRequests: verdict.requestCount ?? null, attemptId, verdict };
  return { kind: "approved-image" as const, imageProviderCalls: 0, criticRequests: 1, attemptId,
    dataUrl: `data:image/png;base64,${bytes.toString("base64")}`, verdict };
}

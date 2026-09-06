/** Private source QA. This reviews a fixed source profile, not a host's event. */
import { createHash, randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import type { Event } from "@shared/schema";
import { OVERLAY_COVERAGE } from "@shared/aiFirstLayout";
import manifest from "./sceneAssets/construction-gouache-v1/manifest.json";
import { prepareSceneStyleSource } from "./sceneStyleSource";
import { sceneBriefDigest } from "./sceneComposition";
import { buildQualityLockedPreviewBrief } from "../prePaymentPreviewQuality";
import { STYLE_SOURCE_MODEL, type AiFirstArtworkAttemptStore, type ArtworkAttemptInput, type ArtworkAttemptRecord } from "./artworkAttemptStore";
import { runTier1Checks, retryCodesFor, type Tier1Result } from "./tier1";
import { runVisionGate, type VisionVerdict } from "./visionGate";

export const sourceManifest = manifest;
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/** Fixed, versioned scope. Customer fields never become source approval. */
export async function sourceReviewProfile() {
  return buildQualityLockedPreviewBrief({
    eventName: "Original construction artwork proof", eventType: "Birthday",
    themeName: "Original construction play landscape", paletteColors: "[]",
    vibeDescription: "Premium hand-painted gouache children's editorial illustration. Warm ochre machinery, sandy earth and deep blue-green accents. Include an unmistakable excavator with a complete connected arm and bucket. Include a substantial complete crane with its boom and hook fully inside the canvas. Include a substantial distinct sand-play area. No people, faces on machines, named characters, logos, text, candles, numerals, balloons or cake. No photorealism, glossy plastic, clipart, collage, panels or reserved text areas. Coherent perspective, grounded machines, believable mechanical connections and consistent contact shadows. All required elements must be recognizable in a small phone teaser.",
  } as Event, "", null);
}

export async function retainStyleSource(bytes: Buffer, owner: { id: number; ownerToken: string }, store: AiFirstArtworkAttemptStore) {
  if (!store.recordOnce) throw new Error("Atomic source retention unavailable");
  const prepared = prepareSceneStyleSource(bytes, manifest);
  const { brief, concept } = await sourceReviewProfile();
  const profileDigest = sceneBriefDigest(brief);
  const result = await store.recordOnce({
    eventId: owner.id, ownerToken: owner.ownerToken,
    idempotencyKey: `style-source:${manifest.sourceSha256}:${owner.id}`,
    directionIndex: 0, attempt: 0, status: "rejected", previewId: null,
    bytes: prepared.original, concept, failureCodes: ["source-not-reviewed"],
    tier1Findings: [], visionScores: null, model: STYLE_SOURCE_MODEL,
    quality: "not-applicable", size: null, costUsdMicros: 0,
    reviewEvidence: { version: 1, reviewedAssetHash: null, verdict: null, generationDurationMs: 0,
      styleSource: { sourceId: manifest.id, scope: "source-profile-only", stage: "stored", profileDigest,
        imageProviderCalls: 0, criticRequests: 0, customerActivation: "disabled" } },
  });
  if (!result.record || result.record.eventId !== owner.id || result.record.ownerToken !== owner.ownerToken ||
      result.record.assetHash !== manifest.sourceSha256) throw new Error("Source retention mismatch");
  return { created: result.created, record: result.record, teaserHash: prepared.teaserSha256 };
}

export function prepareRetainedStyleSource(row: ArtworkAttemptRecord) {
  if (row.model !== STYLE_SOURCE_MODEL || row.reviewEvidence?.styleSource?.sourceId !== manifest.id ||
      row.assetHash !== manifest.sourceSha256) throw new Error("Invalid retained source");
  return prepareSceneStyleSource(Buffer.from(row.assetBytesBase64, "base64"), manifest);
}

export async function reviewRetainedStyleSource(row: ArtworkAttemptRecord, dependencies: {
  attemptStore: AiFirstArtworkAttemptStore;
  environment: string | undefined;
  confirmOneVisionCall: boolean;
  signal?: AbortSignal;
  client?: Anthropic;
  runTier1?: typeof runTier1Checks;
  reviewTimeoutMs?: number;
}) {
  if (dependencies.environment !== "preview" || dependencies.confirmOneVisionCall !== true ||
      !dependencies.attemptStore.recordOnce || !row.ownerToken || dependencies.signal?.aborted) {
    return { kind: "blocked" as const, reason: "review-not-authorized" };
  }
  const started = Date.now();
  let prepared: ReturnType<typeof prepareRetainedStyleSource>;
  try { prepared = prepareRetainedStyleSource(row); }
  catch { return { kind: "blocked" as const, reason: "source-integrity" }; }
  const { brief, concept } = await sourceReviewProfile();
  const profileDigest = sceneBriefDigest(brief);
  if (row.reviewEvidence?.styleSource?.stage !== "stored" ||
      row.reviewEvidence.styleSource.profileDigest !== profileDigest) {
    return { kind: "blocked" as const, reason: "source-profile-changed" };
  }
  // Globally unique per source: a replay, worker crash, changed owner, or
  // another deployment cannot buy a second review. No automatic lease reset.
  const runId = `style-review-${randomUUID()}`;
  const claimKey = `style-source-review-claim:${manifest.sourceSha256}`;
  const base: ArtworkAttemptInput = {
    eventId: row.eventId, ownerToken: row.ownerToken, runId, directionIndex: 0, attempt: 1,
    status: "rejected", previewId: null, bytes: prepared.original, concept,
    failureCodes: ["source-review-incomplete"], tier1Findings: [], visionScores: null,
    model: STYLE_SOURCE_MODEL, quality: "not-applicable", size: null, costUsdMicros: 0,
  };
  try {
    const claim = await dependencies.attemptStore.recordOnce({ ...base, idempotencyKey: claimKey,
      reviewEvidence: { version: 1, reviewedAssetHash: prepared.teaserSha256, verdict: null, generationDurationMs: 0,
        styleSource: { sourceId: manifest.id, scope: "source-profile-only", stage: "review-claimed", profileDigest,
          imageProviderCalls: 0, criticRequests: null, customerActivation: "disabled" } },
    });
    if (!claim.created) return { kind: "blocked" as const, reason: "review-already-claimed" };
    if (!claim.record || claim.record.runId !== runId || claim.record.eventId !== row.eventId ||
        claim.record.ownerToken !== row.ownerToken || claim.record.assetHash !== manifest.sourceSha256) {
      return { kind: "blocked" as const, reason: "review-retention-failed" };
    }
  } catch { return { kind: "blocked" as const, reason: "review-retention-failed" }; }

  let tier1: Tier1Result | undefined;
  let vision: VisionVerdict | null = null;
  let reviewError: string | undefined;
  let criticRequests: 0 | 1 = 0;
  const controller = new AbortController();
  const cancel = () => controller.abort();
  dependencies.signal?.addEventListener("abort", cancel, { once: true });
  const timeout = dependencies.reviewTimeoutMs ?? 45_000;
  const timeoutMs = Number.isFinite(timeout) ? Math.max(1, Math.min(60_000, timeout)) : 45_000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    if (dependencies.signal?.aborted) cancel();
    if (controller.signal.aborted) throw new Error("cancelled");
    tier1 = (dependencies.runTier1 ?? runTier1Checks)({ bytes: prepared.teaser, concept,
      overlayCoverage: OVERLAY_COVERAGE[concept.minOverlay], artworkOpacity: 1, layoutApplied: false, ocr: true });
    if (tier1.passed) {
      const deadline = new Promise<never>((_, reject) => {
        onAbort = () => reject(new Error("Review ended"));
        controller.signal.addEventListener("abort", onAbort, { once: true });
        timer = setTimeout(cancel, timeoutMs);
      });
      criticRequests = 1;
      vision = await Promise.race([runVisionGate({ bytes: prepared.teaser, concept, brief,
        reviewMode: "teaser", maxFormatRepairs: 0, signal: controller.signal, client: dependencies.client }), deadline]);
    }
  } catch { reviewError = "Source review failed, was cancelled, or timed out"; }
  finally {
    clearTimeout(timer);
    if (onAbort) controller.signal.removeEventListener("abort", onAbort);
    dependencies.signal?.removeEventListener("abort", cancel);
  }
  const passed = tier1?.passed === true && vision?.passed === true && !vision.unavailable &&
    !reviewError && !controller.signal.aborted && !dependencies.signal?.aborted;
  const failureCodes = passed ? [] : Array.from(new Set([
    ...(tier1 && !tier1.passed ? retryCodesFor(tier1.findings) : []), ...(vision?.failureCodes ?? []),
    ...(!vision || vision.unavailable || reviewError ? ["vision-unavailable"] : []),
  ]));
  try {
    const result = await dependencies.attemptStore.recordOnce({ ...base,
      idempotencyKey: `style-source-review-result:${manifest.sourceSha256}`,
      status: passed ? "accepted" : "rejected", failureCodes,
      tier1Findings: tier1?.findings ?? [], visionScores: vision?.scores ?? null,
      reviewEvidence: { version: 1, reviewedAssetHash: hash(prepared.teaser), verdict: vision,
        generationDurationMs: 0, reviewError,
        styleSource: { sourceId: manifest.id, scope: "source-profile-only", stage: "reviewed", profileDigest,
          imageProviderCalls: 0, criticRequests, customerActivation: "disabled" } },
    });
    if (!result.created || result.record?.assetHash !== manifest.sourceSha256 ||
        result.record.ownerToken !== row.ownerToken || result.record.eventId !== row.eventId) throw new Error("retention");
    return { kind: "reviewed-source" as const, status: result.record.status,
      attemptId: result.record.id, sourceHash: manifest.sourceSha256, reviewedAssetHash: prepared.teaserSha256,
      failureCodes, elapsedMs: Date.now() - started, imageProviderCalls: 0, criticRequests,
      scope: "source-profile-only", customerActivation: "disabled" };
  } catch { return { kind: "blocked" as const, reason: "review-retention-failed" }; }
}

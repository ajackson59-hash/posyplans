/**
 * PRIVATE Preview research boundary. No route imports this module. A reviewed
 * scene is evidence, not permission to publish it or to reuse a named asset.
 * Callers supply a server-owned certified recipe/pack; never accept them from
 * a customer request. No automatic pack selection, generation or fallback.
 */
import { createHash, randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import type { Event } from "@shared/schema";
import { OVERLAY_COVERAGE } from "@shared/aiFirstLayout";
import {
  buildQualityLockedPreviewBrief, customerVisiblePreviewBytes,
  type NamedCreativeReference,
} from "../prePaymentPreviewQuality";
import {
  SCENE_COMPOSITION_MODEL, type AiFirstArtworkAttemptStore,
} from "./artworkAttemptStore";
import { composeScenePrototype, type SceneAsset, type SceneRecipe } from "./sceneComposition";
import { retryCodesFor, runTier1Checks, type Tier1Result } from "./tier1";
import { runVisionGate, type VisionVerdict } from "./visionGate";

export type SceneReviewResult =
  | { kind: "blocked"; reason: "preview-only" | "invalid-context" | "invalid-scene" | "aborted" | "retention-failed" }
  | {
      kind: "reviewed-scene";
      status: "accepted" | "rejected";
      attemptId: string;
      sourceHash: string;
      reviewedAssetHash: string | null;
      failureCodes: string[];
      elapsedMs: number;
      customerActivation: "disabled";
    };

const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

export async function reviewSceneComposition(input: {
  event: Event;
  recipe: SceneRecipe;
  assets: readonly SceneAsset[];
  inspirationNotes?: string;
  namedReference?: NamedCreativeReference | null;
  /** One critic request, no JSON repair or image generation. Explicit per run. */
  confirmOneVisionCall: true;
}, dependencies: {
  /** Existing durable, owner-scoped attempt store; mandatory before review. */
  attemptStore: AiFirstArtworkAttemptStore;
  environment?: string;
  signal?: AbortSignal;
  reviewTimeoutMs?: number;
  client?: Anthropic;
  runTier1?: typeof runTier1Checks;
}): Promise<SceneReviewResult> {
  if ((dependencies.environment ?? process.env.VERCEL_ENV) !== "preview") {
    return { kind: "blocked", reason: "preview-only" };
  }
  const event = structuredClone(input.event);
  if (input.confirmOneVisionCall !== true || !Number.isSafeInteger(event.id) || event.id <= 0 ||
      !event.ownerToken?.trim() || !dependencies.attemptStore) {
    return { kind: "blocked", reason: "invalid-context" };
  }
  if (dependencies.signal?.aborted) return { kind: "blocked", reason: "aborted" };
  const startedAt = Date.now();
  const runId = `scene-${randomUUID()}`;
  // Freeze the complete input before any await: a changed recipe, mask or
  // brief must not alter a scene after its certificate has been checked.
  const recipe = structuredClone(input.recipe);
  const assets = input.assets.map((asset) => ({
    ...asset, png: Buffer.from(asset.png), alpha: asset.alpha?.slice(),
    certificate: structuredClone(asset.certificate),
  }));
  const { brief, concept, namedReference } = await buildQualityLockedPreviewBrief(
    event, input.inspirationNotes ?? "", input.namedReference,
  );
  let composed: ReturnType<typeof composeScenePrototype>;
  const compositionStartedAt = Date.now();
  try {
    if (dependencies.signal?.aborted) return { kind: "blocked", reason: "aborted" };
    composed = composeScenePrototype({
      brief, namedThemeId: namedReference?.id ?? null,
      ownerScope: event.ownerToken, recipe, assets,
    });
  } catch {
    return { kind: "blocked", reason: "invalid-scene" };
  }
  const compositionDurationMs = Date.now() - compositionStartedAt;
  const sourceHash = hash(composed.bytes);
  let reviewedAssetHash: string | null = null;
  let tier1: Tier1Result | undefined;
  let vision: VisionVerdict | null = null;
  let reviewError: string | undefined;
  const controller = new AbortController();
  const cancel = () => controller.abort(new Error("Scene review cancelled"));
  dependencies.signal?.addEventListener("abort", cancel, { once: true });
  let timer: ReturnType<typeof setTimeout> | undefined;
  const requestedTimeout = dependencies.reviewTimeoutMs ?? 45_000;
  const timeoutMs = Number.isFinite(requestedTimeout)
    ? Math.max(1, Math.min(60_000, requestedTimeout)) : 45_000;
  let onCancel: (() => void) | undefined;
  try {
    if (dependencies.signal?.aborted) cancel();
    if (controller.signal.aborted) throw new Error("Scene review cancelled");
    const teaser = customerVisiblePreviewBytes(composed.bytes);
    reviewedAssetHash = hash(teaser);
    tier1 = (dependencies.runTier1 ?? runTier1Checks)({
      bytes: teaser, concept, brief, overlayCoverage: OVERLAY_COVERAGE[concept.minOverlay],
      artworkOpacity: 1, layoutApplied: false, ocr: true,
    });
    if (tier1.passed) {
      const deadline = new Promise<never>((_, reject) => {
        onCancel = () => reject(new Error("Scene review cancelled or timed out"));
        controller.signal.addEventListener("abort", onCancel, { once: true });
        timer = setTimeout(cancel, timeoutMs);
      });
      vision = await Promise.race([
        runVisionGate({
          bytes: teaser, concept, brief, reviewMode: "teaser", maxFormatRepairs: 0,
          signal: controller.signal, client: dependencies.client,
        }),
        deadline,
      ]);
    }
  } catch {
    // Fixed text: do not persist SDK errors that may contain credentials.
    reviewError = "Scene preparation or review failed, was cancelled, or timed out";
  } finally {
    clearTimeout(timer);
    if (onCancel) controller.signal.removeEventListener("abort", onCancel);
    dependencies.signal?.removeEventListener("abort", cancel);
  }
  const passed = tier1?.passed === true && vision?.passed === true &&
    !vision.unavailable && !reviewError && !controller.signal.aborted && !dependencies.signal?.aborted;
  const failureCodes = passed ? [] : Array.from(new Set([
    ...(tier1 && !tier1.passed ? retryCodesFor(tier1.findings) : []),
    ...(vision?.failureCodes ?? []),
    ...(!vision || vision.unavailable || reviewError || controller.signal.aborted ? ["vision-unavailable"] : []),
  ]));
  try {
    const record = await dependencies.attemptStore.record({
      eventId: event.id, ownerToken: event.ownerToken, runId,
      idempotencyKey: runId, directionIndex: 0, attempt: 1,
      status: passed ? "accepted" : "rejected", bytes: composed.bytes,
      previewId: null, concept, failureCodes,
      tier1Findings: tier1?.findings ?? [], visionScores: vision?.scores ?? null,
      model: SCENE_COMPOSITION_MODEL, quality: "not-applicable", size: null,
      // No new image-provider request. Critic usage and source-art preparation
      // remain separate; never label this zero as the total customer cost.
      costUsdMicros: 0,
      reviewEvidence: {
        version: 1, reviewedAssetHash, verdict: vision, generationDurationMs: 0, reviewError,
        composition: {
          recipeId: recipe.id, styleId: recipe.styleId, briefDigest: composed.briefDigest,
          assetDigests: recipe.layers.map((layer) => assets.find((asset) => asset.id === layer.assetId)!.certificate.digest),
          sourceWidth: recipe.width, sourceHeight: recipe.height,
          compositionDurationMs, imageProviderCalls: 0, customerActivation: "disabled",
        },
      },
    });
    if (record.eventId !== event.id || record.ownerToken !== event.ownerToken ||
        record.assetHash !== sourceHash || !record.id) throw new Error("Retained scene mismatch");
    if (dependencies.signal?.aborted) return { kind: "blocked", reason: "aborted" };
    return {
      kind: "reviewed-scene", status: passed ? "accepted" : "rejected",
      attemptId: record.id, sourceHash, reviewedAssetHash, failureCodes,
      elapsedMs: Date.now() - startedAt, customerActivation: "disabled",
    };
  } catch {
    // Unlike the legacy generator's best-effort store, this new path cannot
    // report acceptance if its original pixels and verdict weren't retained.
    return { kind: "blocked", reason: "retention-failed" };
  }
}

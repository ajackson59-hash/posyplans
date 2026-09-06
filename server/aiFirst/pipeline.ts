// The progressive pipeline.
//
// The shape of this file is dictated by one measurement from the proof: the
// old flow spent 121 s producing a 25 KB JSON array before a single pixel was
// requested, then generated four images in lockstep and revealed nothing
// until the slowest finished. Nobody waits for that.
//
// So: concepts stream in as NDJSON, but no artwork starts until all four have
// been compared as one creative set. Only a complete, full-event, structurally
// diverse quartet may reach the image generator. Once it passes, at most two
// images are in flight and each approved direction is revealed on its own.
//
// Every progress event corresponds to something that actually happened. There
// are no timers pretending to be work.

import type Anthropic from "@anthropic-ai/sdk";
import {
  buildArtworkPrompt,
  aspectRatioForLayout,
  type AiFirstConcept,
  type ConceptSource,
} from "@shared/aiFirstInvite";
import {
  PROGRESS_MESSAGES,
  TARGET_DIRECTION_COUNT,
  type FinishedDirection,
  type PipelineEvent,
  type RunSummary,
} from "@shared/aiFirstStream";
import { OVERLAY_COVERAGE, validateLayoutBeforeGeneration } from "@shared/aiFirstLayout";
import { normalizeSemanticPalette } from "@shared/aiFirstPalette";
import { buildArtworkConstraints, buildRetryPrompt } from "./prompt";
import { runTier1Checks, retryCodesFor, type Tier1Finding } from "./tier1";
import { runVisionGate, visionCostUsd, type VisionVerdict } from "./visionGate";
import { adaptStudioDirection, loadStudioArtwork } from "./fallback";
import {
  DEFAULT_ARTWORK_MODEL,
  estimateImageCostUsdMicros,
  generateArtwork,
  sizeForAspect,
  type ArtworkGenerator,
  type ArtworkModel,
} from "./artwork";
import {
  lookupReusablePreview,
  previewAssetUrl,
  savePreview,
  type AiFirstPreviewStore,
  type PreviewRecord,
} from "./previewStore";
import { MAX_ARTWORK_CONCURRENCY, type AiFirstUsageStore, type CircuitBreaker } from "./usage";
import type { EventBrief } from "./brief";
import type { AiFirstArtworkAttemptStore } from "./artworkAttemptStore";
import type { AiFirstRunStore } from "./runStore";
import { CONCEPT_MODEL, runConceptOnlyProof } from "./conceptOnlyProof";
import { briefForHostDirection } from "./conceptPreflight";

export { CONCEPT_MODEL };
export const TARGET_CONCEPT_COUNT = TARGET_DIRECTION_COUNT;
/** One retry maximum per direction, when the automatic retry is enabled. */
export const MAX_ARTWORK_ATTEMPTS = 2;
/** The next-proof safety setting: one billed image call, no automatic retry. */
export const MAX_ARTWORK_ATTEMPTS_NO_RETRY = 1;

/* ── Progress events ─────────────────────────────────────────────────── */

export { PROGRESS_MESSAGES };
export type { PipelineEvent, FinishedDirection, RunSummary };

export type EventSink = (event: PipelineEvent) => void;

/** `Omit` collapses a union into its common keys; this preserves the arms. */
type Unstamped<T> = T extends unknown ? Omit<T, "at"> : never;
type PipelineEventInput = Unstamped<PipelineEvent>;

/* ── Results ─────────────────────────────────────────────────────────── */

export interface AttemptRecord {
  attempt: number;
  tier1: { passed: boolean; findings: Tier1Finding[]; durationMs: number };
  vision?: Pick<VisionVerdict, "scores" | "requiredPresent" | "excludedFound" | "passed" | "failureCodes" | "unavailable" | "notes">;
  failureCodes: string[];
  billed: boolean;
  durationMs: number;
}

/* ── Input ───────────────────────────────────────────────────────────── */

export interface PipelineInput {
  eventId: number;
  email?: string;
  brief: EventBrief;
  direction?: string;
  avoidConceptNames?: string[];
  keepConstraints?: string[];
  previewStore: AiFirstPreviewStore;
  usageStore: AiFirstUsageStore;
  /** Billed images this run may buy. Enforced by the caller's guard. */
  allowance: number;
  sink: EventSink;
  breaker?: CircuitBreaker;
  /** Injectable for tests. Production uses the server-selected image model. */
  generateImage?: ArtworkGenerator;
  anthropic?: Anthropic;
  /** Off in unit tests; on in production. */
  ocr?: boolean;
  signal?: AbortSignal;
  /**
   * Identifies this run for idempotency. Required so a duplicate click or a
   * duplicate request landing on a second server instance can be recognized
   * as the same run rather than a second one — see server/aiFirst/runStore.ts.
   * Optional only so existing direct-pipeline tests/tools that predate this
   * repair keep compiling; the route always supplies one.
   */
  runId?: string;
  ownerToken?: string;
  /** Durable retention of every billed provider result (accepted AND rejected) for protected review. */
  artworkAttemptStore?: AiFirstArtworkAttemptStore;
  /** Durable run/idempotency state. See runStore.ts. */
  runStore?: AiFirstRunStore;
  /** The next-proof safety setting: caps every direction at one billed image call. */
  disableAutomaticRetry?: boolean;
  /** Review-only cap. Product default remains four directions. */
  directionLimit?: number;
  /** Provider model selected by the server and recorded with every billed result. */
  artworkModel?: ArtworkModel;
}

/* ── Bounded-concurrency helper ──────────────────────────────────────── */

class Semaphore {
  private available: number;
  private waiting: (() => void)[] = [];

  constructor(size: number) {
    this.available = size;
  }

  async acquire(): Promise<() => void> {
    if (this.available > 0) {
      this.available -= 1;
      return () => this.release();
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
    return () => this.release();
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.available += 1;
  }
}

/* ── The run ─────────────────────────────────────────────────────────── */

export async function runAiFirstPipeline(input: PipelineInput): Promise<RunSummary> {
  input = { ...input, brief: briefForHostDirection(input.brief, input.direction) };
  const started = Date.now();
  const sink = input.sink;
  const emit = (event: PipelineEventInput) => {
    sink({ ...event, at: Date.now() } as PipelineEvent);
    // Mirrored into durable run state so the server's own record of "where
    // is this run" survives past this one HTTP response — the UI's progress
    // text and the recovery path after an unexpected disconnect both read
    // this instead of trusting only the stream that may have just dropped.
    if (input.runStore && input.runId && event.type === "progress") {
      void input.runStore.updateProgress(input.runId, event.message);
    }
  };
  const since = () => Date.now() - started;

  const generateImage = input.generateImage ?? generateArtwork;
  const summary: RunSummary = {
    directions: 0,
    adaptedDirections: 0,
    billedImages: 0,
    reusedImages: 0,
    retries: 0,
    costUsd: 0,
    msToFirstConcept: null,
    msToFirstDirection: null,
    msToAllDirections: null,
    conceptRejections: 0,
    degraded: [],
  };

  emit({ type: "progress", message: PROGRESS_MESSAGES.understanding });

  const semaphore = new Semaphore(MAX_ARTWORK_CONCURRENCY);
  const usedThemeIds: string[] = [];
  const inFlight: Promise<void>[] = [];
  let startedDirections = 0;
  let budgetRemaining = input.allowance;
  const directionLimit = Math.max(1, Math.min(TARGET_CONCEPT_COUNT, input.directionLimit ?? TARGET_CONCEPT_COUNT));

  const startDirection = (index: number, concept: AiFirstConcept) => {
    startedDirections += 1;
    emit({
      type: "progress",
      message: startedDirections === 1 ? PROGRESS_MESSAGES.firstDirection : PROGRESS_MESSAGES.anotherDirection,
    });
    usedThemeIds.push(concept.baseThemeId);

    inFlight.push(
      (async () => {
        const release = await semaphore.acquire();
        try {
          const finished = await resolveDirection({
            index,
            concept,
            input,
            generateImage,
            summary,
            usedThemeIds,
            spend: {
              take: () => {
                if (budgetRemaining <= 0) return false;
                budgetRemaining -= 1;
                return true;
              },
            },
            emit,
            startedAt: started,
          });
          summary.directions += 1;
          if (finished.source === "adapted-studio-direction") summary.adaptedDirections += 1;
          if (summary.msToFirstDirection === null) summary.msToFirstDirection = since();
          emit({ type: "direction", direction: finished });
        } catch (err) {
          if (isAbortError(err) || input.signal?.aborted) throw err;
          emit({ type: "warning", message: `direction ${index + 1} could not be completed: ${(err as Error).message}` });
        } finally {
          release();
        }
      })(),
    );
  };

  /* Concepts — streamed for latency, compared as a complete set before spend. */
  try {
    const proof = await runConceptOnlyProof({
      brief: input.brief,
      direction: input.direction,
      avoidConceptNames: input.avoidConceptNames,
      keepConstraints: input.keepConstraints,
      anthropic: input.anthropic,
      signal: input.signal,
      onFirstConcept: () => {
        if (summary.msToFirstConcept === null) summary.msToFirstConcept = since();
      },
      onReviewingConcepts: () => emit({ type: "progress", message: PROGRESS_MESSAGES.reviewingConcepts }),
      onPreflightWarning: (error) =>
        emit({ type: "warning", message: `creative set blocked before artwork spend: ${error}` }),
    });
    summary.conceptRejections = proof.conceptRejections;
    proof.concepts.forEach((concept, index) => emit({ type: "concept", index, concept }));
    proof.concepts.slice(0, directionLimit).forEach((concept, index) => startDirection(index, concept));
  } catch (err) {
    await Promise.allSettled(inFlight);
    if (isAbortError(err) || input.signal?.aborted) throw abortError(input.signal?.reason);
    throw new Error(`concept generation failed: ${(err as Error).message}`);
  }

  emit({ type: "progress", message: PROGRESS_MESSAGES.finishing });
  await Promise.all(inFlight);
  throwIfAborted(input.signal);

  // A run cannot be complete when it produced no applicable preview. A
  // direction task can fail after a paid image attempt (for example while
  // loading or persisting its curated fallback). Treating zero delivered
  // cards as success is both misleading and a spend risk: the host sees
  // nothing and reasonably clicks again. Throw before the durable complete
  // write so the route records one visible failed terminal instead.
  if (summary.directions === 0) {
    throw new Error(
      `invitation generation delivered ${summary.directions} of ${directionLimit} promised directions`,
    );
  } else if (summary.directions < directionLimit) {
    summary.degraded.push(`only ${summary.directions} of ${directionLimit} directions completed`);
  } else {
    emit({
      type: "progress",
      message: directionLimit === 1 ? "Your review direction is ready." : PROGRESS_MESSAGES.ready,
    });
  }

  summary.msToAllDirections = since();
  // Marks the run terminal in durable state. This is the write the client's
  // unexpected-EOF check ultimately depends on: if the HTTP response is cut
  // off before this line runs, the row stays non-terminal and a client that
  // asks the server "did that run finish" (or a fresh page load that resumes
  // it) is told the truth rather than inferring success from stream closure.
  if (input.runStore && input.runId) await input.runStore.complete(input.runId);
  emit({ type: "done", summary });
  return summary;
}

/* ── One direction ───────────────────────────────────────────────────── */

interface ResolveInput {
  index: number;
  concept: AiFirstConcept;
  input: PipelineInput;
  generateImage: ArtworkGenerator;
  summary: RunSummary;
  usedThemeIds: string[];
  spend: { take: () => boolean };
  emit: (event: PipelineEventInput) => void;
  startedAt: number;
}

async function resolveDirection(ctx: ResolveInput): Promise<FinishedDirection> {
  const { input, summary } = ctx;
  const attempts: AttemptRecord[] = [];

  // Layout compatibility is checked BEFORE generation, so an incompatible
  // pairing is repaired rather than paid for and then rejected.
  let repair = validateLayoutBeforeGeneration(ctx.concept);
  let concept: AiFirstConcept = { ...ctx.concept, layoutStyle: repair.layoutStyle, minOverlay: repair.overlay };
  const normalized = normalizeSemanticPalette(concept.semanticPalette);
  if (normalized.fixes.some((f) => f.changed)) {
    concept = {
      ...concept,
      semanticPalette: {
        textSurface: concept.semanticPalette.textSurface,
        headlineColor: normalized.fixes.find((f) => f.role === "headlineColor")?.after ?? concept.semanticPalette.headlineColor,
        bodyColor: normalized.fixes.find((f) => f.role === "bodyColor")?.after ?? concept.semanticPalette.bodyColor,
        accentColor: normalized.fixes.find((f) => f.role === "accentColor")?.after ?? concept.semanticPalette.accentColor,
      },
    };
  }
  let artworkOpacity = repair.artworkOpacity;

  // Reuse before spend. This is what makes restyling free.
  const reusable = await lookupReusablePreview(input.previewStore, input.eventId, concept);
  if (reusable) {
    summary.reusedImages += 1;
    await input.usageStore.record({
      eventId: input.eventId,
      email: input.email,
      reason: "reuse",
      billed: false,
      automatic: false,
      conceptFingerprint: reusable.conceptFingerprint,
      previewId: reusable.previewId,
      reuseOf: reusable.previewId,
      costUsdMicros: 0,
      createdAt: Date.now(),
    });
    return finish(ctx, concept, reusable, "ai-generated", attempts, artworkOpacity, true);
  }

  const basePrompt = `${buildArtworkPrompt(concept)}\n\n${buildArtworkConstraints(input.brief)}`;
  let failureCodes: string[] = [];

  // The next-proof safety setting: when set, a direction gets exactly one
  // billed image call. Preserves the existing one-retry behaviour when unset.
  const maxAttempts = input.disableAutomaticRetry ? MAX_ARTWORK_ATTEMPTS_NO_RETRY : MAX_ARTWORK_ATTEMPTS;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    throwIfAborted(input.signal);
    if (input.breaker && !input.breaker.allows()) {
      summary.degraded.push("provider circuit open");
      break;
    }

    // The key is stable for (run, direction, attempt). The durable reservation
    // below is the spend boundary: it must commit before network I/O, and a
    // crash/resume or competing process that finds it must not buy again.
    const idempotencyKey = input.runId ? `${input.runId}:direction-${ctx.index}:attempt-${attempt}` : undefined;

    if (!ctx.spend.take()) {
      summary.degraded.push("billed-image allowance exhausted");
      break;
    }

    const attemptStarted = Date.now();
    const prompt = attempt === 1 ? basePrompt : buildRetryPrompt(basePrompt, failureCodes);
    const aspectRatio = aspectRatioForLayout(concept.layoutStyle);
    const artworkModel = input.artworkModel ?? DEFAULT_ARTWORK_MODEL;
    const artworkQuality = "high" as const;
    const artworkSize = sizeForAspect(aspectRatio);
    const imageCostUsdMicros = estimateImageCostUsdMicros(artworkModel, artworkQuality, artworkSize);
    const reserved = await input.usageStore.reserveProviderAttempt({
      eventId: input.eventId,
      email: input.email,
      reason: attempt === 1 ? "initial" : "quality-retry",
      // Once the request can reach the provider, billing is conservatively
      // treated as possible. A transport failure cannot prove it was free.
      billed: true,
      automatic: attempt > 1,
      conceptFingerprint: undefined,
      idempotencyKey,
      costUsdMicros: imageCostUsdMicros,
      createdAt: Date.now(),
    });
    if (!reserved) {
      summary.degraded.push(
        `direction ${ctx.index + 1} attempt ${attempt} was already reserved under this run — skipped rather than spent twice`,
      );
      break;
    }

    summary.billedImages += 1;
    // This is an image-output estimate. The provider also bills prompt/input
    // tokens, which are not knowable at the pre-call reservation boundary.
    summary.costUsd += imageCostUsdMicros / 1_000_000;
    if (attempt > 1) summary.retries += 1;

    let bytes: Buffer;
    let dataUrl: string;
    try {
      const art = await ctx.generateImage({
        prompt,
        aspectRatio,
        model: artworkModel,
        quality: artworkQuality,
        signal: input.signal,
      });
      bytes = art.bytes;
      dataUrl = art.dataUrl;
      input.breaker?.recordSuccess();
    } catch (err) {
      if (isAbortError(err) || input.signal?.aborted) throw abortError(input.signal?.reason);
      input.breaker?.recordFailure();
      attempts.push({
        attempt,
        tier1: { passed: false, findings: [], durationMs: 0 },
        failureCodes: ["provider-error"],
        // The request crossed the provider boundary. Billing is uncertain,
        // so the durable reservation remains billed and no automatic retry
        // may follow it.
        billed: true,
        durationMs: Date.now() - attemptStarted,
      });
      summary.degraded.push(`direction ${ctx.index + 1} provider result was uncertain; automatic retry blocked`);
      ctx.emit({
        type: "warning",
        message: `artwork attempt ${attempt} did not return safely; no automatic retry was made: ${(err as Error).message}`,
      });
      break;
    }

    // Tier 1 first: it is free, and it catches most of what actually breaks.
    let tier1 = runTier1Checks({
      bytes,
      concept,
      brief: input.brief,
      overlayCoverage: OVERLAY_COVERAGE[repair.overlay],
      artworkOpacity: artworkOpacity ?? 1,
      ocr: input.ocr,
    });

    // A split layout crops a portrait image down to a very narrow panel. If
    // that is the image's only critical defect, try the exact same paid bytes
    // in a compatible existing portrait layout before discarding them. This
    // is composition repair, not a retry: no image provider is called.
    if (onlyCriticalFailureIs(tier1.findings, "crop-unsafe")) {
      for (const layoutStyle of cropRescueLayouts(concept.layoutStyle)) {
        const candidateRepair = validateLayoutBeforeGeneration({ ...concept, layoutStyle });
        const candidateConcept: AiFirstConcept = {
          ...concept,
          layoutStyle: candidateRepair.layoutStyle,
          minOverlay: candidateRepair.overlay,
        };
        if (aspectRatioForLayout(candidateConcept.layoutStyle) !== aspectRatio) continue;
        const candidateTier1 = runTier1Checks({
          bytes,
          concept: candidateConcept,
          brief: input.brief,
          overlayCoverage: OVERLAY_COVERAGE[candidateRepair.overlay],
          artworkOpacity: candidateRepair.artworkOpacity ?? 1,
          ocr: input.ocr,
        });
        if (!candidateTier1.passed) continue;
        concept = candidateConcept;
        repair = candidateRepair;
        artworkOpacity = candidateRepair.artworkOpacity;
        tier1 = candidateTier1;
        summary.degraded.push(
          `direction ${ctx.index + 1} reused its paid artwork in ${candidateConcept.layoutStyle} after a crop-only layout failure`,
        );
        break;
      }
    }

    // If the paid pixels are otherwise sound, strengthen only the local live-
    // type surface and re-evaluate the exact same bytes. This is a deterministic
    // composition repair, not an image retry: no provider call and no second
    // ledger reservation. The renderer and Tier 1 share the same surface-
    // opacity contract, so a pass here is evidence about the final card.
    if (onlyCriticalFailureIs(tier1.findings, "quiet-region") && repair.overlay !== "plate") {
      const candidateConcept: AiFirstConcept = { ...concept, minOverlay: "plate" };
      const candidateRepair = validateLayoutBeforeGeneration(candidateConcept);
      const candidateTier1 = runTier1Checks({
        bytes,
        concept: candidateConcept,
        brief: input.brief,
        overlayCoverage: OVERLAY_COVERAGE[candidateRepair.overlay],
        artworkOpacity: candidateRepair.artworkOpacity ?? artworkOpacity ?? 1,
        ocr: input.ocr,
      });
      if (candidateTier1.passed) {
        concept = candidateConcept;
        repair = candidateRepair;
        artworkOpacity = candidateRepair.artworkOpacity ?? artworkOpacity;
        tier1 = candidateTier1;
        summary.degraded.push(
          `direction ${ctx.index + 1} reused its paid artwork with a deterministic paper panel after a quiet-region-only failure`,
        );
      }
    }

    let vision: VisionVerdict | undefined;
    if (tier1.passed) {
      vision = await runVisionGate({ bytes, concept, brief: input.brief, client: input.anthropic });
      summary.costUsd += visionCostUsd(vision.usage);
      if (vision.unavailable) summary.degraded.push(`vision gate unavailable: ${vision.notes}`);
    }

    const passed = tier1.passed && vision?.passed === true;
    failureCodes = tier1.passed
      ? (vision?.unavailable ? ["vision-unavailable"] : (vision?.failureCodes ?? ["vision-unavailable"]))
      : retryCodesFor(tier1.findings);

    attempts.push({
      attempt,
      tier1: { passed: tier1.passed, findings: tier1.findings, durationMs: tier1.durationMs },
      vision: vision
        ? {
            scores: vision.scores,
            requiredPresent: vision.requiredPresent,
            excludedFound: vision.excludedFound,
            passed: vision.passed,
            failureCodes: vision.failureCodes,
            unavailable: vision.unavailable,
            notes: vision.notes,
          }
        : undefined,
      failureCodes: passed ? [] : failureCodes,
      billed: true,
      durationMs: Date.now() - attemptStarted,
    });

    if (passed) {
      const saved = await savePreview({
        store: input.previewStore,
        eventId: input.eventId,
        concept,
        bytes,
        assetUrl: dataUrl,
        source: "ai-generated",
      });
      // Every billed provider result is retained for protected review —
      // accepted and rejected alike — so a reviewer can audit an entire run,
      // not just its failures. Never reachable from an ordinary user route;
      // see artworkAttemptStore.ts and the owner-scoped review routes.
      if (input.artworkAttemptStore && input.ownerToken) {
        await input.artworkAttemptStore.record({
          eventId: input.eventId,
          ownerToken: input.ownerToken,
          runId: input.runId ?? null,
          idempotencyKey: idempotencyKey ?? null,
          directionIndex: ctx.index,
          attempt,
          status: "accepted",
          bytes,
          previewId: saved.record.previewId,
          concept,
          failureCodes: [],
          tier1Findings: tier1.findings,
          visionScores: vision?.scores ?? null,
          model: artworkModel,
          quality: artworkQuality,
          size: artworkSize,
          costUsdMicros: imageCostUsdMicros,
        });
      }
      if (input.runStore && input.runId) await input.runStore.incrementCompleted(input.runId);
      return finish(ctx, concept, saved.record, "ai-generated", attempts, artworkOpacity, false);
    }

    // Rejected, but billed: durably retain it for protected reviewer
    // evidence. This is money spent on an image nobody will ever see, and
    // before this store existed that fact evaporated at the end of the
    // request.
    if (input.artworkAttemptStore && input.ownerToken) {
      await input.artworkAttemptStore.record({
        eventId: input.eventId,
        ownerToken: input.ownerToken,
        runId: input.runId ?? null,
        idempotencyKey: idempotencyKey ?? null,
        directionIndex: ctx.index,
        attempt,
        status: "rejected",
        bytes,
        previewId: null,
        concept,
        failureCodes,
        tier1Findings: tier1.findings,
        visionScores: vision?.scores ?? null,
        model: artworkModel,
        quality: artworkQuality,
        size: artworkSize,
        costUsdMicros: imageCostUsdMicros,
      });
    }
  }

  throwIfAborted(input.signal);

  // Every attempt failed (or the safety setting allowed only one). Substitute
  // a curated direction adapted to the brief rather than showing work the
  // gate rejected.
  const adapted = adaptStudioDirection({
    concept,
    brief: input.brief,
    usedThemeIds: ctx.usedThemeIds,
    reason: failureCodes.length > 0 ? failureCodes.join(", ") : "artwork unavailable",
  });
  if (!adapted) {
    throw new Error(
      `generated artwork did not meet Posy's quality standard and no theme-safe studio fallback matches this event`,
    );
  }
  ctx.emit({
    type: "warning",
    message: `direction ${ctx.index + 1} fell back to an adapted studio direction (${adapted.reason})`,
  });

  // A substituted direction is applied by the same route as a generated one,
  // which verifies bytes by hash — so it needs a real preview record holding
  // the artwork it actually displays. The bytes come off disk; no provider
  // call is made here or on apply.
  const studioBytes = await loadStudioArtwork(adapted.theme);
  const savedStudio = await savePreview({
    store: input.previewStore,
    eventId: input.eventId,
    concept: adapted.concept,
    bytes: studioBytes,
    assetUrl: adapted.theme.artwork.fullUrl,
    source: "adapted-studio-direction",
  });

  // The fallback still delivers a customer-safe direction for this slot, so
  // it counts as completed — the UI's "completed" and "fallback" counts are
  // not mutually exclusive, matching the summary's own
  // directions/adaptedDirections split.
  if (input.runStore && input.runId) {
    // Count a fallback only after its bytes and preview record are usable.
    // An attempted fallback that throws must not be reported as delivered.
    await input.runStore.incrementFallback(input.runId);
    await input.runStore.incrementCompleted(input.runId);
  }
  return finish(ctx, adapted.concept, savedStudio.record, "adapted-studio-direction", attempts, undefined, false);
}

function onlyCriticalFailureIs(findings: Tier1Finding[], code: Tier1Finding["code"]): boolean {
  const critical = findings.filter((finding) => finding.critical);
  return critical.length === 1 && critical[0].code === code;
}

/**
 * Layouts that can reuse the same paid bytes without a second provider call,
 * because they share the same source aspect ratio (so the crop math is
 * comparable) and a compatible art-frame shape.
 *
 * `full-bleed` and `backdrop` paint the identical full-card art frame and
 * differ only in overlay opacity, which `evaluateCropSafety` does not weigh —
 * a crop that is unsafe in one is unsafe or safe in the other identically
 * except for how the salient region reads through the overlay. `split`'s art
 * panel is a much narrower slice of the same 9:16 source, so it is offered
 * as a second, lower-priority rescue rather than the first guess.
 */
export function cropRescueLayouts(layoutStyle: AiFirstConcept["layoutStyle"]): AiFirstConcept["layoutStyle"][] {
  if (layoutStyle === "split") return ["full-bleed", "backdrop"];
  if (layoutStyle === "full-bleed") return ["backdrop", "split"];
  if (layoutStyle === "backdrop") return ["full-bleed", "split"];
  return [];
}

function abortError(reason?: unknown): Error {
  if (reason instanceof Error) return reason;
  const error = new Error(typeof reason === "string" ? reason : "Invitation generation was disconnected.");
  error.name = "AbortError";
  return error;
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal.reason);
}

function finish(
  ctx: ResolveInput,
  concept: AiFirstConcept,
  record: PreviewRecord,
  source: ConceptSource,
  attempts: AttemptRecord[],
  artworkOpacity: number | undefined,
  reusedPreview: boolean,
): FinishedDirection {
  // The wire value is a small, owner-scoped route — never the raw stored
  // bytes. Callers that do not carry an ownerToken (older direct-pipeline
  // tests and tools) fall back to the stored value so they keep compiling,
  // but every caller that goes through the real HTTP route supplies one.
  const illustrationUrl = ctx.input.ownerToken
    ? previewAssetUrl(ctx.input.ownerToken, record.previewId)
    : record.assetUrl;
  return {
    index: ctx.index,
    concept,
    source,
    previewId: record.previewId,
    assetHash: record.assetHash,
    illustrationUrl,
    overlay: concept.minOverlay,
    artworkOpacity,
    attempts,
    reusedPreview,
    msFromStart: Date.now() - ctx.startedAt,
  };
}

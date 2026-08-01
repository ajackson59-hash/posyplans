// The progressive pipeline.
//
// The shape of this file is dictated by one measurement from the proof: the
// old flow spent 121 s producing a 25 KB JSON array before a single pixel was
// requested, then generated four images in lockstep and revealed nothing
// until the slowest finished. Nobody waits for that.
//
// So: concepts stream in as NDJSON and each one starts its artwork the moment
// it parses; at most two images are in flight at once; each direction is gated
// and revealed on its own. A direction that fails twice is replaced by an
// adapted studio direction rather than delaying or shortening the set.
//
// Every progress event corresponds to something that actually happened. There
// are no timers pretending to be work.

import Anthropic from "@anthropic-ai/sdk";
import {
  buildArtworkPrompt,
  aspectRatioForLayout,
  type AiFirstConcept,
  type ConceptSource,
} from "@shared/aiFirstInvite";
import {
  PROGRESS_MESSAGES,
  type FinishedDirection,
  type PipelineEvent,
  type RunSummary,
} from "@shared/aiFirstStream";
import { OVERLAY_COVERAGE, validateLayoutBeforeGeneration } from "@shared/aiFirstLayout";
import { normalizeSemanticPalette } from "@shared/aiFirstPalette";
import { ConceptStreamParser } from "./conceptStream";
import { buildSystemPrompt, buildUserPrompt, buildRetryPrompt } from "./prompt";
import { runTier1Checks, retryCodesFor, type Tier1Finding } from "./tier1";
import { runVisionGate, visionCostUsd, type VisionVerdict } from "./visionGate";
import { adaptStudioDirection } from "./fallback";
import { generateArtwork, type ArtworkGenerator } from "./artwork";
import {
  lookupReusablePreview,
  savePreview,
  type AiFirstPreviewStore,
  type PreviewRecord,
} from "./previewStore";
import {
  IMAGE_COST_USD_MICROS,
  MAX_ARTWORK_CONCURRENCY,
  type AiFirstUsageStore,
  type CircuitBreaker,
} from "./usage";
import type { EventBrief } from "./brief";

export const CONCEPT_MODEL = "claude-sonnet-4-6";
export const TARGET_CONCEPT_COUNT = 4;
/** One retry maximum per direction, as specified. */
export const MAX_ARTWORK_ATTEMPTS = 2;

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
  /** Injectable for tests. Production uses gpt-image-1. */
  generateImage?: ArtworkGenerator;
  anthropic?: Anthropic;
  /** Off in unit tests; on in production. */
  ocr?: boolean;
  signal?: AbortSignal;
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
  const started = Date.now();
  const sink = input.sink;
  const emit = (event: PipelineEventInput) => sink({ ...event, at: Date.now() } as PipelineEvent);
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
          emit({ type: "warning", message: `direction ${index + 1} could not be completed: ${(err as Error).message}` });
        } finally {
          release();
        }
      })(),
    );
  };

  /* Concepts — streamed, so artwork starts before the model has finished. */
  const client = input.anthropic ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const parser = new ConceptStreamParser();

  try {
    const stream = await client.messages.stream({
      model: CONCEPT_MODEL,
      max_tokens: 4000,
      system: buildSystemPrompt(),
      messages: [
        {
          role: "user",
          content: buildUserPrompt({
            brief: input.brief,
            direction: input.direction,
            avoidConceptNames: input.avoidConceptNames,
            keepConstraints: input.keepConstraints,
          }),
        },
      ],
    });

    for await (const chunk of stream) {
      if (input.signal?.aborted) break;
      if (chunk.type !== "content_block_delta" || chunk.delta.type !== "text_delta") continue;
      for (const line of parser.push(chunk.delta.text)) {
        if (summary.msToFirstConcept === null) summary.msToFirstConcept = since();
        emit({ type: "concept", index: line.index, concept: line.concept });
        if (line.index < TARGET_CONCEPT_COUNT) startDirection(line.index, line.concept);
      }
    }
    for (const line of parser.flush()) {
      if (summary.msToFirstConcept === null) summary.msToFirstConcept = since();
      emit({ type: "concept", index: line.index, concept: line.concept });
      if (line.index < TARGET_CONCEPT_COUNT) startDirection(line.index, line.concept);
    }
  } catch (err) {
    emit({ type: "error", message: `concept generation failed: ${(err as Error).message}` });
    summary.degraded.push("concept-stream-failed");
  }

  summary.conceptRejections = parser.rejections.length;

  emit({ type: "progress", message: PROGRESS_MESSAGES.finishing });
  await Promise.all(inFlight);

  // The set is only short if the model itself under-delivered; the per-
  // direction fallback has already covered every artwork failure.
  if (summary.directions < TARGET_CONCEPT_COUNT) {
    summary.degraded.push(`only ${summary.directions} of ${TARGET_CONCEPT_COUNT} directions completed`);
  } else {
    emit({ type: "progress", message: PROGRESS_MESSAGES.ready });
  }

  summary.msToAllDirections = since();
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
  const repair = validateLayoutBeforeGeneration(ctx.concept);
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
  const artworkOpacity = repair.artworkOpacity;

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

  const basePrompt = buildArtworkPrompt(concept);
  let failureCodes: string[] = [];

  for (let attempt = 1; attempt <= MAX_ARTWORK_ATTEMPTS; attempt += 1) {
    if (input.signal?.aborted) break;
    if (input.breaker && !input.breaker.allows()) {
      summary.degraded.push("provider circuit open");
      break;
    }
    if (!ctx.spend.take()) {
      summary.degraded.push("billed-image allowance exhausted");
      break;
    }

    const attemptStarted = Date.now();
    const prompt = attempt === 1 ? basePrompt : buildRetryPrompt(basePrompt, failureCodes);
    if (attempt > 1) summary.retries += 1;

    let bytes: Buffer;
    let dataUrl: string;
    try {
      const art = await ctx.generateImage({
        prompt,
        aspectRatio: aspectRatioForLayout(concept.layoutStyle),
        quality: "high",
        signal: input.signal,
      });
      bytes = art.bytes;
      dataUrl = art.dataUrl;
      input.breaker?.recordSuccess();
    } catch (err) {
      input.breaker?.recordFailure();
      attempts.push({
        attempt,
        tier1: { passed: false, findings: [], durationMs: 0 },
        failureCodes: ["provider-error"],
        billed: false,
        durationMs: Date.now() - attemptStarted,
      });
      ctx.emit({ type: "warning", message: `artwork attempt ${attempt} failed: ${(err as Error).message}` });
      continue;
    }

    summary.billedImages += 1;
    summary.costUsd += IMAGE_COST_USD_MICROS / 1_000_000;
    await input.usageStore.record({
      eventId: input.eventId,
      email: input.email,
      reason: attempt === 1 ? "initial" : "quality-retry",
      billed: true,
      // An automatic retry is spend, never a host-visible action.
      automatic: attempt > 1,
      conceptFingerprint: undefined,
      costUsdMicros: IMAGE_COST_USD_MICROS,
      createdAt: Date.now(),
    });

    // Tier 1 first: it is free, and it catches most of what actually breaks.
    const tier1 = runTier1Checks({
      bytes,
      concept,
      overlayCoverage: OVERLAY_COVERAGE[repair.overlay],
      artworkOpacity: artworkOpacity ?? 1,
      ocr: input.ocr,
    });

    let vision: VisionVerdict | undefined;
    if (tier1.passed) {
      vision = await runVisionGate({ bytes, concept, brief: input.brief, client: input.anthropic });
      summary.costUsd += visionCostUsd(vision.usage);
      if (vision.unavailable) summary.degraded.push(`vision gate unavailable: ${vision.notes}`);
    }

    const passed = tier1.passed && vision?.passed === true;
    failureCodes = tier1.passed ? (vision?.failureCodes ?? ["vision-unavailable"]) : retryCodesFor(tier1.findings);

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
      return finish(ctx, concept, saved.record, "ai-generated", attempts, artworkOpacity, false);
    }
  }

  // Both attempts failed. Substitute a curated direction adapted to the
  // brief rather than showing work the gate rejected.
  const adapted = adaptStudioDirection({
    concept,
    brief: input.brief,
    usedThemeIds: ctx.usedThemeIds,
    reason: failureCodes.length > 0 ? failureCodes.join(", ") : "artwork unavailable",
  });
  ctx.emit({
    type: "warning",
    message: `direction ${ctx.index + 1} fell back to an adapted studio direction (${adapted.reason})`,
  });

  return {
    index: ctx.index,
    concept: adapted.concept,
    source: "adapted-studio-direction",
    previewId: `studio-${adapted.theme.id}`,
    assetHash: "",
    illustrationUrl: adapted.theme.artwork.fullUrl,
    overlay: adapted.concept.minOverlay,
    artworkOpacity: undefined,
    attempts,
    reusedPreview: false,
    msFromStart: Date.now() - ctx.startedAt,
  };
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
  return {
    index: ctx.index,
    concept,
    source,
    previewId: record.previewId,
    assetHash: record.assetHash,
    illustrationUrl: record.assetUrl,
    overlay: concept.minOverlay,
    artworkOpacity,
    attempts,
    reusedPreview,
    msFromStart: Date.now() - ctx.startedAt,
  };
}

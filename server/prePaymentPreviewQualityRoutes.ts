import type { Express } from "express";
import type { Event } from "@shared/schema";
import { waitUntil } from "@vercel/functions";
import { z } from "zod";
import { storage } from "./storage";
import { DbArtworkAttemptStore } from "./aiFirst/dbStore";
import type { AiFirstArtworkAttemptStore } from "./aiFirst/artworkAttemptStore";
import { canGenerateDraft } from "./masterPlannerEntitlement";
import {
  type ArtworkReferenceImage,
  type ArtworkReferenceMimeType,
} from "./aiFirst/artwork";
import { boxDownsampleRgb, decodePng, encodePng, PngDecodeError } from "./aiFirst/png";
import {
  PRE_PAYMENT_PREVIEW_LONG_EDGE,
  canAttemptPrePaymentPreview,
} from "./prePaymentPreview";
import {
  isReferenceBoardDataUrl,
  referenceBoardDataUrl,
} from "./prePaymentReferenceBoard";
import {
  namedReferenceAutoResolutionEnabled,
  resolveNamedCreativeReference,
  type ResolvedNamedReference,
} from "./namedReferenceResolver";
import {
  PREPAYMENT_PREVIEW_QUALITY_LOCK_CUTOFF_MS,
  buildDirectionCard,
  detectNamedCreativeReference,
  detectNamedCreativeReferenceSync,
  directionCardDataUrl,
  generateQualityLockedPreview,
  readPrePaymentPreviewMode,
  type DirectionCard,
  type NamedCreativeReference,
  type PrePaymentPreviewMode,
  type PreviewQualityDependencies,
  type PreviewQualityReview,
} from "./prePaymentPreviewQuality";

/**
 * Compact, log-safe summary of why the pipeline did not return an approved
 * image. Full per-candidate tier1/vision evidence lives in
 * artworkAttemptStore; this keeps the reason legible in the warn log
 * itself without duplicating that evidence or growing unbounded.
 */
function summarizeRejectionForLog(reviews: PreviewQualityReview[]): unknown {
  if (reviews.length === 0) return null;
  const last = reviews[reviews.length - 1];
  return {
    candidates: reviews.length,
    lastFailureCodes: last.failureCodes,
    lastNotes: last.notes || undefined,
  };
}

const requestSchema = z.object({
  email: z.string().trim().email().max(254),
  inspirationImages: z
    .array(z.string().max(3_500_000).startsWith("data:image/"))
    .max(2)
    .optional()
    .default([]),
});

export interface PrePaymentPreviewQualityStorage {
  getEventByOwnerToken(ownerToken: string): Promise<Event | undefined>;
  updateEventById(eventId: number, data: Partial<Event>): Promise<Event | undefined>;
}

export type PreviewBackgroundScheduler = (task: () => Promise<void>) => void;

export interface PrePaymentPreviewQualityRouteDependencies {
  store?: PrePaymentPreviewQualityStorage;
  isUnlocked?: (event: Event) => Promise<boolean>;
  mode?: () => PrePaymentPreviewMode;
  autoNamedEnabled?: () => boolean;
  classifyNamedReference?: (text: string) => Promise<NamedCreativeReference | null>;
  resolveNamedReference?: typeof resolveNamedCreativeReference;
  generate?: (
    event: Event,
    dependencies?: PreviewQualityDependencies,
  ) => ReturnType<typeof generateQualityLockedPreview>;
  schedule?: PreviewBackgroundScheduler;
  now?: () => number;
  jobTimeoutMs?: number;
  /**
   * Every billed pre-payment preview candidate — accepted or rejected — is
   * durably retained here for protected owner-scoped review, the same store
   * and the same /ai-first/review/attempts routes the main AI-first
   * pipeline already uses. Before this was wired in, a rejected candidate's
   * tier1/vision findings only ever reached a compact warn log for the
   * duration of that one request. Defaults to the real DB-backed store so
   * production gets retention automatically; tests can inject an in-memory
   * one or omit it entirely (retention is best-effort and optional).
   */
  artworkAttemptStore?: AiFirstArtworkAttemptStore;
}

export type PreviewAssetKind = "direction-card" | "reference-board" | "approved-image" | "none";
type PreviewGenerationState = "idle" | "generating" | "ready" | "fallback";

const QUALITY_APPROVED_PNG_PREFIX = "data:image/png;posy-quality-approved;base64,";
const STANDARD_PNG_PREFIX = "data:image/png;base64,";
// The direction card is returned immediately, so this is a background quality
// budget rather than customer-blocking latency. Live medium renders took about
// 55 seconds and a high render exceeded 115; preserve enough of Vercel's
// 300-second function window for exact-pixel review and one private correction.
export const PREPAYMENT_PREVIEW_JOB_TIMEOUT_MS = 240_000;
const GENERAL_CLASSIFIER_TIMEOUT_MS = 7_500;
const REFERENCE_RESOLUTION_TIMEOUT_MS = 12_000;
const BACKGROUND_STALE_MS = PREPAYMENT_PREVIEW_JOB_TIMEOUT_MS + 15_000;
const POLL_AFTER_MS = 2500;

class PrePaymentPreviewDeadlineError extends Error {
  constructor(stage: string) {
    super(`${stage} exceeded Posy's preview deadline`);
    this.name = "PrePaymentPreviewDeadlineError";
  }
}

function withPreviewDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
  stage: string,
  onTimeout?: (error: PrePaymentPreviewDeadlineError) => void,
): Promise<T> {
  const boundedMs = Math.max(1, Math.floor(timeoutMs));
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new PrePaymentPreviewDeadlineError(stage);
      onTimeout?.(error);
      reject(error);
    }, boundedMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function isSvgDataUrl(value: string | null | undefined): boolean {
  return Boolean(
    value?.startsWith("data:image/svg+xml;base64,")
      || isReferenceBoardDataUrl(value),
  );
}

function svgPayload(value: string): string | null {
  const marker = ";base64,";
  const index = value.indexOf(marker);
  if (!isSvgDataUrl(value) || index < 0) return null;
  return value.slice(index + marker.length);
}

function qualityApprovedDataUrl(value: string): string | null {
  if (value.startsWith(QUALITY_APPROVED_PNG_PREFIX)) return value;
  if (!value.startsWith(STANDARD_PNG_PREFIX)) return null;
  return `${QUALITY_APPROVED_PNG_PREFIX}${value.slice(STANDARD_PNG_PREFIX.length)}`;
}

function qualityApprovedPayload(value: string | null | undefined): string | null {
  if (!value?.startsWith(QUALITY_APPROVED_PNG_PREFIX)) return null;
  return value.slice(QUALITY_APPROVED_PNG_PREFIX.length);
}

const MAX_REFERENCE_IMAGE_BYTES = 2_500_000;
const REFERENCE_DATA_URL = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\r\n]+)$/;

function referenceImagesFromDataUrls(values: string[]): ArtworkReferenceImage[] {
  return values.map((value, index) => {
    const match = REFERENCE_DATA_URL.exec(value);
    if (!match) throw new Error("unsupported reference image");
    const mimeType = match[1] as ArtworkReferenceMimeType;
    const bytes = Buffer.from(match[2].replace(/\s/g, ""), "base64");
    if (bytes.length === 0 || bytes.length > MAX_REFERENCE_IMAGE_BYTES) {
      throw new Error("reference image size is invalid");
    }
    const extension = mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1];
    return { bytes, mimeType, filename: `host-reference-${index + 1}.${extension}` };
  });
}

function eventNamedReferenceBrief(event: Event): string {
  return [event.eventName, event.eventType, event.themeName, event.vibeDescription]
    .filter(Boolean)
    .join(" ");
}

/**
 * Curated-only, synchronous, network-free. Used by every pure read path
 * (readiness polling, asset delivery, direction-card rendering) so an
 * ordinary page load or poll never pays for or awaits a model call.
 */
function namedReferenceForEventSync(event: Event): NamedCreativeReference | null {
  return detectNamedCreativeReferenceSync(eventNamedReferenceBrief(event));
}

function imageIsCurrent(event: Event): boolean {
  return Boolean(qualityApprovedPayload(event.prePaymentPreviewUrl))
    && (event.prePaymentPreviewUsedAt ?? 0) >= PREPAYMENT_PREVIEW_QUALITY_LOCK_CUTOFF_MS;
}

export function prePaymentPreviewAssetKind(event: Event): PreviewAssetKind {
  if (isReferenceBoardDataUrl(event.prePaymentPreviewUrl)) return "reference-board";
  if (isSvgDataUrl(event.prePaymentPreviewUrl)) return "direction-card";
  if (imageIsCurrent(event)) return "approved-image";
  return "none";
}

function backgroundIsStale(event: Event, timestamp: number): boolean {
  if (prePaymentPreviewAssetKind(event) !== "none" || event.prePaymentPreviewAttempts <= 0) return false;
  const startedAt = event.prePaymentPreviewUsedAt ?? 0;
  return startedAt <= 0 || timestamp - startedAt >= BACKGROUND_STALE_MS;
}

function generationState(
  event: Event,
  kind: PreviewAssetKind,
  timestamp: number,
): PreviewGenerationState {
  if (kind === "none" && event.prePaymentPreviewAttempts > 0) {
    return backgroundIsStale(event, timestamp) ? "fallback" : "generating";
  }
  if (kind === "direction-card" && event.prePaymentPreviewAttempts > 0) return "fallback";
  if (kind !== "none") return "ready";
  return "idle";
}

async function defaultUnlocked(event: Event): Promise<boolean> {
  const access = await canGenerateDraft(event.id);
  return access.ok;
}

function defaultSchedule(task: () => Promise<void>): void {
  const promise = task();
  try {
    waitUntil(promise);
  } catch (error) {
    // Local development and unit tests do not provide Vercel's request
    // context. The promise has already started, so keep it alive in-process.
    console.warn("[prepayment-preview] waitUntil unavailable; using in-process background task", error);
    void promise;
  }
}

async function persistDirectionCard(
  store: PrePaymentPreviewQualityStorage,
  event: Event,
  timestamp: number,
  resolvedNamed?: NamedCreativeReference | null,
): Promise<Event> {
  // directionCardDataUrl is synchronous/network-free by default (curated-only
  // detection). resolvedNamed lets the background job pass an already-paid,
  // already-awaited general-classifier result so the card correctly reflects
  // it instead of silently falling back to the generic card.
  const dataUrl = directionCardDataUrl(event, resolvedNamed);
  const updated = await store.updateEventById(event.id, {
    prePaymentPreviewUrl: dataUrl,
    prePaymentPreviewUsedAt: timestamp,
  });
  return updated ?? {
    ...event,
    prePaymentPreviewUrl: dataUrl,
    prePaymentPreviewUsedAt: timestamp,
  };
}

async function persistReferenceBoard(
  store: PrePaymentPreviewQualityStorage,
  event: Event,
  references: ArtworkReferenceImage[],
  timestamp: number,
): Promise<Event> {
  const dataUrl = await referenceBoardDataUrl(event, references);
  const updated = await store.updateEventById(event.id, {
    prePaymentPreviewUrl: dataUrl,
    prePaymentPreviewUsedAt: timestamp,
  });
  return updated ?? {
    ...event,
    prePaymentPreviewUrl: dataUrl,
    prePaymentPreviewUsedAt: timestamp,
  };
}

interface ReadinessResponse {
  ready: boolean;
  generationState: PreviewGenerationState;
  pollAfterMs: number | null;
  mode: PrePaymentPreviewMode;
  kind: PreviewAssetKind;
  imageGenerationEnabled: boolean;
  namedReference: DirectionCard["namedReference"];
  referenceRecommended: boolean;
  referenceCaptured: boolean;
  automaticReferenceResolutionEnabled: boolean;
  automaticReferenceAttempted: boolean;
  directionCard: DirectionCard;
}

async function readiness(
  event: Event,
  mode: PrePaymentPreviewMode,
  autoNamedEnabled: boolean,
  timestamp: number,
  resolvedNamed?: NamedCreativeReference | null,
): Promise<ReadinessResponse> {
  // Curated-only, synchronous and network-free on GET. The explicit POST may
  // pass its one already-resolved general classification into this response.
  const card = buildDirectionCard(event, resolvedNamed);
  const kind = prePaymentPreviewAssetKind(event);
  const state = generationState(event, kind, timestamp);
  const referenceCaptured = kind === "reference-board";
  const hasNamedReference = Boolean(card.namedReference);
  return {
    ready: kind !== "none",
    generationState: state,
    pollAfterMs: state === "generating" ? POLL_AFTER_MS : null,
    mode,
    kind,
    imageGenerationEnabled: hasNamedReference ? autoNamedEnabled : mode === "quality-image",
    namedReference: card.namedReference,
    referenceRecommended: false,
    referenceCaptured,
    automaticReferenceResolutionEnabled: hasNamedReference && autoNamedEnabled,
    automaticReferenceAttempted: hasNamedReference && event.prePaymentPreviewAttempts > 0,
    directionCard: card,
  };
}

async function reservePreviewAttempt(
  store: PrePaymentPreviewQualityStorage,
  event: Event,
  startedAt: number,
): Promise<Event> {
  const updated = await store.updateEventById(event.id, {
    prePaymentPreviewAttempts: event.prePaymentPreviewAttempts + 1,
    prePaymentPreviewUrl: "",
    // During generation this field is the durable start timestamp. Completion
    // replaces it with the final asset timestamp, enabling stale recovery.
    prePaymentPreviewUsedAt: startedAt,
  });
  return updated ?? {
    ...event,
    prePaymentPreviewAttempts: event.prePaymentPreviewAttempts + 1,
    prePaymentPreviewUrl: "",
    prePaymentPreviewUsedAt: startedAt,
  };
}

async function persistApprovedImage(
  store: PrePaymentPreviewQualityStorage,
  event: Event,
  dataUrl: string,
  timestamp: number,
): Promise<boolean> {
  const approved = qualityApprovedDataUrl(dataUrl);
  if (!approved) return false;
  await store.updateEventById(event.id, {
    prePaymentPreviewUrl: approved,
    prePaymentPreviewUsedAt: timestamp,
  });
  return true;
}

interface AutomaticClassifiedJobDependencies {
  store: PrePaymentPreviewQualityStorage;
  event: Event;
  mode: PrePaymentPreviewMode;
  namedAutoEnabled: boolean;
  classifyNamedReference: NonNullable<PrePaymentPreviewQualityRouteDependencies["classifyNamedReference"]>;
  resolveNamedReference: typeof resolveNamedCreativeReference;
  generate: NonNullable<PrePaymentPreviewQualityRouteDependencies["generate"]>;
  artworkAttemptStore: AiFirstArtworkAttemptStore;
  now: () => number;
  jobTimeoutMs: number;
}

interface AutomaticNamedJobDependencies {
  store: PrePaymentPreviewQualityStorage;
  event: Event;
  namedReference: NamedCreativeReference;
  resolveNamedReference: typeof resolveNamedCreativeReference;
  generate: NonNullable<PrePaymentPreviewQualityRouteDependencies["generate"]>;
  artworkAttemptStore: AiFirstArtworkAttemptStore;
  now: () => number;
  jobTimeoutMs: number;
}

async function runAutomaticNamedPreviewJob({
  store,
  event,
  namedReference,
  resolveNamedReference,
  generate,
  artworkAttemptStore,
  now,
  jobTimeoutMs,
}: AutomaticNamedJobDependencies): Promise<void> {
  const jobStartedAt = Date.now();
  const remainingMs = () => Math.max(1, jobTimeoutMs - (Date.now() - jobStartedAt));
  try {
    let resolved: ResolvedNamedReference | null = null;
    try {
      resolved = await withPreviewDeadline(
        resolveNamedReference(event, namedReference),
        Math.min(REFERENCE_RESOLUTION_TIMEOUT_MS, remainingMs()),
        "Named-theme visual research",
      );
    } catch (error) {
      console.error("[prepayment-preview] automatic named-reference resolution failed:", error);
    }

    if (!resolved?.images.length) {
      await persistDirectionCard(store, event, now(), namedReference);
      console.warn(`[prepayment-preview] ${JSON.stringify({
        eventId: event.id,
        kind: "direction-card",
        namedReference: namedReference.id,
        automaticReferenceResolved: false,
      })}`);
      return;
    }

    const abortController = new AbortController();
    const generationTimeoutMs = remainingMs();
    const result = await withPreviewDeadline(
      generate(event, {
        inspirationNotes: resolved.notes,
        referenceImages: resolved.images,
        quality: "high",
        maxCandidates: 2,
        namedReference,
        attemptRetention: { store: artworkAttemptStore, eventId: event.id, ownerToken: event.ownerToken },
        signal: abortController.signal,
      }),
      generationTimeoutMs,
      "Artwork generation and private review",
      (error) => abortController.abort(error),
    );

    if (result.kind === "approved-image"
      && await persistApprovedImage(store, event, result.dataUrl, now())) {
      console.info(`[prepayment-preview] ${JSON.stringify({
        eventId: event.id,
        kind: result.kind,
        model: result.model,
        privateCandidates: result.attempts,
        namedReference: namedReference.id,
        automaticReferenceStrategy: resolved.strategy,
      })}`);
      return;
    }

    await persistDirectionCard(store, event, now(), namedReference);
    console.warn(`[prepayment-preview] ${JSON.stringify({
      eventId: event.id,
      kind: result.kind,
      model: result.model,
      privateCandidates: result.attempts,
      namedReference: namedReference.id,
      automaticReferenceStrategy: resolved.strategy,
      error: result.kind === "unavailable" ? result.error : undefined,
      // Full per-candidate tier1/vision evidence is durably retained in
      // artworkAttemptStore (see /ai-first/review/attempts); this compact
      // summary just keeps the last candidate's reason legible inline.
      rejectionSummary: summarizeRejectionForLog(result.reviews),
    })}`);
  } catch (error) {
    try {
      await persistDirectionCard(store, event, now(), namedReference);
    } catch (persistError) {
      console.error("[prepayment-preview] could not persist the safe named-theme fallback:", persistError);
    }
    console.error("[prepayment-preview] automatic named-theme background task failed closed:", error);
  }
}

async function runAutomaticClassifiedPreviewJob({
  store,
  event,
  mode,
  namedAutoEnabled,
  classifyNamedReference,
  resolveNamedReference,
  generate,
  artworkAttemptStore,
  now,
  jobTimeoutMs,
}: AutomaticClassifiedJobDependencies): Promise<void> {
  const startedAt = Date.now();
  const remainingMs = () => Math.max(1, jobTimeoutMs - (Date.now() - startedAt));
  let namedReference: NamedCreativeReference | null = null;
  try {
    namedReference = await withPreviewDeadline(
      classifyNamedReference(eventNamedReferenceBrief(event)),
      Math.min(GENERAL_CLASSIFIER_TIMEOUT_MS, remainingMs()),
      "Named-theme recognition",
    );
  } catch (error) {
    console.warn("[prepayment-preview] one-shot background named-theme recognition failed closed:", error);
  }

  if (namedReference) {
    if (namedAutoEnabled) {
      await runAutomaticNamedPreviewJob({
        store,
        event,
        namedReference,
        resolveNamedReference,
        generate,
        artworkAttemptStore,
        now,
        jobTimeoutMs: remainingMs(),
      });
      return;
    }
    await persistDirectionCard(store, event, now(), namedReference);
    return;
  }

  if (mode !== "quality-image") {
    await persistDirectionCard(store, event, now());
    return;
  }

  const abortController = new AbortController();
  const generationTimeoutMs = remainingMs();
  try {
    const result = await withPreviewDeadline(
      generate(event, {
        quality: "medium",
        maxCandidates: 1,
        namedReference: null,
        attemptRetention: { store: artworkAttemptStore, eventId: event.id, ownerToken: event.ownerToken },
        signal: abortController.signal,
      }),
      generationTimeoutMs,
      "Artwork generation and private review",
      (error) => abortController.abort(error),
    );

    if (result.kind === "approved-image"
      && await persistApprovedImage(store, event, result.dataUrl, now())) {
      return;
    }
    await persistDirectionCard(store, event, now());
    console.warn(`[prepayment-preview] ${JSON.stringify({
      eventId: event.id,
      kind: result.kind,
      model: result.model,
      privateCandidates: result.attempts,
      error: result.kind === "unavailable" ? result.error : undefined,
      rejectionSummary: summarizeRejectionForLog(result.reviews),
    })}`);
  } catch (error) {
    await persistDirectionCard(store, event, now());
    console.error("[prepayment-preview] classified background preview failed closed:", error);
  }
}

async function readyResponse(
  event: Event,
  mode: PrePaymentPreviewMode,
  autoNamed: boolean,
  timestamp: number,
  resolvedNamed?: NamedCreativeReference | null,
) {
  return readiness(event, mode, autoNamed, timestamp, resolvedNamed);
}

/**
 * Registers before the legacy preview handlers. Raw provider output is never
 * customer-visible. Named-world research and generation run after the HTTP
 * response under Vercel waitUntil, so mobile navigation cannot cancel the job.
 */
export function registerPrePaymentPreviewQualityRoutes(
  app: Express,
  dependencies: PrePaymentPreviewQualityRouteDependencies = {},
): void {
  const store = dependencies.store ?? storage;
  const isUnlocked = dependencies.isUnlocked ?? defaultUnlocked;
  const readMode = dependencies.mode ?? (() => readPrePaymentPreviewMode());
  const autoNamedEnabled = dependencies.autoNamedEnabled
    ?? (() => namedReferenceAutoResolutionEnabled());
  const classifyNamedReference = dependencies.classifyNamedReference
    ?? ((text: string) => detectNamedCreativeReference(text));
  const resolveNamedReference = dependencies.resolveNamedReference
    ?? resolveNamedCreativeReference;
  const generate = dependencies.generate ?? generateQualityLockedPreview;
  const schedule = dependencies.schedule ?? defaultSchedule;
  const now = dependencies.now ?? Date.now;
  const jobTimeoutMs = dependencies.jobTimeoutMs ?? PREPAYMENT_PREVIEW_JOB_TIMEOUT_MS;
  const artworkAttemptStore = dependencies.artworkAttemptStore ?? new DbArtworkAttemptStore();

  app.get("/api/events/owner/:ownerToken/prepayment-preview/readiness", async (req, res) => {
    let event = await store.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });

    const timestamp = now();
    if (backgroundIsStale(event, timestamp)) {
      event = await persistDirectionCard(store, event, timestamp);
    }

    res.setHeader("Cache-Control", "private, no-store");
    return res.json(await readiness(event, readMode(), autoNamedEnabled(), timestamp));
  });

  app.post("/api/events/owner/:ownerToken/prepayment-preview", async (req, res) => {
    let event = await store.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });

    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Enter a valid email to create your private first look." });
    }

    let referenceImages: ArtworkReferenceImage[];
    try {
      referenceImages = referenceImagesFromDataUrls(parsed.data.inspirationImages);
    } catch {
      return res.status(400).json({
        error: "Use a PNG, JPEG or WebP image under 2.5 MB for optional design inspiration.",
      });
    }

    if (await isUnlocked(event)) {
      return res.status(409).json({ error: "This event is already unlocked — use the normal invitation flow." });
    }

    const timestamp = now();
    const mode = readMode();
    const namedAutoEnabled = autoNamedEnabled();
    let currentKind = prePaymentPreviewAssetKind(event);
    const hasHostReference = referenceImages.length > 0;

    if (backgroundIsStale(event, timestamp)) {
      event = await persistDirectionCard(store, event, timestamp);
      currentKind = "direction-card";
    }

    // Treat repeated submits as the same in-flight request before attempting
    // any general classification. This keeps arbitrary named themes one-shot
    // even across duplicate browser requests.
    if (currentKind === "none" && event.prePaymentPreviewAttempts > 0) {
      res.setHeader("Retry-After", String(Math.ceil(POLL_AFTER_MS / 1000)));
      return res.status(202).json(await readiness(event, mode, namedAutoEnabled, timestamp));
    }
    if (currentKind === "direction-card" && event.prePaymentPreviewAttempts > 0) {
      return res.json(await readyResponse(event, mode, namedAutoEnabled, timestamp));
    }

    // A previously completed safe asset is idempotent for every theme type.
    // Quality-approved arbitrary named themes do not need to be rediscovered by
    // the curated read-only detector in order to remain visible.
    if (currentKind === "approved-image" || currentKind === "reference-board") {
      return res.json(await readyResponse(event, mode, namedAutoEnabled, timestamp));
    }

    if (hasHostReference) {
      event = await persistReferenceBoard(store, event, referenceImages, timestamp);
      return res.json(await readyResponse(event, mode, namedAutoEnabled, timestamp));
    }

    const namedReference = namedReferenceForEventSync(event);

    if (namedReference) {
      if (!namedAutoEnabled) {
        if (currentKind !== "direction-card") {
          event = await persistDirectionCard(store, event, timestamp, namedReference);
        }
        return res.json(await readyResponse(event, mode, namedAutoEnabled, timestamp, namedReference));
      }

      const allowance = canAttemptPrePaymentPreview(event);
      if (!allowance.ok) {
        if (currentKind !== "direction-card") {
          event = await persistDirectionCard(store, event, timestamp, namedReference);
        }
        return res.json(await readyResponse(event, mode, namedAutoEnabled, timestamp, namedReference));
      }

      const reservedEvent = await reservePreviewAttempt(store, event, timestamp);
      event = reservedEvent;
      schedule(() => runAutomaticNamedPreviewJob({
        store,
        event: reservedEvent,
        namedReference,
        resolveNamedReference,
        generate,
        artworkAttemptStore,
        now,
        jobTimeoutMs,
      }));

      res.setHeader("Retry-After", String(Math.ceil(POLL_AFTER_MS / 1000)));
      return res.status(202).json(await readiness(reservedEvent, mode, namedAutoEnabled, timestamp, namedReference));
    }

    if (currentKind === "direction-card") {
      return res.json(await readyResponse(event, mode, namedAutoEnabled, timestamp));
    }

    // Unknown names and original themes are classified once after the explicit
    // action. The HTTP response is immediate; classification, optional visual
    // research, generation and review all happen in the scheduled job.
    if (!namedAutoEnabled && mode !== "quality-image") {
      event = await persistDirectionCard(store, event, timestamp);
      return res.json(await readyResponse(event, mode, namedAutoEnabled, timestamp));
    }

    const allowance = canAttemptPrePaymentPreview(event);
    if (!allowance.ok) {
      event = await persistDirectionCard(store, event, timestamp);
      return res.json(await readyResponse(event, mode, namedAutoEnabled, timestamp));
    }

    const reservedEvent = await reservePreviewAttempt(store, event, timestamp);
    schedule(() => runAutomaticClassifiedPreviewJob({
      store,
      event: reservedEvent,
      mode,
      namedAutoEnabled,
      classifyNamedReference,
      resolveNamedReference,
      generate,
      artworkAttemptStore,
      now,
      jobTimeoutMs,
    }));

    res.setHeader("Retry-After", String(Math.ceil(POLL_AFTER_MS / 1000)));
    return res.status(202).json(await readiness(reservedEvent, mode, namedAutoEnabled, timestamp));
  });

  app.get("/api/events/owner/:ownerToken/prepayment-preview/asset", async (req, res) => {
    const event = await store.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "No first look available yet" });

    const mode = readMode();
    // Pure read path (asset delivery) — curated-only, synchronous, no model
    // call. The already-resolved general-path identity (if any) lives in the
    // persisted direction card itself, not re-derived here.
    const namedReference = namedReferenceForEventSync(event);
    const namedAutoEnabled = autoNamedEnabled();
    const stored = event.prePaymentPreviewUrl || "";
    res.setHeader("Cache-Control", "private, no-store");

    if (isSvgDataUrl(stored)) {
      const encoded = svgPayload(stored);
      if (!encoded) return res.status(500).json({ error: "Couldn't render first look" });
      res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
      return res.send(Buffer.from(encoded, "base64"));
    }

    const approvedPayload = qualityApprovedPayload(stored);
    if (!approvedPayload || !imageIsCurrent(event)) {
      return res.status(404).json({ error: "No approved first look available yet" });
    }

    const fullBytes = Buffer.from(approvedPayload, "base64");
    res.setHeader("Content-Type", "image/png");

    if (await isUnlocked(event)) return res.send(fullBytes);

    try {
      const decoded = decodePng(fullBytes);
      const preview = boxDownsampleRgb(decoded, PRE_PAYMENT_PREVIEW_LONG_EDGE);
      return res.send(encodePng(preview));
    } catch (error) {
      const detail = error instanceof PngDecodeError ? error.message : String(error);
      console.error(`[prepayment-preview] approved asset decode failed for event ${event.id}: ${detail}`);
      return res.status(500).json({ error: "Couldn't render first look" });
    }
  });
}

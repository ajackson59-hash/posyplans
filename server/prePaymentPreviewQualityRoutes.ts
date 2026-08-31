import type { Express } from "express";
import type { Event } from "@shared/schema";
import { z } from "zod";
import { storage } from "./storage";
import { canGenerateDraft } from "./masterPlannerEntitlement";
import { extractInspirationNotes } from "./inviteDesignAi";
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
  PREPAYMENT_PREVIEW_QUALITY_LOCK_CUTOFF_MS,
  buildDirectionCard,
  detectNamedCreativeReference,
  directionCardDataUrl,
  generateQualityLockedPreview,
  readPrePaymentPreviewMode,
  type DirectionCard,
  type PrePaymentPreviewMode,
  type PreviewQualityDependencies,
} from "./prePaymentPreviewQuality";

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

export interface PrePaymentPreviewQualityRouteDependencies {
  store?: PrePaymentPreviewQualityStorage;
  isUnlocked?: (event: Event) => Promise<boolean>;
  mode?: () => PrePaymentPreviewMode;
  generate?: (
    event: Event,
    dependencies?: PreviewQualityDependencies,
  ) => ReturnType<typeof generateQualityLockedPreview>;
  analyzeInspiration?: (images: string[]) => Promise<string>;
  now?: () => number;
}

type PreviewAssetKind = "direction-card" | "reference-board" | "approved-image" | "none";

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

function isPngDataUrl(value: string | null | undefined): boolean {
  return Boolean(value?.startsWith("data:image/png;base64,"));
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

function namedReferenceForEvent(event: Event) {
  return detectNamedCreativeReference(
    [event.eventName, event.eventType, event.themeName, event.vibeDescription]
      .filter(Boolean)
      .join(" "),
  );
}

function imageIsCurrent(event: Event): boolean {
  return isPngDataUrl(event.prePaymentPreviewUrl)
    && (event.prePaymentPreviewUsedAt ?? 0) >= PREPAYMENT_PREVIEW_QUALITY_LOCK_CUTOFF_MS;
}

function assetKind(event: Event): PreviewAssetKind {
  if (isReferenceBoardDataUrl(event.prePaymentPreviewUrl)) return "reference-board";
  if (isSvgDataUrl(event.prePaymentPreviewUrl)) return "direction-card";
  // Named entertainment previews are never represented by generated pixels.
  // Any PNG left by an older experiment becomes stale immediately.
  if (imageIsCurrent(event) && !namedReferenceForEvent(event)) return "approved-image";
  return "none";
}

async function defaultUnlocked(event: Event): Promise<boolean> {
  const access = await canGenerateDraft(event.id);
  return access.ok;
}

async function persistDirectionCard(
  store: PrePaymentPreviewQualityStorage,
  event: Event,
  now: number,
): Promise<void> {
  await store.updateEventById(event.id, {
    prePaymentPreviewUrl: directionCardDataUrl(event),
    prePaymentPreviewUsedAt: now,
  });
}

async function persistReferenceBoard(
  store: PrePaymentPreviewQualityStorage,
  event: Event,
  references: ArtworkReferenceImage[],
  now: number,
): Promise<void> {
  await store.updateEventById(event.id, {
    prePaymentPreviewUrl: referenceBoardDataUrl(event, references),
    prePaymentPreviewUsedAt: now,
  });
}

interface ReadinessResponse {
  mode: PrePaymentPreviewMode;
  kind: PreviewAssetKind;
  imageGenerationEnabled: boolean;
  namedReference: DirectionCard["namedReference"];
  referenceRecommended: boolean;
  referenceCaptured: boolean;
  directionCard: DirectionCard;
}

function readiness(event: Event, mode: PrePaymentPreviewMode): ReadinessResponse {
  const card = buildDirectionCard(event);
  const kind = assetKind(event);
  const referenceCaptured = kind === "reference-board";
  return {
    mode,
    kind,
    // Exact named worlds use the deterministic reference-board lane. Generic
    // and original themes may use private quality-gated generation.
    imageGenerationEnabled: mode === "quality-image" && !card.namedReference,
    namedReference: card.namedReference,
    referenceRecommended: Boolean(card.namedReference) && !referenceCaptured,
    referenceCaptured,
    directionCard: card,
  };
}

/**
 * Registers before the legacy preview handlers. Raw provider output is never
 * customer-visible. Named entertainment themes use a deterministic board made
 * from the host's own screenshots; original themes may use the quality gate.
 */
export function registerPrePaymentPreviewQualityRoutes(
  app: Express,
  dependencies: PrePaymentPreviewQualityRouteDependencies = {},
): void {
  const store = dependencies.store ?? storage;
  const isUnlocked = dependencies.isUnlocked ?? defaultUnlocked;
  const readMode = dependencies.mode ?? (() => readPrePaymentPreviewMode());
  const generate = dependencies.generate ?? generateQualityLockedPreview;
  const analyzeInspiration = dependencies.analyzeInspiration ?? extractInspirationNotes;
  const now = dependencies.now ?? Date.now;

  app.get("/api/events/owner/:ownerToken/prepayment-preview/readiness", async (req, res) => {
    const event = await store.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    res.setHeader("Cache-Control", "private, no-store");
    return res.json(readiness(event, readMode()));
  });

  app.post("/api/events/owner/:ownerToken/prepayment-preview", async (req, res) => {
    const event = await store.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });

    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Enter a valid email to create your private preview." });
    }

    let referenceImages: ArtworkReferenceImage[];
    try {
      referenceImages = referenceImagesFromDataUrls(parsed.data.inspirationImages);
    } catch {
      return res.status(400).json({
        error: "Use a PNG, JPEG or WebP screenshot under 2.5 MB for design inspiration.",
      });
    }

    if (await isUnlocked(event)) {
      return res.status(409).json({ error: "This event is already unlocked — use the normal invitation flow." });
    }

    const mode = readMode();
    const currentKind = assetKind(event);
    const hasReference = referenceImages.length > 0;
    const namedReference = namedReferenceForEvent(event);

    // Named entertainment and character themes never spend on or expose an AI
    // approximation at this pre-purchase trust moment. The host first receives
    // a reliable direction card, then may pin the exact world with one or two
    // of their own screenshots. Those exact pixels become the visible proof.
    if (namedReference) {
      if (currentKind === "reference-board" && !hasReference) {
        return res.json({
          ready: true,
          kind: "reference-board",
          referenceRecommended: false,
          referenceCaptured: true,
        });
      }

      if (hasReference) {
        await persistReferenceBoard(store, event, referenceImages, now());
        return res.json({
          ready: true,
          kind: "reference-board",
          referenceRecommended: false,
          referenceCaptured: true,
          namedReference: { id: namedReference.id, label: namedReference.label },
        });
      }

      if (currentKind !== "direction-card") {
        await persistDirectionCard(store, event, now());
      }
      return res.json({
        ready: true,
        kind: "direction-card",
        referenceRecommended: true,
        referenceCaptured: false,
        namedReference: { id: namedReference.id, label: namedReference.label },
      });
    }

    if (currentKind === "approved-image" && mode === "quality-image") {
      return res.json({
        ready: true,
        kind: "approved-image",
        referenceRecommended: false,
        referenceCaptured: false,
      });
    }
    if (currentKind === "direction-card" && mode !== "quality-image") {
      return res.json({
        ready: true,
        kind: "direction-card",
        referenceRecommended: false,
        referenceCaptured: false,
      });
    }

    // Safe launch default for original themes. A deterministic direction card
    // replaces a blank square without any image-provider spend.
    if (mode !== "quality-image") {
      await persistDirectionCard(store, event, now());
      return res.json({
        ready: true,
        kind: "direction-card",
        referenceRecommended: false,
        referenceCaptured: false,
      });
    }

    const allowance = canAttemptPrePaymentPreview(event);
    if (!allowance.ok) {
      await persistDirectionCard(store, event, now());
      return res.json({
        ready: true,
        kind: "direction-card",
        referenceRecommended: false,
        referenceCaptured: false,
      });
    }

    // Reserve a generic/original-theme request before any provider call. Up to
    // two candidates may be inspected privately; only a passing candidate can
    // be persisted or served.
    await store.updateEventById(event.id, {
      prePaymentPreviewAttempts: event.prePaymentPreviewAttempts + 1,
      prePaymentPreviewUrl: "",
      prePaymentPreviewUsedAt: null,
    });

    let inspirationNotes = "";
    if (hasReference) {
      try {
        inspirationNotes = await analyzeInspiration(parsed.data.inspirationImages);
      } catch (error) {
        console.error("[prepayment-preview] inspiration analysis unavailable:", error);
      }
    }

    let result: Awaited<ReturnType<typeof generateQualityLockedPreview>>;
    try {
      result = await generate(event, { inspirationNotes, referenceImages, maxCandidates: 2 });
    } catch (error) {
      await persistDirectionCard(store, event, now());
      console.error("[prepayment-preview] private quality pipeline failed closed:", error);
      return res.json({
        ready: true,
        kind: "direction-card",
        referenceRecommended: false,
        referenceCaptured: false,
      });
    }

    if (result.kind === "approved-image") {
      await store.updateEventById(event.id, {
        prePaymentPreviewUrl: result.dataUrl,
        prePaymentPreviewUsedAt: now(),
      });
      console.info(`[prepayment-preview] ${JSON.stringify({
        eventId: event.id,
        kind: result.kind,
        model: result.model,
        privateCandidates: result.attempts,
      })}`);
      return res.json({
        ready: true,
        kind: "approved-image",
        referenceRecommended: false,
        referenceCaptured: false,
      });
    }

    await persistDirectionCard(store, event, now());
    console.warn(`[prepayment-preview] ${JSON.stringify({
      eventId: event.id,
      kind: result.kind,
      model: result.model,
      privateCandidates: result.attempts,
      error: result.kind === "unavailable" ? result.error : undefined,
    })}`);
    return res.json({
      ready: true,
      kind: "direction-card",
      referenceRecommended: false,
      referenceCaptured: false,
    });
  });

  app.get("/api/events/owner/:ownerToken/prepayment-preview/asset", async (req, res) => {
    const event = await store.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "No preview available yet" });

    const mode = readMode();
    const stored = event.prePaymentPreviewUrl || "";
    res.setHeader("Cache-Control", "private, no-store");

    if (isSvgDataUrl(stored)) {
      const encoded = svgPayload(stored);
      if (!encoded) return res.status(500).json({ error: "Couldn't render preview" });
      res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
      return res.send(Buffer.from(encoded, "base64"));
    }

    // Named-theme generated PNGs from any older experiment are stale by
    // definition; exact-reference boards are the only visual proof served.
    if (namedReferenceForEvent(event)) {
      return res.status(404).json({ error: "No reference-backed preview available yet" });
    }

    if (!imageIsCurrent(event) || mode !== "quality-image") {
      return res.status(404).json({ error: "No approved preview available yet" });
    }

    const match = /^data:image\/png;base64,(.+)$/.exec(stored);
    if (!match) return res.status(500).json({ error: "Couldn't render preview" });
    const fullBytes = Buffer.from(match[1], "base64");
    res.setHeader("Content-Type", "image/png");

    if (await isUnlocked(event)) return res.send(fullBytes);

    try {
      const decoded = decodePng(fullBytes);
      const preview = boxDownsampleRgb(decoded, PRE_PAYMENT_PREVIEW_LONG_EDGE);
      return res.send(encodePng(preview));
    } catch (error) {
      const detail = error instanceof PngDecodeError ? error.message : String(error);
      console.error(`[prepayment-preview] approved asset decode failed for event ${event.id}: ${detail}`);
      return res.status(500).json({ error: "Couldn't render preview" });
    }
  });
}

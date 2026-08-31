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

function isSvgDataUrl(value: string | null | undefined): boolean {
  return Boolean(value?.startsWith("data:image/svg+xml;base64,"));
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

function imageIsCurrent(event: Event): boolean {
  return isPngDataUrl(event.prePaymentPreviewUrl)
    && (event.prePaymentPreviewUsedAt ?? 0) >= PREPAYMENT_PREVIEW_QUALITY_LOCK_CUTOFF_MS;
}

function assetKind(event: Event): "direction-card" | "approved-image" | "none" {
  if (isSvgDataUrl(event.prePaymentPreviewUrl)) return "direction-card";
  if (imageIsCurrent(event)) return "approved-image";
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

interface ReadinessResponse {
  mode: PrePaymentPreviewMode;
  kind: "direction-card" | "approved-image" | "none";
  imageGenerationEnabled: boolean;
  namedReference: DirectionCard["namedReference"];
  referenceRecommended: boolean;
  directionCard: DirectionCard;
}

function readiness(event: Event, mode: PrePaymentPreviewMode): ReadinessResponse {
  const card = buildDirectionCard(event);
  return {
    mode,
    kind: assetKind(event),
    imageGenerationEnabled: mode === "quality-image",
    namedReference: card.namedReference,
    referenceRecommended: card.referenceRecommended,
    directionCard: card,
  };
}

/**
 * Registers before the legacy preview handlers. The old endpoints remain in
 * routes.ts for rollback safety, but Express resolves these first so an
 * unreviewed legacy image can never reach a customer while the quality lock is
 * active.
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
    const namedReference = detectNamedCreativeReference(
      [event.eventName, event.eventType, event.themeName, event.vibeDescription].filter(Boolean).join(" "),
    );

    // Idempotency is type-aware. A safe direction card can be upgraded to an
    // approved generated image only after quality-image is explicitly enabled
    // and, for a named reference, a visual reference is supplied.
    if (currentKind === "approved-image" && mode === "quality-image") {
      return res.json({ ready: true, kind: "approved-image", referenceRecommended: false });
    }
    if (
      currentKind === "direction-card"
      && (mode !== "quality-image" || (namedReference && !hasReference))
    ) {
      return res.json({
        ready: true,
        kind: "direction-card",
        referenceRecommended: Boolean(namedReference),
      });
    }

    // The safe launch default. "off" and invalid configuration do not create
    // a blank square: they return deterministic proof that Posy understood the
    // host, without spending on or exposing generated artwork.
    if (mode !== "quality-image") {
      await persistDirectionCard(store, event, now());
      return res.json({
        ready: true,
        kind: "direction-card",
        referenceRecommended: Boolean(namedReference),
      });
    }

    // Exact entertainment/character references are not guessed from text
    // alone. The customer still gets the direction card immediately; a visual
    // reference can later upgrade it to a privately reviewed image.
    if (namedReference && !hasReference) {
      await persistDirectionCard(store, event, now());
      return res.json({
        ready: true,
        kind: "direction-card",
        referenceRecommended: true,
        namedReference: { id: namedReference.id, label: namedReference.label },
      });
    }

    const allowance = canAttemptPrePaymentPreview(event);
    if (!allowance.ok) {
      await persistDirectionCard(store, event, now());
      return res.json({
        ready: true,
        kind: "direction-card",
        referenceRecommended: Boolean(namedReference),
      });
    }

    // Reserve the customer request before any provider call. The quality
    // function may inspect two private candidates, but it returns pixels only
    // when one clears every gate.
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
        referenceRecommended: Boolean(namedReference),
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
      return res.json({ ready: true, kind: "approved-image", referenceRecommended: false });
    }

    // Fail closed and calm. Provider outage, quota exhaustion, critic outage,
    // or two rejected candidates all become the same safe direction card. No
    // bad pixels and no red customer-facing generation error.
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
      referenceRecommended: Boolean(namedReference),
    });
  });

  app.get("/api/events/owner/:ownerToken/prepayment-preview/asset", async (req, res) => {
    const event = await store.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "No preview available yet" });

    const mode = readMode();
    const stored = event.prePaymentPreviewUrl || "";
    res.setHeader("Cache-Control", "private, no-store");

    if (isSvgDataUrl(stored)) {
      const encoded = stored.slice("data:image/svg+xml;base64,".length);
      res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
      return res.send(Buffer.from(encoded, "base64"));
    }

    // A PNG accepted before this quality-lock contract is stale evidence. It
    // is never served by the new route. The browser will keep the safe empty
    // state until the host submits an email and receives a direction card.
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

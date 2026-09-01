import type { Express } from "express";
import type { Event } from "@shared/schema";
import { z } from "zod";
import { storage } from "./storage";
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
  autoNamedEnabled?: () => boolean;
  resolveNamedReference?: typeof resolveNamedCreativeReference;
  generate?: (
    event: Event,
    dependencies?: PreviewQualityDependencies,
  ) => ReturnType<typeof generateQualityLockedPreview>;
  now?: () => number;
}

type PreviewAssetKind = "direction-card" | "reference-board" | "approved-image" | "none";

const QUALITY_APPROVED_PNG_PREFIX = "data:image/png;posy-quality-approved;base64,";
const STANDARD_PNG_PREFIX = "data:image/png;base64,";

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

function namedReferenceForEvent(event: Event) {
  return detectNamedCreativeReference(
    [event.eventName, event.eventType, event.themeName, event.vibeDescription]
      .filter(Boolean)
      .join(" "),
  );
}

function imageIsCurrent(event: Event): boolean {
  return Boolean(qualityApprovedPayload(event.prePaymentPreviewUrl))
    && (event.prePaymentPreviewUsedAt ?? 0) >= PREPAYMENT_PREVIEW_QUALITY_LOCK_CUTOFF_MS;
}

function assetKind(event: Event): PreviewAssetKind {
  if (isReferenceBoardDataUrl(event.prePaymentPreviewUrl)) return "reference-board";
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
  automaticReferenceResolutionEnabled: boolean;
  automaticReferenceAttempted: boolean;
  directionCard: DirectionCard;
}

function readiness(
  event: Event,
  mode: PrePaymentPreviewMode,
  autoNamedEnabled: boolean,
): ReadinessResponse {
  const card = buildDirectionCard(event);
  const kind = assetKind(event);
  const referenceCaptured = kind === "reference-board";
  const hasNamedReference = Boolean(card.namedReference);
  return {
    mode,
    kind,
    imageGenerationEnabled: hasNamedReference ? autoNamedEnabled : mode === "quality-image",
    namedReference: card.namedReference,
    // A customer upload remains supported as an optional override, but it is
    // never the primary or required path. Posy resolves named worlds itself.
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
): Promise<void> {
  await store.updateEventById(event.id, {
    prePaymentPreviewAttempts: event.prePaymentPreviewAttempts + 1,
    prePaymentPreviewUrl: "",
    prePaymentPreviewUsedAt: null,
  });
}

async function persistApprovedImage(
  store: PrePaymentPreviewQualityStorage,
  event: Event,
  dataUrl: string,
  now: number,
): Promise<boolean> {
  const approved = qualityApprovedDataUrl(dataUrl);
  if (!approved) return false;
  await store.updateEventById(event.id, {
    prePaymentPreviewUrl: approved,
    prePaymentPreviewUsedAt: now,
  });
  return true;
}

/**
 * Registers before the legacy preview handlers. Raw provider output is never
 * customer-visible. Posy resolves official named-world references privately,
 * then generates and reviews at most two candidates before revealing pixels.
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
  const resolveNamedReference = dependencies.resolveNamedReference
    ?? resolveNamedCreativeReference;
  const generate = dependencies.generate ?? generateQualityLockedPreview;
  const now = dependencies.now ?? Date.now;

  app.get("/api/events/owner/:ownerToken/prepayment-preview/readiness", async (req, res) => {
    const event = await store.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    res.setHeader("Cache-Control", "private, no-store");
    return res.json(readiness(event, readMode(), autoNamedEnabled()));
  });

  app.post("/api/events/owner/:ownerToken/prepayment-preview", async (req, res) => {
    const event = await store.getEventByOwnerToken(req.params.ownerToken);
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

    const mode = readMode();
    const namedAutoEnabled = autoNamedEnabled();
    const currentKind = assetKind(event);
    const hasHostReference = referenceImages.length > 0;
    const namedReference = namedReferenceForEvent(event);

    if (namedReference) {
      if (currentKind === "approved-image" && namedAutoEnabled && !hasHostReference) {
        return res.json({
          ready: true,
          kind: "approved-image",
          referenceRecommended: false,
          referenceCaptured: false,
          automaticReferenceAttempted: true,
        });
      }

      if (currentKind === "reference-board" && !hasHostReference) {
        return res.json({
          ready: true,
          kind: "reference-board",
          referenceRecommended: false,
          referenceCaptured: true,
          automaticReferenceAttempted: event.prePaymentPreviewAttempts > 0,
        });
      }

      // Optional host references are still honored, but the ordinary customer
      // path never requires them. They are an explicit override only.
      if (hasHostReference) {
        await persistReferenceBoard(store, event, referenceImages, now());
        return res.json({
          ready: true,
          kind: "reference-board",
          referenceRecommended: false,
          referenceCaptured: true,
          automaticReferenceAttempted: event.prePaymentPreviewAttempts > 0,
          namedReference: { id: namedReference.id, label: namedReference.label },
        });
      }

      if (!namedAutoEnabled) {
        if (currentKind !== "direction-card") await persistDirectionCard(store, event, now());
        return res.json({
          ready: true,
          kind: "direction-card",
          referenceRecommended: false,
          referenceCaptured: false,
          automaticReferenceAttempted: false,
          namedReference: { id: namedReference.id, label: namedReference.label },
        });
      }

      // One customer action may produce two privately reviewed candidates. A
      // completed failed attempt stays calm and idempotent rather than spending
      // again on every blur, refresh or repeated tap.
      if (currentKind === "direction-card" && event.prePaymentPreviewAttempts > 0) {
        return res.json({
          ready: true,
          kind: "direction-card",
          referenceRecommended: false,
          referenceCaptured: false,
          automaticReferenceAttempted: true,
          namedReference: { id: namedReference.id, label: namedReference.label },
        });
      }

      const allowance = canAttemptPrePaymentPreview(event);
      if (!allowance.ok) {
        if (currentKind !== "direction-card") await persistDirectionCard(store, event, now());
        return res.json({
          ready: true,
          kind: "direction-card",
          referenceRecommended: false,
          referenceCaptured: false,
          automaticReferenceAttempted: event.prePaymentPreviewAttempts > 0,
          namedReference: { id: namedReference.id, label: namedReference.label },
        });
      }

      await reservePreviewAttempt(store, event);

      let resolved: ResolvedNamedReference | null = null;
      try {
        resolved = await resolveNamedReference(event, namedReference);
      } catch (error) {
        console.error("[prepayment-preview] automatic named-reference resolution failed:", error);
      }

      if (!resolved?.images.length) {
        await persistDirectionCard(store, event, now());
        console.warn(`[prepayment-preview] ${JSON.stringify({
          eventId: event.id,
          kind: "direction-card",
          namedReference: namedReference.id,
          automaticReferenceResolved: false,
        })}`);
        return res.json({
          ready: true,
          kind: "direction-card",
          referenceRecommended: false,
          referenceCaptured: false,
          automaticReferenceAttempted: true,
          namedReference: { id: namedReference.id, label: namedReference.label },
        });
      }

      let result: Awaited<ReturnType<typeof generateQualityLockedPreview>>;
      try {
        result = await generate(event, {
          inspirationNotes: resolved.notes,
          referenceImages: resolved.images,
          quality: "high",
          maxCandidates: 2,
        });
      } catch (error) {
        await persistDirectionCard(store, event, now());
        console.error("[prepayment-preview] automatic named-theme quality pipeline failed closed:", error);
        return res.json({
          ready: true,
          kind: "direction-card",
          referenceRecommended: false,
          referenceCaptured: false,
          automaticReferenceAttempted: true,
          namedReference: { id: namedReference.id, label: namedReference.label },
        });
      }

      if (result.kind === "approved-image" && await persistApprovedImage(store, event, result.dataUrl, now())) {
        console.info(`[prepayment-preview] ${JSON.stringify({
          eventId: event.id,
          kind: result.kind,
          model: result.model,
          privateCandidates: result.attempts,
          namedReference: namedReference.id,
          automaticReferenceStrategy: resolved.strategy,
        })}`);
        return res.json({
          ready: true,
          kind: "approved-image",
          referenceRecommended: false,
          referenceCaptured: false,
          automaticReferenceAttempted: true,
        });
      }

      await persistDirectionCard(store, event, now());
      console.warn(`[prepayment-preview] ${JSON.stringify({
        eventId: event.id,
        kind: result.kind,
        model: result.model,
        privateCandidates: result.attempts,
        namedReference: namedReference.id,
        automaticReferenceStrategy: resolved.strategy,
        error: result.kind === "unavailable" ? result.error : undefined,
      })}`);
      return res.json({
        ready: true,
        kind: "direction-card",
        referenceRecommended: false,
        referenceCaptured: false,
        automaticReferenceAttempted: true,
        namedReference: { id: namedReference.id, label: namedReference.label },
      });
    }

    // Original and generic themes retain the existing explicit release gate.
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

    await reservePreviewAttempt(store, event);

    let result: Awaited<ReturnType<typeof generateQualityLockedPreview>>;
    try {
      result = await generate(event, {
        referenceImages,
        maxCandidates: 2,
      });
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

    if (result.kind === "approved-image" && await persistApprovedImage(store, event, result.dataUrl, now())) {
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
    if (!event) return res.status(404).json({ error: "No first look available yet" });

    const mode = readMode();
    const namedReference = namedReferenceForEvent(event);
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
    const approvedLaneEnabled = namedReference ? namedAutoEnabled : mode === "quality-image";
    if (!approvedPayload || !imageIsCurrent(event) || !approvedLaneEnabled) {
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

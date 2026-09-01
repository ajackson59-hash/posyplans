import type { Express } from "express";
import { storage } from "./storage";
import { getEntitlementSummary } from "./masterPlannerEntitlement";
import { prePaymentPreviewAssetKind } from "./prePaymentPreviewQualityRoutes";

const QUALITY_APPROVED_PNG_PREFIX = "data:image/png;posy-quality-approved;base64,";
const STANDARD_PNG_PREFIX = "data:image/png;base64,";

function browserRenderablePreviewUrl(value: string): string {
  return value.startsWith(QUALITY_APPROVED_PNG_PREFIX)
    ? `${STANDARD_PNG_PREFIX}${value.slice(QUALITY_APPROVED_PNG_PREFIX.length)}`
    : value;
}

/**
 * Lets a paid host promote the exact approved pre-checkout artwork they
 * already liked into the invitation editor. Direction cards and reference
 * boards are deliberately excluded: they are proof/research artifacts, not
 * invitation artwork. No provider call happens here.
 */
export function registerInitialPreviewRoute(app: Express): void {
  app.post("/api/events/owner/:ownerToken/invite/use-prepayment-preview", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    if (!event.prePaymentPreviewUrl) return res.status(404).json({ error: "No initial preview is saved for this event" });
    if (prePaymentPreviewAssetKind(event) !== "approved-image") {
      return res.status(409).json({
        error: "Only an approved image preview can be reused as invitation artwork",
      });
    }

    const entitlement = await getEntitlementSummary(event.id);
    if (!entitlement?.canGenerate) {
      return res.status(402).json({ error: "Unlock this event before using the full preview" });
    }

    // `posy-quality-approved` is an internal persistence marker, not a
    // browser media-type parameter. Strip it when promoting the bytes into
    // fields that are rendered directly as <img src> / CSS url() values.
    const previewUrl = browserRenderablePreviewUrl(event.prePaymentPreviewUrl);
    const updated = await storage.updateEventById(event.id, {
      // Concept-backed invitation paths read inviteIllustrationUrl. The legacy
      // fallback reads inviteArtworkUrl, so setting both makes this safe for an
      // older event without changing any concept/layout metadata.
      inviteIllustrationUrl: previewUrl,
      inviteArtworkUrl: previewUrl,
    });

    if (!updated) return res.status(404).json({ error: "Event not found" });
    return res.json({ event: updated, reusedExistingArtwork: true });
  });
}

import type { Express } from "express";
import { storage } from "./storage";
import { getEntitlementSummary } from "./masterPlannerEntitlement";

/**
 * Lets a paid host promote the exact pre-checkout artwork they already liked
 * into the invitation editor. No provider call happens here: we only reuse the
 * PNG already stored on the event.
 */
export function registerInitialPreviewRoute(app: Express): void {
  app.post("/api/events/owner/:ownerToken/invite/use-prepayment-preview", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    if (!event.prePaymentPreviewUrl) return res.status(404).json({ error: "No initial preview is saved for this event" });

    const entitlement = await getEntitlementSummary(event.id);
    if (!entitlement?.canGenerate) {
      return res.status(402).json({ error: "Unlock this event before using the full preview" });
    }

    const updated = await storage.updateEventById(event.id, {
      // Concept-backed invitation paths read inviteIllustrationUrl. The legacy
      // fallback reads inviteArtworkUrl, so setting both makes this safe for an
      // older event without changing any concept/layout metadata.
      inviteIllustrationUrl: event.prePaymentPreviewUrl,
      inviteArtworkUrl: event.prePaymentPreviewUrl,
    });

    if (!updated) return res.status(404).json({ error: "Event not found" });
    return res.json({ event: updated, reusedExistingArtwork: true });
  });
}

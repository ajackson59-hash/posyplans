import type { Express } from "express";
import type { Event } from "@shared/schema";
import { storage } from "./storage";
import { eventArtworkFields, eventArtworkVersion, storedEventArtwork, type EventArtworkField } from "./eventArtwork";

type ArtworkStorage = Pick<typeof storage, "getEventByOwnerToken" | "getEventByShareSlug">;

/** Binary reads of applied artwork only. The unpaid preview remains behind
 * its separate approval/version/entitlement-aware route. No provider calls. */
export function registerEventArtworkRoutes(app: Express, store: ArtworkStorage = storage): void {
  for (const audience of ["owner", "public"] as const) {
    app.get(`/api/events/${audience}/:key/invite/assets/:field`, async (req, res) => {
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      const field = req.params.field as EventArtworkField;
      if (!eventArtworkFields.includes(field)) return res.status(404).json({ error: "Artwork not found" });
      const event: Event | undefined = audience === "owner"
        ? await store.getEventByOwnerToken(req.params.key)
        : await store.getEventByShareSlug(req.params.key);
      if (!event || (audience === "public" && event.inviteStatus === "draft")) {
        return res.status(404).json({ error: "Artwork not found" });
      }
      const value = storedEventArtwork(event, field);
      if (typeof req.query.v !== "string" || req.query.v !== eventArtworkVersion(value)) {
        return res.status(404).json({ error: "That artwork version is no longer available" });
      }
      const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
      if (!match) return res.status(404).json({ error: "Artwork not found" });
      const bytes = Buffer.from(match[2], "base64");
      // Avoid a platform error. Larger originals still need object storage;
      // never shrink or alter a paid original silently to meet this limit.
      if (bytes.length > 4_500_000) return res.status(413).json({ error: "This original is too large for direct delivery" });
      res.setHeader("Content-Type", match[1]);
      return res.send(bytes);
    });
  }
}

import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import express from "express";
import { createServer } from "node:http";
import request from "supertest";
import type { Event } from "@shared/schema";
import { encodePng, decodePng } from "../server/aiFirst/png";
import { eventArtworkUrl, ownerEventView } from "../server/eventArtwork";
import { PREPAYMENT_PREVIEW_QUALITY_LOCK_CUTOFF_MS } from "../server/prePaymentPreviewQuality";

process.env.DATABASE_URL = "postgres://test/test";
const state = vi.hoisted(() => ({ event: null as Event | null, paid: false, writes: 0 }));
vi.mock("../server/storage", () => ({ storage: {
  getEventByOwnerToken: async (key: string) => key === state.event?.ownerToken ? { ...state.event } : undefined,
  getEventByShareSlug: async (key: string) => key === state.event?.shareSlug ? { ...state.event } : undefined,
  listGuests: async () => [],
  updateEventById: async (_id: number, data: Partial<Event>) => { state.writes++; return state.event = { ...state.event!, ...data }; },
  updateEventByOwnerToken: async (_key: string, data: Partial<Event>) => { state.writes++; return state.event = { ...state.event!, ...data }; },
} }));
vi.mock("../server/masterPlannerEntitlement", () => ({
  getEntitlementSummary: async () => ({ canGenerate: state.paid }),
  canGenerateDraft: vi.fn(async () => ({ ok: false, reason: "needs_payment" })),
  safeParseStages: () => [], reserveOrResumeFreeDraft: vi.fn(),
}));
const { registerRoutes } = await import("../server/routes");
const { registerInitialPreviewRoute } = await import("../server/initialPreviewRoute");
const { registerEventArtworkRoutes } = await import("../server/eventArtworkRoutes");

// A valid, poorly compressible PNG whose binary (not just base64) exceeds 4.5 MB.
const rgb = Buffer.alloc(1300 * 1600 * 3);
let seed = 12345;
for (let i = 0; i < rgb.length; i++) { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; rgb[i] = seed & 255; }
const source = process.env.POSY_QA_ARTWORK_PATH
  ? readFileSync(process.env.POSY_QA_ARTWORK_PATH)
  : encodePng({ width: 1300, height: 1600, rgb });
const sourcePixels = decodePng(source);
const measurements: Record<string, unknown>[] = [];
afterAll(() => {
  if (process.env.POSY_QA_ARTWORK_REPORT) writeFileSync(process.env.POSY_QA_ARTWORK_REPORT, JSON.stringify({
    fixture: "Synthetic in-memory events and paid entitlement; actual Express handlers; no live settlement or provider calls",
    sourceSha256: createHash("sha256").update(source).digest("hex"),
    sourceBytes: source.length, width: sourcePixels.width, height: sourcePixels.height, measurements,
  }, null, 2));
});
const original = `data:image/png;base64,${source.toString("base64")}`;
const ownerPath = "/api/events/owner/synthetic-artwork-owner";
const publicPath = "/api/events/public/synthetic-public";

async function makeApp() {
  const app = express(); app.use(express.json({ limit: "6mb" }));
  registerEventArtworkRoutes(app);
  await registerRoutes(createServer(app), app);
  registerInitialPreviewRoute(app);
  app.use((error: any, _req: any, res: any, _next: any) => res.status(error.status || 500).json({ error: error.message }));
  return app;
}

beforeEach(() => {
  state.writes = 0; state.paid = false;
  state.event = {
    id: 900, ownerToken: "synthetic-artwork-owner", shareSlug: "synthetic-public",
    eventName: "Synthetic birthday", inviteStatus: "published", capturedEmail: "private@example.test",
    sparkCheckoutSessionId: "private-session", vibeDescription: "private brief", venueContactPhone: "private phone",
    prePaymentPreviewUrl: original.replace(";base64,", ";posy-quality-approved-detail-v1;base64,"),
    prePaymentPreviewUsedAt: PREPAYMENT_PREVIEW_QUALITY_LOCK_CUTOFF_MS + 1,
    inviteArtworkUrl: "", inviteIllustrationUrl: "", customInviteImageUrl: "", inviteDesignConceptJson: "{}",
  } as Event;
});

describe("approved preview through paid reuse, reload and guest delivery", () => {
  it.each(["posy-quality-approved", "posy-quality-approved-detail-v1"])("keeps exact original bytes and small JSON for %s", async (marker) => {
    state.event!.prePaymentPreviewUrl = original.replace(";base64,", `;${marker};base64,`);
    const app = await makeApp();
    const denied = await request(app).post(`${ownerPath}/invite/use-prepayment-preview`).send({});
    expect(denied.status).toBe(402); expect(state.writes).toBe(0);
    const before = await request(app).get(ownerPath);
    expect(before.body.event.prePaymentPreviewUrl).toBe("");
    expect(before.text.length).toBeLessThan(5000);
    state.paid = true;
    const applied = await request(app).post(`${ownerPath}/invite/use-prepayment-preview`).send({});
    expect(applied.status).toBe(200); expect(applied.body.reusedExistingArtwork).toBe(true);
    expect(applied.text.length).toBeLessThan(5000);
    expect(state.event!.inviteArtworkUrl).toBe(original);
    expect(state.event!.inviteIllustrationUrl).toBe(original);
    const reloaded = await request(app).get(ownerPath);
    expect(reloaded.status).toBe(200); expect(reloaded.text.length).toBeLessThan(5000);
    expect(reloaded.body.event).toEqual(applied.body.event);
    const asset = await request(app).get(reloaded.body.event.inviteIllustrationUrl);
    expect(asset.status).toBe(200); expect(Buffer.from(asset.body).equals(source)).toBe(true);
    expect(source.length).toBeGreaterThan(4_500_000);
    expect(asset.headers["content-length"]).toBeUndefined();
    expect(asset.headers["transfer-encoding"]).toBe("chunked");
    expect(asset.headers["etag"]).toBeUndefined();
    expect(asset.headers["referrer-policy"]).toBe("no-referrer");
    expect(asset.headers["cache-control"]).toBe("private, no-store");
    expect(Buffer.from(decodePng(asset.body).rgb).equals(Buffer.from(sourcePixels.rgb))).toBe(true);
    const guest = await request(app).get(publicPath);
    expect(guest.text.length).toBeLessThan(5000);
    for (const secret of ["private@example.test", "private-session", "private brief", "private phone", "synthetic-artwork-owner", "prePaymentPreview"]) {
      expect(guest.text).not.toContain(secret);
    }
    expect(guest.body.eventName).toBe("Synthetic birthday");
    const guestAsset = await request(app).get(guest.body.inviteIllustrationUrl);
    expect(guestAsset.status).toBe(200); expect(Buffer.from(guestAsset.body).equals(source)).toBe(true);
    expect(state.writes).toBe(1);
    expect(Buffer.byteLength(JSON.stringify({ ...state.event }))).toBeGreaterThan(4_500_000);
    measurements.push({ marker, previousEventJsonBytes: Buffer.byteLength(JSON.stringify(state.event)),
      reuseResponseBytes: Buffer.byteLength(applied.text), ownerReloadBytes: Buffer.byteLength(reloaded.text),
      publicEventBytes: Buffer.byteLength(guest.text), ownerAssetBytes: asset.body.length, publicAssetBytes: guestAsset.body.length,
      originalBytesPreserved: true, originalPixelsPreserved: true, writes: state.writes });
  });

  it("preserves image bytes when a wording save sends the displayed URL back", async () => {
    state.event!.inviteArtworkUrl = original;
    const app = await makeApp(); const view = (await request(app).get(ownerPath)).body.event;
    const saved = await request(app).patch(ownerPath).send({ inviteSubject: "Updated wording", inviteArtworkUrl: view.inviteArtworkUrl });
    expect(saved.status).toBe(200); expect(saved.text.length).toBeLessThan(5000);
    expect(state.event!.inviteArtworkUrl).toBe(original);
    expect(state.event!.inviteSubject).toBe("Updated wording");
    const oldUrl = view.inviteArtworkUrl;
    state.event!.inviteArtworkUrl = `data:image/png;base64,${Buffer.from("new artwork").toString("base64")}`;
    const stale = await request(app).patch(ownerPath).send({ inviteArtworkUrl: oldUrl });
    expect(stale.status).toBe(409); expect(state.writes).toBe(1);
    expect((await request(app).get(oldUrl)).status).toBe(404);
  });

  it("externalizes and restores the embedded AI-first artwork without changing its hash or concept", async () => {
    state.event!.inviteDesignConceptJson = JSON.stringify({ theme: { id: "test" }, aiFirst: { artworkUrl: original, assetHash: "unchanged-hash", concept: { title: "Keep" } } });
    const app = await makeApp();
    const view = ownerEventView(state.event!);
    expect(JSON.stringify(view).length).toBeLessThan(5000);
    const concept = JSON.parse(view.inviteDesignConceptJson);
    expect(Buffer.from((await request(app).get(concept.aiFirst.artworkUrl)).body).equals(source)).toBe(true);
    const result = await request(app).patch(ownerPath).send({ inviteDesignConceptJson: view.inviteDesignConceptJson });
    expect(result.status).toBe(200);
    expect(JSON.parse(state.event!.inviteDesignConceptJson)).toEqual({ theme: { id: "test" }, aiFirst: { artworkUrl: original, assetHash: "unchanged-hash", concept: { title: "Keep" } } });
    const guest = await request(app).get(publicPath);
    expect(guest.text).not.toContain("synthetic-artwork-owner");
    expect(Buffer.from((await request(app).get(JSON.parse(guest.body.inviteDesignConceptJson).aiFirst.artworkUrl)).body).equals(source)).toBe(true);
  });

  it("denies unknown owners, private preview fields, stale versions and unpublished public artwork", async () => {
    state.event!.inviteArtworkUrl = original;
    const app = await makeApp();
    const ownerUrl = eventArtworkUrl(state.event!, "inviteArtworkUrl");
    const publicUrl = eventArtworkUrl(state.event!, "inviteArtworkUrl", "public");
    expect((await request(app).get(ownerUrl.replace("synthetic-artwork-owner", "unknown"))).status).toBe(404);
    expect((await request(app).get(ownerUrl.replace("inviteArtworkUrl?", "prePaymentPreviewUrl?"))).status).toBe(404);
    expect((await request(app).get(ownerUrl.split("?")[0])).status).toBe(404);
    const crossEvent = await request(app).patch(ownerPath).send({ inviteArtworkUrl: ownerUrl.replace("synthetic-artwork-owner", "another-owner") });
    expect(crossEvent.status).toBe(409); expect(state.writes).toBe(0);
    state.event!.inviteStatus = "draft";
    expect((await request(app).get(publicUrl)).status).toBe(404);
    const guest = await request(app).get(publicPath);
    expect(guest.body.inviteArtworkUrl).toBe("");
    expect((await request(app).get(ownerUrl)).status).toBe(200);
  });

  it("supports HEAD without a body and never serves executable inline content", async () => {
    const app = await makeApp();
    state.event!.inviteArtworkUrl = original;
    const head = await request(app).head(eventArtworkUrl(state.event!, "inviteArtworkUrl"));
    expect(head.status).toBe(200); expect(head.text).toBeUndefined();
    expect(head.headers["cache-control"]).toBe("private, no-store");
    state.event!.inviteArtworkUrl = `data:image/svg+xml;base64,${Buffer.from("<svg><script>alert(1)</script></svg>").toString("base64")}`;
    expect((await request(app).get(eventArtworkUrl(state.event!, "inviteArtworkUrl"))).status).toBe(404);
    expect(state.writes).toBe(0);
  });
});

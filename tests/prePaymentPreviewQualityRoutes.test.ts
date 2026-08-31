import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import type { Event } from "@shared/schema";

process.env.DATABASE_URL = "postgres://test/test";

vi.mock("../server/storage", () => ({ storage: {} }));
vi.mock("../server/masterPlannerEntitlement", () => ({
  canGenerateDraft: vi.fn(async () => ({ ok: false, reason: "needs_payment" })),
}));
vi.mock("../server/inviteDesignAi", () => ({
  extractInspirationNotes: vi.fn(async () => "reference notes"),
}));

const { registerPrePaymentPreviewQualityRoutes } = await import(
  "../server/prePaymentPreviewQualityRoutes"
);

const OWNER = "owner-token-quality-lock";
const EVENT_ID = 410;
const OLD_PNG = `data:image/png;base64,${Buffer.from("old unreviewed pixels").toString("base64")}`;
const APPROVED_PNG = `data:image/png;base64,${Buffer.from("approved pixels").toString("base64")}`;

const baseEvent = {
  id: EVENT_ID,
  ownerToken: OWNER,
  eventName: "Brian and Blippi's Extravaganza",
  eventType: "Birthday Party",
  eventDate: "Saturday, November 7, 2026",
  themeName: "",
  vibeDescription: "Blippi and Meekah at indoor soft play with bubbles and ice cream treats",
  paletteColors: "[]",
  estimatedGuestCount: 32,
  sparkUnlockedAt: null,
  prePaymentPreviewUrl: "",
  prePaymentPreviewUsedAt: null,
  prePaymentPreviewAttempts: 0,
} as unknown as Event;

let stored: Event;
const getEventByOwnerToken = vi.fn(async (token: string) => token === OWNER ? stored : undefined);
const updateEventById = vi.fn(async (id: number, data: Partial<Event>) => {
  if (id !== EVENT_ID) return undefined;
  stored = { ...stored, ...data };
  return stored;
});
const generate = vi.fn();

function makeApp(mode: "off" | "direction-card" | "quality-image" = "direction-card") {
  const app = express();
  app.use(express.json({ limit: "6mb" }));
  registerPrePaymentPreviewQualityRoutes(app, {
    store: { getEventByOwnerToken, updateEventById },
    isUnlocked: async () => false,
    mode: () => mode,
    generate,
    analyzeInspiration: async () => "reference image shows exact character styling",
    now: () => 1_800_000_000_000,
  });
  return app;
}

beforeEach(() => {
  stored = { ...baseEvent };
  getEventByOwnerToken.mockClear();
  updateEventById.mockClear();
  generate.mockReset();
});

describe("quality-locked prepayment preview routes", () => {
  it("rejects an invalid email before any generation or write", async () => {
    const response = await request(makeApp())
      .post(`/api/events/owner/${OWNER}/prepayment-preview`)
      .send({ email: "not-an-email" });

    expect(response.status).toBe(400);
    expect(generate).not.toHaveBeenCalled();
    expect(updateEventById).not.toHaveBeenCalled();
  });

  it("defaults to a deterministic direction card and spends nothing", async () => {
    const response = await request(makeApp("direction-card"))
      .post(`/api/events/owner/${OWNER}/prepayment-preview`)
      .send({ email: "host@example.com" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      ready: true,
      kind: "direction-card",
      referenceRecommended: true,
    }));
    expect(generate).not.toHaveBeenCalled();
    expect(stored.prePaymentPreviewUrl).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(stored.prePaymentPreviewAttempts).toBe(0);
  });

  it("does not guess a named reference from text alone even when quality images are enabled", async () => {
    const response = await request(makeApp("quality-image"))
      .post(`/api/events/owner/${OWNER}/prepayment-preview`)
      .send({ email: "host@example.com" });

    expect(response.status).toBe(200);
    expect(response.body.kind).toBe("direction-card");
    expect(response.body.namedReference).toEqual({ id: "blippi-meekah", label: "Blippi + Meekah" });
    expect(generate).not.toHaveBeenCalled();
    expect(stored.prePaymentPreviewUrl).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it("may replace a direction card only with an image that the private quality function approved", async () => {
    stored = {
      ...stored,
      eventName: "Candlelit Fortieth",
      vibeDescription: "Elegant candlelit rooftop dinner with terracotta flowers",
    };
    generate.mockResolvedValue({
      kind: "approved-image",
      dataUrl: APPROVED_PNG,
      attempts: 2,
      model: "gpt-image-2",
      reviews: [],
    });

    const response = await request(makeApp("quality-image"))
      .post(`/api/events/owner/${OWNER}/prepayment-preview`)
      .send({ email: "host@example.com" });

    expect(response.status).toBe(200);
    expect(response.body.kind).toBe("approved-image");
    expect(generate).toHaveBeenCalledTimes(1);
    expect(stored.prePaymentPreviewUrl).toBe(APPROVED_PNG);
    expect(stored.prePaymentPreviewAttempts).toBe(1);
  });

  it("converts provider failure or rejected artwork into the safe card instead of a red error", async () => {
    stored = {
      ...stored,
      eventName: "Candlelit Fortieth",
      vibeDescription: "Elegant candlelit rooftop dinner with terracotta flowers",
    };
    generate.mockResolvedValue({
      kind: "unavailable",
      attempts: 0,
      model: "gpt-image-2",
      reviews: [],
      error: "credit_balance_exhausted",
    });

    const response = await request(makeApp("quality-image"))
      .post(`/api/events/owner/${OWNER}/prepayment-preview`)
      .send({ email: "host@example.com" });

    expect(response.status).toBe(200);
    expect(response.body.kind).toBe("direction-card");
    expect(stored.prePaymentPreviewUrl).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it("never serves an old PNG accepted before the quality lock", async () => {
    stored = {
      ...stored,
      prePaymentPreviewUrl: OLD_PNG,
      prePaymentPreviewUsedAt: 1,
    };

    const response = await request(makeApp("quality-image"))
      .get(`/api/events/owner/${OWNER}/prepayment-preview/asset`);

    expect(response.status).toBe(404);
    expect(JSON.stringify(response.body)).not.toContain("old unreviewed pixels");
  });

  it("serves the deterministic card as a crisp private SVG", async () => {
    await request(makeApp("direction-card"))
      .post(`/api/events/owner/${OWNER}/prepayment-preview`)
      .send({ email: "host@example.com" });

    const response = await request(makeApp("direction-card"))
      .get(`/api/events/owner/${OWNER}/prepayment-preview/asset`);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("image/svg+xml");
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(Buffer.isBuffer(response.body)).toBe(true);
    const svg = (response.body as Buffer).toString("utf8");
    expect(svg).toContain("Blippi + Meekah");
    expect(svg).toContain("Indoor soft play");
  });

  it("reports named-reference routing before any customer action", async () => {
    const response = await request(makeApp("direction-card"))
      .get(`/api/events/owner/${OWNER}/prepayment-preview/readiness`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      mode: "direction-card",
      imageGenerationEnabled: false,
      referenceRecommended: true,
      namedReference: { id: "blippi-meekah", label: "Blippi + Meekah" },
    }));
  });
});

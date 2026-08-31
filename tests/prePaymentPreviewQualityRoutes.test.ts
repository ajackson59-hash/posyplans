import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import type { Event } from "@shared/schema";
import { isReferenceBoardDataUrl } from "../server/prePaymentReferenceBoard";

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
const analyzeInspiration = vi.fn(async () => "reference image shows exact character styling");

function makeApp(mode: "off" | "direction-card" | "quality-image" = "direction-card") {
  const app = express();
  app.use(express.json({ limit: "6mb" }));
  registerPrePaymentPreviewQualityRoutes(app, {
    store: { getEventByOwnerToken, updateEventById },
    isUnlocked: async () => false,
    mode: () => mode,
    generate,
    analyzeInspiration,
    now: () => 1_800_000_000_000,
  });
  return app;
}

function genericEvent(): Event {
  return {
    ...stored,
    eventName: "Candlelit Fortieth",
    vibeDescription: "Elegant candlelit rooftop dinner with terracotta flowers",
  };
}

function decodedStoredSvg(): string {
  const marker = ";base64,";
  const encoded = stored.prePaymentPreviewUrl.slice(
    stored.prePaymentPreviewUrl.indexOf(marker) + marker.length,
  );
  return Buffer.from(encoded, "base64").toString("utf8");
}

beforeEach(() => {
  stored = { ...baseEvent };
  getEventByOwnerToken.mockClear();
  updateEventById.mockClear();
  generate.mockReset();
  analyzeInspiration.mockClear();
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
      referenceCaptured: false,
    }));
    expect(generate).not.toHaveBeenCalled();
    expect(stored.prePaymentPreviewUrl).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(stored.prePaymentPreviewAttempts).toBe(0);
  });

  it("never guesses a named entertainment reference from text alone", async () => {
    const response = await request(makeApp("quality-image"))
      .post(`/api/events/owner/${OWNER}/prepayment-preview`)
      .send({ email: "host@example.com" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      kind: "direction-card",
      namedReference: { id: "blippi-meekah", label: "Blippi + Meekah" },
      referenceRecommended: true,
    }));
    expect(generate).not.toHaveBeenCalled();
    expect(analyzeInspiration).not.toHaveBeenCalled();
    expect(stored.prePaymentPreviewAttempts).toBe(0);
  });

  it("turns a named-theme screenshot into exact visible proof without provider spend", async () => {
    const referenceBytes = Buffer.from("exact host reference pixels");
    const response = await request(makeApp("quality-image"))
      .post(`/api/events/owner/${OWNER}/prepayment-preview`)
      .send({
        email: "host@example.com",
        inspirationImages: [`data:image/png;base64,${referenceBytes.toString("base64")}`],
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      kind: "reference-board",
      referenceRecommended: false,
      referenceCaptured: true,
    }));
    expect(generate).not.toHaveBeenCalled();
    expect(analyzeInspiration).not.toHaveBeenCalled();
    expect(stored.prePaymentPreviewAttempts).toBe(0);
    expect(isReferenceBoardDataUrl(stored.prePaymentPreviewUrl)).toBe(true);

    const svg = decodedStoredSvg();
    expect(svg).toContain('data-posy-preview-kind="reference-board"');
    expect(svg).toContain("Blippi + Meekah");
    expect(svg).toContain(`data:image/png;base64,${referenceBytes.toString("base64")}`);
  });

  it("lets the host replace a pinned named-theme reference", async () => {
    const first = Buffer.from("first reference");
    const second = Buffer.from("second reference");

    await request(makeApp("direction-card"))
      .post(`/api/events/owner/${OWNER}/prepayment-preview`)
      .send({
        email: "host@example.com",
        inspirationImages: [`data:image/png;base64,${first.toString("base64")}`],
      });

    const response = await request(makeApp("direction-card"))
      .post(`/api/events/owner/${OWNER}/prepayment-preview`)
      .send({
        email: "host@example.com",
        inspirationImages: [`data:image/png;base64,${second.toString("base64")}`],
      });

    expect(response.body.kind).toBe("reference-board");
    const svg = decodedStoredSvg();
    expect(svg).toContain(second.toString("base64"));
    expect(svg).not.toContain(first.toString("base64"));
    expect(generate).not.toHaveBeenCalled();
  });

  it("rejects unsupported reference-image formats before any write", async () => {
    const response = await request(makeApp("quality-image"))
      .post(`/api/events/owner/${OWNER}/prepayment-preview`)
      .send({
        email: "host@example.com",
        inspirationImages: ["data:image/gif;base64,R0lGODlhAQABAIAAAAUEBA=="],
      });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("PNG, JPEG or WebP");
    expect(generate).not.toHaveBeenCalled();
    expect(updateEventById).not.toHaveBeenCalled();
  });

  it("allows an original theme to use only privately approved generated artwork", async () => {
    stored = genericEvent();
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

  it("converts an original-theme provider failure into the safe card", async () => {
    stored = genericEvent();
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

  it("never serves a generated PNG for a named entertainment theme", async () => {
    stored = {
      ...stored,
      prePaymentPreviewUrl: OLD_PNG,
      prePaymentPreviewUsedAt: 1_900_000_000_000,
    };

    const response = await request(makeApp("quality-image"))
      .get(`/api/events/owner/${OWNER}/prepayment-preview/asset`);

    expect(response.status).toBe(404);
    expect(JSON.stringify(response.body)).not.toContain("old unreviewed pixels");
  });

  it("serves both structured preview types as crisp private SVGs", async () => {
    await request(makeApp("direction-card"))
      .post(`/api/events/owner/${OWNER}/prepayment-preview`)
      .send({ email: "host@example.com" });

    const direction = await request(makeApp("direction-card"))
      .get(`/api/events/owner/${OWNER}/prepayment-preview/asset`);
    expect(direction.status).toBe(200);
    expect(direction.headers["content-type"]).toContain("image/svg+xml");
    expect((direction.body as Buffer).toString("utf8")).toContain("Blippi + Meekah");

    const referenceBytes = Buffer.from("exact reference");
    await request(makeApp("direction-card"))
      .post(`/api/events/owner/${OWNER}/prepayment-preview`)
      .send({
        email: "host@example.com",
        inspirationImages: [`data:image/jpeg;base64,${referenceBytes.toString("base64")}`],
      });

    const board = await request(makeApp("direction-card"))
      .get(`/api/events/owner/${OWNER}/prepayment-preview/asset`);
    expect(board.status).toBe(200);
    expect(board.headers["content-type"]).toContain("image/svg+xml");
    expect(board.headers["cache-control"]).toBe("private, no-store");
    expect((board.body as Buffer).toString("utf8")).toContain("VISUAL REFERENCE CAPTURED");
  });

  it("reports captured-reference state without offering image generation", async () => {
    const referenceBytes = Buffer.from("exact reference");
    await request(makeApp("quality-image"))
      .post(`/api/events/owner/${OWNER}/prepayment-preview`)
      .send({
        email: "host@example.com",
        inspirationImages: [`data:image/png;base64,${referenceBytes.toString("base64")}`],
      });

    const response = await request(makeApp("quality-image"))
      .get(`/api/events/owner/${OWNER}/prepayment-preview/readiness`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      mode: "quality-image",
      kind: "reference-board",
      imageGenerationEnabled: false,
      referenceRecommended: false,
      referenceCaptured: true,
      namedReference: { id: "blippi-meekah", label: "Blippi + Meekah" },
    }));
  });
});

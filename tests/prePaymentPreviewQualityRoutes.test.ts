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

const { registerPrePaymentPreviewQualityRoutes } = await import(
  "../server/prePaymentPreviewQualityRoutes"
);

const OWNER = "owner-token-quality-lock";
const EVENT_ID = 410;
const OLD_PNG = `data:image/png;base64,${Buffer.from("old unreviewed pixels").toString("base64")}`;
const APPROVED_BYTES = Buffer.from("approved private pixels");
const APPROVED_PNG = `data:image/png;base64,${APPROVED_BYTES.toString("base64")}`;
const QUALITY_PREFIX = "data:image/png;posy-quality-approved;base64,";

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
const resolveNamedReference = vi.fn();

function makeApp(options: {
  mode?: "off" | "direction-card" | "quality-image";
  autoNamed?: boolean;
  unlocked?: boolean;
} = {}) {
  const app = express();
  app.use(express.json({ limit: "6mb" }));
  registerPrePaymentPreviewQualityRoutes(app, {
    store: { getEventByOwnerToken, updateEventById },
    isUnlocked: async () => options.unlocked ?? false,
    mode: () => options.mode ?? "direction-card",
    autoNamedEnabled: () => options.autoNamed ?? true,
    resolveNamedReference,
    generate,
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

function automaticResolution() {
  return {
    images: [{
      bytes: Buffer.from("official Blippi and Meekah reference pixels"),
      mimeType: "image/png" as const,
      filename: "automatic-reference-1.png",
    }],
    notes: "Official Blippi and Meekah identity references",
    strategy: "curated" as const,
    sourcePages: ["https://www.blippi.com/about"],
  };
}

beforeEach(() => {
  stored = { ...baseEvent };
  getEventByOwnerToken.mockClear();
  updateEventById.mockClear();
  generate.mockReset();
  resolveNamedReference.mockReset();
});

describe("quality-locked prepayment preview routes", () => {
  it("rejects an invalid email before any resolution, generation or write", async () => {
    const response = await request(makeApp())
      .post(`/api/events/owner/${OWNER}/prepayment-preview`)
      .send({ email: "not-an-email" });

    expect(response.status).toBe(400);
    expect(resolveNamedReference).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(updateEventById).not.toHaveBeenCalled();
  });

  it("automatically resolves and privately approves a named-theme first look", async () => {
    resolveNamedReference.mockResolvedValue(automaticResolution());
    generate.mockResolvedValue({
      kind: "approved-image",
      dataUrl: APPROVED_PNG,
      attempts: 1,
      model: "gpt-image-2",
      reviews: [],
    });

    const response = await request(makeApp())
      .post(`/api/events/owner/${OWNER}/prepayment-preview`)
      .send({ email: "host@example.com" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      ready: true,
      kind: "approved-image",
      referenceRecommended: false,
      automaticReferenceAttempted: true,
    }));
    expect(resolveNamedReference).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0][1]).toEqual(expect.objectContaining({
      inspirationNotes: "Official Blippi and Meekah identity references",
      quality: "high",
      maxCandidates: 2,
    }));
    expect(generate.mock.calls[0][1].referenceImages).toHaveLength(1);
    expect(stored.prePaymentPreviewAttempts).toBe(1);
    expect(stored.prePaymentPreviewUrl).toBe(`${QUALITY_PREFIX}${APPROVED_BYTES.toString("base64")}`);
  });

  it("fails closed to the direction card when automatic reference resolution is unavailable", async () => {
    resolveNamedReference.mockResolvedValue(null);

    const response = await request(makeApp())
      .post(`/api/events/owner/${OWNER}/prepayment-preview`)
      .send({ email: "host@example.com" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      kind: "direction-card",
      referenceRecommended: false,
      automaticReferenceAttempted: true,
      namedReference: { id: "blippi-meekah", label: "Blippi + Meekah" },
    }));
    expect(generate).not.toHaveBeenCalled();
    expect(stored.prePaymentPreviewAttempts).toBe(1);
    expect(stored.prePaymentPreviewUrl).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it("keeps rejected named-theme candidates private and shows the reliable direction", async () => {
    resolveNamedReference.mockResolvedValue(automaticResolution());
    generate.mockResolvedValue({
      kind: "rejected",
      attempts: 2,
      model: "gpt-image-1.5",
      reviews: [],
    });

    const response = await request(makeApp())
      .post(`/api/events/owner/${OWNER}/prepayment-preview`)
      .send({ email: "host@example.com" });

    expect(response.status).toBe(200);
    expect(response.body.kind).toBe("direction-card");
    expect(stored.prePaymentPreviewUrl).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(JSON.stringify(response.body)).not.toContain("data:image");
  });

  it("does not repeat provider spend after a completed automatic attempt returned the direction card", async () => {
    stored = {
      ...stored,
      prePaymentPreviewAttempts: 1,
      prePaymentPreviewUrl: "data:image/svg+xml;base64,AAAA",
      prePaymentPreviewUsedAt: 1_800_000_000_000,
    };

    const response = await request(makeApp())
      .post(`/api/events/owner/${OWNER}/prepayment-preview`)
      .send({ email: "host@example.com" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      kind: "direction-card",
      automaticReferenceAttempted: true,
    }));
    expect(resolveNamedReference).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it("supports a host-supplied reference only as an optional override without provider spend", async () => {
    const referenceBytes = Buffer.from("exact host reference pixels");
    const response = await request(makeApp())
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
    expect(resolveNamedReference).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(stored.prePaymentPreviewAttempts).toBe(0);
    expect(isReferenceBoardDataUrl(stored.prePaymentPreviewUrl)).toBe(true);
    expect(decodedStoredSvg()).toContain(`data:image/png;base64,${referenceBytes.toString("base64")}`);
  });

  it("uses the safe direction card when automatic named research is disabled", async () => {
    const response = await request(makeApp({ autoNamed: false }))
      .post(`/api/events/owner/${OWNER}/prepayment-preview`)
      .send({ email: "host@example.com" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      kind: "direction-card",
      automaticReferenceAttempted: false,
    }));
    expect(resolveNamedReference).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(stored.prePaymentPreviewAttempts).toBe(0);
  });

  it("keeps original themes behind the separate quality-image release gate", async () => {
    stored = genericEvent();

    const response = await request(makeApp({ mode: "direction-card" }))
      .post(`/api/events/owner/${OWNER}/prepayment-preview`)
      .send({ email: "host@example.com" });

    expect(response.status).toBe(200);
    expect(response.body.kind).toBe("direction-card");
    expect(resolveNamedReference).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it("stores original-theme artwork only after the private quality function approves it", async () => {
    stored = genericEvent();
    generate.mockResolvedValue({
      kind: "approved-image",
      dataUrl: APPROVED_PNG,
      attempts: 2,
      model: "gpt-image-2",
      reviews: [],
    });

    const response = await request(makeApp({ mode: "quality-image" }))
      .post(`/api/events/owner/${OWNER}/prepayment-preview`)
      .send({ email: "host@example.com" });

    expect(response.status).toBe(200);
    expect(response.body.kind).toBe("approved-image");
    expect(generate).toHaveBeenCalledTimes(1);
    expect(stored.prePaymentPreviewUrl).toBe(`${QUALITY_PREFIX}${APPROVED_BYTES.toString("base64")}`);
    expect(stored.prePaymentPreviewAttempts).toBe(1);
  });

  it("never serves an ordinary PNG left by an older preview experiment", async () => {
    stored = {
      ...stored,
      prePaymentPreviewUrl: OLD_PNG,
      prePaymentPreviewUsedAt: 1_900_000_000_000,
    };

    const response = await request(makeApp())
      .get(`/api/events/owner/${OWNER}/prepayment-preview/asset`);

    expect(response.status).toBe(404);
    expect(JSON.stringify(response.body)).not.toContain("old unreviewed pixels");
  });

  it("serves a marked quality-approved named image", async () => {
    stored = {
      ...stored,
      prePaymentPreviewUrl: `${QUALITY_PREFIX}${APPROVED_BYTES.toString("base64")}`,
      prePaymentPreviewUsedAt: 1_900_000_000_000,
      prePaymentPreviewAttempts: 1,
    };

    const response = await request(makeApp({ unlocked: true }))
      .get(`/api/events/owner/${OWNER}/prepayment-preview/asset`);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("image/png");
    expect(Buffer.compare(response.body as Buffer, APPROVED_BYTES)).toBe(0);
  });

  it("reports automatic named-reference routing before customer action", async () => {
    const response = await request(makeApp())
      .get(`/api/events/owner/${OWNER}/prepayment-preview/readiness`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      kind: "none",
      imageGenerationEnabled: true,
      namedReference: { id: "blippi-meekah", label: "Blippi + Meekah" },
      referenceRecommended: false,
      automaticReferenceResolutionEnabled: true,
      automaticReferenceAttempted: false,
    }));
  });
});

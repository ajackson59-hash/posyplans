// Route coverage for the B2a pre-payment invitation preview: real AI
// generation before checkout, but capped to a few attempts, gated by a
// plausible request email without persisting it as ownership, and served
// through a low-resolution endpoint that never exposes the original before
// payment. Mirrors the supertest
// harness pattern established in tests/paywallEntitlementGate.test.ts.

import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createServer } from "node:http";
import { decodePng, encodePng } from "../server/aiFirst/png";
import { PRE_PAYMENT_PREVIEW_LONG_EDGE } from "../server/prePaymentPreview";

process.env.DATABASE_URL = "postgres://test/test";

const OWNER = "owner-token-test";
const EVENT_ID = 205;

// A tiny but non-trivial synthetic PNG (checkerboard) so the blur endpoint
// has real detail to genuinely destroy, and the full-quality reveal has
// real bytes to compare against.
function syntheticInviteDataUrl(): string {
  const size = 320;
  const rgb = new Uint8Array(size * size * 3);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 3;
      const on = (Math.floor(x / 8) + Math.floor(y / 8)) % 2 === 0;
      rgb[i] = on ? 20 : 230;
      rgb[i + 1] = on ? 20 : 230;
      rgb[i + 2] = on ? 20 : 230;
    }
  }
  const png = encodePng({ width: size, height: size, rgb });
  return `data:image/png;base64,${png.toString("base64")}`;
}

const SYNTHETIC_INVITE = syntheticInviteDataUrl();

const baseEvent = {
  id: EVENT_ID,
  ownerToken: OWNER,
  shareSlug: "slug",
  eventName: "Nina's Fortieth",
  eventType: "birthday",
  eventDate: "Saturday, June 14",
  location: "The Rosewood Terrace",
  hostNames: "Nina & Sam",
  themeName: "",
  capturedEmail: null as string | null,
  sparkUnlockedAt: null as number | null,
  prePaymentPreviewUrl: "",
  prePaymentPreviewUsedAt: null as number | null,
  prePaymentPreviewAttempts: 0,
};

let stored: Record<string, unknown>;
let entitlement: { planTier: string; trialEndsAt?: number | null } | undefined;

const generateInviteDesignConcepts = vi.fn(async () => [
  { conceptName: "Test Concept", layoutStyle: "centered" },
]);
const generateInviteIllustrationWithQualityGate = vi.fn(async () => SYNTHETIC_INVITE);

vi.mock("../server/storage", () => ({
  storage: {
    getEventByOwnerToken: async (token: string) => (token === OWNER ? { ...stored } : undefined),
    getEventById: async (id: number) => (id === EVENT_ID ? { ...stored } : undefined),
    updateEventById: async (id: number, data: Record<string, unknown>) => {
      if (id !== EVENT_ID) return undefined;
      stored = { ...stored, ...data };
      return { ...stored };
    },
    updateEventByOwnerToken: async (token: string, data: Record<string, unknown>) => {
      if (token !== OWNER) return undefined;
      stored = { ...stored, ...data };
      return { ...stored };
    },
    getEmailEntitlement: async () => entitlement,
  },
}));

vi.mock("../server/inviteDesignAi", () => ({
  generateInviteDesignConcepts,
  extractInspirationNotes: vi.fn(async () => ""),
}));

vi.mock("../server/illustrationGen", () => ({
  generateInviteIllustration: vi.fn(async () => SYNTHETIC_INVITE),
  generateInviteIllustrationWithQualityGate,
}));

const { registerRoutes } = await import("../server/routes");

async function makeApp() {
  const app = express();
  app.use(express.json());
  await registerRoutes(createServer(app), app);
  return app;
}

beforeEach(() => {
  stored = { ...baseEvent };
  entitlement = undefined;
  generateInviteDesignConcepts.mockClear();
  generateInviteIllustrationWithQualityGate.mockClear();
});

describe("POST /prepayment-preview", () => {
  it("refuses a missing or invalid request email before calling any model", async () => {
    const app = await makeApp();
    const res = await request(app).post(`/api/events/owner/${OWNER}/prepayment-preview`).send({});

    expect(res.status).toBe(400);
    expect(generateInviteIllustrationWithQualityGate).not.toHaveBeenCalled();
    expect(stored.prePaymentPreviewAttempts).toBe(0);
  });

  it("generates a preview without persisting the provisional request email", async () => {
    const app = await makeApp();
    const res = await request(app)
      .post(`/api/events/owner/${OWNER}/prepayment-preview`)
      .send({ email: "host@example.com" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ready: true });
    expect(generateInviteIllustrationWithQualityGate).toHaveBeenCalledTimes(1);
    expect(stored.prePaymentPreviewUrl).toBe(SYNTHETIC_INVITE);
    expect(stored.prePaymentPreviewAttempts).toBe(1);
    expect(stored.capturedEmail).toBeNull();
    // Never leaks the raw data URL in the response body.
    expect(JSON.stringify(res.body)).not.toContain("base64");
  });

  it("is idempotent: a second call does not spend again", async () => {
    const app = await makeApp();
    await request(app)
      .post(`/api/events/owner/${OWNER}/prepayment-preview`)
      .send({ email: "host@example.com" });
    generateInviteIllustrationWithQualityGate.mockClear();

    const res = await request(app)
      .post(`/api/events/owner/${OWNER}/prepayment-preview`)
      .send({ email: "host@example.com" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ready: true });
    expect(generateInviteIllustrationWithQualityGate).not.toHaveBeenCalled();
  });

  it("refuses an already Spark-unlocked event with 409, and does not spend", async () => {
    stored.sparkUnlockedAt = Date.now();
    const app = await makeApp();
    const res = await request(app)
      .post(`/api/events/owner/${OWNER}/prepayment-preview`)
      .send({ email: "host@example.com" });

    expect(res.status).toBe(409);
    expect(generateInviteIllustrationWithQualityGate).not.toHaveBeenCalled();
  });

  it("refuses an already Plus-active event with 409, and does not spend", async () => {
    stored.capturedEmail = "plus@example.com";
    entitlement = { planTier: "plus_active" };
    const app = await makeApp();
    const res = await request(app)
      .post(`/api/events/owner/${OWNER}/prepayment-preview`)
      .send({ email: "plus@example.com" });

    expect(res.status).toBe(409);
    expect(generateInviteIllustrationWithQualityGate).not.toHaveBeenCalled();
  });

  it("stops after the attempt cap and never exceeds it even on repeated failure", async () => {
    generateInviteIllustrationWithQualityGate.mockRejectedValue(new Error("provider down"));
    const app = await makeApp();

    for (let i = 0; i < 5; i += 1) {
      await request(app)
        .post(`/api/events/owner/${OWNER}/prepayment-preview`)
        .send({ email: "host@example.com" });
    }

    expect(stored.prePaymentPreviewAttempts).toBe(3);
    const res = await request(app)
      .post(`/api/events/owner/${OWNER}/prepayment-preview`)
      .send({ email: "host@example.com" });
    expect(res.status).toBe(429);
  });
});

describe("GET /prepayment-preview/asset", () => {
  it("404s when no preview has been generated yet", async () => {
    const app = await makeApp();
    const res = await request(app).get(`/api/events/owner/${OWNER}/prepayment-preview/asset`);
    expect(res.status).toBe(404);
  });

  it("serves a useful low-resolution PNG to an unpaid caller — never the raw bytes", async () => {
    stored.prePaymentPreviewUrl = SYNTHETIC_INVITE;
    const app = await makeApp();
    const res = await request(app).get(`/api/events/owner/${OWNER}/prepayment-preview/asset`);

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");
    expect(res.headers["cache-control"]).toBe("private, no-store");

    const originalBytes = Buffer.from(SYNTHETIC_INVITE.split(",")[1], "base64");
    expect(res.body.length).toBeLessThan(originalBytes.length);
    expect(Buffer.compare(res.body as Buffer, originalBytes)).not.toBe(0);
    const preview = decodePng(res.body as Buffer);
    expect(Math.max(preview.width, preview.height)).toBe(PRE_PAYMENT_PREVIEW_LONG_EDGE);
  });

  it("serves the exact original bytes to a Spark-unlocked (paid) caller", async () => {
    stored.prePaymentPreviewUrl = SYNTHETIC_INVITE;
    stored.sparkUnlockedAt = Date.now();
    const app = await makeApp();
    const res = await request(app).get(`/api/events/owner/${OWNER}/prepayment-preview/asset`);

    expect(res.status).toBe(200);
    const originalBytes = Buffer.from(SYNTHETIC_INVITE.split(",")[1], "base64");
    expect(Buffer.compare(res.body as Buffer, originalBytes)).toBe(0);
  });

  it("serves the exact original bytes to a Plus-active caller", async () => {
    stored.prePaymentPreviewUrl = SYNTHETIC_INVITE;
    stored.capturedEmail = "plus@example.com";
    entitlement = { planTier: "plus_active" };
    const app = await makeApp();
    const res = await request(app).get(`/api/events/owner/${OWNER}/prepayment-preview/asset`);

    expect(res.status).toBe(200);
    const originalBytes = Buffer.from(SYNTHETIC_INVITE.split(",")[1], "base64");
    expect(Buffer.compare(res.body as Buffer, originalBytes)).toBe(0);
  });
});

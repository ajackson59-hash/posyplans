// Regression coverage for the confirmed production paywall bypass (QA
// report, B2): an anonymous, unpaid, un-emailed visitor could reach real
// billed AI artwork generation — and a published invitation carrying it —
// through three separate route surfaces. Each surface is tested against a
// paid event (must succeed, unchanged behavior) and an unpaid event (must be
// refused before any provider call, with zero spend).

import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createServer } from "node:http";

process.env.DATABASE_URL = "postgres://test/test";

const OWNER = "owner-token-test";
const EVENT_ID = 76; // same id referenced by the QA report's leaked event

const baseEvent = {
  id: EVENT_ID,
  ownerToken: OWNER,
  shareSlug: "slug",
  eventName: "Nina's Fortieth",
  eventType: "birthday",
  eventDate: "Saturday, June 14",
  location: "The Rosewood Terrace",
  hostNames: "Nina & Sam",
  rsvpDeadline: "June 1",
  themeName: "",
  paletteColors: "[]",
  inviteSubject: "",
  inviteMessage: "",
  inviteDesignConceptJson: "{}",
  inviteIllustrationUrl: "",
  customInviteImageUrl: "",
  inviteRenderMode: "",
  envelopeColor: "",
  envelopeLinerPattern: "",
  stampStyle: "",
  linerColor: "",
  stampColor: "",
  capturedEmail: null as string | null,
  sparkUnlockedAt: null as number | null,
};

let stored: Record<string, unknown>;
let entitlement: { planTier: string; trialEndsAt?: number | null } | undefined;

const generateInviteIllustration = vi.fn(async () => "data:image/png;base64,AAA");
const generateInviteIllustrationWithQualityGate = vi.fn(async () => "data:image/png;base64,AAA");

vi.mock("../server/storage", () => ({
  storage: {
    getEventByOwnerToken: async (token: string) => (token === OWNER ? { ...stored } : undefined),
    getEventById: async (id: number) => (id === EVENT_ID ? { ...stored } : undefined),
    updateEventByOwnerToken: async (token: string, data: Record<string, unknown>) => {
      if (token !== OWNER) return undefined;
      stored = { ...stored, ...data };
      return { ...stored };
    },
    getEmailEntitlement: async () => entitlement,
  },
}));

vi.mock("../server/illustrationGen", () => ({
  generateInviteIllustration,
  generateInviteIllustrationWithQualityGate,
}));

const { registerRoutes } = await import("../server/routes");
const { FONT_PAIRINGS } = await import("../shared/inviteDesign");

async function makeApp() {
  const app = express();
  app.use(express.json());
  await registerRoutes(createServer(app), app);
  return app;
}

const validConcept = {
  conceptName: "Orbital Lariat Chrome",
  description: "A premium modern composition.",
  paletteColors: ["#1a1a1a", "#c9a227", "#f5f0e6", "#7a5230"],
  fontPairingId: FONT_PAIRINGS[0].id,
  borderStyle: "thin-frame",
  layoutStyle: "centered",
  illustrationPrompt: "A premium modern composition with a focal planet.",
};

beforeEach(() => {
  stored = { ...baseEvent };
  entitlement = undefined;
  generateInviteIllustration.mockClear();
  generateInviteIllustrationWithQualityGate.mockClear();
});

describe("POST /invite/preview-concept payment gate", () => {
  it("refuses an unpaid, un-emailed event before calling the image model", async () => {
    const app = await makeApp();
    const res = await request(app)
      .post(`/api/events/owner/${OWNER}/invite/preview-concept`)
      .send({ concept: validConcept });

    expect(res.status).toBe(402);
    expect(generateInviteIllustration).not.toHaveBeenCalled();
  });

  it("allows preview once the event has an unlocked Spark purchase", async () => {
    stored.sparkUnlockedAt = Date.now();
    const app = await makeApp();
    const res = await request(app)
      .post(`/api/events/owner/${OWNER}/invite/preview-concept`)
      .send({ concept: validConcept });

    expect(res.status).toBe(200);
    expect(generateInviteIllustration).toHaveBeenCalledTimes(1);
  });

  it("allows preview for an active Plus subscriber", async () => {
    stored.capturedEmail = "host@example.com";
    entitlement = { planTier: "plus_active" };
    const app = await makeApp();
    const res = await request(app)
      .post(`/api/events/owner/${OWNER}/invite/preview-concept`)
      .send({ concept: validConcept });

    expect(res.status).toBe(200);
    expect(generateInviteIllustration).toHaveBeenCalledTimes(1);
  });

  it("refuses an expired Plus trial", async () => {
    stored.capturedEmail = "host@example.com";
    entitlement = { planTier: "plus_trial", trialEndsAt: Date.now() - 1000 };
    const app = await makeApp();
    const res = await request(app)
      .post(`/api/events/owner/${OWNER}/invite/preview-concept`)
      .send({ concept: validConcept });

    expect(res.status).toBe(402);
    expect(generateInviteIllustration).not.toHaveBeenCalled();
  });
});

describe("POST /invite/apply-concept payment gate", () => {
  it("refuses an unpaid, un-emailed event before calling the image model, and does not persist anything", async () => {
    const app = await makeApp();
    const res = await request(app)
      .post(`/api/events/owner/${OWNER}/invite/apply-concept`)
      .send({ concept: validConcept });

    expect(res.status).toBe(402);
    expect(generateInviteIllustrationWithQualityGate).not.toHaveBeenCalled();
    expect(stored.inviteIllustrationUrl).toBe("");
  });

  it("refuses an unpaid event even when a pre-generated illustrationUrl is supplied", async () => {
    // Guards against a client that calls preview first (which would itself
    // be refused), grabs the fallback/no-op response, then tries to smuggle
    // an illustrationUrl straight into apply-concept to skip billing.
    const app = await makeApp();
    const res = await request(app)
      .post(`/api/events/owner/${OWNER}/invite/apply-concept`)
      .send({ concept: validConcept, illustrationUrl: "data:image/png;base64,smuggled" });

    expect(res.status).toBe(402);
    expect(generateInviteIllustrationWithQualityGate).not.toHaveBeenCalled();
    expect(stored.inviteIllustrationUrl).toBe("");
  });

  it("allows apply once the event has an unlocked Spark purchase, and persists the illustration", async () => {
    stored.sparkUnlockedAt = Date.now();
    const app = await makeApp();
    const res = await request(app)
      .post(`/api/events/owner/${OWNER}/invite/apply-concept`)
      .send({ concept: validConcept });

    expect(res.status).toBe(200);
    expect(generateInviteIllustrationWithQualityGate).toHaveBeenCalledTimes(1);
    expect(stored.inviteIllustrationUrl).toBe("data:image/png;base64,AAA");
  });

  it("allows apply for an active Plus subscriber", async () => {
    stored.capturedEmail = "host@example.com";
    entitlement = { planTier: "plus_active" };
    const app = await makeApp();
    const res = await request(app)
      .post(`/api/events/owner/${OWNER}/invite/apply-concept`)
      .send({ concept: validConcept });

    expect(res.status).toBe(200);
    expect(generateInviteIllustrationWithQualityGate).toHaveBeenCalledTimes(1);
  });
});

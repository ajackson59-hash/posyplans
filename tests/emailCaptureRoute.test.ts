// Regression coverage for a duplicate-route bug found while building B2a:
// two independent handlers were registered for
// POST /api/events/:eventId/email-capture. Express always dispatches to the
// FIRST matching registration, so the earlier (cruder) handler silently
// shadowed the later, better one — every caller got a raw Event body
// instead of an EntitlementSummary, which made the paywall's "Use my Plus
// email" button show a false failure toast on every use. This file locks in
// the surviving route's actual (EntitlementSummary) contract so a future
// duplicate registration would break these tests instead of shipping silently.

import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createServer } from "node:http";

process.env.DATABASE_URL = "postgres://test/test";

const OWNER = "owner-token-test";
const EVENT_ID = 91;

const sendEventRecoveryEmail = vi.fn(async () => ({ ok: true }));
vi.mock("../server/email", () => ({
  sendEventRecoveryEmail,
  sendInviteEmail: vi.fn(async () => ({ ok: true })),
}));

const baseEvent = {
  id: EVENT_ID,
  ownerToken: OWNER,
  eventName: "Nina's Fortieth",
  eventType: "Birthday Party",
  eventDate: "Saturday, June 14",
  draftStatus: "not_started",
  capturedEmail: null as string | null,
  sparkUnlockedAt: null as number | null,
};

let stored: Record<string, unknown>;
let entitlement: { planTier: string; trialEndsAt?: number | null } | undefined;

vi.mock("../server/storage", () => ({
  storage: {
    getEventById: async (id: number) => (id === EVENT_ID ? { ...stored } : undefined),
    getEventByOwnerToken: async (token: string) => (token === OWNER ? { ...stored } : undefined),
    setEventCapturedEmail: async (id: number, email: string) => {
      if (id !== EVENT_ID) return;
      stored = { ...stored, capturedEmail: email };
    },
    getEmailEntitlement: async () => entitlement,
  },
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
  sendEventRecoveryEmail.mockClear();
  sendEventRecoveryEmail.mockResolvedValue({ ok: true });
});

describe("POST /api/events/:eventId/email-capture", () => {
  it("returns an EntitlementSummary (canGenerate: false) for an unpaid, un-entitled email", async () => {
    const app = await makeApp();
    const res = await request(app)
      .post(`/api/events/${EVENT_ID}/email-capture`)
      .send({ email: "host@example.com", ownerToken: OWNER });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      eventId: EVENT_ID,
      emailCaptured: true,
      canGenerate: false,
    });
    expect(stored.capturedEmail).toBe("host@example.com");
    expect(sendEventRecoveryEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: "host@example.com",
      subject: "Your private Posy event link",
      body: expect.stringContaining(`https://posyplans.com/dashboard/${OWNER}`),
    }));
  });

  it("returns canGenerate: true when the captured email holds an active Plus plan", async () => {
    entitlement = { planTier: "plus_active" };
    const app = await makeApp();
    const res = await request(app)
      .post(`/api/events/${EVENT_ID}/email-capture`)
      .send({ email: "plus@example.com", ownerToken: OWNER });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ emailCaptured: true, canGenerate: true, planTier: "plus_active" });
  });

  it("rejects a request without a valid ownerToken", async () => {
    const app = await makeApp();
    const res = await request(app)
      .post(`/api/events/${EVENT_ID}/email-capture`)
      .send({ email: "host@example.com" });

    expect(res.status).toBe(401);
  });

  it("rejects an implausible email without touching storage", async () => {
    const app = await makeApp();
    const res = await request(app)
      .post(`/api/events/${EVENT_ID}/email-capture`)
      .send({ email: "not-an-email", ownerToken: OWNER });

    expect(res.status).toBe(400);
    expect(stored.capturedEmail).toBeNull();
  });

  it("lets the owner correct an already-captured email and sends the new private link", async () => {
    stored.capturedEmail = "first@example.com";
    const app = await makeApp();
    const res = await request(app)
      .post(`/api/events/${EVENT_ID}/email-capture`)
      .send({ email: "second@example.com", ownerToken: OWNER });

    expect(res.status).toBe(200);
    expect(stored.capturedEmail).toBe("second@example.com");
    expect(sendEventRecoveryEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: "second@example.com",
    }));
  });

  it("does not resend the private link when the same email is captured again", async () => {
    stored.capturedEmail = "host@example.com";
    const app = await makeApp();
    const res = await request(app)
      .post(`/api/events/${EVENT_ID}/email-capture`)
      .send({ email: "HOST@example.com", ownerToken: OWNER });

    expect(res.status).toBe(200);
    expect(stored.capturedEmail).toBe("host@example.com");
    expect(sendEventRecoveryEmail).not.toHaveBeenCalled();
  });
});

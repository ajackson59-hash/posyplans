import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createServer } from "node:http";

process.env.DATABASE_URL = "postgres://test/test";

const OWNER = "owner-token-test";
const EVENT_ID = 312;

const baseEvent = {
  id: EVENT_ID,
  ownerToken: OWNER,
  eventName: "Nina's Fortieth",
  eventType: "Birthday Party",
  eventDate: "Saturday, June 14",
  capturedEmail: null as string | null,
};

let stored = { ...baseEvent };

const createStripeSession = vi.fn(async () => ({
  id: "cs_test_123",
  url: "https://checkout.stripe.test/session",
}));
const retrieveStripeSession = vi.fn(async () => ({
  id: "cs_test_123",
  status: "complete",
  mode: "payment",
  metadata: { plan: "spark", ownerToken: OWNER },
  customer_details: { email: "verified@example.com", phone: null },
  customer_email: "typed@example.com",
}));
const sendEventRecoveryEmail = vi.fn(async () => ({ ok: true }));

vi.mock("../server/storage", () => ({
  storage: {
    getEventByOwnerToken: async (token: string) => (token === OWNER ? { ...stored } : undefined),
    getEventById: async (id: number) => (id === EVENT_ID ? { ...stored } : undefined),
    setEventCapturedEmail: async (id: number, email: string) => {
      if (id === EVENT_ID) stored = { ...stored, capturedEmail: email };
    },
    markEventSparkUnlocked: async (token: string) => (token === OWNER ? { ...stored } : undefined),
  },
}));

vi.mock("../server/email", () => ({
  sendEventRecoveryEmail,
  sendInviteEmail: vi.fn(async () => ({ ok: true })),
}));

vi.mock("../server/stripe", () => ({
  getStripe: () => ({
    checkout: { sessions: { create: createStripeSession, retrieve: retrieveStripeSession } },
  }),
  getPriceId: () => "price_plus",
  getSparkPriceId: () => "price_spark",
  isStripeConfigured: () => true,
  getWebhookSecret: () => undefined,
  planTierFromSubscriptionStatus: () => "plus_active",
  plusPriceValue: () => 99,
  CHECKOUT_PRICES: { spark: 9.99, plusMonthly: 11.99, plusAnnual: 99 },
  USD_CHECKOUT_SESSION_DEFAULTS: {},
}));

vi.mock("../server/metaCapi", () => ({
  sendMetaPurchaseEvent: vi.fn(async () => ({ ok: true })),
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
  createStripeSession.mockClear();
  retrieveStripeSession.mockClear();
  sendEventRecoveryEmail.mockClear();
  sendEventRecoveryEmail.mockResolvedValue({ ok: true });
});

describe("checkout email capture", () => {
  it("saves the explicit checkout email and sends the private return link before Stripe handoff", async () => {
    const app = await makeApp();
    const res = await request(app)
      .post("/api/checkout/create-session")
      .send({ email: " HOST@EXAMPLE.COM ", plan: "spark", returnToken: OWNER });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ url: "https://checkout.stripe.test/session" });
    expect(stored.capturedEmail).toBe("host@example.com");
    expect(sendEventRecoveryEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: "host@example.com",
      body: expect.stringContaining(`https://posyplans.com/dashboard/${OWNER}`),
    }));
    expect(createStripeSession).toHaveBeenCalledWith(expect.objectContaining({
      customer_email: "HOST@EXAMPLE.COM",
      metadata: { plan: "spark", ownerToken: OWNER },
    }));
  });

  it("rejects an unknown event before creating a Stripe session or sending a link", async () => {
    const app = await makeApp();
    const res = await request(app)
      .post("/api/checkout/create-session")
      .send({ email: "host@example.com", plan: "spark", returnToken: "missing-owner-token" });

    expect(res.status).toBe(404);
    expect(createStripeSession).not.toHaveBeenCalled();
    expect(sendEventRecoveryEmail).not.toHaveBeenCalled();
  });

  it("lets Stripe's verified address replace an earlier checkout address", async () => {
    stored = { ...stored, capturedEmail: "typed@example.com" };
    const app = await makeApp();
    const res = await request(app).get("/api/checkout/confirm?sessionId=cs_test_123");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ plan: "spark", unlocked: true, email: "verified@example.com" });
    expect(stored.capturedEmail).toBe("verified@example.com");
    expect(sendEventRecoveryEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: "verified@example.com",
      body: expect.stringContaining(`https://posyplans.com/dashboard/${OWNER}`),
    }));
  });
});

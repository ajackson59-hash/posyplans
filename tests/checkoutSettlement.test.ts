import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer } from "node:http";
import request from "supertest";
import Stripe from "stripe";
import type { Event, EmailEntitlement } from "@shared/schema";
import { encodePng } from "../server/aiFirst/png";
import { PREPAYMENT_PREVIEW_QUALITY_LOCK_CUTOFF_MS } from "../server/prePaymentPreviewQuality";

process.env.DATABASE_URL = "postgres://test/test";
process.env.STRIPE_SECRET_KEY = "sk_test_local_fixture_only";
const fixture = vi.hoisted(() => ({ event: null as Event | null, entitlement: undefined as EmailEntitlement | undefined,
  session: {} as any, subscription: {} as any, writes: 0, failEmail: false }));
const calls = vi.hoisted(() => ({ create: vi.fn(), retrieve: vi.fn(), subscription: vi.fn(), email: vi.fn(), analytics: vi.fn(), purchase: vi.fn() }));
const signingSecret = "whsec_local_fixture_only";
const sdk = new Stripe("sk_test_local_fixture_only");
vi.mock("../server/stripe", async (original) => ({ ...await original<typeof import("../server/stripe")>(),
  getStripe: () => ({ checkout: { sessions: { create: calls.create, retrieve: calls.retrieve } },
    subscriptions: { retrieve: calls.subscription }, customers: { retrieve: async () => ({ id: "cus_local", email: "verified@example.test" }) },
    webhooks: sdk.webhooks }),
  getPriceId: (interval: string) => `price_${interval}`, getSparkPriceId: () => "price_spark",
  getWebhookSecret: () => signingSecret, isStripeConfigured: () => true,
}));
vi.mock("../server/storage", () => ({ storage: {
  getEventByOwnerToken: async (owner: string) => owner === fixture.event?.ownerToken ? { ...fixture.event } : undefined,
  getEventById: async (id: number) => id === fixture.event?.id ? { ...fixture.event } : undefined,
  listGuests: async () => [],
  getEmailEntitlement: async (email: string) => fixture.entitlement?.email === email ? fixture.entitlement : undefined,
  upsertEmailEntitlement: async (email: string, data: Partial<EmailEntitlement>) => {
    fixture.writes++; return fixture.entitlement = { email, planTier: "spark", ...fixture.entitlement, ...data } as EmailEntitlement;
  },
  markEventSparkUnlocked: async (owner: string, session: string) => {
    if (owner !== fixture.event?.ownerToken) return undefined;
    if (!fixture.event.sparkUnlockedAt) {
      fixture.writes++; fixture.event.sparkUnlockedAt = Date.now(); fixture.event.sparkCheckoutSessionId = session;
    }
    return { ...fixture.event };
  },
  setEventCapturedEmail: async (_id: number, email: string) => {
    if (fixture.failEmail) throw new Error("Simulated persistence outage");
    fixture.writes++; fixture.event!.capturedEmail = email; return fixture.event;
  },
  updateEventById: async (_id: number, data: Partial<Event>) => { fixture.writes++; return fixture.event = { ...fixture.event!, ...data }; },
  logAnalyticsEvent: calls.analytics,
} }));
vi.mock("../server/email", () => ({ sendEventRecoveryEmail: calls.email, sendInviteEmail: vi.fn() }));
vi.mock("../server/metaCapi", () => ({ sendMetaPurchaseEvent: calls.purchase }));

const { registerRoutes } = await import("../server/routes");
const { registerInitialPreviewRoute } = await import("../server/initialPreviewRoute");
const { registerEventArtworkRoutes } = await import("../server/eventArtworkRoutes");
const owner = "local-payment-owner";
const path = `/api/events/owner/${owner}`;
const source = encodePng({ width: 16, height: 24, rgb: Buffer.alloc(16 * 24 * 3, 128) });

async function appForTest() {
  const app = express(); app.use(express.json({ verify: (req, _res, bytes) => { req.rawBody = bytes; } }));
  await registerRoutes(createServer(app), app); registerInitialPreviewRoute(app); registerEventArtworkRoutes(app);
  return app;
}
function notification(app: express.Express, type: string, object = fixture.session, livemode = false, corrupt = false) {
  const payload = JSON.stringify({ id: "evt_local", object: "event", type, livemode, data: { object } });
  const signature = sdk.webhooks.generateTestHeaderString({ payload, secret: signingSecret });
  return request(app).post("/api/stripe/webhook").set("Content-Type", "application/json").set("stripe-signature", signature).send(corrupt ? payload.replace("evt_local", "evt_changed") : payload);
}
function plus(status = "active") {
  fixture.subscription = { id: "sub_local", status, customer: "cus_local", metadata: { plan: "plus", returnToken: owner },
    trial_start: null, trial_end: null, items: { data: [{ price: { recurring: { interval: "month" } } }] } };
  fixture.session = { ...fixture.session, mode: "subscription", metadata: { plan: "plus", billingInterval: "monthly", returnToken: owner },
    customer: "cus_local", subscription: fixture.subscription };
}

beforeEach(() => {
  vi.clearAllMocks(); fixture.writes = 0; fixture.failEmail = false; fixture.entitlement = undefined;
  fixture.event = { id: 901, ownerToken: owner, shareSlug: "local-share", eventName: "Local payment fixture", capturedEmail: "typed@example.test",
    draftStatus: "none", sparkUnlockedAt: null, sparkCheckoutSessionId: null, inviteStatus: "draft", inviteDesignConceptJson: "{}",
    inviteIllustrationUrl: "", inviteArtworkUrl: "", customInviteImageUrl: "",
    prePaymentPreviewUrl: `data:image/png;posy-quality-approved-detail-v1;base64,${source.toString("base64")}`,
    prePaymentPreviewUsedAt: PREPAYMENT_PREVIEW_QUALITY_LOCK_CUTOFF_MS + 1 } as Event;
  fixture.session = { id: "cs_test_local", mode: "payment", status: "complete", payment_status: "paid", amount_total: 999,
    metadata: { plan: "spark", ownerToken: owner }, customer_details: { email: "verified@example.test" } };
  fixture.subscription = {};
  calls.retrieve.mockImplementation(async () => fixture.session);
  calls.subscription.mockImplementation(async () => fixture.subscription);
  calls.create.mockResolvedValue({ url: "https://checkout.stripe.test/local" });
  calls.email.mockResolvedValue({ ok: true }); calls.purchase.mockResolvedValue({ ok: true });
});

describe("payment settlement boundaries", () => {
  it.each(["unpaid", undefined, "no_payment_required"])("does not unlock a nonzero Spark purchase with payment_status=%s", async (paymentStatus) => {
    fixture.session.payment_status = paymentStatus;
    const res = await request(await appForTest()).get("/api/checkout/confirm?sessionId=cs_test_local");
    expect(res.status).toBe(409); expect(res.body.code).toBe("payment_pending"); expect(fixture.writes).toBe(0);
    expect(calls.purchase).not.toHaveBeenCalled(); expect(calls.email).not.toHaveBeenCalled();
  });
  it.each(["open", "expired"])("does not unlock checkout status %s", async (status) => {
    fixture.session.status = status;
    expect((await request(await appForTest()).get("/api/checkout/confirm?sessionId=cs_test_local")).status).toBe(409);
    expect(fixture.writes).toBe(0);
  });
  it("unlocks a legitimate settled zero-total purchase", async () => {
    fixture.session.amount_total = 0; fixture.session.payment_status = "no_payment_required";
    const result = await request(await appForTest()).get("/api/checkout/confirm?sessionId=cs_test_local");
    expect(result.status).toBe(200); expect(result.body.unlocked).toBe(true);
  });
  it("rejects another product or an absent event without claiming an unlock", async () => {
    const app = await appForTest(); fixture.session.metadata.plan = "other";
    expect((await request(app).get("/api/checkout/confirm?sessionId=cs_test_local")).status).toBe(400);
    fixture.session.metadata.plan = "spark"; fixture.event = null;
    expect((await request(app).get("/api/checkout/confirm?sessionId=cs_test_local")).status).toBe(404);
    expect(fixture.writes).toBe(0);
  });
  it("handles delayed settlement and duplicate notifications, then reuses and reloads the approved artwork", async () => {
    const app = await appForTest(); fixture.session.payment_status = "unpaid";
    expect((await notification(app, "checkout.session.completed")).status).toBe(200);
    expect((await request(app).post(`${path}/invite/use-prepayment-preview`).send({})).status).toBe(402);
    expect(fixture.writes).toBe(0);
    fixture.session.payment_status = "paid";
    expect((await notification(app, "checkout.session.async_payment_succeeded")).status).toBe(200);
    const unlockedAt = fixture.event!.sparkUnlockedAt; const writes = fixture.writes;
    expect((await notification(app, "checkout.session.async_payment_succeeded")).status).toBe(200);
    expect(fixture.writes).toBe(writes); expect(fixture.event!.sparkUnlockedAt).toBe(unlockedAt);
    expect(fixture.event!.capturedEmail).toBe("verified@example.test");
    expect((await request(app).get(`${path}/master-planner/entitlement`)).body.canGenerate).toBe(true);
    expect((await request(app).post(`${path}/invite/use-prepayment-preview`).send({})).status).toBe(200);
    const reloaded = (await request(app).get(path)).body.event;
    const asset = await request(app).get(reloaded.inviteIllustrationUrl);
    expect(asset.status).toBe(200); expect(Buffer.from(asset.body).equals(source)).toBe(true);
  });
  it.each(["incomplete", "incomplete_expired", "past_due", "canceled", "unpaid", "paused"])("does not report Plus success for %s", async (status) => {
    plus(status); const app = await appForTest();
    const res = await request(app).get("/api/checkout/confirm?sessionId=cs_test_local");
    expect(res.status).toBe(409); expect(res.body.code).toBe("subscription_inactive");
    expect((await request(app).get(`${path}/master-planner/entitlement`)).body.canGenerate).toBe(false);
  });
  it("fulfills Plus by webhook without a browser return and uses the payment email", async () => {
    plus(); const app = await appForTest();
    expect((await notification(app, "checkout.session.completed")).status).toBe(200);
    expect(fixture.event!.capturedEmail).toBe("verified@example.test");
    expect((await request(app).get(`${path}/master-planner/entitlement`)).body).toMatchObject({ planTier: "plus_active", canGenerate: true });
    const res = await request(app).get("/api/checkout/confirm?sessionId=cs_test_local");
    expect(res.body).toMatchObject({ plan: "plus", returnToken: owner, billingInterval: "monthly" });
    expect(res.headers["cache-control"]).toBe("private, no-store");
  });
  it("carries the originating event onto new subscriptions for subsequent webhooks", async () => {
    const app = await appForTest();
    expect((await request(app).post("/api/checkout/create-session").send({ email: "typed@example.test", plan: "plus", billingInterval: "monthly", returnToken: owner })).status).toBe(200);
    expect(calls.create).toHaveBeenCalledWith(expect.objectContaining({ subscription_data: { metadata: { plan: "plus", billingInterval: "monthly", returnToken: owner } } }));
  });
  it("reconciles current subscription state instead of replaying a stale active notification", async () => {
    plus("canceled"); const app = await appForTest();
    expect((await notification(app, "customer.subscription.updated", { ...fixture.subscription, status: "active" })).status).toBe(200);
    expect(fixture.entitlement!.planTier).toBe("plus_expired"); expect(calls.subscription).toHaveBeenCalledWith("sub_local", { expand: ["latest_invoice"] });
  });
  it("does not revoke a newer Plus subscription through an old cancellation or checkout return", async () => {
    plus("canceled"); fixture.entitlement = { email: "verified@example.test", stripeSubscriptionId: "sub_newer", planTier: "plus_active" } as EmailEntitlement;
    const app = await appForTest();
    expect((await notification(app, "customer.subscription.deleted", fixture.subscription)).status).toBe(200);
    expect((await request(app).get("/api/checkout/confirm?sessionId=cs_test_local")).status).toBe(409);
    expect(fixture.entitlement.planTier).toBe("plus_active"); expect(fixture.writes).toBe(0);
  });
  it("retains valid legacy trial access but rejects an expired trial", async () => {
    plus("trialing"); fixture.subscription.trial_end = Math.floor(Date.now() / 1000) + 3600;
    const app = await appForTest();
    expect((await request(app).get("/api/checkout/confirm?sessionId=cs_test_local")).status).toBe(200);
    expect((await request(app).get(`${path}/master-planner/entitlement`)).body.canGenerate).toBe(true);
    fixture.subscription.trial_end = Math.floor(Date.now() / 1000) - 1;
    expect((await request(app).get("/api/checkout/confirm?sessionId=cs_test_local")).status).toBe(409);
    expect((await request(app).get(`${path}/master-planner/entitlement`)).body.canGenerate).toBe(false);
  });
  it("does not bypass payment settlement through an active subscription notification", async () => {
    plus(); fixture.subscription.latest_invoice = { status: "open", amount_remaining: 1199 };
    const app = await appForTest();
    expect((await notification(app, "customer.subscription.created", fixture.subscription)).status).toBe(200);
    expect(fixture.writes).toBe(0);
    fixture.subscription.latest_invoice = { status: "paid", amount_remaining: 0 };
    expect((await notification(app, "customer.subscription.updated", fixture.subscription)).status).toBe(200);
    expect((await request(app).get(`${path}/master-planner/entitlement`)).body.canGenerate).toBe(true);
  });
  it("retries email persistence failure instead of acknowledging paid access that cannot resolve", async () => {
    plus(); fixture.failEmail = true; const app = await appForTest();
    expect((await notification(app, "checkout.session.completed")).status).toBe(500);
    fixture.failEmail = false;
    expect((await notification(app, "checkout.session.completed")).status).toBe(200);
    expect((await request(app).get(`${path}/master-planner/entitlement`)).body.canGenerate).toBe(true);
  });
  it("verifies actual webhook signatures and rejects an environment mismatch", async () => {
    const app = await appForTest();
    expect((await notification(app, "checkout.session.completed", fixture.session, false, true)).status).toBe(400);
    expect((await notification(app, "checkout.session.completed", fixture.session, true)).status).toBe(400);
    expect(fixture.writes).toBe(0);
  });
  it("reports test-mode readiness without exposing credentials", async () => {
    const res = await request(await appForTest()).get("/api/checkout/config");
    expect(res.body).toEqual({ configured: true, mode: "test", webhookConfigured: true });
    expect(res.text).not.toContain("sk_test"); expect(res.text).not.toContain("whsec");
  });
});

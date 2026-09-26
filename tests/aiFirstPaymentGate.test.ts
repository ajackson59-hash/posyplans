// Regression coverage for the confirmed production paywall bypass (QA
// report, B2): the AI-first generation route had kill-switch, idempotency,
// rate-limit and circuit-breaker checks, but no payment/entitlement check —
// an anonymous, unpaid, un-emailed visitor could trigger a fully billed
// generation. This must be refused before guardGeneration/rate-limiting and
// before a run is ever claimed, so an unpaid request never reaches the
// provider pipeline or consumes rate-limit budget.

import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { featureFlagEnvVar } from "@shared/featureFlags";
import { AI_FIRST_DIRECTION_LIMIT_ENV } from "../server/aiFirst/config";
import { InMemoryRunStore } from "../server/aiFirst/runStore";
import { InMemoryPreviewStore } from "../server/aiFirst/previewStore";
import { InMemoryUsageStore } from "../server/aiFirst/usage";
import { InMemoryArtworkAttemptStore } from "../server/aiFirst/artworkAttemptStore";
import { registerAiFirstRoutes } from "../server/aiFirst/routes";
import type { PlusMembershipAccess } from "../server/plusMembership";

const OWNER = "owner";
const EVENT_ID = 76; // same id referenced by the QA report's leaked event

type FixtureEvent = {
  id: number;
  capturedEmail?: string;
  eventType: string;
  sparkUnlockedAt?: number | null;
};

function appFor(event: FixtureEvent, membership: { planTier: string; trialEndsAt?: number | null } | undefined,
  typedEmailEntitlement?: { planTier: string; trialEndsAt?: number | null }) {
  const app = express();
  app.use(express.json());
  const runStore = new InMemoryRunStore();
  const usageStore = new InMemoryUsageStore();
  const runPipeline = vi.fn(async () => {
    throw new Error("must not run: unpaid request reached the pipeline");
  });
  registerAiFirstRoutes(app, {
    storage: {
      getEventByOwnerToken: async (token: string) => (token === OWNER ? event : undefined),
      updateEventByOwnerToken: async () => undefined,
      getEmailEntitlement: async () => typedEmailEntitlement,
      listMenuItems: async () => [],
      listBudgetItems: async () => [],
      listGuests: async () => [],
    },
    plusAccess: async (eventId) => eventId === event.id && membership ? {
      subscriptionId: 'sub_proven', customerId: 'cus_proven', billingInterval: 'monthly', trialEndsAt: null,
      ...membership,
    } as PlusMembershipAccess : undefined,
    previewStore: new InMemoryPreviewStore(),
    usageStore,
    runStore,
    artworkAttemptStore: new InMemoryArtworkAttemptStore(),
    env: {
      [featureFlagEnvVar("aiFirstInvitations")]: "1",
      [featureFlagEnvVar("aiFirstDisableAutomaticRetry")]: "1",
      [AI_FIRST_DIRECTION_LIMIT_ENV]: "1",
    },
    runPipeline,
  });
  return { app, runStore, usageStore, runPipeline };
}

describe("POST /ai-first/generate payment gate", () => {
  it("rejects a typed Plus email without a proven event membership before claiming or dispatching", async () => {
    const { app, runStore, runPipeline } = appFor(
      { id: EVENT_ID, eventType: "birthday", capturedEmail: "someone-elses-plus@example.com" },
      undefined,
      { planTier: "plus_active" },
    );
    const res = await request(app).post(`/api/events/owner/${OWNER}/ai-first/generate`).send({ runId: "typed-email-run" });
    expect(res.status).toBe(402);
    expect(res.body.denial).toBe("needs-payment");
    expect(runPipeline).not.toHaveBeenCalled();
    expect(await runStore.get("typed-email-run")).toBeUndefined();
  });

  it("rejects an event with no sparkUnlockedAt and no entitlement before claiming a run", async () => {
    const { app, runStore, runPipeline } = appFor(
      { id: EVENT_ID, eventType: "birthday" },
      undefined,
    );

    const res = await request(app)
      .post(`/api/events/owner/${OWNER}/ai-first/generate`)
      .send({ runId: "unpaid-run" });

    expect(res.status).toBe(402);
    expect(res.body.denial).toBe("needs-payment");
    expect(runPipeline).not.toHaveBeenCalled();
    expect(await runStore.get("unpaid-run")).toBeUndefined();
  });

  it("allows generation for an event with sparkUnlockedAt set", async () => {
    const { app, runPipeline } = appFor(
      { id: EVENT_ID, eventType: "birthday", sparkUnlockedAt: Date.now() },
      undefined,
    );
    runPipeline.mockImplementation(async () => {
      throw new Error("synthetic stop after gate check");
    });

    const res = await request(app)
      .post(`/api/events/owner/${OWNER}/ai-first/generate`)
      .send({ runId: "spark-run" });

    // The pipeline itself throws synthetically (this test only cares that
    // the gate let the request through to the pipeline, not full pipeline
    // behavior — that's covered elsewhere).
    expect(res.status).toBe(200);
    expect(runPipeline).toHaveBeenCalledTimes(1);
  });

  it("allows generation for an active Plus subscriber", async () => {
    const { app, runPipeline } = appFor(
      { id: EVENT_ID, eventType: "birthday", capturedEmail: "host@example.com" },
      { planTier: "plus_active" },
    );
    runPipeline.mockImplementation(async () => {
      throw new Error("synthetic stop after gate check");
    });

    const res = await request(app)
      .post(`/api/events/owner/${OWNER}/ai-first/generate`)
      .send({ runId: "plus-active-run" });

    expect(res.status).toBe(200);
    expect(runPipeline).toHaveBeenCalledTimes(1);
  });

  it.each([
    { membership: undefined, name: "no membership", plan: "Spark", eventHard: 12, responseStatus: 403 },
    { membership: { planTier: "plus_active" }, name: "active Plus", plan: "Plus", eventHard: 40, responseStatus: 200 },
    { membership: { planTier: "plus_trial", trialEndsAt: Date.now() - 1000 }, name: "expired Plus trial", plan: "Spark", eventHard: 12, responseStatus: 403 },
  ])("uses $plan limits for status and generation on a Spark-unlocked event with $name", async ({ membership, plan, eventHard, responseStatus }) => {
    const { app, usageStore, runPipeline } = appFor(
      { id: EVENT_ID, eventType: "birthday", capturedEmail: "host@example.com", sparkUnlockedAt: Date.now() },
      membership,
    );
    for (let i = 0; i < 12; i += 1) {
      await usageStore.record({ eventId: EVENT_ID, email: "host@example.com", reason: "initial", billed: true,
        automatic: false, costUsdMicros: 0, createdAt: Date.now() });
    }
    const status = await request(app).get(`/api/events/owner/${OWNER}/ai-first/status`);
    expect(status.status).toBe(200);
    expect(status.body).toMatchObject({ plan, ceilings: { eventHard }, usage: { eventBilled: 12 } });

    const generation = await request(app).post(`/api/events/owner/${OWNER}/ai-first/generate`)
      .send({ runId: `spark-with-${plan.toLowerCase()}-allowance`, confirmAdditionalGeneration: true });
    expect(generation.status).toBe(responseStatus);
    if (plan === "Plus") {
      expect(runPipeline).toHaveBeenCalledTimes(1);
      expect(runPipeline).toHaveBeenCalledWith(expect.objectContaining({ allowance: 1 }));
    } else {
      expect(generation.body).toMatchObject({ denial: "event-ceiling", plan: "Spark" });
      expect(runPipeline).not.toHaveBeenCalled();
    }
  });

  it("rejects an event with an expired Plus trial", async () => {
    const { app, runStore, runPipeline } = appFor(
      { id: EVENT_ID, eventType: "birthday", capturedEmail: "host@example.com" },
      { planTier: "plus_trial", trialEndsAt: Date.now() - 1000 },
    );

    const res = await request(app)
      .post(`/api/events/owner/${OWNER}/ai-first/generate`)
      .send({ runId: "expired-trial-run" });

    expect(res.status).toBe(402);
    expect(res.body.denial).toBe("needs-payment");
    expect(runPipeline).not.toHaveBeenCalled();
    expect(await runStore.get("expired-trial-run")).toBeUndefined();
  });

  it("allows generation for an active (non-expired) Plus trial", async () => {
    const { app, runPipeline } = appFor(
      { id: EVENT_ID, eventType: "birthday", capturedEmail: "host@example.com" },
      { planTier: "plus_trial", trialEndsAt: Date.now() + 1000 * 60 * 60 * 24 },
    );
    runPipeline.mockImplementation(async () => {
      throw new Error("synthetic stop after gate check");
    });

    const res = await request(app)
      .post(`/api/events/owner/${OWNER}/ai-first/generate`)
      .send({ runId: "active-trial-run" });

    expect(res.status).toBe(200);
    expect(runPipeline).toHaveBeenCalledTimes(1);
  });
});

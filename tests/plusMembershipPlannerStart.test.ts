import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createServer } from "node:http";
import type { Event } from "@shared/schema";
import type { PlusMembershipAccess } from "../server/plusMembership";

process.env.DATABASE_URL = "postgres://test/test";

const fixture = vi.hoisted(() => ({
  event: null as Event | null,
  membership: undefined as PlusMembershipAccess | undefined,
}));
const calls = vi.hoisted(() => ({ reserve: vi.fn(), orchestrate: vi.fn(), waitUntil: vi.fn(), expire: vi.fn() }));
vi.mock("../server/storage", () => ({ storage: {
  getEventByOwnerToken: async (owner: string) => owner === fixture.event?.ownerToken ? { ...fixture.event } : undefined,
  getEventById: async (id: number) => id === fixture.event?.id ? { ...fixture.event } : undefined,
  reserveInitialGeneration: calls.reserve,
  expireInitialGeneration: calls.expire,
  getLatestGenerationForEvent: async () => ({ id: 811, completedStages: '["theme"]', failedStage: null }),
} }));
vi.mock("../server/plusMembership", async original => ({
  ...await original<typeof import("../server/plusMembership")>(),
  getEventPlusAccess: async (id: number) => id === fixture.event?.id ? fixture.membership : undefined,
}));
vi.mock("../server/masterPlannerOrchestrator", () => ({ runMasterPlannerOrchestration: calls.orchestrate }));
vi.mock("@vercel/functions", () => ({ waitUntil: calls.waitUntil }));

const { registerRoutes } = await import("../server/routes");
const owner = "plus-start-owner-local-fixture";
const eventId = 990077;
const path = `/api/events/owner/${owner}/master-planner`;
const generation = { id: 811, eventId, state: "running", reservedAt: 1_700_000_000_000, completedStages: '["theme"]' };

async function appForTest() {
  const app = express();
  app.use(express.json());
  await registerRoutes(createServer(app), app);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  fixture.event = {
    id: eventId, ownerToken: owner, capturedEmail: "billing@example.test", sparkUnlockedAt: null,
    draftStatus: "none", draftStage: null, eventName: "Local plan-start fixture",
    inviteIllustrationUrl: "saved-artwork-fixture", inviteDesignConceptJson: '{"saved":true}',
  } as Event;
  fixture.membership = {
    subscriptionId: "sub_local_fixture", customerId: "cus_local_fixture", planTier: "plus_active",
    trialEndsAt: null, billingInterval: "monthly", bindingSource: "email_verification",
  };
  calls.orchestrate.mockResolvedValue(undefined);
  calls.reserve.mockImplementation(async (_eventId: number, allowResume: boolean) => {
    if (fixture.event!.draftStatus === "generating") return { ok: true, generation, shouldStart: false };
    if (fixture.event!.draftStatus === "failed_partial" && !allowResume) return { ok: false, reason: "interrupted", shouldStart: false };
    fixture.event!.draftStatus = "generating";
    return { ok: true, generation, shouldStart: true };
  });
});

describe("verified Plus membership plan-start boundary", () => {
  it.each(["none", "failed_partial", "generating"] as const)("requires boolean confirmation before reserving a %s plan", async draftStatus => {
    fixture.event!.draftStatus = draftStatus;
    const app = await appForTest();
    const before = { ...fixture.event };
    for (const confirmMembershipStart of [undefined, false, "true", 1]) {
      const res = await request(app).post(`${path}/generate`).send({ confirmMembershipStart, resumeInterrupted: true });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("explicit_plan_start_required");
    }
    expect(calls.reserve).not.toHaveBeenCalled();
    expect(calls.orchestrate).not.toHaveBeenCalled();
    expect(calls.waitUntil).not.toHaveBeenCalled();
    expect(fixture.event).toEqual(before);
  });

  it.each(["none", "failed_partial", "generating"] as const)("reports the durable explicit-start requirement for %s without starting work", async draftStatus => {
    fixture.event!.draftStatus = draftStatus;
    const app = await appForTest();
    for (let read = 0; read < 2; read++) {
      const res = await request(app).get(`${path}/entitlement`);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ canGenerate: true, requiresExplicitStart: true, freeDraftState: draftStatus });
      expect(res.text).not.toContain("sub_local_fixture");
      expect(res.text).not.toContain("cus_local_fixture");
      expect(res.text).not.toContain("billing@example.test");
      expect(res.text).not.toContain(owner);
    }
    expect(calls.reserve).not.toHaveBeenCalled();
    expect(calls.orchestrate).not.toHaveBeenCalled();
  });

  it("allows explicit Build and honors the reservation's duplicate-worker decision", async () => {
    const app = await appForTest();
    const responses = await Promise.all([
      request(app).post(`${path}/generate`).send({ confirmMembershipStart: true }),
      request(app).post(`${path}/generate`).send({ confirmMembershipStart: true }),
    ]);
    expect(responses.map(res => res.status)).toEqual([200, 200]);
    expect(responses.map(res => res.body.generationId)).toEqual([generation.id, generation.id]);
    expect(calls.reserve.mock.calls).toEqual([[eventId, false], [eventId, false]]);
    expect(calls.orchestrate).toHaveBeenCalledExactlyOnceWith(eventId, generation.id, undefined, generation.reservedAt);
    expect(calls.waitUntil).toHaveBeenCalledOnce();
  });

  it("requires explicit resume separately from membership-start confirmation", async () => {
    fixture.event!.draftStatus = "failed_partial";
    const app = await appForTest();
    const withoutResume = await request(app).post(`${path}/generate`).send({ confirmMembershipStart: true });
    expect(withoutResume.status).toBe(409);
    expect(withoutResume.body.code).toBe("generation_interrupted");
    expect(calls.orchestrate).not.toHaveBeenCalled();

    const resumed = await request(app).post(`${path}/generate`).send({ confirmMembershipStart: true, resumeInterrupted: true });
    const replayed = await request(app).post(`${path}/generate`).send({ confirmMembershipStart: true, resumeInterrupted: true });
    expect(resumed.status).toBe(200);
    expect(replayed.status).toBe(200);
    expect(calls.reserve.mock.calls).toEqual([[eventId, false], [eventId, true], [eventId, true]]);
    expect(calls.orchestrate).toHaveBeenCalledExactlyOnceWith(eventId, generation.id, undefined, generation.reservedAt);
  });

  it("reads an existing running plan without dispatching a new worker", async () => {
    fixture.event!.draftStatus = "generating";
    fixture.event!.draftStage = "budget_menu";
    const app = await appForTest();
    const res = await request(app).get(`${path}/status`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ draftStatus: "generating", draftStage: "budget_menu", completedStages: ["theme"] });
    expect(calls.reserve).not.toHaveBeenCalled();
    expect(calls.orchestrate).not.toHaveBeenCalled();
    expect((await request(app).post(`${path}/generate`).send({ confirmMembershipStart: true })).status).toBe(200);
    expect(calls.reserve).toHaveBeenCalledExactlyOnceWith(eventId, false);
    expect(calls.orchestrate).not.toHaveBeenCalled();
  });

  it("never overwrites a ready plan even with both explicit flags", async () => {
    fixture.event!.draftStatus = "ready";
    const before = { ...fixture.event };
    const app = await appForTest();
    expect((await request(app).get(`${path}/entitlement`)).body).toMatchObject({ canGenerate: true, requiresExplicitStart: false });
    for (const body of [{}, { confirmMembershipStart: true, resumeInterrupted: true }]) {
      const res = await request(app).post(`${path}/generate`).send(body);
      expect(res.status).toBe(409);
      expect(res.body.error).toMatch(/already been generated/);
    }
    expect(calls.reserve).not.toHaveBeenCalled();
    expect(calls.orchestrate).not.toHaveBeenCalled();
    expect(fixture.event).toEqual(before);
  });

  it.each(["canceled", "expired-trial", "unbound"])("refuses %s membership at the paid gate despite explicit confirmation", async state => {
    if (state === "unbound") fixture.membership = undefined;
    else if (state === "canceled") fixture.membership!.planTier = "plus_expired";
    else { fixture.membership!.planTier = "plus_trial"; fixture.membership!.trialEndsAt = Date.now() - 1; }
    const app = await appForTest();
    expect((await request(app).get(`${path}/entitlement`)).body.canGenerate).toBe(false);
    const res = await request(app).post(`${path}/generate`).send({ confirmMembershipStart: true, resumeInterrupted: true });
    expect(res.status).toBe(402);
    expect(calls.reserve).not.toHaveBeenCalled();
    expect(calls.orchestrate).not.toHaveBeenCalled();
  });

  it.each(["checkout", "subscription", "historical_checkout"])("keeps settled %s membership start behavior without a verification flag", async bindingSource => {
    fixture.membership!.bindingSource = bindingSource;
    const app = await appForTest();
    expect((await request(app).get(`${path}/entitlement`)).body).toMatchObject({ canGenerate: true, requiresExplicitStart: false });
    expect((await request(app).post(`${path}/generate`).send({})).status).toBe(200);
    expect(calls.reserve).toHaveBeenCalledExactlyOnceWith(eventId, false);
    expect(calls.orchestrate).toHaveBeenCalledOnce();
  });

  it("keeps the settled Spark event start behavior and refuses an unknown owner", async () => {
    fixture.membership = undefined;
    fixture.event!.sparkUnlockedAt = Date.now();
    const app = await appForTest();
    const unknown = await request(app).post("/api/events/owner/not-the-owner/master-planner/generate").send({ confirmMembershipStart: true });
    expect(unknown.status).toBe(404);
    expect(calls.reserve).not.toHaveBeenCalled();
    expect((await request(app).get(`${path}/entitlement`)).body).toMatchObject({ sparkUnlocked: true, canGenerate: true, requiresExplicitStart: false });
    expect((await request(app).post(`${path}/generate`).send({})).status).toBe(200);
    expect(calls.orchestrate).toHaveBeenCalledOnce();
  });
});

// The flag is the whole safety story of this feature: with it off, the live
// experience must be indistinguishable from one where none of this code was
// merged. These tests assert that literally — every AI-first route 404s, and
// no store, model or image provider is reached.

import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { DEFAULT_FEATURE_FLAGS, readFeatureFlags, featureFlagEnvVar } from "@shared/featureFlags";
import { registerAiFirstRoutes } from "../server/aiFirst/routes";
import { InMemoryPreviewStore } from "../server/aiFirst/previewStore";
import { InMemoryUsageStore } from "../server/aiFirst/usage";
import { InMemoryRunStore } from "../server/aiFirst/runStore";
import { InMemoryArtworkAttemptStore } from "../server/aiFirst/artworkAttemptStore";

const OWNER = "owner-token";

function appWith(env: Record<string, string | undefined>) {
  const app = express();
  app.use(express.json());
  const storage = {
    getEventByOwnerToken: async (token: string) =>
      token === OWNER ? { id: 1, capturedEmail: "host@example.com", eventType: "birthday" } : undefined,
    updateEventByOwnerToken: async () => ({ id: 1 }),
    getEmailEntitlement: async () => undefined,
    listMenuItems: async () => [],
    listBudgetItems: async () => [],
    listGuests: async () => [],
  };
  registerAiFirstRoutes(app, {
    storage,
    previewStore: new InMemoryPreviewStore(),
    usageStore: new InMemoryUsageStore(),
    runStore: new InMemoryRunStore(),
    artworkAttemptStore: new InMemoryArtworkAttemptStore(),
    env,
  });
  return app;
}

describe("feature flags", () => {
  it("defaults every flag off", () => {
    expect(DEFAULT_FEATURE_FLAGS).toEqual({
      aiFirstInvitations: false,
      invitationGenerationKillSwitch: false,
      aiFirstDisableAutomaticRetry: false,
    });
    expect(readFeatureFlags({})).toEqual(DEFAULT_FEATURE_FLAGS);
  });

  it("treats anything but an explicit truthy string as off", () => {
    const name = featureFlagEnvVar("aiFirstInvitations");
    for (const value of [undefined, "", "0", "false", "off", "no", "maybe"]) {
      expect(readFeatureFlags({ [name]: value }).aiFirstInvitations).toBe(false);
    }
    for (const value of ["1", "true", "TRUE", "on", "yes"]) {
      expect(readFeatureFlags({ [name]: value }).aiFirstInvitations).toBe(true);
    }
  });
});

describe("route gating", () => {
  const routes: [string, string][] = [
    ["get", `/api/events/owner/${OWNER}/ai-first/status`],
    ["post", `/api/events/owner/${OWNER}/ai-first/generate`],
    ["post", `/api/events/owner/${OWNER}/ai-first/apply`],
    ["post", "/api/ai-first/cleanup-previews"],
  ];

  it("404s every AI-first route with the flag off", async () => {
    const app = appWith({});
    for (const [method, path] of routes) {
      const res = await (method === "get" ? request(app).get(path) : request(app).post(path).send({}));
      expect(res.status, `${method} ${path}`).toBe(404);
    }
  });

  it("answers the flag query without the flag, so the client knows what to render", async () => {
    const res = await request(appWith({}).use(express.json())).get("/api/feature-flags");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(DEFAULT_FEATURE_FLAGS);
  });

  it("serves status with the flag on", async () => {
    const app = appWith({ [featureFlagEnvVar("aiFirstInvitations")]: "1" });
    const res = await request(app).get(`/api/events/owner/${OWNER}/ai-first/status`);
    expect(res.status).toBe(200);
    expect(res.body.plan).toBe("Spark");
    expect(res.body.killSwitch).toBe(false);
  });

  it("never labels a plan Free", async () => {
    const app = appWith({ [featureFlagEnvVar("aiFirstInvitations")]: "1" });
    const res = await request(app).get(`/api/events/owner/${OWNER}/ai-first/status`);
    expect(res.body.plan).not.toBe("Free");
  });

  it("reports the kill switch without disabling the rest of the surface", async () => {
    const app = appWith({
      [featureFlagEnvVar("aiFirstInvitations")]: "1",
      [featureFlagEnvVar("invitationGenerationKillSwitch")]: "1",
    });
    const status = await request(app).get(`/api/events/owner/${OWNER}/ai-first/status`);
    expect(status.body.killSwitch).toBe(true);

    // Cleanup and apply still answer; only new generation is refused.
    const cleanup = await request(app).post("/api/ai-first/cleanup-previews").send({});
    expect(cleanup.status).toBe(200);

    const generate = await request(app).post(`/api/events/owner/${OWNER}/ai-first/generate`).send({ runId: "run-1" });
    expect(generate.status).toBe(403);
    expect(generate.body.denial).toBe("kill-switch");
    expect(generate.body.paused).toBe(true);
  });

  it("reads the flag per request, so a kill switch needs no redeploy", async () => {
    const env: Record<string, string | undefined> = {};
    const app = appWith(env);
    expect((await request(app).get(`/api/events/owner/${OWNER}/ai-first/status`)).status).toBe(404);
    env[featureFlagEnvVar("aiFirstInvitations")] = "1";
    expect((await request(app).get(`/api/events/owner/${OWNER}/ai-first/status`)).status).toBe(200);
    env[featureFlagEnvVar("aiFirstInvitations")] = "0";
    expect((await request(app).get(`/api/events/owner/${OWNER}/ai-first/status`)).status).toBe(404);
  });
});

// Protected Preview readiness and concept-only proof.
//
// Every provider is injected. These tests cannot reach Anthropic or OpenAI,
// and the concept-only module has no image-generator capability by design.

import { readFileSync } from "node:fs";
import type Anthropic from "@anthropic-ai/sdk";
import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { featureFlagEnvVar } from "@shared/featureFlags";
import type { EventBrief } from "../server/aiFirst/brief";
import { runConceptOnlyProof } from "../server/aiFirst/conceptOnlyProof";
import { checkAiFirstModelReadiness } from "../server/aiFirst/providerReadiness";
import { registerAiFirstRoutes, type AiFirstDeps } from "../server/aiFirst/routes";
import { InMemoryPreviewStore } from "../server/aiFirst/previewStore";
import { InMemoryUsageStore } from "../server/aiFirst/usage";
import { InMemoryRunStore } from "../server/aiFirst/runStore";
import { InMemoryArtworkAttemptStore } from "../server/aiFirst/artworkAttemptStore";
import {
  AI_FIRST_DIRECTION_LIMIT_ENV,
  AI_FIRST_IMAGE_MODEL_ENV,
} from "../server/aiFirst/config";
import { concept, conceptQuartet } from "./aiFirstFixtures";

const OWNER = "preview-owner-token";
const EVENT_ID = 6;

const neutralBrief: EventBrief = {
  eventName: "Ada's 4th Birthday",
  eventType: "birthday",
  milestone: "4th",
  vibe: "modern editorial garden celebration",
  themeName: "modern garden",
  colors: ["dusty rose"],
  formality: "refined-playful",
  dateLine: "12 September 2026",
  season: "autumn",
  venueType: "private home",
  guestCount: 18,
  dna: {},
  inspirationNotes: "",
  requirements: { required: ["a polished editorial invitation"], preferred: [], excluded: [] },
};

function conceptClient(): Anthropic {
  const quartet = conceptQuartet(
    concept({
      art: {
        medium: "watercolor",
        composition: "off-centre garden celebration scene",
        prompt: "A refined modern garden birthday celebration with candlelight and deep foliage.",
      },
    }),
  );
  return {
    messages: {
      stream: async () =>
        (async function* () {
          yield {
            type: "content_block_delta",
            delta: { type: "text_delta", text: `${quartet.map((item) => JSON.stringify(item)).join("\n")}\n` },
          };
        })(),
    },
  } as unknown as Anthropic;
}

describe("provider model readiness", () => {
  it("retrieves the exact models without touching the image-generation endpoint", async () => {
    const urls: string[] = [];
    const anthropic = {
      models: { retrieve: async (model: string) => ({ id: model }) },
    } as unknown as Anthropic;
    const result = await checkAiFirstModelReadiness({
      env: { ANTHROPIC_API_KEY: "anthropic-test", OPENAI_API_KEY: "openai-test" },
      artworkModel: "gpt-image-2",
      anthropic,
      fetchImpl: (async (url: string | URL | Request) => {
        urls.push(String(url));
        return new Response(JSON.stringify({ id: "gpt-image-2", object: "model" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }) as typeof fetch,
    });

    expect(result.ready).toBe(true);
    expect(result.anthropic).toMatchObject({ model: "claude-sonnet-4-6", accessible: true });
    expect(result.openai).toMatchObject({ model: "gpt-image-2", accessible: true });
    expect(result.imageProviderCalls).toBe(0);
    expect(urls).toEqual(["https://api.openai.com/v1/models/gpt-image-2"]);
    expect(urls.join(" ")).not.toContain("/images/generations");
  });

  it("reports missing keys without attempting either provider", async () => {
    let calls = 0;
    const result = await checkAiFirstModelReadiness({
      env: {},
      artworkModel: "gpt-image-2",
      fetchImpl: (async () => {
        calls += 1;
        throw new Error("must not call");
      }) as typeof fetch,
    });
    expect(result.ready).toBe(false);
    expect(result.anthropic.configured).toBe(false);
    expect(result.openai.configured).toBe(false);
    expect(calls).toBe(0);
  });
});

describe("concept-only proof boundary", () => {
  it("runs the real quartet preflight with no image-provider capability", async () => {
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error("concept-only proof must not use fetch");
    }) as typeof fetch;
    try {
      const proof = await runConceptOnlyProof({ brief: neutralBrief, anthropic: conceptClient() });
      expect(proof.concepts).toHaveLength(4);
      expect(proof.imageProviderCalls).toBe(0);
      expect(proof.billedArtworkAttempts).toBe(0);
      expect(fetchCalls).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("has no image generator, usage store, run store, or attempt store import", () => {
    const source = readFileSync("server/aiFirst/conceptOnlyProof.ts", "utf8");
    expect(source).not.toMatch(/from ["']\.\/(?:artwork|usage|runStore|artworkAttemptStore)["']/);
    expect(source).not.toMatch(/generateArtwork|images\/generations/);
  });
});

function reviewApp(input: {
  env?: Record<string, string | undefined>;
  checkModelReadiness?: AiFirstDeps["checkModelReadiness"];
  runConceptProof?: AiFirstDeps["runConceptProof"];
}) {
  const app = express();
  app.use(express.json());
  const previewStore = new InMemoryPreviewStore();
  const usageStore = new InMemoryUsageStore();
  const runStore = new InMemoryRunStore();
  const artworkAttemptStore = new InMemoryArtworkAttemptStore();
  registerAiFirstRoutes(app, {
    storage: {
      getEventByOwnerToken: async (token: string) =>
        token === OWNER
          ? {
              id: EVENT_ID,
              ownerToken: OWNER,
              capturedEmail: "host@example.com",
              eventName: "I'm 3 & Digging It",
              eventType: "Birthday Party",
              vibeDescription: "backyard BBQ construction party for a little builder",
              themeName: "construction / little builder",
              paletteColors: JSON.stringify(["construction yellow", "ink navy", "concrete cream"]),
              eventDate: "2026-07-30",
              venueName: "Hidden Valley",
              location: "backyard",
            }
          : undefined,
      updateEventByOwnerToken: async () => undefined,
      getEmailEntitlement: async () => undefined,
      listMenuItems: async () => [],
      listBudgetItems: async () => [],
      listGuests: async () => [],
    },
    previewStore,
    usageStore,
    runStore,
    artworkAttemptStore,
    env: {
      VERCEL_ENV: "preview",
      [featureFlagEnvVar("aiFirstInvitations")]: "1",
      [featureFlagEnvVar("invitationGenerationKillSwitch")]: "1",
      [featureFlagEnvVar("aiFirstDisableAutomaticRetry")]: "1",
      [AI_FIRST_DIRECTION_LIMIT_ENV]: "1",
      [AI_FIRST_IMAGE_MODEL_ENV]: "gpt-image-2",
      ANTHROPIC_API_KEY: "hidden-anthropic-key",
      OPENAI_API_KEY: "hidden-openai-key",
      ...input.env,
    },
    checkModelReadiness: input.checkModelReadiness,
    runConceptProof: input.runConceptProof,
  });
  return { app, previewStore, usageStore, runStore, artworkAttemptStore };
}

describe("protected Preview review routes", () => {
  it("404s outside Preview before any model check", async () => {
    let checks = 0;
    const { app } = reviewApp({
      env: { VERCEL_ENV: "production" },
      checkModelReadiness: async () => {
        checks += 1;
        throw new Error("must not run");
      },
    });
    const response = await request(app).get(`/api/events/owner/${OWNER}/ai-first/review/readiness`);
    expect(response.status).toBe(404);
    expect(checks).toBe(0);
  });

  it("requires the kill switch before any provider check", async () => {
    let checks = 0;
    const { app } = reviewApp({
      env: { [featureFlagEnvVar("invitationGenerationKillSwitch")]: "0" },
      checkModelReadiness: async () => {
        checks += 1;
        throw new Error("must not run");
      },
    });
    const response = await request(app).get(`/api/events/owner/${OWNER}/ai-first/review/readiness`);
    expect(response.status).toBe(409);
    expect(response.body.denial).toBe("kill-switch-required");
    expect(checks).toBe(0);
  });

  it("reports both exact models and the bounded canary controls without exposing keys", async () => {
    const { app } = reviewApp({
      checkModelReadiness: async () => ({
        ready: true,
        anthropic: {
          provider: "anthropic",
          model: "claude-sonnet-4-6",
          configured: true,
          accessible: true,
        },
        openai: { provider: "openai", model: "gpt-image-2", configured: true, accessible: true },
        imageProviderCalls: 0,
      }),
    });
    const response = await request(app).get(`/api/events/owner/${OWNER}/ai-first/review/readiness`);
    expect(response.status, response.text).toBe(200);
    expect(response.body).toMatchObject({
      ready: true,
      environment: "preview",
      killSwitch: true,
      canaryControlsReady: true,
      directionLimit: 1,
      automaticRetryDisabled: true,
      artworkModel: "gpt-image-2",
      imageProviderCalls: 0,
      billedArtworkAttempts: 0,
    });
    expect(response.text).not.toContain("hidden-anthropic-key");
    expect(response.text).not.toContain("hidden-openai-key");
  });

  it("runs an explicitly confirmed concept proof without any durable run or artwork record", async () => {
    const { app, usageStore, runStore, artworkAttemptStore } = reviewApp({
      runConceptProof: async () => ({
        model: "claude-sonnet-4-6",
        concepts: conceptQuartet(),
        conceptRejections: 0,
        imageProviderCalls: 0,
        billedArtworkAttempts: 0,
      }),
    });
    const unconfirmed = await request(app)
      .post(`/api/events/owner/${OWNER}/ai-first/review/concept-proof`)
      .send({});
    expect(unconfirmed.status).toBe(400);

    const response = await request(app)
      .post(`/api/events/owner/${OWNER}/ai-first/review/concept-proof`)
      .send({ confirmConceptOnly: true });
    expect(response.status, response.text).toBe(200);
    expect(response.body).toMatchObject({
      model: "claude-sonnet-4-6",
      environment: "preview",
      killSwitch: true,
      runClaimed: false,
      imageProviderCalls: 0,
      billedArtworkAttempts: 0,
    });
    expect(response.body.concepts).toHaveLength(4);
    expect(usageStore.all).toHaveLength(0);
    expect(runStore.all).toHaveLength(0);
    expect(artworkAttemptStore.all).toHaveLength(0);
  });

  it("returns the exact Anthropic failure while preserving the zero-image boundary", async () => {
    const exact =
      '400 {"type":"error","error":{"type":"invalid_request_error","message":"Your credit balance is too low to access the Anthropic API."}}';
    const { app, usageStore, runStore, artworkAttemptStore } = reviewApp({
      runConceptProof: async () => {
        throw new Error(exact);
      },
    });
    const response = await request(app)
      .post(`/api/events/owner/${OWNER}/ai-first/review/concept-proof`)
      .send({ confirmConceptOnly: true });
    expect(response.status).toBe(503);
    expect(response.body.error).toBe(exact);
    expect(response.body).toMatchObject({ imageProviderCalls: 0, billedArtworkAttempts: 0, runClaimed: false });
    expect(usageStore.all).toHaveLength(0);
    expect(runStore.all).toHaveLength(0);
    expect(artworkAttemptStore.all).toHaveLength(0);
  });
});

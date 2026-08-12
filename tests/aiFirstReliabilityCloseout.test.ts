// Final PR #3 reliability controls. Every provider dependency is faked;
// this file cannot make OpenAI or Anthropic calls.

import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import type Anthropic from "@anthropic-ai/sdk";
import type { PipelineEvent } from "@shared/aiFirstStream";
import { featureFlagEnvVar } from "@shared/featureFlags";
import {
  estimateImageCostUsdMicros,
  sizeForAspect,
  type ArtworkModel,
} from "../server/aiFirst/artwork";
import {
  AI_FIRST_DIRECTION_LIMIT_ENV,
  AI_FIRST_IMAGE_MODEL_ENV,
  readAiFirstArtworkModel,
  readAiFirstDirectionLimit,
} from "../server/aiFirst/config";
import { runAiFirstPipeline, type PipelineInput } from "../server/aiFirst/pipeline";
import {
  InMemoryRunStore,
  RUN_LEASE_EXPIRED_ERROR,
  RUN_LEASE_MS,
} from "../server/aiFirst/runStore";
import { InMemoryPreviewStore } from "../server/aiFirst/previewStore";
import { InMemoryUsageStore } from "../server/aiFirst/usage";
import { InMemoryArtworkAttemptStore } from "../server/aiFirst/artworkAttemptStore";
import { abortOnUnexpectedResponseClose, registerAiFirstRoutes } from "../server/aiFirst/routes";
import type { EventBrief } from "../server/aiFirst/brief";
import { artworkForAspect, concept, conceptQuartet } from "./aiFirstFixtures";

const brief: EventBrief = {
  eventName: "Ada's 4th Birthday",
  eventType: "birthday",
  milestone: "4th",
  vibe: "modern space cowgirl",
  themeName: "space cowgirl",
  colors: ["dusty rose"],
  formality: "playful",
  dateLine: "12 September 2026",
  season: "autumn",
  venueType: "home",
  guestCount: 18,
  dna: {},
  inspirationNotes: "",
  requirements: { required: ["space cowgirl visual identity"], preferred: [], excluded: [] },
};

const direction = concept({
  conceptName: "Orbital Lariat Chrome",
  art: {
    medium: "gouache",
    composition: "three chrome lariat orbits around a focal planet",
    prompt: "A premium modern space-cowgirl gouache composition with a focal planet and chrome lariat orbit.",
  },
});

const passingVision = {
  textLogoWatermarkFree: 5,
  artifactFree: 5,
  premiumFinish: 5,
  briefFidelity: 5,
  compositionQuality: 5,
  ageAppropriate: 5,
  requiredPresent: [{ requirement: "space cowgirl visual identity", present: true }],
  excludedFound: [],
  notes: "",
};

function oneConceptClient(): Anthropic {
  return {
    messages: {
      stream: async () =>
        (async function* () {
          yield {
            type: "content_block_delta",
            delta: { type: "text_delta", text: `${conceptQuartet(direction).map((item) => JSON.stringify(item)).join("\n")}\n` },
          };
        })(),
      create: async () => ({
        content: [{ type: "text", text: JSON.stringify(passingVision) }],
        usage: { input_tokens: 1000, output_tokens: 100 },
      }),
    },
  } as unknown as Anthropic;
}

describe("model-aware image cost", () => {
  it("uses the documented model, quality and output dimensions", () => {
    expect(sizeForAspect("1:1")).toBe("1024x1024");
    expect(sizeForAspect("9:16")).toBe("1024x1536");
    expect(sizeForAspect("16:9")).toBe("1536x1024");
    expect(estimateImageCostUsdMicros("gpt-image-1", "high", "1024x1024")).toBe(167_000);
    expect(estimateImageCostUsdMicros("gpt-image-1", "high", "1024x1536")).toBe(250_000);
    expect(estimateImageCostUsdMicros("gpt-image-2", "high", "1024x1024")).toBe(211_000);
    expect(estimateImageCostUsdMicros("gpt-image-2", "high", "1536x1024")).toBe(165_000);
  });

  it("defaults safely and rejects unsupported configured models", () => {
    expect(readAiFirstArtworkModel({})).toBe("gpt-image-1");
    expect(readAiFirstArtworkModel({ [AI_FIRST_IMAGE_MODEL_ENV]: "gpt-image-2" })).toBe("gpt-image-2");
    expect(() => readAiFirstArtworkModel({ [AI_FIRST_IMAGE_MODEL_ENV]: "unknown" })).toThrow(
      AI_FIRST_IMAGE_MODEL_ENV,
    );
  });
});

describe("one-direction paid review canary", () => {
  it("defaults to four but honors only integer review limits from 1 through 4", () => {
    expect(readAiFirstDirectionLimit({})).toBe(4);
    expect(readAiFirstDirectionLimit({ [AI_FIRST_DIRECTION_LIMIT_ENV]: "1" })).toBe(1);
    expect(readAiFirstDirectionLimit({ [AI_FIRST_DIRECTION_LIMIT_ENV]: "3" })).toBe(3);
    for (const invalid of ["0", "5", "1.5", "nope", ""]) {
      expect(readAiFirstDirectionLimit({ [AI_FIRST_DIRECTION_LIMIT_ENV]: invalid })).toBe(4);
    }
  });

  it("makes one total image call, records provenance, and completes one direction", async () => {
    const events: PipelineEvent[] = [];
    const attempts = new InMemoryArtworkAttemptStore();
    let calls = 0;
    const model: ArtworkModel = "gpt-image-1";

    const summary = await runAiFirstPipeline({
      eventId: 1,
      ownerToken: "owner",
      runId: "one-paid-proof",
      brief,
      previewStore: new InMemoryPreviewStore(),
      usageStore: new InMemoryUsageStore(),
      artworkAttemptStore: attempts,
      allowance: 1,
      directionLimit: 1,
      disableAutomaticRetry: true,
      artworkModel: model,
      sink: (event) => events.push(event),
      anthropic: oneConceptClient(),
      ocr: false,
      generateImage: async (request) => {
        calls += 1;
        expect(request.model).toBe(model);
        expect(request.quality).toBe("high");
        const bytes = artworkForAspect(request.aspectRatio);
        return { bytes, dataUrl: `data:image/png;base64,${bytes.toString("base64")}`, durationMs: 1 };
      },
    });

    expect(calls).toBe(1);
    expect(summary.directions).toBe(1);
    expect(summary.billedImages).toBe(1);
    expect(events.filter((event) => event.type === "direction")).toHaveLength(1);
    expect(events.filter((event) => event.type === "done")).toHaveLength(1);
    expect(attempts.all).toHaveLength(1);
    expect(attempts.all[0]).toMatchObject({ model, quality: "high", size: "1024x1536" });
    expect(attempts.all[0].costUsdMicros).toBe(250_000);
  });
});

describe("stale run recovery", () => {
  it("keeps a fresh lease locked and expires a stale one before a new claim", async () => {
    const now = 10_000_000;
    const fresh = new InMemoryRunStore();
    await fresh.claim({ runId: "fresh", eventId: 1, ownerToken: "owner", now: now - RUN_LEASE_MS + 1 });
    expect((await fresh.claim({ runId: "blocked", eventId: 1, ownerToken: "owner", now })).outcome).toBe(
      "active-elsewhere",
    );

    const stale = new InMemoryRunStore();
    await stale.claim({ runId: "stale", eventId: 1, ownerToken: "owner", now: now - RUN_LEASE_MS - 1 });
    expect((await stale.claim({ runId: "replacement", eventId: 1, ownerToken: "owner", now })).outcome).toBe(
      "claimed",
    );
    expect(await stale.get("stale")).toMatchObject({
      status: "failed",
      terminal: true,
      errorMessage: RUN_LEASE_EXPIRED_ERROR,
    });
  });

  it("still allows only one winner when two replacements race after expiry", async () => {
    const store = new InMemoryRunStore();
    const now = 10_000_000;
    await store.claim({ runId: "stale", eventId: 1, ownerToken: "owner", now: now - RUN_LEASE_MS - 1 });
    const results = await Promise.all([
      store.claim({ runId: "replacement-a", eventId: 1, ownerToken: "owner", now }),
      store.claim({ runId: "replacement-b", eventId: 1, ownerToken: "owner", now }),
    ]);
    expect(results.filter((result) => result.outcome === "claimed")).toHaveLength(1);
    expect(results.filter((result) => result.outcome === "active-elsewhere")).toHaveLength(1);
  });
});

describe("terminal event ordering", () => {
  it("fails instead of emitting done when a rejected image's fallback cannot be persisted", async () => {
    const events: PipelineEvent[] = [];
    const runStore = new InMemoryRunStore();
    await runStore.claim({ runId: "fallback-save-failure", eventId: 1, ownerToken: "owner" });
    const previewStore = new (class extends InMemoryPreviewStore {
      override async put(): Promise<never> {
        throw new Error("preview store unavailable");
      }
    })();

    await expect(
      runAiFirstPipeline({
        eventId: 1,
        ownerToken: "owner",
        runId: "fallback-save-failure",
        runStore,
        brief,
        previewStore,
        usageStore: new InMemoryUsageStore(),
        allowance: 1,
        directionLimit: 1,
        disableAutomaticRetry: true,
        sink: (event) => events.push(event),
        anthropic: oneConceptClient(),
        ocr: false,
        // A deliberately crop-unsafe image forces the curated fallback.
        generateImage: async ({ aspectRatio }) => {
          const bytes = artworkForAspect(aspectRatio);
          return { bytes, dataUrl: "x", durationMs: 1 };
        },
        visionGate: async () => ({
          ...passingVision,
          ageAppropriate: 2,
          passed: false,
          failureCodes: ["age-appropriate"],
          unavailable: false,
        }),
      }),
    ).rejects.toThrow("delivered 0 of 1 promised directions");

    expect(events.some((event) => event.type === "done")).toBe(false);
    expect((await runStore.get("fallback-save-failure"))?.completedCount).toBe(0);
    expect((await runStore.get("fallback-save-failure"))?.fallbackCount).toBe(0);
  });

  it("persists completed before emitting the one done event", async () => {
    let persisted = false;
    const store = new (class extends InMemoryRunStore {
      override async complete(runId: string, now?: number): Promise<void> {
        await super.complete(runId, now);
        persisted = true;
      }
    })();
    await store.claim({ runId: "ordered", eventId: 1, ownerToken: "owner" });
    let doneCount = 0;

    await runAiFirstPipeline({
      eventId: 1,
      ownerToken: "owner",
      runId: "ordered",
      runStore: store,
      brief,
      previewStore: new InMemoryPreviewStore(),
      usageStore: new InMemoryUsageStore(),
      allowance: 1,
      directionLimit: 1,
      disableAutomaticRetry: true,
      sink: (event) => {
        if (event.type === "done") {
          doneCount += 1;
          expect(persisted).toBe(true);
        }
      },
      anthropic: oneConceptClient(),
      ocr: false,
      generateImage: async ({ aspectRatio }) => {
        const bytes = artworkForAspect(aspectRatio);
        return { bytes, dataUrl: "x", durationMs: 1 };
      },
    });

    expect(doneCount).toBe(1);
  });

  it("emits no terminal event when concept generation fails; the route owns the error terminal", async () => {
    const events: PipelineEvent[] = [];
    const broken = {
      messages: { stream: async () => { throw new Error("model unavailable"); } },
    } as unknown as Anthropic;

    await expect(
      runAiFirstPipeline({
        eventId: 1,
        brief,
        previewStore: new InMemoryPreviewStore(),
        usageStore: new InMemoryUsageStore(),
        allowance: 1,
        directionLimit: 1,
        disableAutomaticRetry: true,
        sink: (event) => events.push(event),
        anthropic: broken,
        ocr: false,
      }),
    ).rejects.toThrow("concept generation failed: model unavailable");
    expect(events.some((event) => event.type === "done" || event.type === "error")).toBe(false);
  });

  it("does not emit done when the durable complete write fails", async () => {
    const events: PipelineEvent[] = [];
    const store = new (class extends InMemoryRunStore {
      override async complete(): Promise<void> {
        throw new Error("database unavailable");
      }
    })();
    await store.claim({ runId: "db-failure", eventId: 1, ownerToken: "owner" });

    await expect(
      runAiFirstPipeline({
        eventId: 1,
        ownerToken: "owner",
        runId: "db-failure",
        runStore: store,
        brief,
        previewStore: new InMemoryPreviewStore(),
        usageStore: new InMemoryUsageStore(),
        allowance: 1,
        directionLimit: 1,
        disableAutomaticRetry: true,
        sink: (event) => events.push(event),
        anthropic: oneConceptClient(),
        ocr: false,
        generateImage: async ({ aspectRatio }) => {
          const bytes = artworkForAspect(aspectRatio);
          return { bytes, dataUrl: "x", durationMs: 1 };
        },
      }),
    ).rejects.toThrow("database unavailable");
    expect(events.some((event) => event.type === "done")).toBe(false);
  });

  it("aborts on a dropped response but not on a normal ended response", () => {
    let closeHandler: (() => void) | undefined;
    const response = {
      writableEnded: false,
      on: (event: string, handler: () => void) => {
        if (event === "close") closeHandler = handler;
        return response;
      },
    } as unknown as Parameters<typeof abortOnUnexpectedResponseClose>[0];
    const dropped = new AbortController();
    abortOnUnexpectedResponseClose(response, dropped);
    closeHandler?.();
    expect(dropped.signal.aborted).toBe(true);

    let normalClose: (() => void) | undefined;
    const endedResponse = {
      writableEnded: true,
      on: (event: string, handler: () => void) => {
        if (event === "close") normalClose = handler;
        return endedResponse;
      },
    } as unknown as Parameters<typeof abortOnUnexpectedResponseClose>[0];
    const normal = new AbortController();
    abortOnUnexpectedResponseClose(endedResponse, normal);
    normalClose?.();
    expect(normal.signal.aborted).toBe(false);
  });

  it("the route persists failure before returning exactly one error terminal", async () => {
    const app = express();
    app.use(express.json());
    const runStore = new InMemoryRunStore();
    let receivedInput: PipelineInput | undefined;
    registerAiFirstRoutes(app, {
      storage: {
        getEventByOwnerToken: async (token: string) =>
          token === "owner" ? { id: 1, capturedEmail: "host@example.com", eventType: "birthday" } : undefined,
        updateEventByOwnerToken: async () => undefined,
        getEmailEntitlement: async () => undefined,
        listMenuItems: async () => [],
        listBudgetItems: async () => [],
        listGuests: async () => [],
      },
      previewStore: new InMemoryPreviewStore(),
      usageStore: new InMemoryUsageStore(),
      runStore,
      artworkAttemptStore: new InMemoryArtworkAttemptStore(),
      env: {
        [featureFlagEnvVar("aiFirstInvitations")]: "1",
        [featureFlagEnvVar("aiFirstDisableAutomaticRetry")]: "1",
        [AI_FIRST_DIRECTION_LIMIT_ENV]: "1",
      },
      runPipeline: async (input) => {
        receivedInput = input;
        throw new Error("synthetic pipeline failure");
      },
    });

    const result = await request(app)
      .post("/api/events/owner/owner/ai-first/generate")
      .send({ runId: "route-failure" });
    expect(result.status).toBe(200);
    expect((result.text.match(/\"type\":\"error\"/g) ?? [])).toHaveLength(1);
    expect(result.text).not.toContain('"type":"done"');
    expect(receivedInput).toMatchObject({
      directionLimit: 1,
      allowance: 1,
      disableAutomaticRetry: true,
      artworkModel: "gpt-image-1",
    });
    expect(await runStore.get("route-failure")).toMatchObject({
      status: "failed",
      terminal: true,
      errorMessage: "synthetic pipeline failure",
    });
  });

  it("surfaces a theme-quality rejection in host language rather than an internal pipeline error", async () => {
    const app = express();
    app.use(express.json());
    const runStore = new InMemoryRunStore();
    registerAiFirstRoutes(app, {
      storage: {
        getEventByOwnerToken: async () => ({ id: 1, capturedEmail: "host@example.com", eventType: "birthday" }),
        updateEventByOwnerToken: async () => undefined,
        getEmailEntitlement: async () => undefined,
        listMenuItems: async () => [],
        listBudgetItems: async () => [],
        listGuests: async () => [],
      },
      previewStore: new InMemoryPreviewStore(),
      usageStore: new InMemoryUsageStore(),
      runStore,
      artworkAttemptStore: new InMemoryArtworkAttemptStore(),
      env: {
        [featureFlagEnvVar("aiFirstInvitations")]: "1",
        [featureFlagEnvVar("aiFirstDisableAutomaticRetry")]: "1",
        [AI_FIRST_DIRECTION_LIMIT_ENV]: "1",
      },
      runPipeline: async () => {
        throw new Error(
          "generated artwork did not meet Posy's quality standard and no theme-safe studio fallback matches this event",
        );
      },
    });

    const result = await request(app)
      .post("/api/events/owner/owner/ai-first/generate")
      .send({ runId: "quality-rejection" });
    expect(result.text).toContain("Posy rejected this artwork");
    expect(result.text).not.toContain("no theme-safe studio fallback");
    expect(await runStore.get("quality-rejection")).toMatchObject({
      status: "failed",
      terminal: true,
      errorMessage: expect.stringContaining("Posy rejected this artwork"),
    });
  });

  it("rejects unsupported model configuration before claiming a run", async () => {
    const app = express();
    app.use(express.json());
    const runStore = new InMemoryRunStore();
    let pipelineCalls = 0;
    registerAiFirstRoutes(app, {
      storage: {
        getEventByOwnerToken: async () => ({ id: 1, capturedEmail: "host@example.com", eventType: "birthday" }),
        updateEventByOwnerToken: async () => undefined,
        getEmailEntitlement: async () => undefined,
        listMenuItems: async () => [],
        listBudgetItems: async () => [],
        listGuests: async () => [],
      },
      previewStore: new InMemoryPreviewStore(),
      usageStore: new InMemoryUsageStore(),
      runStore,
      artworkAttemptStore: new InMemoryArtworkAttemptStore(),
      env: {
        [featureFlagEnvVar("aiFirstInvitations")]: "1",
        [AI_FIRST_IMAGE_MODEL_ENV]: "not-a-real-model",
      },
      runPipeline: async () => {
        pipelineCalls += 1;
        throw new Error("must not run");
      },
    });

    const result = await request(app)
      .post("/api/events/owner/owner/ai-first/generate")
      .send({ runId: "bad-model" });
    expect(result.status).toBe(503);
    expect(result.body.denial).toBe("invalid-provider-configuration");
    expect(pipelineCalls).toBe(0);
    expect(runStore.all).toHaveLength(0);
  });
});

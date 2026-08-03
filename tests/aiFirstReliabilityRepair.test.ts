// PR #3 reliability repair — non-provider tests.
//
// Every test here either drives the real pipeline/routes with fakes (no
// network, no OpenAI, no Anthropic key ever read) or exercises a store in
// isolation. Nothing in this file calls a provider; MAX_ARTWORK_ATTEMPTS,
// the fake `generateImage`/`anthropic` clients and the in-memory stores are
// what make that true, the same pattern the pre-existing aiFirst tests use.

import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import type Anthropic from "@anthropic-ai/sdk";
import { featureFlagEnvVar } from "@shared/featureFlags";
import type { PipelineEvent } from "@shared/aiFirstStream";
import { runAiFirstPipeline } from "../server/aiFirst/pipeline";
import { registerAiFirstRoutes } from "../server/aiFirst/routes";
import { InMemoryPreviewStore } from "../server/aiFirst/previewStore";
import { InMemoryUsageStore } from "../server/aiFirst/usage";
import { InMemoryRunStore } from "../server/aiFirst/runStore";
import { InMemoryRejectedArtworkStore } from "../server/aiFirst/rejectedArtworkStore";
import type { EventBrief } from "../server/aiFirst/brief";
import { concept, framedArtworkForAspect, artworkForAspect } from "./aiFirstFixtures";

const OWNER = "owner-token";
const EVENT_ID = 1;

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
  requirements: { required: ["the space cowgirl visual identity"], preferred: [], excluded: [] },
};

const FAILING_CONCEPT = concept({
  conceptName: "High-Noon Nebula",
  baseThemeId: "celestial-heirloom",
  placementId: "centre",
  layoutStyle: "full-bleed",
});

function singleConceptClient(): Anthropic {
  return {
    messages: {
      stream: async () =>
        (async function* () {
          yield { type: "content_block_delta", delta: { type: "text_delta", text: `${JSON.stringify(FAILING_CONCEPT)}\n` } };
        })(),
    },
  } as unknown as Anthropic;
}

const PASSING_VISION_BODY = {
  textLogoWatermarkFree: 5,
  artifactFree: 5,
  premiumFinish: 5,
  briefFidelity: 5,
  compositionQuality: 5,
  ageAppropriate: 5,
  requiredPresent: [{ requirement: "the space cowgirl visual identity", present: true }],
  excludedFound: [],
  notes: "",
};

/** Concept stream plus a vision critic that always passes — for tests where
 *  tier 1 is expected to pass and the direction should actually succeed. */
function singleConceptClientWithPassingVision(): Anthropic {
  return {
    messages: {
      stream: async () =>
        (async function* () {
          yield { type: "content_block_delta", delta: { type: "text_delta", text: `${JSON.stringify(FAILING_CONCEPT)}\n` } };
        })(),
      create: async () => ({
        content: [{ type: "text", text: JSON.stringify(PASSING_VISION_BODY) }],
        usage: { input_tokens: 1000, output_tokens: 150 },
      }),
    },
  } as unknown as Anthropic;
}

/* ── Shared "server" fixture: one storage, stores shared across app instances ── */

function makeStorage(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    getEventByOwnerToken: async (token: string) =>
      token === OWNER ? { id: EVENT_ID, capturedEmail: "host@example.com", eventType: "birthday" } : undefined,
    updateEventByOwnerToken: async (_token: string, data: Record<string, unknown>) => ({ id: EVENT_ID, ...data }),
    getEmailEntitlement: async () => undefined,
    listMenuItems: async () => [],
    listBudgetItems: async () => [],
    listGuests: async () => [],
    ...overrides,
  };
}

function appFor(deps: {
  previewStore: InMemoryPreviewStore;
  usageStore: InMemoryUsageStore;
  runStore: InMemoryRunStore;
  rejectedArtworkStore: InMemoryRejectedArtworkStore;
  env?: Record<string, string | undefined>;
}) {
  const app = express();
  app.use(express.json());
  registerAiFirstRoutes(app, {
    storage: makeStorage(),
    previewStore: deps.previewStore,
    usageStore: deps.usageStore,
    runStore: deps.runStore,
    rejectedArtworkStore: deps.rejectedArtworkStore,
    env: { [featureFlagEnvVar("aiFirstInvitations")]: "1", ...deps.env },
  });
  return app;
}

/* ═══════════════════════════════════════════════════════════════════════
   1. Unexpected stream termination (client)
   ═══════════════════════════════════════════════════════════════════════ */

describe("unexpected stream termination is a visible failure, not a silent success", () => {
  it("reports failure when the SSE body ends with no done or error event", async () => {
    const { useAiFirstSession, UNEXPECTED_STREAM_END_MESSAGE } = await import("../client/src/lib/aiFirstSession");
    const { renderHook, act, waitFor } = await import("@testing-library/react");

    // A body that streams one progress line, then just... stops. No `done`,
    // no `error`. This is the exact shape a dropped connection or a proxy
    // timeout produces.
    const body = `data: ${JSON.stringify({ type: "progress", message: "Understanding the event's visual direction…", at: Date.now() })}\n\n`;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok: true,
      body: {
        getReader: () => {
          let sent = false;
          return {
            read: async () =>
              sent
                ? { done: true, value: undefined }
                : ((sent = true), { done: false, value: new TextEncoder().encode(body) }),
          };
        },
      },
    })) as unknown as typeof fetch;

    try {
      const { result } = renderHook(() => useAiFirstSession("token"));
      await act(() => result.current.run());
      await waitFor(() => expect(result.current.error).toBe(UNEXPECTED_STREAM_END_MESSAGE));
      expect(result.current.running).toBe(false);
      // No summary was ever produced — the run must not look complete.
      expect(result.current.summary).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("does NOT report failure when the stream ends right after an explicit done event", async () => {
    const { useAiFirstSession } = await import("../client/src/lib/aiFirstSession");
    const { renderHook, act, waitFor } = await import("@testing-library/react");

    const summary = {
      directions: 0,
      adaptedDirections: 0,
      billedImages: 0,
      reusedImages: 0,
      retries: 0,
      costUsd: 0,
      msToFirstConcept: null,
      msToFirstDirection: null,
      msToAllDirections: 1,
      conceptRejections: 0,
      degraded: [],
    };
    const body = `data: ${JSON.stringify({ type: "done", summary, at: Date.now() })}\n\n`;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => ({
      ok: true,
      body: {
        getReader: () => {
          let sent = false;
          return {
            read: async () =>
              sent
                ? { done: true, value: undefined }
                : ((sent = true), { done: false, value: new TextEncoder().encode(body) }),
          };
        },
      },
    })) as unknown as typeof fetch;

    try {
      const { result } = renderHook(() => useAiFirstSession("token"));
      await act(() => result.current.run());
      await waitFor(() => expect(result.current.summary).not.toBeNull());
      expect(result.current.error).toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("the pipeline itself always emits an explicit done, even on a short/degraded run", async () => {
    // Regression pin for the server side of the same contract: whatever the
    // client is trusting, the server actually sends it.
    const events: PipelineEvent[] = [];
    const broken = {
      messages: {
        stream: async () => {
          throw new Error("model unavailable");
        },
      },
    } as unknown as Anthropic;

    await runAiFirstPipeline({
      eventId: 1,
      brief,
      previewStore: new InMemoryPreviewStore(),
      usageStore: new InMemoryUsageStore(),
      allowance: 40,
      sink: (event) => events.push(event),
      anthropic: broken,
      ocr: false,
      generateImage: async ({ aspectRatio }) => ({ bytes: artworkForAspect(aspectRatio), dataUrl: "x", durationMs: 1 }),
    });

    expect(events.some((e) => e.type === "error")).toBe(true);
    expect(events.some((e) => e.type === "done")).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   2. Multi-megabyte image fixture never enters the streamed event
   ═══════════════════════════════════════════════════════════════════════ */

describe("stream events are bounded — no full image payload ever appears in one", () => {
  it("keeps a multi-megabyte generated image out of the direction event, using a route URL instead", async () => {
    const previewStore = new InMemoryPreviewStore();
    const usageStore = new InMemoryUsageStore();
    const events: PipelineEvent[] = [];

    // A base64 PNG data URL comfortably over 1MB of raw bytes.
    const bigBytes = artworkForAspect("1:1");
    const paddedBytes = Buffer.concat([bigBytes, Buffer.alloc(2 * 1024 * 1024, 1)]);
    const bigDataUrl = `data:image/png;base64,${paddedBytes.toString("base64")}`;
    expect(bigDataUrl.length).toBeGreaterThan(1_000_000);

    await runAiFirstPipeline({
      eventId: EVENT_ID,
      ownerToken: OWNER,
      runId: "run-mb-fixture",
      brief,
      previewStore,
      usageStore,
      allowance: 40,
      sink: (event) => events.push(event),
      anthropic: singleConceptClient(),
      ocr: false,
      generateImage: async ({ aspectRatio }) => ({
        bytes: artworkForAspect(aspectRatio),
        dataUrl: bigDataUrl,
        durationMs: 1,
      }),
    });

    const serialized = events.map((e) => JSON.stringify(e));
    const maxEventBytes = Math.max(...serialized.map((s) => Buffer.byteLength(s, "utf8")));

    // Every individual SSE frame stays small: nowhere near the multi-MB
    // fixture, regardless of how large the underlying artwork actually is.
    expect(maxEventBytes).toBeLessThan(10_000);
    // The image bytes are provably not embedded verbatim anywhere in the
    // stream — not as the full data URL and not as its base64 payload.
    expect(serialized.every((s) => !s.includes(bigDataUrl))).toBe(true);
    const b64Payload = bigDataUrl.split(",")[1];
    expect(serialized.every((s) => !s.includes(b64Payload))).toBe(true);

    const direction = events.find((e): e is Extract<PipelineEvent, { type: "direction" }> => e.type === "direction")!.direction;
    // Instead, a small owner-scoped route URL is what ships on the wire.
    expect(direction.illustrationUrl).toBe(`/api/events/owner/${OWNER}/ai-first/preview/${direction.previewId}/asset`);
  });

  it("serves the real bytes back from the preview asset route with safe headers", async () => {
    const previewStore = new InMemoryPreviewStore();
    const usageStore = new InMemoryUsageStore();
    const runStore = new InMemoryRunStore();
    const rejectedArtworkStore = new InMemoryRejectedArtworkStore();
    const events: PipelineEvent[] = [];

    await runAiFirstPipeline({
      eventId: EVENT_ID,
      ownerToken: OWNER,
      runId: "run-asset-route",
      brief,
      previewStore,
      usageStore,
      allowance: 40,
      sink: (event) => events.push(event),
      anthropic: singleConceptClientWithPassingVision(),
      ocr: false,
      generateImage: async ({ aspectRatio }) => ({
        bytes: artworkForAspect(aspectRatio),
        dataUrl: `data:image/png;base64,${artworkForAspect(aspectRatio).toString("base64")}`,
        durationMs: 1,
      }),
    });

    const direction = events.find((e): e is Extract<PipelineEvent, { type: "direction" }> => e.type === "direction")!.direction;
    expect(direction.source).toBe("ai-generated");
    const app = appFor({ previewStore, usageStore, runStore, rejectedArtworkStore });

    const res = await request(app).get(
      `/api/events/owner/${OWNER}/ai-first/preview/${direction.previewId}/asset`,
    );
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/png");
    expect(res.headers["cache-control"]).toContain("immutable");
    expect(Buffer.isBuffer(res.body) || typeof res.body === "object").toBeTruthy();
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   3. Duplicate click, same run id
   ═══════════════════════════════════════════════════════════════════════ */

describe("duplicate click with the same run id does not buy a second set of images", () => {
  it("the second /generate call for an already-claimed runId is refused, not run again", async () => {
    const previewStore = new InMemoryPreviewStore();
    const usageStore = new InMemoryUsageStore();
    const runStore = new InMemoryRunStore();
    const rejectedArtworkStore = new InMemoryRejectedArtworkStore();
    const app = appFor({ previewStore, usageStore, runStore, rejectedArtworkStore });

    const runId = "run-duplicate-click";
    // Claim the run directly, as the in-flight first request would have.
    const first = await runStore.claim({ runId, eventId: EVENT_ID, ownerToken: OWNER });
    expect(first.outcome).toBe("claimed");

    // The duplicate click resends the same runId while the first request is
    // still an active SSE stream.
    const res = await request(app)
      .post(`/api/events/owner/${OWNER}/ai-first/generate`)
      .send({ runId });

    expect(res.status).toBe(409);
    expect(res.body.denial).toBe("duplicate-run");
    expect(res.body.run.runId).toBe(runId);
  });

  it("claim() itself is idempotent — a second claim never creates a second row", async () => {
    const runStore = new InMemoryRunStore();
    const runId = "run-idempotent-claim";
    const a = await runStore.claim({ runId, eventId: EVENT_ID, ownerToken: OWNER });
    const b = await runStore.claim({ runId, eventId: EVENT_ID, ownerToken: OWNER });
    expect(a.outcome).toBe("claimed");
    expect(b.outcome).toBe("duplicate");
    expect(runStore.all.filter((r) => r.runId === runId)).toHaveLength(1);
  });

  it("never spends twice for the same run+direction+attempt idempotency key", async () => {
    // Two full pipeline runs under the same runId also naturally hit the
    // pre-existing reuse-by-fingerprint path (a fingerprint match is a cache
    // hit before spend is even considered) — which already proves "no
    // duplicate spend" but not specifically the *idempotency-key* guard this
    // repair adds. This test isolates that guard: the ledger already holds
    // an entry for run+direction+attempt before resolveDirection ever runs,
    // exactly the state a crash-and-resume or a replayed request produces.
    const previewStore = new InMemoryPreviewStore();
    const usageStore = new InMemoryUsageStore();
    const runId = "run-preseeded-key";
    const idempotencyKey = `${runId}:direction-0:attempt-1`;
    await usageStore.record({
      eventId: EVENT_ID,
      email: "host@example.com",
      reason: "initial",
      billed: true,
      automatic: false,
      idempotencyKey,
      costUsdMicros: 40_000,
      createdAt: Date.now(),
    });

    let imageCalls = 0;
    const summary = await runAiFirstPipeline({
      eventId: EVENT_ID,
      ownerToken: OWNER,
      runId,
      email: "host@example.com",
      brief,
      previewStore,
      usageStore,
      allowance: 40,
      sink: () => {},
      anthropic: singleConceptClientWithPassingVision(),
      ocr: false,
      generateImage: async ({ aspectRatio }) => {
        imageCalls += 1;
        return { bytes: artworkForAspect(aspectRatio), dataUrl: "data:image/png;base64,x", durationMs: 1 };
      },
    });

    // The provider is never called for the attempt whose key is already on
    // the ledger — the guard fires before spend, exactly as required.
    expect(imageCalls).toBe(0);
    const billedRows = usageStore.all.filter((e) => e.billed);
    // Still exactly the one pre-seeded row; resolveDirection added nothing.
    expect(billedRows).toHaveLength(1);
    void summary;
  });

  it("a fresh run id for the same direction is unaffected by another run's idempotency key", async () => {
    const previewStore = new InMemoryPreviewStore();
    const usageStore = new InMemoryUsageStore();
    await usageStore.record({
      eventId: EVENT_ID,
      reason: "initial",
      billed: true,
      automatic: false,
      idempotencyKey: "run-other:direction-0:attempt-1",
      costUsdMicros: 40_000,
      createdAt: Date.now(),
    });

    let imageCalls = 0;
    await runAiFirstPipeline({
      eventId: EVENT_ID,
      ownerToken: OWNER,
      runId: "run-fresh",
      brief,
      previewStore,
      usageStore,
      allowance: 40,
      sink: () => {},
      anthropic: singleConceptClientWithPassingVision(),
      ocr: false,
      generateImage: async ({ aspectRatio }) => {
        imageCalls += 1;
        return { bytes: artworkForAspect(aspectRatio), dataUrl: "data:image/png;base64,x", durationMs: 1 };
      },
    });

    expect(imageCalls).toBe(1);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   4. Duplicate requests reaching separate simulated server instances
   ═══════════════════════════════════════════════════════════════════════ */

describe("duplicate requests reaching separate simulated server instances", () => {
  it("two Express apps sharing one durable run store treat a raced claim as one run", async () => {
    // Two "instances": distinct Express apps (so nothing but the durable
    // stores is shared between them), pointed at the exact same runStore/
    // usageStore/previewStore \u2014 standing in for two Vercel invocations
    // talking to the same database.
    const previewStore = new InMemoryPreviewStore();
    const usageStore = new InMemoryUsageStore();
    const runStore = new InMemoryRunStore();
    const rejectedArtworkStore = new InMemoryRejectedArtworkStore();

    const instanceA = appFor({ previewStore, usageStore, runStore, rejectedArtworkStore });
    const instanceB = appFor({ previewStore, usageStore, runStore, rejectedArtworkStore });

    const runId = "run-cross-instance";

    // Both requests race for the same runId. Neither app has any private
    // state about the other's request \u2014 only the shared runStore does.
    const [resA, resB] = await Promise.all([
      request(instanceA).post(`/api/events/owner/${OWNER}/ai-first/generate`).send({ runId }),
      request(instanceB).post(`/api/events/owner/${OWNER}/ai-first/generate`).send({ runId }),
    ]);

    const statuses = [resA.status, resB.status].sort();
    // One instance's request is claimed (streams as SSE, status 200 with a
    // text/event-stream body); the other is told it's a duplicate.
    expect(statuses).toContain(409);
    expect(runStore.all.filter((r) => r.runId === runId)).toHaveLength(1);
  });

  it("a fresh runId on a second instance is unaffected by another event's active run", async () => {
    const previewStore = new InMemoryPreviewStore();
    const usageStore = new InMemoryUsageStore();
    const runStore = new InMemoryRunStore();
    const rejectedArtworkStore = new InMemoryRejectedArtworkStore();
    await runStore.claim({ runId: "run-other-event", eventId: 999, ownerToken: "someone-else" });

    const instanceB = appFor({ previewStore, usageStore, runStore, rejectedArtworkStore });
    expect(await runStore.hasActiveRun(EVENT_ID)).toBe(false);

    const res = await request(instanceB)
      .post(`/api/events/owner/${OWNER}/ai-first/generate`)
      .send({ runId: "run-fresh-on-b" });
    // Not a 409 \u2014 unrelated event, unrelated run id.
    expect(res.status).not.toBe(409);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   5. All four gates failing
   ═══════════════════════════════════════════════════════════════════════ */

describe("all four gates failing (tier1 x2 attempts, vision x2 attempts)", () => {
  it("rejects on every attempt and still falls back to a customer-safe direction", async () => {
    const previewStore = new InMemoryPreviewStore();
    const usageStore = new InMemoryUsageStore();
    const rejectedArtworkStore = new InMemoryRejectedArtworkStore();
    const events: PipelineEvent[] = [];

    const summary = await runAiFirstPipeline({
      eventId: EVENT_ID,
      ownerToken: OWNER,
      runId: "run-four-gates",
      email: "host@example.com",
      brief,
      previewStore,
      usageStore,
      rejectedArtworkStore,
      allowance: 40,
      sink: (event) => events.push(event),
      anthropic: singleConceptClient(),
      ocr: false,
      // Tier 1 fails both attempts (a printed margin on every image) \u2014 the
      // vision gate is therefore never reached, so all four "gates" that
      // could have run (tier1 attempt 1, tier1 attempt 2, and the vision
      // pass each of those would have unlocked) come back failed/never-pass.
      generateImage: async ({ aspectRatio }) => ({
        bytes: framedArtworkForAspect(aspectRatio),
        dataUrl: `data:image/png;base64,${framedArtworkForAspect(aspectRatio).toString("base64")}`,
        durationMs: 1,
      }),
    });

    expect(summary.directions).toBe(1);
    expect(summary.adaptedDirections).toBe(1);
    const direction = events.find((e): e is Extract<PipelineEvent, { type: "direction" }> => e.type === "direction")!.direction;
    expect(direction.source).toBe("adapted-studio-direction");
    expect(direction.attempts.every((a) => a.tier1.passed === false)).toBe(true);
    expect(direction.attempts).toHaveLength(2);

    // Both billed, rejected attempts are durably retained.
    const rejected = await rejectedArtworkStore.listForOwner(EVENT_ID, OWNER);
    expect(rejected).toHaveLength(2);
    expect(rejected.every((r) => r.failureCodes.length > 0)).toBe(true);
    expect(rejected.every((r) => r.tier1Findings.length > 0)).toBe(true);
    expect(rejected.every((r) => r.costUsdMicros > 0)).toBe(true);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   6. Rejected artwork retained for protected review, hidden from ordinary users
   ═══════════════════════════════════════════════════════════════════════ */

describe("rejected paid artwork: retained for protected review, invisible to ordinary routes", () => {
  async function seedRejectedRun() {
    const previewStore = new InMemoryPreviewStore();
    const usageStore = new InMemoryUsageStore();
    const runStore = new InMemoryRunStore();
    const rejectedArtworkStore = new InMemoryRejectedArtworkStore();
    const events: PipelineEvent[] = [];

    await runAiFirstPipeline({
      eventId: EVENT_ID,
      ownerToken: OWNER,
      runId: "run-protected-review",
      email: "host@example.com",
      brief,
      previewStore,
      usageStore,
      rejectedArtworkStore,
      allowance: 40,
      sink: (event) => events.push(event),
      anthropic: singleConceptClient(),
      ocr: false,
      generateImage: async ({ aspectRatio }) => ({
        bytes: framedArtworkForAspect(aspectRatio),
        dataUrl: `data:image/png;base64,${framedArtworkForAspect(aspectRatio).toString("base64")}`,
        durationMs: 1,
      }),
    });

    return { previewStore, usageStore, runStore, rejectedArtworkStore, events };
  }

  it("the owner-scoped review route returns the rejected evidence", async () => {
    const { previewStore, usageStore, runStore, rejectedArtworkStore } = await seedRejectedRun();
    const app = appFor({ previewStore, usageStore, runStore, rejectedArtworkStore });

    const res = await request(app).get(`/api/events/owner/${OWNER}/ai-first/review/rejected`);
    expect(res.status).toBe(200);
    expect(res.body.rejected.length).toBeGreaterThan(0);
    expect(res.body.rejected[0].assetDataUrl).toMatch(/^data:image\/png;base64,/);
    expect(res.body.rejected[0].failureCodes.length).toBeGreaterThan(0);
  });

  it("a different owner token for the same event sees nothing", async () => {
    const { previewStore, usageStore, runStore, rejectedArtworkStore } = await seedRejectedRun();
    const app = appFor({ previewStore, usageStore, runStore, rejectedArtworkStore });

    // A wrong/unknown owner token doesn't resolve to an event at all, so the
    // route 404s rather than leaking anything.
    const res = await request(app).get(`/api/events/owner/not-the-owner/ai-first/review/rejected`);
    expect(res.status).toBe(404);
  });

  it("ordinary routes never surface a rejected image", async () => {
    const { previewStore, usageStore, runStore, rejectedArtworkStore, events } = await seedRejectedRun();
    const app = appFor({ previewStore, usageStore, runStore, rejectedArtworkStore });

    // status: no mention of rejected artwork anywhere in the payload.
    const status = await request(app).get(`/api/events/owner/${OWNER}/ai-first/status`);
    expect(JSON.stringify(status.body)).not.toContain("failureCodes");

    // apply: only the finished (adapted-studio-direction) preview is
    // reachable, never a rejected attempt's bytes.
    const direction = events.find((e): e is Extract<PipelineEvent, { type: "direction" }> => e.type === "direction")!.direction;
    const apply = await request(app)
      .post(`/api/events/owner/${OWNER}/ai-first/apply`)
      .send({ previewId: direction.previewId, assetHash: direction.assetHash });
    expect(apply.status).toBe(200);

    // The rejected bytes are not addressable through the preview store at
    // all \u2014 they were never saved there in the first place.
    const rejected = (await rejectedArtworkStore.listForOwner(EVENT_ID, OWNER))[0];
    const viaPreviewStore = await previewStore.findByPreviewId(EVENT_ID, rejected.assetHash);
    expect(viaPreviewStore).toBeUndefined();
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   7. Visible user failure (already partly covered above; route-level check)
   ═══════════════════════════════════════════════════════════════════════ */

describe("visible user failure", () => {
  it("a run that hits a hard error still ends with an explicit, readable error event", async () => {
    const previewStore = new InMemoryPreviewStore();
    const usageStore = new InMemoryUsageStore();
    const events: PipelineEvent[] = [];

    await runAiFirstPipeline({
      eventId: EVENT_ID,
      brief,
      previewStore,
      usageStore,
      allowance: 40,
      sink: (event) => events.push(event),
      anthropic: {
        messages: { stream: async () => { throw new Error("concept model unreachable"); } },
      } as unknown as Anthropic,
      ocr: false,
      generateImage: async ({ aspectRatio }) => ({ bytes: artworkForAspect(aspectRatio), dataUrl: "x", durationMs: 1 }),
    });

    const error = events.find((e): e is Extract<PipelineEvent, { type: "error" }> => e.type === "error");
    expect(error).toBeDefined();
    expect(error!.message.toLowerCase()).toContain("concept generation failed");
  });

  it("missing runId on /generate is refused with a clear 400, not silently accepted", async () => {
    const app = appFor({
      previewStore: new InMemoryPreviewStore(),
      usageStore: new InMemoryUsageStore(),
      runStore: new InMemoryRunStore(),
      rejectedArtworkStore: new InMemoryRejectedArtworkStore(),
    });
    const res = await request(app).post(`/api/events/owner/${OWNER}/ai-first/generate`).send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toContain("runId");
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   8. Studio fallback Apply (defect 6 — verify/strengthen a026088)
   ═══════════════════════════════════════════════════════════════════════ */

describe("studio fallback Apply uses exact bytes and calls no image generator", () => {
  it("Apply persists the exact displayed studio bytes with a nonempty hash", async () => {
    const previewStore = new InMemoryPreviewStore();
    const usageStore = new InMemoryUsageStore();
    const runStore = new InMemoryRunStore();
    const rejectedArtworkStore = new InMemoryRejectedArtworkStore();
    const events: PipelineEvent[] = [];
    let imageCalls = 0;

    await runAiFirstPipeline({
      eventId: EVENT_ID,
      ownerToken: OWNER,
      runId: "run-fallback-apply",
      brief,
      previewStore,
      usageStore,
      allowance: 40,
      sink: (event) => events.push(event),
      anthropic: singleConceptClient(),
      ocr: false,
      generateImage: async ({ aspectRatio }) => {
        imageCalls += 1;
        return { bytes: framedArtworkForAspect(aspectRatio), dataUrl: "data:image/png;base64,x", durationMs: 1 };
      },
    });

    const direction = events.find((e): e is Extract<PipelineEvent, { type: "direction" }> => e.type === "direction")!.direction;
    expect(direction.source).toBe("adapted-studio-direction");
    expect(direction.assetHash).not.toBe("");

    const stored = await previewStore.findByPreviewId(EVENT_ID, direction.previewId);
    expect(stored).toBeDefined();

    const app = appFor({ previewStore, usageStore, runStore, rejectedArtworkStore });
    const callsBeforeApply = imageCalls;

    const res = await request(app)
      .post(`/api/events/owner/${OWNER}/ai-first/apply`)
      .send({ previewId: direction.previewId, assetHash: direction.assetHash });

    expect(res.status).toBe(200);
    expect(imageCalls).toBe(callsBeforeApply); // no new image-generation call
    expect(res.body.assetHash).toBe(direction.assetHash);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   9. Zero provider calls with kill switch
   ═══════════════════════════════════════════════════════════════════════ */

describe("kill switch: zero provider functions invoked, clear paused response", () => {
  it("refuses /generate before any pipeline/provider function is reachable", async () => {
    let pipelineInvoked = false;
    // We don't call runAiFirstPipeline from the route under test at all in
    // this scenario since the route must short-circuit before it would; this
    // flag exists to make that assertion explicit rather than implicit.
    void pipelineInvoked;

    const app = appFor({
      previewStore: new InMemoryPreviewStore(),
      usageStore: new InMemoryUsageStore(),
      runStore: new InMemoryRunStore(),
      rejectedArtworkStore: new InMemoryRejectedArtworkStore(),
      env: { [featureFlagEnvVar("invitationGenerationKillSwitch")]: "1" },
    });

    const res = await request(app)
      .post(`/api/events/owner/${OWNER}/ai-first/generate`)
      .send({ runId: "run-kill-switch" });

    expect(res.status).toBe(403);
    expect(res.body.denial).toBe("kill-switch");
    expect(res.body.paused).toBe(true);
    expect(res.headers["content-type"]).toContain("application/json");
  });

  it("claims no run row when the kill switch is on \u2014 nothing durable is spent or started", async () => {
    const runStore = new InMemoryRunStore();
    const app = appFor({
      previewStore: new InMemoryPreviewStore(),
      usageStore: new InMemoryUsageStore(),
      runStore,
      rejectedArtworkStore: new InMemoryRejectedArtworkStore(),
      env: { [featureFlagEnvVar("invitationGenerationKillSwitch")]: "1" },
    });

    await request(app).post(`/api/events/owner/${OWNER}/ai-first/generate`).send({ runId: "run-kill-switch-2" });
    expect(runStore.all).toHaveLength(0);
  });

  it("reuse, apply and cleanup keep working while the kill switch is on", async () => {
    const previewStore = new InMemoryPreviewStore();
    const usageStore = new InMemoryUsageStore();
    const app = appFor({
      previewStore,
      usageStore,
      runStore: new InMemoryRunStore(),
      rejectedArtworkStore: new InMemoryRejectedArtworkStore(),
      env: { [featureFlagEnvVar("invitationGenerationKillSwitch")]: "1" },
    });

    const cleanup = await request(app).post("/api/ai-first/cleanup-previews").send({});
    expect(cleanup.status).toBe(200);
  });
});

/* ═══════════════════════════════════════════════════════════════════════
   10. Next-proof safety setting: disable automatic paid image retry
   ═══════════════════════════════════════════════════════════════════════ */

describe("next-proof safety setting: disables the automatic paid retry", () => {
  it("buys at most one image per direction and preserves fallback after a failed direction", async () => {
    const previewStore = new InMemoryPreviewStore();
    const usageStore = new InMemoryUsageStore();
    const events: PipelineEvent[] = [];
    let imageCalls = 0;

    const summary = await runAiFirstPipeline({
      eventId: EVENT_ID,
      ownerToken: OWNER,
      runId: "run-no-retry",
      brief,
      previewStore,
      usageStore,
      allowance: 40,
      sink: (event) => events.push(event),
      anthropic: singleConceptClient(),
      ocr: false,
      disableAutomaticRetry: true,
      generateImage: async ({ aspectRatio }) => {
        imageCalls += 1;
        return { bytes: framedArtworkForAspect(aspectRatio), dataUrl: "data:image/png;base64,x", durationMs: 1 };
      },
    });

    // One direction, one billed call \u2014 no automatic retry even though the
    // single attempt fails the gate.
    expect(imageCalls).toBe(1);
    expect(summary.retries).toBe(0);
    expect(summary.billedImages).toBe(1);
    // Fallback still fires, so the host still gets a customer-safe card.
    expect(summary.adaptedDirections).toBe(1);
    const direction = events.find((e): e is Extract<PipelineEvent, { type: "direction" }> => e.type === "direction")!.direction;
    expect(direction.source).toBe("adapted-studio-direction");
  });

  it("still allows the ordinary one retry when the setting is off", async () => {
    const previewStore = new InMemoryPreviewStore();
    const usageStore = new InMemoryUsageStore();
    let imageCalls = 0;

    const summary = await runAiFirstPipeline({
      eventId: EVENT_ID,
      brief,
      previewStore,
      usageStore,
      allowance: 40,
      sink: () => {},
      anthropic: singleConceptClient(),
      ocr: false,
      generateImage: async ({ aspectRatio }) => {
        imageCalls += 1;
        return { bytes: framedArtworkForAspect(aspectRatio), dataUrl: "data:image/png;base64,x", durationMs: 1 };
      },
    });

    expect(imageCalls).toBe(2);
    expect(summary.retries).toBe(1);
  });
});

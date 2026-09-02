import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import type { Event } from "@shared/schema";
import { isReferenceBoardDataUrl } from "../server/prePaymentReferenceBoard";

process.env.DATABASE_URL = "postgres://test/test";

vi.mock("../server/storage", () => ({ storage: {} }));
vi.mock("../server/masterPlannerEntitlement", () => ({
  canGenerateDraft: vi.fn(async () => ({ ok: false, reason: "needs_payment" })),
}));

const { registerPrePaymentPreviewQualityRoutes } = await import(
  "../server/prePaymentPreviewQualityRoutes"
);

const OWNER = "owner-token-quality-lock";
const EVENT_ID = 410;
const NOW = 1_800_000_000_000;
const OLD_PNG = `data:image/png;base64,${Buffer.from("old unreviewed pixels").toString("base64")}`;
const APPROVED_BYTES = Buffer.from("approved private pixels");
const APPROVED_PNG = `data:image/png;base64,${APPROVED_BYTES.toString("base64")}`;
const QUALITY_PREFIX = "data:image/png;posy-quality-approved;base64,";

const baseEvent = {
  id: EVENT_ID,
  ownerToken: OWNER,
  eventName: "Brian and Blippi's Extravaganza",
  eventType: "Birthday Party",
  eventDate: "Saturday, November 7, 2026",
  themeName: "",
  vibeDescription: "Blippi and Meekah at indoor soft play with bubbles and ice cream treats",
  paletteColors: "[]",
  estimatedGuestCount: 32,
  sparkUnlockedAt: null,
  prePaymentPreviewUrl: "",
  prePaymentPreviewUsedAt: null,
  prePaymentPreviewAttempts: 0,
} as unknown as Event;

let stored: Event;
const getEventByOwnerToken = vi.fn(async (token: string) => token === OWNER ? stored : undefined);
const updateEventById = vi.fn(async (id: number, data: Partial<Event>) => {
  if (id !== EVENT_ID) return undefined;
  stored = { ...stored, ...data };
  return stored;
});
const generate = vi.fn();
const classifyNamedReference = vi.fn();
const resolveNamedReference = vi.fn();
const scheduledTasks: Array<() => Promise<void>> = [];
const schedule = vi.fn((task: () => Promise<void>) => {
  scheduledTasks.push(task);
});

function makeApp(options: {
  mode?: "off" | "direction-card" | "quality-image";
  autoNamed?: boolean;
  unlocked?: boolean;
  jobTimeoutMs?: number;
} = {}) {
  const app = express();
  app.use(express.json({ limit: "6mb" }));
  registerPrePaymentPreviewQualityRoutes(app, {
    store: { getEventByOwnerToken, updateEventById },
    isUnlocked: async () => options.unlocked ?? false,
    mode: () => options.mode ?? "direction-card",
    autoNamedEnabled: () => options.autoNamed ?? true,
    classifyNamedReference,
    resolveNamedReference,
    generate,
    schedule,
    now: () => NOW,
    jobTimeoutMs: options.jobTimeoutMs,
  });
  return app;
}

async function runScheduledTask(): Promise<void> {
  const task = scheduledTasks.shift();
  if (!task) throw new Error("expected a scheduled preview task");
  await task();
}

function genericEvent(): Event {
  return {
    ...stored,
    eventName: "Candlelit Fortieth",
    vibeDescription: "Elegant candlelit rooftop dinner with terracotta flowers",
  };
}

function decodedStoredSvg(): string {
  const marker = ";base64,";
  const encoded = stored.prePaymentPreviewUrl.slice(
    stored.prePaymentPreviewUrl.indexOf(marker) + marker.length,
  );
  return Buffer.from(encoded, "base64").toString("utf8");
}

function automaticResolution() {
  return {
    images: [{
      bytes: Buffer.from("official Blippi and Meekah reference pixels"),
      mimeType: "image/png" as const,
      filename: "automatic-reference-1.png",
    }],
    notes: "Official Blippi and Meekah identity references",
    strategy: "curated" as const,
    sourcePages: ["https://www.blippi.com/about"],
  };
}

beforeEach(() => {
  stored = { ...baseEvent };
  getEventByOwnerToken.mockClear();
  updateEventById.mockClear();
  generate.mockReset();
  classifyNamedReference.mockReset();
  classifyNamedReference.mockResolvedValue(null);
  resolveNamedReference.mockReset();
  schedule.mockClear();
  scheduledTasks.length = 0;
});

describe("quality-locked prepayment preview routes", () => {
  it("rejects an invalid email before any resolution, generation or write", async () => {
    const response = await request(makeApp())
      .post(`/api/events/owner/${OWNER}/prepayment-preview`)
      .send({ email: "not-an-email" });

    expect(response.status).toBe(400);
    expect(resolveNamedReference).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
    expect(updateEventById).not.toHaveBeenCalled();
  });

  it("returns immediately, then automatically resolves and privately approves a named-theme first look", async () => {
    resolveNamedReference.mockResolvedValue(automaticResolution());
    generate.mockResolvedValue({
      kind: "approved-image",
      dataUrl: APPROVED_PNG,
      attempts: 1,
      model: "gpt-image-2",
      reviews: [],
    });

    const response = await request(makeApp())
      .post(`/api/events/owner/${OWNER}/prepayment-preview`)
      .send({ email: "host@example.com" });

    expect(response.status).toBe(202);
    expect(response.body).toEqual(expect.objectContaining({
      ready: false,
      kind: "none",
      generationState: "generating",
      referenceRecommended: false,
      automaticReferenceAttempted: true,
    }));
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(resolveNamedReference).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(stored.prePaymentPreviewAttempts).toBe(1);
    expect(stored.prePaymentPreviewUsedAt).toBe(NOW);
    expect(stored.prePaymentPreviewUrl).toBe("");

    await runScheduledTask();

    expect(resolveNamedReference).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0][1]).toEqual(expect.objectContaining({
      inspirationNotes: "Official Blippi and Meekah identity references",
      quality: "high",
      maxCandidates: 2,
      parallelCandidates: true,
      namedReference: expect.objectContaining({ id: "blippi-meekah" }),
      signal: expect.any(AbortSignal),
    }));
    expect(generate.mock.calls[0][1].referenceImages).toBeUndefined();
    expect(stored.prePaymentPreviewUrl).toBe(`${QUALITY_PREFIX}${APPROVED_BYTES.toString("base64")}`);

    const ready = await request(makeApp())
      .get(`/api/events/owner/${OWNER}/prepayment-preview/readiness`);
    expect(ready.body).toEqual(expect.objectContaining({
      ready: true,
      kind: "approved-image",
      generationState: "ready",
    }));
  });

  it("fails closed to the direction card when automatic reference resolution is unavailable", async () => {
    resolveNamedReference.mockResolvedValue(null);

    const response = await request(makeApp())
      .post(`/api/events/owner/${OWNER}/prepayment-preview`)
      .send({ email: "host@example.com" });

    expect(response.status).toBe(202);
    expect(response.body.generationState).toBe("generating");
    await runScheduledTask();

    expect(generate).not.toHaveBeenCalled();
    expect(stored.prePaymentPreviewAttempts).toBe(1);
    expect(stored.prePaymentPreviewUrl).toMatch(/^data:image\/svg\+xml;base64,/);

    const ready = await request(makeApp())
      .get(`/api/events/owner/${OWNER}/prepayment-preview/readiness`);
    expect(ready.body).toEqual(expect.objectContaining({
      kind: "direction-card",
      generationState: "fallback",
      referenceRecommended: false,
      automaticReferenceAttempted: true,
      namedReference: { id: "blippi-meekah", label: "Blippi + Meekah" },
    }));
  });

  it("falls back at the bounded deadline and aborts the active provider work", async () => {
    resolveNamedReference.mockResolvedValue(automaticResolution());
    let providerSignal: AbortSignal | undefined;
    generate.mockImplementation((_event: Event, dependencies?: { signal?: AbortSignal }) => {
      providerSignal = dependencies?.signal;
      return new Promise(() => undefined);
    });

    const response = await request(makeApp({ jobTimeoutMs: 5 }))
      .post(`/api/events/owner/${OWNER}/prepayment-preview`)
      .send({ email: "host@example.com" });

    expect(response.status).toBe(202);
    await runScheduledTask();
    expect(providerSignal).toBeDefined();
    expect(providerSignal?.aborted).toBe(true);
    expect((providerSignal?.reason as Error | undefined)?.message).toContain("preview deadline");
    expect(stored.prePaymentPreviewUrl).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it("keeps rejected named-theme candidates private and shows the reliable direction", async () => {
    resolveNamedReference.mockResolvedValue(automaticResolution());
    generate.mockResolvedValue({
      kind: "rejected",
      attempts: 2,
      model: "gpt-image-1.5",
      reviews: [],
    });

    const response = await request(makeApp())
      .post(`/api/events/owner/${OWNER}/prepayment-preview`)
      .send({ email: "host@example.com" });

    expect(response.status).toBe(202);
    await runScheduledTask();
    expect(stored.prePaymentPreviewUrl).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(JSON.stringify(response.body)).not.toContain("data:image");
  });

  it("treats a repeated request during background work as the same in-flight first look", async () => {
    const app = makeApp();
    const first = await request(app)
      .post(`/api/events/owner/${OWNER}/prepayment-preview`)
      .send({ email: "host@example.com" });
    const second = await request(app)
      .post(`/api/events/owner/${OWNER}/prepayment-preview`)
      .send({ email: "host@example.com" });

    expect(first.status).toBe(202);
    expect(second.status).toBe(202);
    expect(second.body.generationState).toBe("generating");
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(scheduledTasks).toHaveLength(1);
  });

  it("recovers an abandoned background request to the safe direction card", async () => {
    stored = {
      ...stored,
      prePaymentPreviewAttempts: 1,
      prePaymentPreviewUrl: "",
      prePaymentPreviewUsedAt: NOW - (6 * 60 * 1000) - 1,
    };

    const response = await request(makeApp())
      .get(`/api/events/owner/${OWNER}/prepayment-preview/readiness`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      ready: true,
      kind: "direction-card",
      generationState: "fallback",
    }));
    expect(stored.prePaymentPreviewUrl).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it("does not repeat provider spend after a completed automatic attempt returned the direction card", async () => {
    stored = {
      ...stored,
      prePaymentPreviewAttempts: 1,
      prePaymentPreviewUrl: "data:image/svg+xml;base64,AAAA",
      prePaymentPreviewUsedAt: NOW,
    };

    const response = await request(makeApp())
      .post(`/api/events/owner/${OWNER}/prepayment-preview`)
      .send({ email: "host@example.com" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      kind: "direction-card",
      generationState: "fallback",
      automaticReferenceAttempted: true,
    }));
    expect(resolveNamedReference).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
  });

  it("supports a host-supplied reference only as an optional override without provider spend", async () => {
    const referenceBytes = Buffer.from("exact host reference pixels");
    const response = await request(makeApp())
      .post(`/api/events/owner/${OWNER}/prepayment-preview`)
      .send({
        email: "host@example.com",
        inspirationImages: [`data:image/png;base64,${referenceBytes.toString("base64")}`],
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      kind: "reference-board",
      referenceRecommended: false,
      referenceCaptured: true,
      generationState: "ready",
    }));
    expect(resolveNamedReference).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
    expect(stored.prePaymentPreviewAttempts).toBe(0);
    expect(isReferenceBoardDataUrl(stored.prePaymentPreviewUrl)).toBe(true);
    expect(decodedStoredSvg()).toContain(`data:image/png;base64,${referenceBytes.toString("base64")}`);
  });

  it("uses the safe direction card when automatic named research is disabled", async () => {
    const response = await request(makeApp({ autoNamed: false }))
      .post(`/api/events/owner/${OWNER}/prepayment-preview`)
      .send({ email: "host@example.com" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      kind: "direction-card",
      automaticReferenceAttempted: false,
    }));
    expect(resolveNamedReference).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
    expect(stored.prePaymentPreviewAttempts).toBe(0);
  });

  it("returns immediately, then classifies an original theme once in the scheduled job", async () => {
    stored = genericEvent();

    const response = await request(makeApp({ mode: "direction-card" }))
      .post(`/api/events/owner/${OWNER}/prepayment-preview`)
      .send({ email: "host@example.com" });

    expect(response.status).toBe(202);
    expect(response.body.kind).toBe("none");
    expect(response.body.directionCard.headline).toContain("Candlelit");
    expect(classifyNamedReference).not.toHaveBeenCalled();
    expect(schedule).toHaveBeenCalledTimes(1);

    await runScheduledTask();
    expect(classifyNamedReference).toHaveBeenCalledTimes(1);
    expect(resolveNamedReference).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(stored.prePaymentPreviewAttempts).toBe(1);
    expect(stored.prePaymentPreviewUrl).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it("recognizes an arbitrary named world once on POST and never reclassifies it from GET polling", async () => {
    stored = {
      ...stored,
      eventName: "Ella's Sesame Street Party",
      themeName: "Sesame Street",
      vibeDescription: "Sesame Street characters at a neighborhood block party with bubbles",
    } as unknown as Event;
    const sesame = {
      id: "named-theme-sesame-street",
      label: "Sesame Street",
      trigger: /sesame street/i,
      cues: ["Sesame Street", "Neighborhood friends", "Playful learning", "Block-party joy"],
      palette: ["#1b5e9b", "#f2c230", "#f7f1e5", "#d84f45"],
      requirements: ["The Sesame Street identity is unmistakable through its recognizable neighborhood character world."],
    };
    classifyNamedReference.mockResolvedValue(sesame);
    resolveNamedReference.mockResolvedValue(null);

    const response = await request(makeApp())
      .post(`/api/events/owner/${OWNER}/prepayment-preview`)
      .send({ email: "host@example.com" });

    expect(response.status).toBe(202);
    expect(response.body.directionCard.headline).toBe("Sesame Street");
    expect(classifyNamedReference).not.toHaveBeenCalled();

    const pollingBeforeWork = await request(makeApp())
      .get(`/api/events/owner/${OWNER}/prepayment-preview/readiness`);
    expect(pollingBeforeWork.status).toBe(200);
    expect(classifyNamedReference).not.toHaveBeenCalled();

    await runScheduledTask();
    expect(classifyNamedReference).toHaveBeenCalledTimes(1);
    expect(decodedStoredSvg()).toContain("Sesame Street");

    const ready = await request(makeApp())
      .get(`/api/events/owner/${OWNER}/prepayment-preview/readiness`);
    expect(ready.status).toBe(200);
    expect(classifyNamedReference).toHaveBeenCalledTimes(1);
  });

  it("serves a quality-approved arbitrary named theme without reclassifying on GET", async () => {
    stored = {
      ...genericEvent(),
      eventName: "Ella's Sesame Street Party",
      themeName: "Sesame Street",
      prePaymentPreviewUrl: `${QUALITY_PREFIX}${APPROVED_BYTES.toString("base64")}`,
      prePaymentPreviewUsedAt: NOW,
      prePaymentPreviewAttempts: 1,
    } as unknown as Event;

    const response = await request(makeApp({ mode: "direction-card", unlocked: true }))
      .get(`/api/events/owner/${OWNER}/prepayment-preview/asset`);

    expect(response.status).toBe(200);
    expect(Buffer.compare(response.body, APPROVED_BYTES)).toBe(0);
    expect(classifyNamedReference).not.toHaveBeenCalled();
  });

  it("stores original-theme artwork only after the scheduled private quality function approves it", async () => {
    stored = genericEvent();
    generate.mockResolvedValue({
      kind: "approved-image",
      dataUrl: APPROVED_PNG,
      attempts: 1,
      model: "gpt-image-2",
      reviews: [],
    });

    const response = await request(makeApp({ mode: "quality-image" }))
      .post(`/api/events/owner/${OWNER}/prepayment-preview`)
      .send({ email: "host@example.com" });

    expect(response.status).toBe(202);
    expect(response.body.kind).toBe("none");
    expect(classifyNamedReference).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();

    await runScheduledTask();

    expect(classifyNamedReference).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0][1]).toEqual(expect.objectContaining({
      quality: "medium",
      maxCandidates: 1,
      namedReference: null,
      signal: expect.any(AbortSignal),
    }));
    expect(stored.prePaymentPreviewUrl).toBe(`${QUALITY_PREFIX}${APPROVED_BYTES.toString("base64")}`);
    expect(stored.prePaymentPreviewAttempts).toBe(1);

    const ready = await request(makeApp({ mode: "quality-image" }))
      .get(`/api/events/owner/${OWNER}/prepayment-preview/readiness`);
    expect(ready.status).toBe(200);
    expect(ready.body.kind).toBe("approved-image");
  });

  it("never serves an ordinary PNG left by an older preview experiment", async () => {
    stored = {
      ...stored,
      prePaymentPreviewUrl: OLD_PNG,
      prePaymentPreviewUsedAt: 1_900_000_000_000,
    };

    const response = await request(makeApp())
      .get(`/api/events/owner/${OWNER}/prepayment-preview/asset`);

    expect(response.status).toBe(404);
    expect(JSON.stringify(response.body)).not.toContain("old unreviewed pixels");
  });

  it("serves a marked quality-approved named image", async () => {
    stored = {
      ...stored,
      prePaymentPreviewUrl: `${QUALITY_PREFIX}${APPROVED_BYTES.toString("base64")}`,
      prePaymentPreviewUsedAt: 1_900_000_000_000,
      prePaymentPreviewAttempts: 1,
    };

    const response = await request(makeApp({ unlocked: true }))
      .get(`/api/events/owner/${OWNER}/prepayment-preview/asset`);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("image/png");
    expect(Buffer.compare(response.body as Buffer, APPROVED_BYTES)).toBe(0);
  });

  it("reports automatic named-reference routing before customer action", async () => {
    const response = await request(makeApp())
      .get(`/api/events/owner/${OWNER}/prepayment-preview/readiness`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      ready: false,
      kind: "none",
      generationState: "idle",
      imageGenerationEnabled: true,
      namedReference: { id: "blippi-meekah", label: "Blippi + Meekah" },
      referenceRecommended: false,
      automaticReferenceResolutionEnabled: true,
      automaticReferenceAttempted: false,
    }));
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import type { Event } from "@shared/schema";
import { isReferenceBoardDataUrl } from "../server/prePaymentReferenceBoard";
import { generateQualityLockedPreview } from "../server/prePaymentPreviewQuality";
import { InMemoryArtworkAttemptStore } from "../server/aiFirst/artworkAttemptStore";
import { decodePng, encodePng, readPngSize } from "../server/aiFirst/png";

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
const completePrePaymentPreview = vi.fn(async (event: Event, data: Pick<Event, "prePaymentPreviewUrl" | "prePaymentPreviewUsedAt">) => {
  const fields = ["id", "ownerToken", "prePaymentPreviewAttempts", "prePaymentPreviewUrl", "prePaymentPreviewUsedAt",
    "eventName", "eventType", "eventDate", "themeName", "vibeDescription", "paletteColors", "location", "venueName", "estimatedGuestCount"] as const;
  if (fields.some((field) => stored[field] !== event[field])) return undefined;
  return updateEventById(event.id, data);
});
const generate = vi.fn();
const reservePrePaymentPreview = vi.fn(async (event: Event, startedAt: number) => {
  if (stored.id !== event.id || stored.ownerToken !== event.ownerToken || stored.sparkUnlockedAt ||
      stored.prePaymentPreviewAttempts >= 3 ||
      stored.prePaymentPreviewAttempts !== event.prePaymentPreviewAttempts ||
      stored.prePaymentPreviewUsedAt !== event.prePaymentPreviewUsedAt ||
      stored.prePaymentPreviewUrl !== event.prePaymentPreviewUrl) return undefined;
  stored = { ...stored, prePaymentPreviewAttempts: stored.prePaymentPreviewAttempts + 1,
    prePaymentPreviewUrl: "", prePaymentPreviewUsedAt: startedAt };
  return stored;
});
const classifyNamedReference = vi.fn();
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
    store: { getEventByOwnerToken, updateEventById, reservePrePaymentPreview, completePrePaymentPreview },
    isUnlocked: async () => options.unlocked ?? false,
    mode: () => options.mode ?? "direction-card",
    autoNamedEnabled: () => options.autoNamed ?? true,
    classifyNamedReference,
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

beforeEach(() => {
  stored = { ...baseEvent };
  getEventByOwnerToken.mockClear();
  updateEventById.mockClear();
  completePrePaymentPreview.mockClear();
  reservePrePaymentPreview.mockClear();
  generate.mockReset();
  classifyNamedReference.mockReset();
  classifyNamedReference.mockResolvedValue(null);
  schedule.mockClear();
  scheduledTasks.length = 0;
});

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("quality-locked prepayment preview routes", () => {
  it("serves the exact reviewed teaser and paid full source while the second candidate is still private", async () => {
    const app = makeApp();
    const attempts = new InMemoryArtworkAttemptStore();
    let releaseSibling!: () => void;
    const sibling = new Promise<void>((resolve) => { releaseSibling = resolve; });
    let published!: () => void;
    const firstPublished = new Promise<void>((resolve) => { published = resolve; });
    let count = 0;
    const runVision = vi.fn(async () => ({
      passed: true, unavailable: false, failureCodes: [], requiredPresent: [], excludedFound: [], notes: "Fixture review, not real art QA",
      scores: { textLogoWatermarkFree: 5, artifactFree: 5, premiumFinish: 5, briefFidelity: 5, compositionQuality: 5, ageAppropriate: 5 },
      durationMs: 1, usage: { inputTokens: 0, outputTokens: 0 },
    }));
    generate.mockImplementation((event, options) => generateQualityLockedPreview(event, {
      ...options,
      attemptRetention: { store: attempts, eventId: EVENT_ID, ownerToken: OWNER },
      onApproved: async (result) => { await options.onApproved(result); published(); },
      generateImage: async () => {
        const fill = ++count;
        if (fill === 2) await sibling;
        const bytes = encodePng({ width: 630, height: 1120, rgb: new Uint8Array(630 * 1120 * 3).fill(fill) });
        return { bytes, dataUrl: "not served", durationMs: 1 };
      },
      runTier1: () => ({ passed: true, findings: [], salientRegions: [], durationMs: 1 }), runVision,
    }));
    await request(app).post(`/api/events/owner/${OWNER}/prepayment-preview`).send({ email: "qa@example.com" });
    const job = runScheduledTask();
    try {
      await firstPublished;
      const ready = await request(app).get(`/api/events/owner/${OWNER}/prepayment-preview/readiness`);
      expect(ready.body.kind).toBe("approved-image");
      const teaser = await request(app).get(`/api/events/owner/${OWNER}/prepayment-preview/asset`);
      expect(teaser.headers["cache-control"]).toBe("private, no-store");
      expect(readPngSize(teaser.body)).toEqual({ width: 315, height: 560 });
      expect(teaser.body.equals(runVision.mock.calls[0][0].bytes)).toBe(true);
      const paid = await request(makeApp({ unlocked: true })).get(`/api/events/owner/${OWNER}/prepayment-preview/asset`);
      expect(readPngSize(paid.body)).toEqual({ width: 630, height: 1120 });
      expect(decodePng(paid.body).rgb[0]).toBe(1);
      expect(attempts.all).toHaveLength(1);
    } finally {
      releaseSibling();
      await job;
    }
    expect(count).toBe(2);
    expect(attempts.all).toHaveLength(2);
    expect(decodePng(Buffer.from(stored.prePaymentPreviewUrl.split(",")[1], "base64")).rgb[0]).toBe(1);
  });

  it.each([true, false])("reserves only one paid job across simultaneous stale reads (named=%s)", async (named) => {
    if (!named) stored = genericEvent();
    const snapshot = { ...stored };
    getEventByOwnerToken.mockResolvedValueOnce({ ...snapshot }).mockResolvedValueOnce({ ...snapshot });
    const results = await Promise.all([makeApp({ mode: "quality-image" }), makeApp({ mode: "quality-image" })]
      .map((app) => request(app).post(`/api/events/owner/${OWNER}/prepayment-preview`)
        .send({ email: "qa@example.com" })));
    expect(results.map((result) => result.status)).toEqual([202, 202]);
    expect(reservePrePaymentPreview).toHaveBeenCalledTimes(2);
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(stored.prePaymentPreviewAttempts).toBe(1);
  });

  it("never starts paid work when the durable reservation fails", async () => {
    reservePrePaymentPreview.mockResolvedValueOnce(undefined);
    await request(makeApp()).post(`/api/events/owner/${OWNER}/prepayment-preview`)
      .send({ email: "qa@example.com" });
    expect(schedule).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it("rejects an invalid email before any resolution, generation or write", async () => {
    const response = await request(makeApp())
      .post(`/api/events/owner/${OWNER}/prepayment-preview`)
      .send({ email: "not-an-email" });

    expect(response.status).toBe(400);
    expect(generate).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
    expect(updateEventById).not.toHaveBeenCalled();
  });

  it("returns immediately, then privately approves a text-first named-theme first look", async () => {
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
    expect(generate).not.toHaveBeenCalled();
    expect(stored.prePaymentPreviewAttempts).toBe(1);
    expect(stored.prePaymentPreviewUsedAt).toBe(NOW);
    expect(stored.prePaymentPreviewUrl).toBe("");

    await runScheduledTask();

    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0][1]).toEqual(expect.objectContaining({
      inspirationNotes: expect.stringContaining("orange glasses"),
      quality: "high",
      maxCandidates: 2,
      parallelCandidates: true,
      allowTargetedCorrection: false,
      onApproved: expect.any(Function),
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

  it.each(["rejected", "timeout"])("keeps the early approved image when its sibling ends with %s", async (ending) => {
    const app = makeApp({ jobTimeoutMs: 1000 });
    let release!: () => void;
    const sibling = new Promise<void>((resolve) => { release = resolve; });
    let published!: () => void;
    const firstPass = new Promise<void>((resolve) => { published = resolve; });
    generate.mockImplementation(async (_event, options) => {
      await options.onApproved({ kind: "approved-image", dataUrl: APPROVED_PNG, attempts: 2, model: "gpt-image-2", reviews: [] });
      published();
      await sibling;
      return { kind: "rejected", attempts: 2, model: "gpt-image-2", reviews: [] };
    });
    await request(app).post(`/api/events/owner/${OWNER}/prepayment-preview`).send({ email: "qa@example.com" });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const running = runScheduledTask();
    await firstPass;
    const winner = stored.prePaymentPreviewUrl;
    expect(winner).toBe(`${QUALITY_PREFIX}${APPROVED_BYTES.toString("base64")}`);
    if (ending === "timeout") await vi.advanceTimersByTimeAsync(1001);
    release();
    await running;
    expect(stored.prePaymentPreviewUrl).toBe(winner);
    expect(updateEventById.mock.calls.filter(([, data]) => data.prePaymentPreviewUrl)).toHaveLength(1);
    vi.useRealTimers();
    const ready = await request(app).get(`/api/events/owner/${OWNER}/prepayment-preview/readiness`);
    expect(ready.body.kind).toBe("approved-image");
    expect(ready.body.generationState).toBe("ready");
    expect(schedule).toHaveBeenCalledTimes(1);
  });

  it.each(["newer-asset", "edited-brief", "rotated-owner", "newer-job"])("rejects stale job writes after %s", async (change) => {
    const app = makeApp();
    generate.mockImplementation(async (_event, options) => {
      if (change === "newer-asset") stored = { ...stored, prePaymentPreviewUrl: "newer-protected-asset" };
      if (change === "edited-brief") stored = { ...stored, vibeDescription: "Host changed the theme" };
      if (change === "rotated-owner") stored = { ...stored, ownerToken: "rotated-owner" };
      if (change === "newer-job") stored = { ...stored, prePaymentPreviewUsedAt: NOW + 1 };
      await options.onApproved({ kind: "approved-image", dataUrl: APPROVED_PNG, attempts: 2, model: "gpt-image-2", reviews: [] });
      return { kind: "rejected", attempts: 2, model: "gpt-image-2", reviews: [] };
    });
    await request(app).post(`/api/events/owner/${OWNER}/prepayment-preview`).send({ email: "qa@example.com" });
    await runScheduledTask();
    expect(updateEventById.mock.calls.filter(([, data]) => data.prePaymentPreviewUrl)).toHaveLength(0);
  });

  it("rejects late approval callbacks after timeout without replacing the fallback", async () => {
    const app = makeApp({ jobTimeoutMs: 1000 });
    let options: any;
    generate.mockImplementation(async (_event, deps) => { options = deps; return new Promise(() => {}); });
    await request(app).post(`/api/events/owner/${OWNER}/prepayment-preview`).send({ email: "qa@example.com" });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const running = runScheduledTask();
    await vi.advanceTimersByTimeAsync(1001);
    await running;
    const fallback = stored.prePaymentPreviewUrl;
    expect(fallback).toMatch(/^data:image\/svg/);
    await options.onApproved({ kind: "approved-image", dataUrl: APPROVED_PNG, attempts: 2, model: "gpt-image-2", reviews: [] });
    expect(stored.prePaymentPreviewUrl).toBe(fallback);
  });

  it("still requires private quality approval when external reference downloads are unavailable", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("reference sites unavailable"));
    generate.mockResolvedValue({ kind: "rejected", attempts: 2, model: "gpt-image-2", reviews: [] });

    const response = await request(makeApp())
      .post(`/api/events/owner/${OWNER}/prepayment-preview`)
      .send({ email: "host@example.com" });

    expect(response.status).toBe(202);
    expect(response.body.generationState).toBe("generating");
    await runScheduledTask();

    expect(generate).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(generate.mock.calls[0][1]).toMatchObject({ quality: "high", maxCandidates: 2, parallelCandidates: true });
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
    expect(generate).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
    expect(stored.prePaymentPreviewAttempts).toBe(0);
    expect(isReferenceBoardDataUrl(stored.prePaymentPreviewUrl)).toBe(true);
    expect(decodedStoredSvg()).toContain(`data:image/png;base64,${referenceBytes.toString("base64")}`);
  });

  it("uses the safe direction card when automatic named generation is disabled", async () => {
    const response = await request(makeApp({ autoNamed: false }))
      .post(`/api/events/owner/${OWNER}/prepayment-preview`)
      .send({ email: "host@example.com" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual(expect.objectContaining({
      kind: "direction-card",
      automaticReferenceAttempted: false,
    }));
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
    generate.mockResolvedValue({ kind: "rejected", attempts: 2, model: "gpt-image-2", reviews: [] });

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

  it.each(["Moana and Maui", "Unfamiliar Star Academy"])("does not make %s depend on an unused external image download", async (label) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("external images unavailable"));
    stored = { ...genericEvent(), eventName: "General named QA", themeName: "",
      vibeDescription: `${label}. Medium: lacquer inlay. Silver foliage and a crescent moon. No extra characters.` };
    const namedReference = { id: "named-theme-test", label, trigger: /unused/, cues: [label],
      palette: ["#112233", "#223344", "#334455", "#445566"],
      requirements: [`${label} must each be independently recognizable`] };
    classifyNamedReference.mockResolvedValue(namedReference);
    generate.mockResolvedValue({ kind: "approved-image", attempts: 2, model: "gpt-image-2", reviews: [], dataUrl: APPROVED_PNG });
    const app = makeApp({ mode: "quality-image" });
    await request(app).post(`/api/events/owner/${OWNER}/prepayment-preview`).send({ email: "qa@example.com" });
    await runScheduledTask();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(classifyNamedReference).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0][0].vibeDescription).toBe(stored.vibeDescription);
    expect(generate.mock.calls[0][1]).toMatchObject({ namedReference, inspirationNotes: namedReference.requirements[0],
      quality: "high", maxCandidates: 2, parallelCandidates: true, allowTargetedCorrection: false });
    expect(generate.mock.calls[0][1].referenceImages).toBeUndefined();
    const ready = await request(app).get(`/api/events/owner/${OWNER}/prepayment-preview/readiness`);
    expect(ready.body.kind).toBe("approved-image");
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

  it.each(["timeout", "error"])("never spends on generic artwork after recognition %s", async (failure) => {
    stored = { ...genericEvent(), eventName: "Frozen Fifth Birthday",
      vibeDescription: "Disney Frozen with Elsa and Anna, cel-shaded illustration" };
    let receivedSignal: AbortSignal | undefined;
    let resolveLate: ((value: null) => void) | undefined;
    classifyNamedReference.mockImplementation((_text: string, signal: AbortSignal) => {
      receivedSignal = signal;
      if (failure === "error") return Promise.reject(new Error("recognition unavailable"));
      return new Promise(resolve => { resolveLate = resolve; });
    });
    const app = makeApp({ mode: "quality-image", jobTimeoutMs: 20 });
    const response = await request(app).post(`/api/events/owner/${OWNER}/prepayment-preview`)
      .send({ email: "qa@example.com" });
    expect(response.status).toBe(202);
    await runScheduledTask();
    expect(receivedSignal).toBeInstanceOf(AbortSignal);
    expect(receivedSignal!.aborted).toBe(failure === "timeout");
    resolveLate?.(null);
    await Promise.resolve();
    expect(generate).not.toHaveBeenCalled();
    const ready = await request(app).get(`/api/events/owner/${OWNER}/prepayment-preview/readiness`);
    expect(ready.body).toMatchObject({ kind: "direction-card", generationState: "fallback" });
    expect(classifyNamedReference).toHaveBeenCalledTimes(1);
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

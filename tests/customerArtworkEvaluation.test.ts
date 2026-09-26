/** Offline rehearsal of all eight evaluation briefs through the customer route.
 * Every provider boundary is replaced; no live artwork or human scores exist. */
import { afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import express from "express";
import request from "supertest";
import type Anthropic from "@anthropic-ai/sdk";
import type { Event } from "@shared/schema";
import { MEDIUM_FEASIBILITY_CASES } from "../server/aiFirst/mediumFeasibilityCases";
import { InMemoryArtworkAttemptStore } from "../server/aiFirst/artworkAttemptStore";
import { CUSTOMER_PREVIEW_POLICY } from "../server/customerPreviewPolicy";
import { detectNamedCreativeReference, generateQualityLockedPreview } from "../server/prePaymentPreviewQuality";

vi.mock("../server/storage", () => ({ storage: {} }));
vi.mock("../server/masterPlannerEntitlement", () => ({ canGenerateDraft: vi.fn() }));
const { registerPrePaymentPreviewQualityRoutes } = await import("../server/prePaymentPreviewQualityRoutes");
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
afterEach(() => vi.unstubAllGlobals());

it("rehearses the actual customer route for eight frozen briefs without image, critic, classifier or database calls", async () => {
  const network = vi.fn(async () => { throw new Error("Offline preflight forbids network access"); });
  vi.stubGlobal("fetch", network);
  const cases: unknown[] = [];
  let totalClassifierBoundaries = 0;
  for (const [index, item] of MEDIUM_FEASIBILITY_CASES.entries()) {
    let event = {
      id: index + 1, ownerToken: `offline-fixture-${index + 1}`, eventName: "Artwork evaluation",
      eventType: "Artwork evaluation", eventDate: "", themeName: "", vibeDescription: item.hostBrief,
      paletteColors: "[]", estimatedGuestCount: null, sparkUnlockedAt: null,
      prePaymentPreviewUrl: "", prePaymentPreviewAttempts: 0, prePaymentPreviewUsedAt: null,
    } as unknown as Event;
    const scheduled: Array<() => Promise<void>> = [];
    let imageRequest: Record<string, unknown> | undefined;
    let classifierRequest: Record<string, unknown> | undefined;
    let routePolicy: unknown;
    const classifier = vi.fn(async (body: Record<string, unknown>, options: unknown) => {
      classifierRequest = body;
      expect(options).toMatchObject({ maxRetries: 0 });
      // Hypothetical valid classification only. This is not model output and
      // cannot prove recognition; final prompt hashes may differ in a live run.
      const subjects = [...item.classifierSubjects];
      const parsed = subjects.length ? { named: true, label: subjects.join(" and "), subjects }
        : { named: false, label: "", subjects: [] };
      return { content: [{ type: "text", text: JSON.stringify(parsed) }], usage: { input_tokens: 0, output_tokens: 0 } };
    });
    const generateImage = vi.fn(async (input: Record<string, unknown>) => {
      const { signal, ...serializable } = input;
      imageRequest = serializable;
      throw new Error("OFFLINE_CAPTURE_ONLY");
    });
    const runVision = vi.fn(async () => { throw new Error("Offline preflight cannot review images"); });
    const app = express(); app.use(express.json());
    registerPrePaymentPreviewQualityRoutes(app, {
      store: {
        getEventByOwnerToken: async token => token === event.ownerToken ? event : undefined,
        updateEventById: async (_id, fields) => { event = { ...event, ...fields }; return event; },
        reservePrePaymentPreview: async (_event, startedAt) => {
          if (event.prePaymentPreviewAttempts !== 0) return undefined;
          event = { ...event, prePaymentPreviewAttempts: 1, prePaymentPreviewUsedAt: startedAt }; return event;
        },
        completePrePaymentPreview: async (_event, fields) => { event = { ...event, ...fields }; return event; },
      },
      isUnlocked: async () => false, mode: () => "quality-image", autoNamedEnabled: () => true,
      artworkAttemptStore: new InMemoryArtworkAttemptStore(), schedule: task => scheduled.push(task),
      classifyNamedReference: (text, signal) => detectNamedCreativeReference(text, {
        client: { messages: { create: classifier } } as unknown as Anthropic,
        signal, bypassCache: true, requireResolvedClassification: true,
      }),
      generate: async (inputEvent, options) => {
        routePolicy = options;
        return generateQualityLockedPreview(inputEvent, { ...options, generateImage, runVision });
      },
    });
    const endpoint = `/api/events/owner/${event.ownerToken}/prepayment-preview`;
    const submission = await request(app).post(endpoint).send({ email: "offline@example.com" });
    expect(submission.status).toBe(202);
    expect(scheduled).toHaveLength(1);
    await scheduled.shift()!();
    expect(routePolicy).toMatchObject(CUSTOMER_PREVIEW_POLICY);
    expect(imageRequest).toMatchObject({ model: "gpt-image-2", quality: "medium", outputFormat: "jpeg", maxTransientRetries: 0 });
    expect(imageRequest?.referenceImages).toBeUndefined();
    expect(imageRequest?.prompt).toContain(item.hostBrief);
    expect(hash(item.hostBrief)).toBe(item.hostBriefSha256);
    expect(generateImage).toHaveBeenCalledTimes(1);
    expect(runVision).not.toHaveBeenCalled();
    const classifierBoundaries = classifier.mock.calls.length;
    expect(classifierBoundaries).toBe(index === 0 || index === 2 ? 0 : 1);
    totalClassifierBoundaries += classifierBoundaries;
    await request(app).post(endpoint).send({ email: "offline@example.com" });
    expect(scheduled).toHaveLength(0);
    expect(generateImage).toHaveBeenCalledTimes(1);
    cases.push({
      proposedTrialId: `customer-artwork-20260909-${String(index + 1).padStart(2, "0")}`,
      priorTrialId: item.trialId, cohort: item.cohort, requestedMedium: item.requestedMedium,
      hostBrief: item.hostBrief, hostBriefSha256: item.hostBriefSha256,
      classifierDispatchesIfUncached: classifierBoundaries,
      classifierRequest: classifierRequest ?? null,
      classificationEvidence: classifierBoundaries ? "hypothetical-fixture-not-model-output" : "curated-no-call",
      promptFinality: classifierBoundaries ? "provisional-until-real-classification" : "final-at-recorded-customer-source",
      capturedImageRequest: imageRequest, capturedPromptSha256: hash(String(imageRequest?.prompt)),
      liveOutcome: null, humanReview: "pending", browserLoadedMs: null,
    });
  }
  expect(totalClassifierBoundaries).toBe(6);
  expect(network).not.toHaveBeenCalled();
  if (process.env.POSY_WRITE_CUSTOMER_PREFLIGHT === "1") writeFileSync(
    "tools/qa/CUSTOMER_ARTWORK_PREFLIGHT.json",
    JSON.stringify({
      version: 1, status: "prepared-not-paid-authorized-or-executed",
      customerSourceSha: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      customerPolicy: CUSTOMER_PREVIEW_POLICY,
      proposal: { images: 8, maxCritics: 8, maxClassifiers: 6, planningReserveUsd: 2,
        providerEnforcedDollarCap: false, noRetries: true, noReplacements: true,
        oldStudyRemainsStopped: true, releaseBenchmark: false },
      physicalImageCalls: 0, physicalCriticCalls: 0, physicalClassifierCalls: 0, networkCalls: 0, cases,
    }, null, 2) + "\n",
  );
});

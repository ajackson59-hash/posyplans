import { createHash } from "node:crypto";
import express from "express";
import request from "supertest";
import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CALIBRATION_CASES, CONSISTENCY_CASES, REFERENCE_COMPARISON_CASES, calibrationProfile, runReviewCalibration, type CalibrationCaseId } from "../server/aiFirst/reviewCalibration";
import { registerReviewCalibrationRoutes } from "../server/aiFirst/reviewCalibrationRoutes";
import { registerAiFirstRoutes } from "../server/aiFirst/routes";
import { InMemoryArtworkAttemptStore } from "../server/aiFirst/artworkAttemptStore";
import { encodePng } from "../server/aiFirst/png";

// Local fixtures verify the request/persistence boundaries, not visual identity.
// Official source pixels stay private and are never committed to this repo.
const bytes = encodePng({ width: 120, height: 60, rgb: new Uint8Array(120 * 60 * 3).fill(150) });
const hash = createHash("sha256").update(bytes).digest("hex");
const originalControls = structuredClone(CALIBRATION_CASES);
const originalConsistency = structuredClone(CONSISTENCY_CASES);
const originalReferenceCases = structuredClone(REFERENCE_COMPARISON_CASES);
beforeEach(() => {
  for (const control of [...Object.values(CALIBRATION_CASES), ...Object.values(CONSISTENCY_CASES), ...Object.values(REFERENCE_COMPARISON_CASES)]) Object.assign(control, { sourceHash: hash, reviewedHash: hash });
});
afterEach(() => {
  for (const key of Object.keys(REFERENCE_COMPARISON_CASES)) Object.assign(REFERENCE_COMPARISON_CASES[key], originalReferenceCases[key]);
  for (const key of Object.keys(CONSISTENCY_CASES)) Object.assign(CONSISTENCY_CASES[key], originalConsistency[key]);
  for (const key of Object.keys(CALIBRATION_CASES) as CalibrationCaseId[]) Object.assign(CALIBRATION_CASES[key], originalControls[key]);
});
const owner = { id: 41, ownerToken: "private-calibration-owner" };
const environment = { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "codex/launch-blockers", VERCEL_GIT_COMMIT_SHA: "fixture-sha" };
const scores = { textLogoWatermarkFree: 5, artifactFree: 5, premiumFinish: 5,
  briefFidelity: 5, compositionQuality: 5, ageAppropriate: 5 };
function critic(accurate: boolean, malformed = false) {
  const create = vi.fn(async (body: any) => ({ stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 80 },
    content: [{ type: "text", text: malformed ? "invalid" : JSON.stringify({ ...scores,
      requiredPresent: (body.output_config.format.schema.properties.requiredPresent.items.properties.requirement.enum ?? [])
        .map((requirement: string) => ({ requirement, present: accurate, evidence: "Located identity fixture evidence" })),
      excludedFound: [], notes: "",
      dimensionAssessments: Object.fromEntries(Object.keys(scores).map(k => [k, { status: "clear", criterion: "none", location: "Full canvas", observation: "Located fixture observation" }])),
      teaserChecks: { milestone: { correct: true, evidence: "No count required" },
        identity: { accurate, evidence: "Visible hair, face and costume fixture observations" },
        purchase: { wouldCreatePurchaseDesire: true, evidence: "Fixture only" } },
    }) }] }));
  return { create, client: { messages: { create } } as unknown as Anthropic };
}
function input(store: InMemoryArtworkAttemptStore, client: Anthropic, caseId: CalibrationCaseId = "rumi-matched") {
  return { store, client, caseId, bytes, owner, environment };
}
function app(store: InMemoryArtworkAttemptStore, client: Anthropic, env = environment) {
  const server = express(); server.use(express.json({ limit: "3mb" }));
  registerReviewCalibrationRoutes(server, { artworkAttemptStore: store, calibrationClient: client, env,
    storage: { getEventByOwnerToken: async (token: string) => token === owner.ownerToken ? owner :
      token === "another-owner" ? { id: 42, ownerToken: token } : undefined } as any });
  return server;
}
const root = `/api/events/owner/${owner.ownerToken}/ai-first/review/calibration`;
const body = () => ({ sourceBase64: bytes.toString("base64"), confirmOneVisionCall: true });

describe("private fixed reviewer calibration", () => {
  it("keeps completed diagnostic POST routes absent from the application, even for the authorized owner", async () => {
    const server = express(); server.use(express.json());
    const getEventByOwnerToken = vi.fn(async () => owner);
    registerAiFirstRoutes(server, { env: environment, artworkAttemptStore: new InMemoryArtworkAttemptStore(),
      storage: { getEventByOwnerToken } } as any);
    for (const path of ["calibration", "consistency-calibration", "reference-comparison"]) {
      const response = await request(server).post(`/api/events/owner/${owner.ownerToken}/ai-first/review/${path}/rumi-matched-1-text`).send({});
      expect(response.status).toBe(404);
    }
    expect(getEventByOwnerToken).not.toHaveBeenCalled();
  });
  it("compares reference pixels with a simultaneous text baseline under sixteen non-replayable claims", async () => {
    const store = new InMemoryArtworkAttemptStore(), c = critic(true);
    expect(Object.keys(REFERENCE_COMPARISON_CASES)).toHaveLength(16);
    for (const caseId of Object.keys(REFERENCE_COMPARISON_CASES)) {
      const args = { ...input(store, c.client), dataset: "references-v1" as const, caseId, referenceSources: [bytes, bytes] };
      expect(await runReviewCalibration(args)).toMatchObject({ kind: "calibrated", criticRequests: 1, imageProviderCalls: 0 });
      expect(await runReviewCalibration(args)).toMatchObject({ kind: "blocked", reason: "case-already-claimed" });
    }
    expect(c.create).toHaveBeenCalledTimes(16);
    const bodies = c.create.mock.calls.map(([body]) => body);
    expect(bodies[0].messages[0].content.filter((b: any) => b.type === "image")).toHaveLength(1);
    expect(bodies[1].messages[0].content.filter((b: any) => b.type === "image")).toHaveLength(3);
    expect(bodies[0]).toEqual(bodies[3]); expect(bodies[1]).toEqual(bodies[2]);
    expect(JSON.stringify(bodies)).not.toContain("expectedIdentity");
    expect(JSON.stringify(bodies)).not.toContain("rumi-matched");
    expect(store.all).toHaveLength(32);
    expect(store.all.every(row => row.status === "rejected" && !row.previewId)).toBe(true);
    expect(store.all[3].reviewEvidence?.verdict?.referenceEvidence).toHaveLength(2);
  });

  it("validates the complete reference pack before claiming or buying a comparison review", async () => {
    const store = new InMemoryArtworkAttemptStore(), c = critic(true);
    for (const referenceSources of [undefined, [bytes], [bytes, Buffer.from("changed")]]) {
      expect(await runReviewCalibration({ ...input(store, c.client), dataset: "references-v1",
        caseId: "rumi-matched-1-pixels", referenceSources })).toMatchObject({ kind: "blocked" });
    }
    expect(c.create).not.toHaveBeenCalled(); expect(store.all).toHaveLength(0);
  });
  it("caps the new calibration at eight physical calls across repeat requests and redeploys", async () => {
    const store = new InMemoryArtworkAttemptStore(), c = critic(true);
    expect(Object.keys(CONSISTENCY_CASES)).toHaveLength(8);
    for (const caseId of Object.keys(CONSISTENCY_CASES)) {
      const args = { ...input(store, c.client), dataset: "consistency-v1" as const, caseId };
      expect(await runReviewCalibration(args)).toMatchObject({ kind: "calibrated", criticRequests: 1, imageProviderCalls: 0 });
      expect(await runReviewCalibration({ ...args, environment: { ...environment, VERCEL_GIT_COMMIT_SHA: "redeployed" } }))
        .toMatchObject({ kind: "blocked", reason: "case-already-claimed" });
    }
    expect(await runReviewCalibration({ ...input(store, c.client), dataset: "consistency-v1", caseId: "rumi-matched-3" }))
      .toMatchObject({ kind: "blocked" });
    expect(c.create).toHaveBeenCalledTimes(8);
    expect(store.all).toHaveLength(16);
    expect(store.all.every(row => row.status === "rejected" && row.previewId === null)).toBe(true);
    const modelBodies = c.create.mock.calls.map(([body]) => JSON.stringify(body));
    expect(modelBodies[0]).toBe(modelBodies[1]); // Repetitions cannot leak a repetition label or prior result.
    expect(modelBodies[0]).toContain("REQUESTED TREATMENT: photographic + 3d");
    expect(modelBodies[0]).toContain("intentional portrait framing");
    expect(modelBodies[0]).not.toContain("expectedIdentity");
    expect(modelBodies[0]).not.toContain("located-review-controls");
  });

  it.each([["rumi-matched", true], ["rumi-mismatched", false]] as const)(
    "retains %s evidence without promoting even a passing verdict", async (caseId, accurate) => {
      const store = new InMemoryArtworkAttemptStore(), c = critic(accurate);
      const result = await runReviewCalibration(input(store, c.client, caseId));
      expect(result).toMatchObject({ kind: "calibrated", identityCorrect: true, expectedIdentity: accurate,
        criticRequests: 1, imageProviderCalls: 0, customerActivation: "disabled", criticCostUsdMicrosFromUsage: 1500 });
      expect(c.create).toHaveBeenCalledTimes(1);
      const [requestBody, options] = c.create.mock.calls[0] as unknown as [any, any];
      expect(options.maxRetries).toBe(0);
      expect(requestBody.model).toBe("claude-sonnet-4-6");
      const serialized = JSON.stringify(requestBody);
      expect(serialized).toContain("Rumi: swept-up purple hair");
      expect(serialized).toContain("Zoey: dark hair");
      expect(serialized).not.toContain("expectedIdentity");
      expect(serialized).not.toContain(caseId);
      expect(serialized).not.toContain("fixture-sha");
      expect(store.all).toHaveLength(2);
      for (const row of store.all) expect(row).toMatchObject({ status: "rejected", previewId: null, model: "posy-review-calibration-v1" });
      expect(store.all[1].reviewEvidence?.calibration).toMatchObject({ stage: "completed", identityCorrect: true,
        deploymentSha: "fixture-sha", criticRequests: 1 });
    });

  it.each([["rumi-matched", false], ["rumi-mismatched", true]] as const)("records the wrong identity decision on %s as a calibration failure", async (caseId, accurate) => {
    const store = new InMemoryArtworkAttemptStore(), c = critic(accurate);
    expect(await runReviewCalibration(input(store, c.client, caseId))).toMatchObject({ kind: "calibrated", identityCorrect: false });
  });

  it("binds identical pixel pairs to different requested identities without changing reference context", async () => {
    const positive = await calibrationProfile("rumi-matched"), negative = await calibrationProfile("rumi-mismatched");
    expect(positive.brief.inspirationNotes).toBe(negative.brief.inspirationNotes);
    expect(positive.requiredIdentity).toContain("Rumi"); expect(negative.requiredIdentity).toContain("Zoey");
    expect(CALIBRATION_CASES["rumi-matched"].reviewedHash).toBe(CALIBRATION_CASES["rumi-mismatched"].reviewedHash);
  });

  it("allows one dispatch per fixed global case under concurrency and permanently refuses replay", async () => {
    const store = new InMemoryArtworkAttemptStore(), c = critic(true), args = input(store, c.client);
    const results = await Promise.all([runReviewCalibration(args), runReviewCalibration(args)]);
    expect(results.filter(x => x.kind === "calibrated")).toHaveLength(1);
    expect(c.create).toHaveBeenCalledTimes(1);
    expect(await runReviewCalibration(args)).toEqual({ kind: "blocked", reason: "case-already-claimed" });
    expect(await runReviewCalibration({ ...args, owner: { id: 42, ownerToken: "another-owner" } })).toMatchObject({ kind: "blocked" });
    expect(c.create).toHaveBeenCalledTimes(1);
  });

  it("does not repair malformed output or reset a consumed case", async () => {
    const store = new InMemoryArtworkAttemptStore(), c = critic(true, true), args = input(store, c.client);
    expect(await runReviewCalibration(args)).toMatchObject({ kind: "calibrated", identityCorrect: false, criticRequests: 1 });
    expect(await runReviewCalibration(args)).toMatchObject({ reason: "case-already-claimed" });
    expect(c.create).toHaveBeenCalledTimes(1);
  });

  it("retains a timeout as failure with no second dispatch", async () => {
    const store = new InMemoryArtworkAttemptStore();
    const create = vi.fn((_body: any, options: any) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
    }));
    const client = { messages: { create } } as unknown as Anthropic;
    const args = { ...input(store, client), timeoutMs: 5 };
    expect(await runReviewCalibration(args)).toMatchObject({ kind: "calibrated", identityCorrect: false,
      criticRequests: 1, criticCostUsdMicrosFromUsage: null });
    expect(await runReviewCalibration(args)).toMatchObject({ reason: "case-already-claimed" });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("blocks before spending on wrong source bytes or missing durable reservation", async () => {
    const store = new InMemoryArtworkAttemptStore(), c = critic(true);
    expect(await runReviewCalibration({ ...input(store, c.client), bytes: Buffer.from("changed") })).toMatchObject({ reason: "source-integrity" });
    const reserve = vi.spyOn(store, "recordOnce").mockRejectedValue(new Error("database unavailable"));
    await expect(runReviewCalibration(input(store, c.client))).rejects.toThrow("database unavailable");
    expect(c.create).not.toHaveBeenCalled(); expect(store.all).toHaveLength(0); reserve.mockRestore();
  });

  it.each([["production", "codex/launch-blockers"], ["preview", "main"], ["development", "codex/launch-blockers"]])(
    "keeps the route absent for %s/%s", async (env, branch) => {
      const store = new InMemoryArtworkAttemptStore(), c = critic(true);
      const response = await request(app(store, c.client, { ...environment, VERCEL_ENV: env, VERCEL_GIT_COMMIT_REF: branch }))
        .post(`${root}/rumi-matched`).send(body());
      expect(response.status).toBe(404); expect(c.create).not.toHaveBeenCalled();
    });

  it("rejects other owners, unknown cases, forged expectations and unconfirmed requests without calls", async () => {
    const store = new InMemoryArtworkAttemptStore(), c = critic(true), server = app(store, c.client);
    for (const token of ["anonymous", "another-owner"]) {
      expect((await request(server).post(`${root.replace(owner.ownerToken, token)}/rumi-matched`).send(body())).status).toBe(404);
    }
    for (const caseId of ["fifth-case", "toString", "__proto__"]) {
      expect((await request(server).post(`${root}/${caseId}`).send(body())).status).toBe(404);
    }
    for (const data of [{ ...body(), expectedIdentity: true }, { sourceBase64: bytes.toString("base64") }]) {
      expect((await request(server).post(`${root}/rumi-matched`).send(data)).status).toBe(400);
    }
    expect(c.create).not.toHaveBeenCalled(); expect(store.all).toHaveLength(0);
  });

  it("returns private evidence only and cannot spend beyond the four fixed cases", async () => {
    const store = new InMemoryArtworkAttemptStore(), c = critic(true), server = app(store, c.client);
    for (const caseId of Object.keys(CALIBRATION_CASES)) {
      const response = await request(server).post(`${root}/${caseId}`).send(body());
      expect(response.status).toBe(200); expect(response.headers["cache-control"]).toBe("private, no-store");
      expect(JSON.stringify(response.body)).not.toContain(bytes.toString("base64"));
      expect((await request(server).post(`${root}/${caseId}`).send(body())).status).toBe(409);
    }
    expect(c.create).toHaveBeenCalledTimes(4);
    expect(store.all).toHaveLength(8);
    expect(store.all.every(row => row.status === "rejected" && row.previewId === null)).toBe(true);
  });
});

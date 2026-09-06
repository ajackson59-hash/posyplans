import { createHash } from "node:crypto";
import express from "express";
import request from "supertest";
import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InMemoryArtworkAttemptStore } from "../server/aiFirst/artworkAttemptStore";
import { encodePng, readPngSize } from "../server/aiFirst/png";
import { registerStyleSourceRoutes } from "../server/aiFirst/styleSourceRoutes";
import { prepareRetainedStyleSource, retainStyleSource, reviewRetainedStyleSource } from "../server/aiFirst/styleSourceReview";

// Synthetic pixels exercise security/persistence only. They do not certify art.
vi.mock("../server/aiFirst/sceneAssets/construction-gouache-v1/manifest.json", async (original) => {
  const real = await original<{ default: Record<string, unknown> }>();
  const { encodePng } = await import("../server/aiFirst/png");
  const { createHash } = await import("node:crypto");
  const bytes = encodePng({ width: 400, height: 600, rgb: new Uint8Array(400 * 600 * 3).fill(160) });
  return { default: { ...real.default, width: 400, height: 600,
    sourceSha256: createHash("sha256").update(bytes).digest("hex") } };
});

const owner = { id: 7, ownerToken: "private-test-owner" };
const png = () => encodePng({ width: 400, height: 600, rgb: new Uint8Array(400 * 600 * 3).fill(160) });
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const clearTier1 = () => ({ passed: true, findings: [], durationMs: 0 });
const allFive = { textLogoWatermarkFree: 5, artifactFree: 5, premiumFinish: 5,
  briefFidelity: 5, compositionQuality: 5, ageAppropriate: 5 };
function critic(override: Record<string, unknown> = {}) {
  const create = vi.fn(async (body: any) => ({ stop_reason: "end_turn", usage: { input_tokens: 30, output_tokens: 20 },
    content: [{ type: "text", text: JSON.stringify({ ...allFive,
      requiredPresent: (body.output_config.format.schema.properties.requiredPresent.items.properties.requirement.enum ?? [])
        .map((requirement: string) => ({ requirement, present: true, evidence: "Scripted fixture observation" })),
      excludedFound: [], notes: "Test only",
      dimensionAssessments: Object.fromEntries(Object.keys(allFive).map((k) => [k, { status: "clear", criterion: "none", location: "Full canvas", observation: "Scripted fixture observation" }])),
      teaserChecks: { milestone: { correct: true, evidence: "No age props" },
        identity: { accurate: true, evidence: "Original construction" },
        purchase: { wouldCreatePurchaseDesire: true, evidence: "Fixture only" } }, ...override,
    }) }] }));
  return { create, client: { messages: { create } } as unknown as Anthropic };
}
function app(store = new InMemoryArtworkAttemptStore(), environment = "preview", branch = "codex/launch-blockers") {
  const server = express(); server.use(express.json({ limit: "6mb" }));
  registerStyleSourceRoutes(server, { artworkAttemptStore: store,
    env: { VERCEL_ENV: environment, VERCEL_GIT_COMMIT_REF: branch },
    storage: { getEventByOwnerToken: async (token: string) => token === owner.ownerToken ? owner :
      token === "second-owner" ? { id: 8, ownerToken: token } : undefined } as any });
  return server;
}
const root = `/api/events/owner/${owner.ownerToken}/ai-first/review/style-source`;
afterEach(() => vi.useRealTimers());

describe("private style source delivery", () => {
  it("stores one original under simultaneous uploads and serves exact native/teaser pixels privately", async () => {
    const store = new InMemoryArtworkAttemptStore(), server = app(store), bytes = png();
    const responses = await Promise.all([1, 2].map(() => request(server).post(root).send({ sourceBase64: bytes.toString("base64") })));
    expect(responses.map(r => r.status).sort()).toEqual([200, 201]); expect(store.all).toHaveLength(1);
    const id = responses[0].body.attemptId;
    expect(responses[0].body).toMatchObject({ imageProviderCalls: 0, criticRequests: 0, customerActivation: "disabled" });
    expect(JSON.stringify(responses[0].body)).not.toContain(bytes.toString("base64"));
    const source = await request(server).get(`${root}/${id}/asset?variant=source`);
    expect(source.status).toBe(200); expect(source.body.equals(bytes)).toBe(true);
    expect(source.headers["cache-control"]).toBe("private, no-store");
    const teaser = await request(server).get(`${root}/${id}/asset`);
    expect(readPngSize(teaser.body)).toEqual({ width: 373, height: 560 });
    expect(hash(teaser.body)).toBe(responses[0].body.teaserHash);
    expect((await request(server).get(`${root}/${id}/asset`)).body.equals(teaser.body)).toBe(true);
    expect(store.all[0].previewId).toBeNull(); expect(store.all[0].status).toBe("rejected");
  });

  it.each([["production", "codex/launch-blockers"], ["preview", "main"], ["development", "codex/launch-blockers"]])(
    "keeps upload, retrieval and review absent in %s/%s", async (env, branch) => {
      const store = new InMemoryArtworkAttemptStore(), server = app(store, env, branch);
      expect((await request(server).post(root).send({ sourceBase64: png().toString("base64") })).status).toBe(404);
      expect((await request(server).get(`${root}/1/asset`)).status).toBe(404);
      expect((await request(server).post(`${root}/1/review`).send({})).status).toBe(404);
      expect(store.all).toHaveLength(0);
    });

  it("blocks other owners, anonymous callers and unknown assets", async () => {
    const store = new InMemoryArtworkAttemptStore(), server = app(store);
    const { record } = await retainStyleSource(png(), owner, store);
    for (const token of ["second-owner", "unknown"]) {
      const path = root.replace(owner.ownerToken, token);
      expect((await request(server).get(`${path}/${record.id}/asset`)).status).toBe(404);
      expect((await request(server).post(`${path}/${record.id}/review`).send({ confirmOneVisionCall: true, expectedAssetHash: hash(png()) })).status).toBe(404);
    }
    expect((await request(server).get(`${root}/missing/asset`)).status).toBe(404);
  });

  it("rejects changed bytes, forged metadata and review without exact confirmation", async () => {
    const store = new InMemoryArtworkAttemptStore(), server = app(store);
    for (const body of [{ sourceBase64: "AAAA" }, { sourceBase64: png().toString("base64"), customerActivation: "enabled" }]) {
      expect((await request(server).post(root).send(body)).status).toBeGreaterThanOrEqual(400);
    }
    expect(store.all).toHaveLength(0);
    const { record } = await retainStyleSource(png(), owner, store);
    for (const body of [{}, { confirmOneVisionCall: true, expectedAssetHash: "wrong" },
      { confirmOneVisionCall: true, expectedAssetHash: hash(png()), brief: "forged" }]) {
      expect((await request(server).post(`${root}/${record.id}/review`).send(body)).status).toBe(400);
    }
    expect(store.all).toHaveLength(1);
  });

  it("detects corruption when reading retained data", async () => {
    const store = new InMemoryArtworkAttemptStore(); const { record } = await retainStyleSource(png(), owner, store);
    record.assetBytesBase64 = Buffer.from("changed").toString("base64");
    expect(() => prepareRetainedStyleSource(record)).toThrow();
  });
});

describe("one bounded source review", () => {
  it("reviews exact teaser pixels once across concurrent requests and preserves source/evidence", async () => {
    const store = new InMemoryArtworkAttemptStore(), review = critic();
    const { record } = await retainStyleSource(png(), owner, store);
    const deps = { environment: "preview", confirmOneVisionCall: true, attemptStore: store, client: review.client, runTier1: clearTier1 };
    const outcomes = await Promise.all([1, 2, 3].map(() => reviewRetainedStyleSource(record, deps)));
    expect(outcomes.filter(x => x.kind === "reviewed-source")).toHaveLength(1);
    expect(review.create).toHaveBeenCalledTimes(1);
    expect(review.create.mock.calls[0][1]).toMatchObject({ maxRetries: 0 });
    const reviewed = Buffer.from(review.create.mock.calls[0][0].messages[0].content[0].source.data, "base64");
    expect(reviewed.equals(prepareRetainedStyleSource(record).teaser)).toBe(true);
    const result = store.all.find(x => x.reviewEvidence?.styleSource?.stage === "reviewed")!;
    expect(result.status).toBe("accepted"); expect(result.previewId).toBeNull();
    expect(Buffer.from(result.assetBytesBase64, "base64").equals(png())).toBe(true);
    expect(result.reviewEvidence?.styleSource).toMatchObject({ scope: "source-profile-only", criticRequests: 1, customerActivation: "disabled" });
    expect(outcomes.find(x => x.kind === "reviewed-source")).not.toHaveProperty("dataUrl");
    expect(await reviewRetainedStyleSource(record, deps)).toMatchObject({ kind: "blocked", reason: "review-already-claimed" });
  });

  it.each([{ premiumFinish: 4 }, { requiredPresent: [] }, { teaserChecks: {} }])("retains a strict rejection without repair: %j", async (override) => {
    const store = new InMemoryArtworkAttemptStore(), review = critic(override);
    const { record } = await retainStyleSource(png(), owner, store);
    const result = await reviewRetainedStyleSource(record, { environment: "preview", confirmOneVisionCall: true,
      attemptStore: store, client: review.client, runTier1: clearTier1 });
    expect(result).toMatchObject({ kind: "reviewed-source", status: "rejected" }); expect(review.create).toHaveBeenCalledTimes(1);
  });

  it("does not turn a malformed response into a second call", async () => {
    const store = new InMemoryArtworkAttemptStore(), review = critic();
    review.create.mockResolvedValue({ content: [{ type: "text", text: "invalid JSON" }], usage: {} } as any);
    const { record } = await retainStyleSource(png(), owner, store);
    expect(await reviewRetainedStyleSource(record, { environment: "preview", confirmOneVisionCall: true,
      attemptStore: store, client: review.client, runTier1: clearTier1 })).toMatchObject({ status: "rejected" });
    expect(review.create).toHaveBeenCalledTimes(1);
  });

  it("retains timed-out evidence and refuses a late approval or retry", async () => {
    const store = new InMemoryArtworkAttemptStore(), review = critic();
    const { record } = await retainStyleSource(png(), owner, store);
    let finish!: (value: any) => void;
    review.create.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const deps = { environment: "preview", confirmOneVisionCall: true, attemptStore: store,
      client: review.client, runTier1: clearTier1, reviewTimeoutMs: 100 };
    vi.useFakeTimers(); const pending = reviewRetainedStyleSource(record, deps);
    await vi.advanceTimersByTimeAsync(101);
    expect(await pending).toMatchObject({ kind: "reviewed-source", status: "rejected" });
    finish({ content: [{ type: "text", text: JSON.stringify(allFive) }] });
    expect(await reviewRetainedStyleSource(record, deps)).toMatchObject({ kind: "blocked" });
    expect(store.all.at(-1)?.status).toBe("rejected"); expect(review.create).toHaveBeenCalledTimes(1);
  });

  it("does not spend when the unique claim cannot be retained", async () => {
    const store = new InMemoryArtworkAttemptStore(), review = critic();
    const { record } = await retainStyleSource(png(), owner, store);
    vi.spyOn(store, "recordOnce").mockRejectedValue(new Error("private db failure"));
    expect(await reviewRetainedStyleSource(record, { environment: "preview", confirmOneVisionCall: true,
      attemptStore: store, client: review.client, runTier1: clearTier1 })).toMatchObject({ kind: "blocked" });
    expect(review.create).not.toHaveBeenCalled();
  });

  it("keeps another owner's global claim private", async () => {
    const store = new InMemoryArtworkAttemptStore(), review = critic();
    const first = await retainStyleSource(png(), owner, store);
    const second = await retainStyleSource(png(), { id: 8, ownerToken: "second-owner" }, store);
    const deps = { environment: "preview", confirmOneVisionCall: true, attemptStore: store, client: review.client, runTier1: clearTier1 };
    await reviewRetainedStyleSource(first.record, deps);
    expect(await reviewRetainedStyleSource(second.record, deps)).toEqual({ kind: "blocked", reason: "review-already-claimed" });
    expect(review.create).toHaveBeenCalledTimes(1);
    expect(await store.listForOwner(7, "second-owner")).toEqual([]);
  });

  it("withholds acceptance if the final verdict cannot be retained, then refuses another spend", async () => {
    const store = new InMemoryArtworkAttemptStore(), review = critic();
    const { record } = await retainStyleSource(png(), owner, store);
    const write = store.recordOnce.bind(store);
    vi.spyOn(store, "recordOnce").mockImplementation(async input => {
      if (input.idempotencyKey.startsWith("style-source-review-result:")) throw new Error("database unavailable");
      return write(input);
    });
    const deps = { environment: "preview", confirmOneVisionCall: true, attemptStore: store, client: review.client, runTier1: clearTier1 };
    expect(await reviewRetainedStyleSource(record, deps)).toMatchObject({ kind: "blocked", reason: "review-retention-failed" });
    expect(await reviewRetainedStyleSource(record, deps)).toMatchObject({ kind: "blocked", reason: "review-already-claimed" });
    expect(review.create).toHaveBeenCalledTimes(1);
    expect(store.all.every(row => row.status === "rejected" && row.previewId === null)).toBe(true);
  });
});

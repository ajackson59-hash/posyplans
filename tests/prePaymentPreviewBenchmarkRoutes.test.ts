import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import type { PreviewBenchmarkSummary } from "../server/prePaymentPreviewBenchmarkRoutes";
import { registerPrePaymentPreviewBenchmarkRoutes } from "../server/prePaymentPreviewBenchmarkRoutes";

process.env.DATABASE_URL = "postgres://test/test";

interface StoredRun {
  state: "running" | "complete";
  summary?: PreviewBenchmarkSummary;
  assets: Map<number, Buffer>;
}

function inMemoryStore() {
  const runs = new Map<string, StoredRun>();
  return {
    runs,
    store: {
      reserve: vi.fn(async (runId: string) => {
        const existing = runs.get(runId);
        if (existing?.summary) return { ...existing.summary, cached: true };
        if (existing?.state === "running") return "running" as const;
        runs.set(runId, { state: "running", assets: new Map() });
        return "reserved" as const;
      }),
      complete: vi.fn(async (runId: string, summary: PreviewBenchmarkSummary, captures: Array<{ result: { bytes: Buffer } }>) => {
        runs.set(runId, {
          state: "complete",
          summary,
          assets: new Map(captures.map((capture, index) => [index + 1, capture.result.bytes])),
        });
      }),
      summary: vi.fn(async (runId: string) => runs.get(runId)?.summary ?? null),
      asset: vi.fn(async (runId: string, attempt: number) => runs.get(runId)?.assets.get(attempt) ?? null),
      report: vi.fn(async () => Array.from(runs.values()).flatMap((run) => run.summary ? [run.summary] : [])),
    },
  };
}

function makeApp(overrides: Record<string, unknown> = {}) {
  const app = express();
  app.use(express.json());
  registerPrePaymentPreviewBenchmarkRoutes(app, {
    allow: () => true,
    now: (() => {
      let time = 1_800_000_000_000;
      return () => (time += 1000);
    })(),
    ...overrides,
  });
  return app;
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe("Preview-only funded prepayment benchmark", () => {
  it("does not expose the runner when the Preview branch guard is closed", async () => {
    const generate = vi.fn();
    const response = await request(makeApp({ allow: () => false, generate }))
      .post("/api/qa/prepayment-preview-benchmark/rooftop-fortieth/1")
      .send({});

    expect(response.status).toBe(404);
    expect(generate).not.toHaveBeenCalled();
  });

  it("accepts only cases from the fixed release corpus", async () => {
    const generate = vi.fn();
    const response = await request(makeApp({ generate }))
      .post("/api/qa/prepayment-preview-benchmark/arbitrary-user-prompt/1")
      .send({});

    expect(response.status).toBe(404);
    expect(generate).not.toHaveBeenCalled();
  });

  it("hard-blocks named entertainment themes from provider spend", async () => {
  const generate = vi.fn();
  const response = await request(makeApp({ generate }))
    .post("/api/qa/prepayment-preview-benchmark/unicorn-academy-igloo/1")
    .send({});

  expect(response.status).toBe(404);
  expect(generate).not.toHaveBeenCalled();
});

it("reports a clean 48-run generic-only release scope", async () => {
  const memory = inMemoryStore();
  const response = await request(makeApp({ store: memory.store }))
    .get("/api/qa/prepayment-preview-benchmark/report");

  expect(response.status).toBe(200);
  expect(response.body).toEqual(expect.objectContaining({
    benchmarkVersion: "prepayment-quality-lock-2026-08-31-v4-generic",
    scope: "generic-and-original-themes-only",
    excludedNamedThemeCases: 8,
    expectedRuns: 48,
    completedRuns: 0,
  }));
});

  it("runs one approved candidate, stores its private bytes and is idempotent", async () => {
    const memory = inMemoryStore();
    const generatedBytes = Buffer.from("private benchmark png bytes");
    const generateImage = vi.fn(async () => ({
      bytes: generatedBytes,
      dataUrl: `data:image/png;base64,${generatedBytes.toString("base64")}`,
      durationMs: 4200,
    }));
    const generate = vi.fn(async (_event, dependencies) => {
      await dependencies.generateImage({
        prompt: "fixed benchmark prompt",
        aspectRatio: "1:1",
        model: "gpt-image-2",
        quality: "medium",
      });
      return {
        kind: "approved-image" as const,
        dataUrl: "data:image/png;base64,PRIVATE",
        attempts: 1,
        model: "gpt-image-2" as const,
        reviews: [],
      };
    });
    const app = makeApp({ store: memory.store, generate, generateImage });

    const first = await request(app)
      .post("/api/qa/prepayment-preview-benchmark/rooftop-fortieth/1")
      .send({});

    expect(first.status).toBe(200);
    expect(first.body).toEqual(expect.objectContaining({
      caseId: "rooftop-fortieth",
      run: 1,
      kind: "approved-image",
      approved: true,
      approvedCandidate: 1,
      attempts: 1,
    }));
    expect(JSON.stringify(first.body)).not.toContain("data:image");
    expect(generate).toHaveBeenCalledTimes(1);

    const asset = await request(app)
      .get("/api/qa/prepayment-preview-benchmark/rooftop-fortieth/1/asset/1");
    expect(asset.status).toBe(200);
    expect(Buffer.compare(asset.body as Buffer, generatedBytes)).toBe(0);

    const repeated = await request(app)
      .post("/api/qa/prepayment-preview-benchmark/rooftop-fortieth/1")
      .send({});
    expect(repeated.status).toBe(200);
    expect(repeated.body.cached).toBe(true);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("records a rejected run without exposing an asset in the JSON response", async () => {
    const memory = inMemoryStore();
    const rejectedBytes = Buffer.from("rejected candidate stays private");
    const generateImage = vi.fn(async () => ({
      bytes: rejectedBytes,
      dataUrl: `data:image/png;base64,${rejectedBytes.toString("base64")}`,
      durationMs: 3500,
    }));
    const generate = vi.fn(async (_event, dependencies) => {
      await dependencies.generateImage({
        prompt: "fixed benchmark prompt",
        aspectRatio: "1:1",
        model: "gpt-image-2",
        quality: "medium",
      });
      return {
        kind: "rejected" as const,
        attempts: 1,
        model: "gpt-image-2" as const,
        reviews: [],
      };
    });

    const response = await request(makeApp({ store: memory.store, generate, generateImage }))
      .post("/api/qa/prepayment-preview-benchmark/construction/2")
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.kind).toBe("rejected");
    expect(response.body.approved).toBe(false);
    expect(JSON.stringify(response.body)).not.toContain("data:image");
  });
});

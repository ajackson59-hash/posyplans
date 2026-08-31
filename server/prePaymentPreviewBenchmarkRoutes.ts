import type { Express } from "express";
import type { Event } from "@shared/schema";
import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import {
  PREPAYMENT_PREVIEW_BENCHMARK,
  getPrePaymentPreviewBenchmarkCase,
  type PrePaymentPreviewBenchmarkCase,
} from "@shared/prePaymentPreviewBenchmark";
import { db } from "./storage";
import {
  DEFAULT_ARTWORK_MODEL,
  estimateImageCostUsdMicros,
  generateArtwork,
  sizeForAspect,
  type ArtworkRequest,
  type ArtworkResult,
} from "./aiFirst/artwork";
import {
  detectNamedCreativeReference,
  generateQualityLockedPreview,
  type QualityLockedPreviewResult,
} from "./prePaymentPreviewQuality";

const BENCHMARK_VERSION = "prepayment-quality-lock-2026-08-31-v1";
const BENCHMARK_BRANCH = "fix/prepayment-preview-quality-lock";
const RUN_TIMEOUT_MS = 8 * 60 * 1000;
const paramsSchema = z.object({
  caseId: z.string().min(1).max(80),
  run: z.coerce.number().int().min(1).max(3),
});

interface StoredBenchmarkRow {
  id: number;
  run_id: string;
  attempt: number;
  status: string;
  asset_bytes_base64: string;
  concept_json: string;
  created_at: number;
}

export interface BenchmarkReviewSummary {
  candidate: number;
  tier1Passed: boolean;
  visionPassed: boolean;
  scores: Record<string, number> | null;
  requiredMissing: string[];
  excludedFound: string[];
  failureCodes: string[];
  notes: string;
  providerDurationMs: number;
  quality: "medium";
  size: "1024x1024";
  costUsdMicros: number;
}

export interface PreviewBenchmarkSummary {
  benchmarkVersion: string;
  state: "complete";
  caseId: string;
  run: number;
  eventName: string;
  namedReference: string | null;
  referenceNotesUsed: boolean;
  kind: QualityLockedPreviewResult["kind"];
  approved: boolean;
  attempts: number;
  approvedCandidate: number | null;
  model: typeof DEFAULT_ARTWORK_MODEL;
  totalDurationMs: number;
  estimatedImageCostUsdMicros: number;
  reviews: BenchmarkReviewSummary[];
  error: string | null;
  gitSha: string | null;
  completedAt: number;
  cached?: boolean;
}

export interface PreviewBenchmarkStore {
  reserve(runId: string, eventId: number, ownerToken: string, now: number): Promise<"reserved" | "running" | PreviewBenchmarkSummary>;
  complete(runId: string, summary: PreviewBenchmarkSummary, captures: CapturedCandidate[]): Promise<void>;
  summary(runId: string): Promise<PreviewBenchmarkSummary | null>;
  asset(runId: string, attempt: number): Promise<Buffer | null>;
  report(): Promise<PreviewBenchmarkSummary[]>;
}

interface CapturedCandidate {
  request: ArtworkRequest;
  result: ArtworkResult;
}

function benchmarkRunId(caseId: string, run: number): string {
  return `${BENCHMARK_VERSION}:${caseId}:run-${run}`;
}

function syntheticEventId(caseId: string, run: number): number {
  const index = PREPAYMENT_PREVIEW_BENCHMARK.findIndex((testCase) => testCase.id === caseId);
  return 900_000 + Math.max(0, index) * 10 + run;
}

function benchmarkOwnerToken(caseId: string, run: number): string {
  return `qa-preview-${caseId}-run-${run}`;
}

function benchmarkEvent(testCase: PrePaymentPreviewBenchmarkCase, run: number): Event {
  return {
    id: syntheticEventId(testCase.id, run),
    ownerToken: benchmarkOwnerToken(testCase.id, run),
    shareSlug: `qa-${testCase.id}-${run}`,
    eventName: testCase.eventName,
    eventType: testCase.eventType,
    eventDate: "Saturday, October 17, 2026",
    location: "",
    hostNames: "",
    themeName: "",
    paletteColors: "[]",
    estimatedGuestCount: 24,
    budgetCeiling: null,
    vibeDescription: testCase.vibeDescription,
    eventIdentity: "",
    prePaymentPreviewAttempts: 0,
    prePaymentPreviewUrl: "",
    prePaymentPreviewUsedAt: null,
    sparkUnlockedAt: null,
  } as unknown as Event;
}

function parseSummary(value: string): PreviewBenchmarkSummary | null {
  try {
    const parsed = JSON.parse(value) as Partial<PreviewBenchmarkSummary>;
    return parsed?.benchmarkVersion === BENCHMARK_VERSION && parsed.state === "complete"
      ? parsed as PreviewBenchmarkSummary
      : null;
  } catch {
    return null;
  }
}

function rows(result: unknown): StoredBenchmarkRow[] {
  return Array.from(result as Iterable<StoredBenchmarkRow>);
}

class DatabasePreviewBenchmarkStore implements PreviewBenchmarkStore {
  async reserve(runId: string, eventId: number, ownerToken: string, now: number): Promise<"reserved" | "running" | PreviewBenchmarkSummary> {
    const reservationKey = `${runId}:reservation`;
    const inserted = rows(await db.execute(sql`
      insert into ai_first_artwork_attempts (
        event_id,
        owner_token,
        run_id,
        idempotency_key,
        direction_index,
        attempt,
        status,
        asset_hash,
        asset_bytes_base64,
        preview_id,
        concept_json,
        failure_codes_json,
        tier1_findings_json,
        vision_scores_json,
        cost_usd_micros,
        created_at,
        model,
        quality,
        size
      ) values (
        ${eventId},
        ${ownerToken},
        ${runId},
        ${reservationKey},
        -1,
        0,
        'benchmark-reserved',
        '',
        '',
        null,
        ${JSON.stringify({ benchmarkVersion: BENCHMARK_VERSION, state: "running" })},
        '[]',
        '[]',
        null,
        0,
        ${now},
        ${DEFAULT_ARTWORK_MODEL},
        'medium',
        '1024x1024'
      )
      on conflict do nothing
      returning id, run_id, attempt, status, asset_bytes_base64, concept_json, created_at
    `));

    if (inserted.length > 0) return "reserved";

    const existing = rows(await db.execute(sql`
      select id, run_id, attempt, status, asset_bytes_base64, concept_json, created_at
      from ai_first_artwork_attempts
      where idempotency_key = ${reservationKey}
      limit 1
    `))[0];
    if (!existing) return "running";

    const complete = parseSummary(existing.concept_json);
    if (complete) return { ...complete, cached: true };
    if (now - Number(existing.created_at) < RUN_TIMEOUT_MS) return "running";

    const reclaimed = rows(await db.execute(sql`
      update ai_first_artwork_attempts
      set status = 'benchmark-reserved',
          concept_json = ${JSON.stringify({ benchmarkVersion: BENCHMARK_VERSION, state: "running", reclaimedAt: now })},
          created_at = ${now}
      where id = ${existing.id}
        and concept_json not like '%"state":"complete"%'
      returning id, run_id, attempt, status, asset_bytes_base64, concept_json, created_at
    `));
    return reclaimed.length > 0 ? "reserved" : "running";
  }

  async complete(runId: string, summary: PreviewBenchmarkSummary, captures: CapturedCandidate[]): Promise<void> {
    const reservationKey = `${runId}:reservation`;
    const approvedCandidate = summary.approvedCandidate;

    for (let index = 0; index < captures.length; index += 1) {
      const candidate = index + 1;
      const capture = captures[index];
      const review = summary.reviews[index];
      const bytes = capture.result.bytes;
      const assetHash = createHash("sha256").update(bytes).digest("hex");
      const status = approvedCandidate === candidate ? "benchmark-approved" : "benchmark-rejected";
      const quality = capture.request.quality ?? "high";
      const size = sizeForAspect(capture.request.aspectRatio);

      await db.execute(sql`
        insert into ai_first_artwork_attempts (
          event_id,
          owner_token,
          run_id,
          idempotency_key,
          direction_index,
          attempt,
          status,
          asset_hash,
          asset_bytes_base64,
          preview_id,
          concept_json,
          failure_codes_json,
          tier1_findings_json,
          vision_scores_json,
          cost_usd_micros,
          created_at,
          model,
          quality,
          size
        ) values (
          ${syntheticEventId(summary.caseId, summary.run)},
          ${benchmarkOwnerToken(summary.caseId, summary.run)},
          ${runId},
          ${`${runId}:candidate-${candidate}`},
          0,
          ${candidate},
          ${status},
          ${assetHash},
          ${bytes.toString("base64")},
          null,
          ${JSON.stringify({
            benchmarkVersion: BENCHMARK_VERSION,
            caseId: summary.caseId,
            run: summary.run,
            eventName: summary.eventName,
            request: {
              model: capture.request.model ?? DEFAULT_ARTWORK_MODEL,
              quality,
              size,
            },
            providerDurationMs: capture.result.durationMs,
            review,
          })},
          ${JSON.stringify(review?.failureCodes ?? [])},
          ${JSON.stringify(review?.tier1Passed === false ? review.failureCodes : [])},
          ${JSON.stringify(review?.scores ?? null)},
          ${review?.costUsdMicros ?? 0},
          ${summary.completedAt},
          ${capture.request.model ?? DEFAULT_ARTWORK_MODEL},
          ${quality},
          ${size}
        )
        on conflict do nothing
      `);
    }

    await db.execute(sql`
      update ai_first_artwork_attempts
      set status = ${summary.approved ? "benchmark-complete-approved" : `benchmark-complete-${summary.kind}`},
          concept_json = ${JSON.stringify(summary)}
      where idempotency_key = ${reservationKey}
    `);
  }

  async summary(runId: string): Promise<PreviewBenchmarkSummary | null> {
    const row = rows(await db.execute(sql`
      select id, run_id, attempt, status, asset_bytes_base64, concept_json, created_at
      from ai_first_artwork_attempts
      where idempotency_key = ${`${runId}:reservation`}
      limit 1
    `))[0];
    return row ? parseSummary(row.concept_json) : null;
  }

  async asset(runId: string, attempt: number): Promise<Buffer | null> {
    const row = rows(await db.execute(sql`
      select id, run_id, attempt, status, asset_bytes_base64, concept_json, created_at
      from ai_first_artwork_attempts
      where run_id = ${runId}
        and attempt = ${attempt}
        and asset_bytes_base64 <> ''
      limit 1
    `))[0];
    return row?.asset_bytes_base64 ? Buffer.from(row.asset_bytes_base64, "base64") : null;
  }

  async report(): Promise<PreviewBenchmarkSummary[]> {
    const result = rows(await db.execute(sql`
      select id, run_id, attempt, status, asset_bytes_base64, concept_json, created_at
      from ai_first_artwork_attempts
      where run_id like ${`${BENCHMARK_VERSION}:%`}
        and attempt = 0
      order by run_id asc
    `));
    return result.map((row) => parseSummary(row.concept_json)).filter((value): value is PreviewBenchmarkSummary => Boolean(value));
  }
}

function isPreviewBenchmarkEnvironment(): boolean {
  return process.env.VERCEL_ENV === "preview"
    && process.env.VERCEL_GIT_COMMIT_REF === BENCHMARK_BRANCH;
}

function reviewSummaries(
  result: QualityLockedPreviewResult,
  captures: CapturedCandidate[],
): BenchmarkReviewSummary[] {
  const resultError = result.kind === "unavailable" ? result.error : undefined;
  return captures.map((capture, index) => {
    const review = result.reviews[index];
    const vision = review?.vision;
    return {
      candidate: index + 1,
      tier1Passed: review?.tier1.passed ?? false,
      visionPassed: vision?.passed ?? false,
      scores: vision?.scores ? { ...vision.scores } : null,
      requiredMissing: (vision?.requiredPresent ?? [])
        .filter((item) => !item.present)
        .map((item) => item.requirement),
      excludedFound: [...(vision?.excludedFound ?? [])],
      failureCodes: [...(review?.failureCodes ?? [])],
      notes: review?.notes ?? resultError ?? "No completed quality review was available.",
      providerDurationMs: capture.result.durationMs,
      quality: "medium",
      size: "1024x1024",
      costUsdMicros: estimateImageCostUsdMicros(
        capture.request.model ?? DEFAULT_ARTWORK_MODEL,
        capture.request.quality ?? "medium",
        sizeForAspect(capture.request.aspectRatio),
      ),
    };
  });
}

export interface PreviewBenchmarkRouteDependencies {
  allow?: () => boolean;
  store?: PreviewBenchmarkStore;
  generate?: typeof generateQualityLockedPreview;
  generateImage?: typeof generateArtwork;
  now?: () => number;
}

export function registerPrePaymentPreviewBenchmarkRoutes(
  app: Express,
  dependencies: PreviewBenchmarkRouteDependencies = {},
): void {
  const allow = dependencies.allow ?? isPreviewBenchmarkEnvironment;
  const store = dependencies.store ?? new DatabasePreviewBenchmarkStore();
  const generate = dependencies.generate ?? generateQualityLockedPreview;
  const generateImage = dependencies.generateImage ?? generateArtwork;
  const now = dependencies.now ?? Date.now;

  app.get("/api/qa/prepayment-preview-benchmark/report", async (_req, res) => {
    if (!allow()) return res.status(404).json({ error: "Not found" });
    const completed = await store.report();
    const approved = completed.filter((item) => item.approved).length;
    const totalCost = completed.reduce((sum, item) => sum + item.estimatedImageCostUsdMicros, 0);
    res.setHeader("Cache-Control", "private, no-store");
    return res.json({
      benchmarkVersion: BENCHMARK_VERSION,
      expectedRuns: PREPAYMENT_PREVIEW_BENCHMARK.length * 3,
      completedRuns: completed.length,
      approvedRuns: approved,
      nonApprovedRuns: completed.length - approved,
      estimatedImageCostUsdMicros: totalCost,
      gitSha: process.env.VERCEL_GIT_COMMIT_SHA || null,
      results: completed,
    });
  });

  app.get("/api/qa/prepayment-preview-benchmark/:caseId/:run", async (req, res) => {
    if (!allow()) return res.status(404).json({ error: "Not found" });
    const parsed = paramsSchema.safeParse(req.params);
    if (!parsed.success || !getPrePaymentPreviewBenchmarkCase(parsed.data?.caseId || "")) {
      return res.status(404).json({ error: "Benchmark case not found" });
    }
    const summary = await store.summary(benchmarkRunId(parsed.data.caseId, parsed.data.run));
    res.setHeader("Cache-Control", "private, no-store");
    return summary
      ? res.json(summary)
      : res.status(404).json({ error: "Benchmark run not found" });
  });

  app.get("/api/qa/prepayment-preview-benchmark/:caseId/:run/asset/:attempt", async (req, res) => {
    if (!allow()) return res.status(404).json({ error: "Not found" });
    const parsed = paramsSchema.extend({ attempt: z.coerce.number().int().min(1).max(2) }).safeParse(req.params);
    if (!parsed.success || !getPrePaymentPreviewBenchmarkCase(parsed.data?.caseId || "")) {
      return res.status(404).json({ error: "Benchmark asset not found" });
    }
    const asset = await store.asset(
      benchmarkRunId(parsed.data.caseId, parsed.data.run),
      parsed.data.attempt,
    );
    if (!asset) return res.status(404).json({ error: "Benchmark asset not found" });
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("Content-Type", "image/png");
    res.setHeader("Content-Disposition", `inline; filename="${parsed.data.caseId}-run-${parsed.data.run}-candidate-${parsed.data.attempt}.png"`);
    return res.send(asset);
  });

  app.post("/api/qa/prepayment-preview-benchmark/:caseId/:run", async (req, res) => {
    if (!allow()) return res.status(404).json({ error: "Not found" });
    const parsed = paramsSchema.safeParse(req.params);
    const testCase = parsed.success ? getPrePaymentPreviewBenchmarkCase(parsed.data.caseId) : undefined;
    if (!parsed.success || !testCase) {
      return res.status(404).json({ error: "Benchmark case not found" });
    }

    const runId = benchmarkRunId(testCase.id, parsed.data.run);
    const startedAt = now();
    const reservation = await store.reserve(
      runId,
      syntheticEventId(testCase.id, parsed.data.run),
      benchmarkOwnerToken(testCase.id, parsed.data.run),
      startedAt,
    );
    if (typeof reservation === "object") {
      res.setHeader("Cache-Control", "private, no-store");
      return res.json(reservation);
    }
    if (reservation === "running") {
      res.setHeader("Retry-After", "20");
      return res.status(202).json({
        benchmarkVersion: BENCHMARK_VERSION,
        state: "running",
        caseId: testCase.id,
        run: parsed.data.run,
        gitSha: process.env.VERCEL_GIT_COMMIT_SHA || null,
      });
    }

    const event = benchmarkEvent(testCase, parsed.data.run);
    const captures: CapturedCandidate[] = [];
    let result: QualityLockedPreviewResult;
    try {
      result = await generate(event, {
        inspirationNotes: testCase.benchmarkReferenceNotes ?? "",
        maxCandidates: 2,
        generateImage: async (request) => {
          const generated = await generateImage(request);
          captures.push({ request, result: generated });
          return generated;
        },
      });
    } catch (error) {
      result = {
        kind: "unavailable",
        attempts: captures.length,
        model: DEFAULT_ARTWORK_MODEL,
        reviews: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }

    const reviews = reviewSummaries(result, captures);
    const completedAt = now();
    const approvedCandidate = result.kind === "approved-image" ? result.attempts : null;
    const summary: PreviewBenchmarkSummary = {
      benchmarkVersion: BENCHMARK_VERSION,
      state: "complete",
      caseId: testCase.id,
      run: parsed.data.run,
      eventName: testCase.eventName,
      namedReference: detectNamedCreativeReference(
        `${testCase.eventName} ${testCase.eventType} ${testCase.vibeDescription}`,
      )?.id ?? null,
      referenceNotesUsed: Boolean(testCase.benchmarkReferenceNotes),
      kind: result.kind,
      approved: result.kind === "approved-image",
      attempts: result.attempts,
      approvedCandidate,
      model: result.model,
      totalDurationMs: completedAt - startedAt,
      estimatedImageCostUsdMicros: reviews.reduce((sum, review) => sum + review.costUsdMicros, 0),
      reviews,
      error: result.kind === "unavailable" ? result.error ?? "provider unavailable" : null,
      gitSha: process.env.VERCEL_GIT_COMMIT_SHA || null,
      completedAt,
    };

    await store.complete(runId, summary, captures);
    console.info(`[prepayment-benchmark] ${JSON.stringify({
      caseId: summary.caseId,
      run: summary.run,
      kind: summary.kind,
      attempts: summary.attempts,
      durationMs: summary.totalDurationMs,
      costUsdMicros: summary.estimatedImageCostUsdMicros,
    })}`);
    res.setHeader("Cache-Control", "private, no-store");
    return res.json(summary);
  });
}

/** Offline evidence accounting. Never generates images, reviews or requests. */
import { z } from "zod";

const id = z.string().trim().min(1).max(160);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const ms = z.number().finite().int().nonnegative();
const cost = z.number().finite().int().nonnegative().nullable();
const path = z.enum(["text-first", "reference-led", "scene-composition"]);

export const previewBenchmarkSchema = z.object({
  version: z.literal(1),
  deploymentSha: z.string().regex(/^[a-f0-9]{40}$/),
  renderPath: path,
  cases: z.array(z.object({
    id, cohort: z.enum(["named-child", "original-child", "adult"]),
    briefDigest: digest,
    /** Register trial IDs before spending; missing results stay in denominator. */
    trialIds: z.array(id).min(1).max(1000),
  }).strict()).min(1).max(100),
  results: z.array(z.object({
    trialId: id,
    deploymentSha: z.string().regex(/^[a-f0-9]{40}$/),
    renderPath: path,
    briefDigest: digest,
    evidence: z.enum(["live", "simulated"]),
    outcome: z.enum(["approved", "fallback", "timeout", "error", "unsupported"]),
    firstApprovedMs: ms.nullable(),
    /** Measured from the same submission start until browser image load; absent is unknown. */
    browserLoadedMs: ms.nullable().optional(),
    terminalMs: ms.nullable(),
    automatedPass: z.boolean(),
    reviewedAssetHash: digest.nullable(),
    deliveredAssetHash: digest.nullable(),
    /** Human labels are independent of an AI agent's visual inspection. */
    humanReview: z.enum(["pass", "fail", "pending"]),
    humanReviewedAssetHash: digest.nullable(),
    imageProviderRequests: ms.nullable(),
    criticRequests: ms.nullable(),
    recordedCostUsdMicros: cost,
    /** Null means input, critic or other charges are not fully accounted for. */
    allInCostUsdMicros: cost,
  }).strict()).max(10_000),
}).strict();

export type PreviewBenchmark = z.infer<typeof previewBenchmarkSchema>;
export const PREVIEW_BENCHMARK_TARGET_MS = 90_000;
const TARGET_SUCCESS_RATE = .95;
const MIN_TRIALS_PER_CASE = 20;

function percentile(values: number[], fraction: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

export function summarizePreviewBenchmark(value: unknown) {
  const input = previewBenchmarkSchema.parse(value);
  if (new Set(input.cases.map((item) => item.id)).size !== input.cases.length) {
    throw new Error("Duplicate benchmark case");
  }
  const planned = input.cases.flatMap((item) => item.trialIds);
  if (new Set(planned).size !== planned.length) throw new Error("Duplicate planned trial");
  if (new Set(input.results.map((item) => item.trialId)).size !== input.results.length) {
    throw new Error("Duplicate result: retries cannot replace a failed trial");
  }
  const results = new Map(input.results.map((item) => [item.trialId, item]));
  const plannedBriefs = new Map(input.cases.flatMap((item) => item.trialIds.map((trialId) => [trialId, item.briefDigest] as const)));
  const matchesScope = (row: PreviewBenchmark["results"][number]) =>
    row.deploymentSha === input.deploymentSha && row.renderPath === input.renderPath &&
    row.briefDigest === plannedBriefs.get(row.trialId) && row.evidence === "live";
  const isDelivered = (row: PreviewBenchmark["results"][number]) =>
    row.outcome === "approved" && row.automatedPass && row.firstApprovedMs !== null &&
    row.reviewedAssetHash !== null && row.reviewedAssetHash === row.deliveredAssetHash;
  for (const result of input.results) {
    if (!planned.includes(result.trialId)) throw new Error("Unregistered benchmark result");
    if (result.firstApprovedMs !== null && (result.outcome !== "approved" ||
        (result.terminalMs !== null && result.firstApprovedMs > result.terminalMs))) {
      throw new Error("Inconsistent approval timing");
    }
    if (result.allInCostUsdMicros !== null && result.recordedCostUsdMicros !== null &&
        result.allInCostUsdMicros < result.recordedCostUsdMicros) throw new Error("Inconsistent cost ledger");
  }
  const failures = new Set<string>();
  if (input.cases.length < 8 || new Set(input.cases.map((item) => item.cohort)).size !== 3) {
    failures.add("insufficient-event-coverage");
  }
  const byCase = input.cases.map((item) => {
    const rows = item.trialIds.map((trialId) => results.get(trialId));
    let verifiedWithinTarget = 0;
    let automaticDelivered = 0;
    for (const row of rows) {
      if (!row) { failures.add("missing-results"); continue; }
      const scopeMatches = matchesScope(row);
      if (!scopeMatches) failures.add("mismatched-or-simulated-evidence");
      const withinBudget = row.imageProviderRequests !== null && row.criticRequests !== null &&
        row.imageProviderRequests <= (input.renderPath === "scene-composition" ? 0 : 2) &&
        row.criticRequests <= (input.renderPath === "scene-composition" ? 1 : 4);
      if (!withinBudget) failures.add("unknown-or-exceeded-request-budget");
      if (row.allInCostUsdMicros === null) failures.add("incomplete-cost-accounting");
      const delivered = isDelivered(row);
      if (row.outcome === "approved" && !delivered) failures.add("unverified-delivered-pixels");
      if (delivered) automaticDelivered++;
      const humanPass = row.humanReview === "pass" && row.humanReviewedAssetHash === row.deliveredAssetHash;
      if (delivered && !humanPass) failures.add("human-quality-unconfirmed-or-failed");
      const loaded = row.browserLoadedMs != null && row.firstApprovedMs != null && row.browserLoadedMs >= row.firstApprovedMs;
      if (delivered && !loaded) failures.add("browser-delivery-time-unverified");
      if (scopeMatches && withinBudget && delivered && humanPass && loaded && row.browserLoadedMs! <= PREVIEW_BENCHMARK_TARGET_MS) {
        verifiedWithinTarget++;
      }
    }
    const rate = verifiedWithinTarget / rows.length;
    if (rows.length < MIN_TRIALS_PER_CASE) failures.add("insufficient-repeated-trials");
    if (rate < TARGET_SUCCESS_RATE) failures.add("quality-or-latency-target-missed");
    return {
      caseId: item.id, cohort: item.cohort, planned: rows.length,
      observed: rows.filter(Boolean).length, automaticDelivered, verifiedWithinTarget,
      verifiedWithinTargetRate: rate,
    };
  });
  const scopedResults = input.results.filter(matchesScope);
  const firstApproved = scopedResults
    .filter(isDelivered)
    .map((row) => row.firstApprovedMs!);
  const terminal = scopedResults.filter((row) => row.terminalMs !== null).map((row) => row.terminalMs!);
  const browserLoaded = scopedResults.filter(isDelivered).filter(row => row.browserLoadedMs != null &&
    row.browserLoadedMs >= row.firstApprovedMs!).map(row => row.browserLoadedMs!);
  const completeCosts = input.results.length === planned.length && input.results.every((row) => row.allInCostUsdMicros !== null);
  const allInCostUsdMicros = completeCosts
    ? input.results.reduce((sum, row) => sum + row.allInCostUsdMicros!, 0) : null;
  const verifiedWithinTarget = byCase.reduce((sum, row) => sum + row.verifiedWithinTarget, 0);
  return {
    deploymentSha: input.deploymentSha, renderPath: input.renderPath,
    targetMs: PREVIEW_BENCHMARK_TARGET_MS, targetSuccessRate: TARGET_SUCCESS_RATE,
    planned: planned.length, observed: input.results.length, missing: planned.length - input.results.length,
    mismatchedOrSimulatedResults: input.results.length - scopedResults.length,
    outcomes: Object.fromEntries(["approved", "fallback", "timeout", "error", "unsupported"].map((outcome) =>
      [outcome, input.results.filter((row) => row.outcome === outcome).length])),
    verifiedWithinTarget, verifiedWithinTargetRate: verifiedWithinTarget / planned.length,
    /** Explicitly conditional metrics: failures never masquerade as fast art. */
    approvedOnlyLatencyMs: { p50: percentile(firstApproved, .5), p95: percentile(firstApproved, .95) },
    browserLoadedApprovedOnlyLatencyMs: { p50: percentile(browserLoaded, .5), p95: percentile(browserLoaded, .95) },
    observedTerminalLatencyMs: { p50: percentile(terminal, .5), p95: percentile(terminal, .95) },
    recordedCostUsdMicros: input.results.reduce((sum, row) => sum + (row.recordedCostUsdMicros ?? 0), 0),
    allInCostUsdMicros,
    allInCostPerVerifiedOnTimeResultUsdMicros: allInCostUsdMicros !== null && verifiedWithinTarget > 0
      ? allInCostUsdMicros / verifiedWithinTarget : null,
    byCase, blockers: Array.from(failures).sort(),
    /** Observed benchmark only; not statistical proof or full-product clearance. */
    meetsObservedArtworkBenchmark: failures.size === 0,
  };
}

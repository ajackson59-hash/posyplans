import { describe, expect, it } from "vitest";
import { summarizePreviewBenchmark, type PreviewBenchmark } from "../server/aiFirst/previewBenchmark";

function fixture(): PreviewBenchmark {
  const cases: PreviewBenchmark["cases"] = ["blippi-meekah", "frozen", "kpop", "construction", "adult-garden", "moana", "original-vector", "lacquer-inlay"]
    .map((id, index) => ({ id, cohort: index < 3 ? "named-child" : index === 3 ? "original-child" : "adult",
      briefDigest: String(index).repeat(64), trialIds: Array.from({ length: 20 }, (_, n) => `${id}-${n}`) }));
  return {
    version: 1, deploymentSha: "a".repeat(40), renderPath: "scene-composition", cases,
    // Synthetic values test accounting; they are never written as live evidence.
    results: cases.flatMap((item) => item.trialIds.map((trialId) => ({
      trialId, deploymentSha: "a".repeat(40), renderPath: "scene-composition", briefDigest: item.briefDigest,
      evidence: "live", outcome: "approved", firstApprovedMs: 40_000, browserLoadedMs: 41_000, terminalMs: 42_000, automatedPass: true,
      reviewedAssetHash: "b".repeat(64), deliveredAssetHash: "b".repeat(64),
      humanReview: "pass", humanReviewedAssetHash: "b".repeat(64),
      imageProviderRequests: 0, criticRequests: 1, recordedCostUsdMicros: 50_000, allInCostUsdMicros: 60_000,
    }))),
  };
}

describe("offline preview launch benchmark accounting", () => {
  it("cannot shrink the promised eight-direction release matrix to five", () => {
    const input = fixture(); input.cases = input.cases.slice(0, 5);
    const ids = new Set(input.cases.flatMap(row => row.trialIds));
    input.results = input.results.filter(row => ids.has(row.trialId));
    expect(summarizePreviewBenchmark(input).blockers).toContain("insufficient-event-coverage");
  });

  it.each([undefined, null, 30_000, 95_000])("does not confuse server approval with on-time browser delivery (%s)", (browserLoadedMs) => {
    const input = fixture(); input.results.forEach(row => { row.browserLoadedMs = browserLoadedMs; });
    const report = summarizePreviewBenchmark(input);
    expect(report.verifiedWithinTarget).toBe(0);
    expect(report.meetsObservedArtworkBenchmark).toBe(false);
    expect(report.approvedOnlyLatencyMs.p95).toBe(40_000);
  });
  it("requires repeated, complete, independently reviewed evidence across every cohort", () => {
    const report = summarizePreviewBenchmark(fixture());
    expect(report.meetsObservedArtworkBenchmark).toBe(true);
    expect(report.planned).toBe(160); expect(report.verifiedWithinTargetRate).toBe(1);
    expect(report.approvedOnlyLatencyMs).toEqual({ p50: 40_000, p95: 40_000 });
    expect(report.observedTerminalLatencyMs).toEqual({ p50: 42_000, p95: 42_000 });
    expect(report.allInCostPerVerifiedOnTimeResultUsdMicros).toBe(60_000);
  });

  it("keeps missing trials in the denominator instead of reporting only wins", () => {
    const input = fixture(); input.results.splice(0, 10);
    const report = summarizePreviewBenchmark(input);
    expect(report.planned).toBe(160); expect(report.observed).toBe(150); expect(report.missing).toBe(10);
    expect(report.verifiedWithinTargetRate).toBe(150 / 160);
    expect(report.allInCostUsdMicros).toBeNull();
    expect(report.meetsObservedArtworkBenchmark).toBe(false);
  });

  it.each(["fallback", "timeout", "error", "unsupported"] as const)("does not count a fast %s as delivered artwork", (outcome) => {
    const input = fixture();
    for (const row of input.results.slice(0, 2)) Object.assign(row, { outcome, firstApprovedMs: null, terminalMs: 50,
      automatedPass: false, deliveredAssetHash: null, humanReview: "pending", humanReviewedAssetHash: null });
    const report = summarizePreviewBenchmark(input);
    expect(report.outcomes[outcome]).toBe(2);
    expect(report.byCase[0].verifiedWithinTargetRate).toBe(.9);
    // Aggregate 98.75% cannot hide an individual event world's 90% result.
    expect(report.verifiedWithinTargetRate).toBe(158 / 160);
    expect(report.meetsObservedArtworkBenchmark).toBe(false);
    expect(report.approvedOnlyLatencyMs.p50).toBe(40_000);
  });

  it("uses first approved delivery rather than the slower sibling completion", () => {
    const input = fixture(); input.results.forEach((row) => { row.terminalMs = 140_000; });
    const report = summarizePreviewBenchmark(input);
    expect(report.meetsObservedArtworkBenchmark).toBe(true);
    expect(report.approvedOnlyLatencyMs.p95).toBe(40_000);
    expect(report.observedTerminalLatencyMs.p95).toBe(140_000);
  });

  it("rejects two-minute success as meeting the 90-second requirement", () => {
    const input = fixture(); input.results.forEach((row) => { row.firstApprovedMs = 132_186; row.terminalMs = null; });
    const report = summarizePreviewBenchmark(input);
    expect(report.verifiedWithinTarget).toBe(0);
    expect(report.approvedOnlyLatencyMs.p95).toBe(132_186);
    expect(report.meetsObservedArtworkBenchmark).toBe(false);
  });

  it.each(["pending", "fail"] as const)("does not substitute an AI verdict for a human %s", (humanReview) => {
    const input = fixture(); input.results[0].humanReview = humanReview;
    expect(summarizePreviewBenchmark(input).blockers).toContain("human-quality-unconfirmed-or-failed");
  });

  it.each(["deploymentSha", "briefDigest", "renderPath", "evidence"] as const)("does not pool different %s", (field) => {
    const input = fixture();
    if (field === "renderPath") input.results[0][field] = "text-first";
    else if (field === "evidence") input.results[0][field] = "simulated";
    else input.results[0][field] = "f".repeat(field === "deploymentSha" ? 40 : 64);
    expect(summarizePreviewBenchmark(input).blockers).toContain("mismatched-or-simulated-evidence");
  });

  it.each(["deliveredAssetHash", "humanReviewedAssetHash"] as const)("requires the exact final pixels: %s", (field) => {
    const input = fixture(); input.results[0][field] = "e".repeat(64);
    expect(summarizePreviewBenchmark(input).meetsObservedArtworkBenchmark).toBe(false);
  });

  it("does not advertise simulated or different-commit timings as live latency", () => {
    const input = fixture(); input.results.forEach((row) => { row.evidence = "simulated"; });
    const report = summarizePreviewBenchmark(input);
    expect(report.approvedOnlyLatencyMs).toEqual({ p50: null, p95: null });
    expect(report.observedTerminalLatencyMs).toEqual({ p50: null, p95: null });
    expect(report.mismatchedOrSimulatedResults).toBe(160);
  });

  it("keeps unknown all-in charges unknown and includes failed-request costs", () => {
    const input = fixture(); input.results[0].allInCostUsdMicros = null;
    const report = summarizePreviewBenchmark(input);
    expect(report.recordedCostUsdMicros).toBe(8_000_000);
    expect(report.allInCostUsdMicros).toBeNull();
    expect(report.allInCostPerVerifiedOnTimeResultUsdMicros).toBeNull();
    expect(report.blockers).toContain("incomplete-cost-accounting");
  });

  it.each([null, 1] as const)("fails unknown or non-zero composed-image request counts: %s", (imageProviderRequests) => {
    const input = fixture(); input.results[0].imageProviderRequests = imageProviderRequests;
    expect(summarizePreviewBenchmark(input).blockers).toContain("unknown-or-exceeded-request-budget");
  });

  it("enforces the existing text-first two-image cap and bounded critic repair count", () => {
    const input = fixture(); input.renderPath = "text-first";
    input.results.forEach((row) => { row.renderPath = "text-first"; row.imageProviderRequests = 2; row.criticRequests = 4; });
    expect(summarizePreviewBenchmark(input).meetsObservedArtworkBenchmark).toBe(true);
    input.results[0].imageProviderRequests = 3;
    expect(summarizePreviewBenchmark(input).blockers).toContain("unknown-or-exceeded-request-budget");
  });

  it("does not allow duplicate results to replace failures", () => {
    const input = fixture(); input.results.push(input.results[0]);
    expect(() => summarizePreviewBenchmark(input)).toThrow("Duplicate result");
  });

  it.each(["unregistered", "duplicate-plan", "invalid-time", "invalid-cost", "secret-field"])("rejects malformed evidence: %s", (kind) => {
    const input = fixture();
    if (kind === "unregistered") input.results[0].trialId = "not-registered";
    if (kind === "duplicate-plan") input.cases[0].trialIds.push(input.cases[0].trialIds[0]);
    if (kind === "invalid-time") input.results[0].firstApprovedMs = -1;
    if (kind === "invalid-cost") input.results[0].allInCostUsdMicros = 1;
    if (kind === "secret-field") (input.results[0] as any).ownerToken = "never-export-this";
    expect(() => summarizePreviewBenchmark(input)).toThrow();
  });

  it("cannot establish reliability from one passing canary", () => {
    const input = fixture(); input.cases = input.cases.slice(0, 1); input.cases[0].trialIds = input.cases[0].trialIds.slice(0, 1);
    input.results = input.results.slice(0, 1);
    expect(summarizePreviewBenchmark(input).blockers).toEqual(expect.arrayContaining(["insufficient-event-coverage", "insufficient-repeated-trials"]));
  });
});

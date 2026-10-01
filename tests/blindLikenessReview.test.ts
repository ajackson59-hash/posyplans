// @vitest-environment node
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { runBlindLikenessReview, BLIND_LIKENESS_VERSION } from "../server/aiFirst/blindLikenessReview";
import { encodePng } from "../server/aiFirst/png";
import { blindReport, blindFixtureClient } from "./helpers/blindReviewFixture";
const pixels = (value: number) => encodePng({ width: 80, height: 100, rgb: new Uint8Array(80 * 100 * 3).fill(value) });
const candidate = pixels(120), reference = pixels(180);
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

it("sends only pixel inputs and fixed generic text, with a stable schema across both candidates", async () => {
  const capture = vi.fn();
  const client = blindFixtureClient(() => blindReport(), capture);
  const contaminated = { candidate, reference, client, brief: "PRIVATE_HOST_BRIEF_SENTINEL", subject: "PRIVATE_NAME_SENTINEL",
    sourceUrl: "https://private.invalid/REFERENCE_METADATA_SENTINEL", expectedIdentity: "EXPECTED_ANSWER_SENTINEL", concept: { prompt: "GENERATION_PROMPT_SENTINEL" } };
  const first = await runBlindLikenessReview(contaminated);
  const second = await runBlindLikenessReview({ ...contaminated, candidate: reference });
  expect(capture).toHaveBeenCalledTimes(2);
  const [a, b] = capture.mock.calls.map(call => call[0]);
  expect(JSON.stringify(a)).not.toMatch(/SENTINEL|Meekah|Blippi/);
  expect(a).toMatchObject({ stream: true, max_tokens: 1800 });
  expect(a.system).toEqual(b.system); expect(a.output_config).toEqual(b.output_config);
  const messages = a.messages[0].content;
  expect(messages.filter((p: any) => p.type === "image").map((p: any) => hash(Buffer.from(p.source.data, "base64"))))
    .toEqual([hash(candidate), hash(reference)]);
  expect(first.requestSchema).toEqual(second.requestSchema);
  expect(first).toMatchObject({ version: BLIND_LIKENESS_VERSION, scope: "reference-likeness-only",
    inputHashes: { candidate: hash(candidate), reference: hash(reference) }, requestCount: 1,
    usage: { inputTokens: 100, outputTokens: 80 } });
  expect(first).not.toHaveProperty("scores"); expect(first).not.toHaveProperty("passed");
});

it.each([true, false])("aggregates complete feature evidence without a scene verdict (match=%s)", async match => {
  const raw = blindReport(match);
  const result = await runBlindLikenessReview({ candidate, reference, client: blindFixtureClient(() => raw) });
  expect(result).toMatchObject({ unavailable: false, decision: match ? "match" : "mismatch", issues: [], report: raw });
  expect(result.comparison?.valid).toBe(true);
});

it.each(["missing", "duplicate", "unknown-reference", "insufficient", "ambiguous", "invalid-selection"])(
  "never returns a match for %s evidence", async kind => {
    const raw = blindReport();
    if (kind === "missing") raw.identityComparisons.pop();
    if (kind === "duplicate") raw.identityComparisons.push(raw.identityComparisons[0]);
    if (kind === "unknown-reference") raw.identityComparisons[0].referenceKey = "reference2";
    if (kind === "insufficient") raw.identityComparisons[0].candidateVisibility = "insufficient";
    if (kind === "ambiguous") raw.subjectSelection.status = "ambiguous";
    if (kind === "invalid-selection") raw.subjectSelection.candidateLocation = "";
    const result = await runBlindLikenessReview({ candidate, reference, client: blindFixtureClient(() => raw) });
    expect(result.decision).toBe("unresolved"); expect(result.issues.length).toBeGreaterThan(0);
    expect(result.requestCount).toBe(1);
  });

it("rejects invalid input or cancellation before any provider dispatch", async () => {
  const capture = vi.fn(), client = blindFixtureClient(() => blindReport(), capture);
  const a = await runBlindLikenessReview({ candidate: Buffer.from("invalid"), reference, client });
  const b = await runBlindLikenessReview({ candidate, reference, client, signal: AbortSignal.abort() });
  for (const result of [a, b]) expect(result).toMatchObject({ unavailable: true, decision: "unresolved", requestCount: 0 });
  expect(capture).not.toHaveBeenCalled();
});

it("retains provider rejection without retry or fabricated review evidence", async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ type: "error",
    error: { type: "invalid_request_error", message: "Offline provider rejection" } }),
    { status: 400, headers: { "content-type": "application/json", "request-id": "req_rejected" } }));
  const result = await runBlindLikenessReview({ candidate, reference, client: new Anthropic({ apiKey: "offline", fetch }) });
  expect(result).toMatchObject({ unavailable: true, decision: "unresolved", requestCount: 1, report: null, comparison: null });
  expect(result.requestTimings[0]).toMatchObject({ outcome: "failed", httpStatus: 400, requestId: "req_rejected", usageStatus: "none" });
  expect(fetch).toHaveBeenCalledTimes(1);
});

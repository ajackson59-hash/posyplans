// @vitest-environment node
import Anthropic from "@anthropic-ai/sdk";
import { expect, it, vi } from "vitest";
import { newVisionRequestTiming, streamVisionResponse } from "../server/aiFirst/visionStream";
import { runVisionGate } from "../server/aiFirst/visionGate";
import { buildEventBrief } from "../server/aiFirst/brief";
import { encodePng } from "../server/aiFirst/png";
import { concept } from "./aiFirstFixtures";
import type { Event } from "@shared/schema";

const body = { model: "claude-sonnet-4-6", max_tokens: 3050,
  messages: [{ role: "user" as const, content: "Offline transport fixture" }] };
const message = { id: "msg_fixture", type: "message", role: "assistant", model: body.model,
  content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 1 } };
const events = (text = "{}", stopReason = "end_turn") => [
  { type: "message_start", message },
  { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
  { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } },
  { type: "content_block_stop", index: 0 },
  { type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 40 } },
  { type: "message_stop" },
];
const sse = (rows: unknown[]) => rows.map((row: any) => `event: ${row.type}\ndata: ${JSON.stringify(row)}\n\n`).join("");
const headers = { "content-type": "text/event-stream", "request-id": "req_fixture" };
const sdk = (fetch: any) => new Anthropic({ apiKey: "offline-test-key", fetch });

it("records response milestones with one real SDK request and cumulative usage", async () => {
  const fetch = vi.fn(async () => new Response(sse(events()), { headers }));
  const timing = newVisionRequestTiming();
  const response = await streamVisionResponse(sdk(fetch), body, timing);
  expect(response.content).toEqual([{ type: "text", text: "{}" }]);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual({ ...body, stream: true });
  expect(timing).toMatchObject({ outcome: "completed", usageStatus: "complete", requestId: "req_fixture",
    messageId: "msg_fixture", httpStatus: 200, messageStopped: true, stopReason: "end_turn",
    usage: { inputTokens: 100, outputTokens: 40 }, textCharacters: 2 });
  expect(timing.headersMs).toBeLessThanOrEqual(timing.firstEventMs!);
  expect(timing.firstEventMs).toBeLessThanOrEqual(timing.firstTextMs!);
  expect(timing.firstTextMs).toBeLessThanOrEqual(timing.finishedMs!);
});

it("rejects a stream that ends without message_stop even if its JSON is parseable", async () => {
  const fetch = vi.fn(async () => new Response(sse(events().slice(0, -1)), { headers }));
  const timing = newVisionRequestTiming();
  await expect(streamVisionResponse(sdk(fetch), body, timing)).rejects.toThrow();
  expect(timing).toMatchObject({ outcome: "failed", messageStopped: false, usageStatus: "partial",
    usage: { inputTokens: 100, outputTokens: 40 } });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("retains partial usage and timing after cancellation and never retries", async () => {
  const controller = new AbortController();
  const fetch = vi.fn(async (_url, options) => new Response(new ReadableStream({
    start(stream) {
      stream.enqueue(new TextEncoder().encode(sse(events().slice(0, 3))));
      options.signal.addEventListener("abort", () => stream.error(new DOMException("Aborted", "AbortError")), { once: true });
    },
  }), { headers }));
  const timing = newVisionRequestTiming();
  const pending = streamVisionResponse(sdk(fetch), body, timing, controller.signal);
  const timer = setTimeout(() => controller.abort(), 40);
  try { await expect(pending).rejects.toThrow(); } finally { clearTimeout(timer); }
  expect(timing).toMatchObject({ outcome: "aborted", usageStatus: "partial", messageStopped: false,
    requestId: "req_fixture", usage: { inputTokens: 100, outputTokens: 1 }, textCharacters: 2 });
  expect(fetch).toHaveBeenCalledTimes(1);
});

it("retains an HTTP rejection ID without retrying or claiming schema acceptance", async () => {
  const fetch = vi.fn(async () => new Response(JSON.stringify({ type: "error",
    error: { type: "invalid_request_error", message: "Invalid schema fixture" } }),
    { status: 400, headers: { "content-type": "application/json", "request-id": "req_rejected" } }));
  const timing = newVisionRequestTiming();
  await expect(streamVisionResponse(sdk(fetch), body, timing)).rejects.toThrow();
  expect(timing).toMatchObject({ outcome: "failed", usageStatus: "none", httpStatus: 400,
    requestId: "req_rejected", firstEventMs: null, firstTextMs: null });
  expect(fetch).toHaveBeenCalledTimes(1);
});

const bytes = encodePng({ width: 80, height: 100, rgb: new Uint8Array(80 * 100 * 3).fill(120) });
const brief = buildEventBrief({ event: { eventName: "Offline fixture", eventType: "Party", themeName: "Garden",
  paletteColors: "[]", vibeDescription: "Garden celebration" } as Event, dna: {}, guestCount: null });
const scores = { textLogoWatermarkFree: 5, artifactFree: 5, premiumFinish: 5,
  briefFidelity: 5, compositionQuality: 5, ageAppropriate: 5 };
const text = JSON.stringify({ ...scores, requiredPresent: [], excludedFound: [], notes: "Offline fixture only" });

it("keeps the shared review body, schema and verdict equivalent across transports", async () => {
  const fetch = vi.fn(async (_url, options) => JSON.parse(options.body).stream
    ? new Response(sse(events(text)), { headers })
    : new Response(JSON.stringify({ ...message, usage: { input_tokens: 100, output_tokens: 40 },
      stop_reason: "end_turn", content: [{ type: "text", text }] }), { headers: { "content-type": "application/json" } }));
  const input = { bytes, brief, concept: concept(), client: sdk(fetch), maxFormatRepairs: 0 as const };
  const a = await runVisionGate(input), b = await runVisionGate({ ...input, streamDiagnostics: true });
  expect(b).toMatchObject({ passed: a.passed, unavailable: false, scores: a.scores, usage: a.usage,
    requiredPresent: a.requiredPresent, failureCodes: a.failureCodes, requestSchema: a.requestSchema, requestCount: 1 });
  expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ ...JSON.parse(fetch.mock.calls[0][1].body), stream: true });
  expect(b.requestTimings?.[0].outcome).toBe("completed");
});

it.each(["max_tokens", "refusal", "missing_stop"])("keeps %s output unavailable without a repair call", async reason => {
  const rows = events(text, reason === "missing_stop" ? "end_turn" : reason);
  const fetch = vi.fn(async () => new Response(sse(reason === "missing_stop" ? rows.slice(0, -1) : rows), { headers }));
  const verdict = await runVisionGate({ bytes, brief, concept: concept(), client: sdk(fetch),
    maxFormatRepairs: 0, streamDiagnostics: true });
  expect(verdict).toMatchObject({ unavailable: true, passed: false, requestCount: 1, requiredPresent: [] });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(verdict.requestTimings?.[0].usageStatus).toBe(reason === "missing_stop" ? "partial" : "complete");
});

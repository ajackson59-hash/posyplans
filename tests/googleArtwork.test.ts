// Offline provider-contract and pixel-continuity checks, not quality evidence.
// @vitest-environment node
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { decode as decodeJpeg, encode as encodeJpeg } from "jpeg-js";
import type { Event } from "@shared/schema";
import { generateArtwork, GOOGLE_ARTWORK_MODEL, ArtworkNormalizationError, ArtworkProviderError } from "../server/aiFirst/artwork";
import { decodePng, readPngSize } from "../server/aiFirst/png";
import { InMemoryArtworkAttemptStore } from "../server/aiFirst/artworkAttemptStore";
import { customerVisiblePreviewBytes, generateQualityLockedPreview } from "../server/prePaymentPreviewQuality";
import { CUSTOMER_PREVIEW_POLICY } from "../server/customerPreviewPolicy";
import { MEDIUM_FEASIBILITY_CASES } from "../server/aiFirst/mediumFeasibilityCases";
import { runTier1Checks } from "../server/aiFirst/tier1";
import { buildQualityLockedPreviewBrief } from "../server/prePaymentPreviewQuality";

let jpeg: Buffer;
const fetchMock = vi.fn();
const usage = { total_input_tokens: 2000, total_output_tokens: 1120, total_thought_tokens: 30,
  input_tokens_by_modality: [{ modality: "text", tokens: 2000 }],
  output_tokens_by_modality: [{ modality: "image", tokens: 1120 }] };
const input = { prompt: MEDIUM_FEASIBILITY_CASES[1].hostBrief, model: GOOGLE_ARTWORK_MODEL,
  aspectRatio: "9:16" as const, quality: "medium" as const, outputFormat: "jpeg" as const, maxTransientRetries: 0 as const };
const response = () => ({ id: "fixture_interaction_123", status: "completed", model: GOOGLE_ARTWORK_MODEL, usage,
  steps: [{ type: "thought", summary: [{ type: "image", mime_type: "image/png", data: "ignored" }] },
    { type: "model_output", content: [{ type: "image", mime_type: "image/jpeg", data: jpeg.toString("base64") }] }] });
beforeAll(() => {
  const width = 768, height = 1376, data = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4; data[i] = x % 255; data[i + 1] = y % 255; data[i + 2] = 70; data[i + 3] = 255;
  }
  jpeg = encodeJpeg({ width, height, data }, 95).data;
});
beforeEach(() => {
  vi.stubEnv("GEMINI_API_KEY", "test-google-key"); vi.stubEnv("OPENAI_API_KEY", "");
  fetchMock.mockReset().mockImplementation(async () => new Response(JSON.stringify(response()), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("uses the documented REST steps, ignores thought images and preserves exact decoded source pixels", async () => {
  const result = await generateArtwork(input);
  const [url, init] = fetchMock.mock.calls[0];
  expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/interactions");
  expect(init.headers).toEqual({ "Content-Type": "application/json", "x-goog-api-key": "test-google-key" });
  expect(JSON.parse(init.body)).toEqual({ model: GOOGLE_ARTWORK_MODEL, input: [{ type: "text", text: input.prompt }],
    response_format: { type: "image", mime_type: "image/jpeg", aspect_ratio: "9:16", image_size: "1K" }, store: false, stream: false });
  const decoded = decodePng(result.bytes);
  expect({ width: decoded.width, height: decoded.height }).toEqual({ width: 768, height: 1376 });
  expect(Buffer.from(decoded.rgb).equals(Buffer.from(decodeJpeg(jpeg, { formatAsRGBA: false }).data))).toBe(true);
  expect(result.telemetry?.google).toMatchObject({ model: GOOGLE_ARTWORK_MODEL, size: "768x1376", usage });
  expect(result.telemetry?.responseUsage).toBeUndefined();
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("passes supplied reference pixels through the same provider adapter for edits", async () => {
  await generateArtwork({ ...input, referenceImages: [{ bytes: jpeg, mimeType: "image/jpeg" }], inputFidelity: "high" });
  const payload = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(payload.input[1]).toEqual({ type: "image", mime_type: "image/jpeg", data: jpeg.toString("base64") });
  expect(payload).not.toHaveProperty("input_fidelity");
});

it("validates native Google teaser dimensions and still rejects a mismatched provider ratio", async () => {
  const event = { eventName: "Construction", eventType: "Birthday", themeName: "", paletteColors: "[]",
    vibeDescription: MEDIUM_FEASIBILITY_CASES[4].hostBrief } as Event;
  const { brief, concept } = await buildQualityLockedPreviewBrief(event, "", null);
  const generated = await generateArtwork(input);
  const teaser = customerVisiblePreviewBytes(generated.bytes);
  const checks = { bytes: teaser, concept, brief, overlayCoverage: 0, artworkOpacity: 1, layoutApplied: false, ocr: false };
  const google = runTier1Checks({ ...checks, artworkModel: GOOGLE_ARTWORK_MODEL });
  expect(google.findings.filter(f => f.code === "dimensions" && f.critical)).toEqual([]);
  expect(runTier1Checks({ ...checks, artworkModel: "gpt-image-2" }).findings.some(f => f.code === "dimensions" && f.critical)).toBe(true);
});

it.each([400, 401, 429, 503])("does not retry or switch provider after HTTP %s and sanitizes private error text", async status => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { status: "PERMISSION_DENIED", message: "private prompt secret test-google-key" } }), { status }));
  const error = await generateArtwork(input).catch(e => e);
  expect(error).toBeInstanceOf(ArtworkProviderError);
  expect(error.diagnostics).toMatchObject({ model: GOOGLE_ARTWORK_MODEL, status, code: "PERMISSION_DENIED", providerRequestCount: 1 });
  expect(JSON.stringify(error)).not.toMatch(/private prompt|test-google-key/);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("requires credentials and a live deadline before dispatch", async () => {
  vi.stubEnv("GEMINI_API_KEY", "");
  await expect(generateArtwork(input)).rejects.toThrow("GEMINI_API_KEY");
  vi.stubEnv("GEMINI_API_KEY", "test-google-key");
  const controller = new AbortController(); controller.abort(new Error("expired"));
  await expect(generateArtwork({ ...input, signal: controller.signal })).rejects.toThrow("expired");
  expect(fetchMock).not.toHaveBeenCalled();
});

it("retains the documented Interactions error code and keeps its redacted explanation out of logs", async () => {
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: {
    code: "invalid_argument", message: "Invalid parameter response_format; private prompt test-google-key",
  } }), { status: 400 }));
  const error = await generateArtwork(input).catch(e => e);
  expect(error).toBeInstanceOf(ArtworkProviderError);
  expect(error.diagnostics).toMatchObject({ status: 400, code: "invalid_argument", providerRequestCount: 1 });
  expect(error.privateProviderMessage).toBe("Invalid parameter response_format; private prompt [REDACTED_API_KEY]");
  expect(Object.keys(error)).not.toContain("privateProviderMessage");
  expect(JSON.stringify(error)).not.toMatch(/private prompt|test-google-key|Invalid parameter/);
  expect(String(error)).not.toMatch(/private prompt|test-google-key|Invalid parameter/);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("never promotes a text-only reply or a thought image to artwork", async () => {
  const body = response(); body.steps = [body.steps[0]];
  fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
  await expect(generateArtwork(input)).rejects.toThrow("missing_single_image");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("retains undecodable final output without another paid dispatch", async () => {
  const body = response(); body.steps[1].content![0].data = Buffer.from("broken JPEG").toString("base64");
  fetchMock.mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
  const error = await generateArtwork(input).catch(e => e);
  expect(error).toBeInstanceOf(ArtworkNormalizationError);
  expect(error.result.bytes.toString()).toBe("broken JPEG");
  expect(error.result.telemetry.google.usage).toEqual(usage);
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("reviews exact customer teaser bytes and retains the full source with Google provenance", async () => {
  const event = { id: 1000, ownerToken: "fixture", eventName: "Artwork evaluation", eventType: "Artwork evaluation",
    themeName: "", paletteColors: "[]", vibeDescription: input.prompt } as Event;
  const store = new InMemoryArtworkAttemptStore();
  const runVision = vi.fn(async () => ({ scores: { textLogoWatermarkFree: 5, artifactFree: 5, premiumFinish: 5,
    briefFidelity: 5, compositionQuality: 5, ageAppropriate: 5 }, requiredPresent: [], excludedFound: [],
    passed: true, unavailable: false, failureCodes: [], notes: "Offline test verdict", durationMs: 1, requestCount: 1 }));
  const result = await generateQualityLockedPreview(event, { ...CUSTOMER_PREVIEW_POLICY, artworkModel: GOOGLE_ARTWORK_MODEL,
    runTier1: () => ({ passed: true, findings: [], salientRegions: [], durationMs: 0 }), runVision,
    attemptRetention: { eventId: event.id, ownerToken: event.ownerToken, store } });
  expect(result).toMatchObject({ kind: "approved-image", model: GOOGLE_ARTWORK_MODEL, attempts: 1 });
  expect(store.all[0]).toMatchObject({ model: GOOGLE_ARTWORK_MODEL, size: "768x1376", costUsdMicros: 67200 });
  const source = Buffer.from(store.all[0].assetBytesBase64, "base64");
  expect((runVision.mock.calls[0] as any)[0].bytes.equals(customerVisiblePreviewBytes(source))).toBe(true);
  expect(readPngSize(source)).toEqual({ width: 768, height: 1376 });
  expect(JSON.parse(fetchMock.mock.calls[0][1].body).input[0].text).toContain(input.prompt);
  expect(fetchMock).toHaveBeenCalledTimes(1); expect(runVision).toHaveBeenCalledTimes(1);
});

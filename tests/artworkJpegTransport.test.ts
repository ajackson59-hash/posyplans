// @vitest-environment node
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { decode as decodeJpeg, encode as encodeJpeg } from "jpeg-js";
import type { Event } from "@shared/schema";
import { ArtworkNormalizationError, generateArtwork } from "../server/aiFirst/artwork";
import { decodePng, readPngSize } from "../server/aiFirst/png";
import { customerVisiblePreviewBytes, generateQualityLockedPreview } from "../server/prePaymentPreviewQuality";

let jpeg: Buffer;
let decodedRgb: Buffer;
const fetchMock = vi.fn();
const event = { id: 42, eventName: "Garden gathering", eventType: "Dinner Party",
  eventDate: "September 19, 2026", vibeDescription: "Watercolor foliage and flowers in a moonlit garden.",
  themeName: "Garden", paletteColors: "[]" } as unknown as Event;

beforeAll(() => {
  const width = 1024, height = 1536;
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    rgba[i] = Math.floor(x / 4); rgba[i + 1] = Math.floor(y / 6);
    rgba[i + 2] = (x > 200 && x < 700 && y > 300 && y < 1000) ? 220 : 30;
    rgba[i + 3] = 255;
  }
  jpeg = encodeJpeg({ width, height, data: rgba }, 100).data;
  decodedRgb = Buffer.from(decodeJpeg(jpeg, { useTArray: true, formatAsRGBA: false }).data);
});
beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "test-key");
  fetchMock.mockReset().mockImplementation(async () => new Response(JSON.stringify({
    data: [{ b64_json: jpeg.toString("base64") }],
  }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("maximum-quality JPEG provider transport", () => {
  it.each([false, true])("normalizes full-size decoded pixels without resampling (reference edit=%s)", async (edit) => {
    const result = await generateArtwork({ prompt: "Preserve this garden direction", aspectRatio: "9:16",
      quality: "high", outputFormat: "jpeg", maxTransientRetries: 0,
      ...(edit ? { referenceImages: [{ bytes: jpeg, mimeType: "image/jpeg" as const }] } : {}),
    });
    const png = decodePng(result.bytes);
    expect({ width: png.width, height: png.height }).toEqual({ width: 1024, height: 1536 });
    expect(Buffer.from(png.rgb).equals(decodedRgb)).toBe(true);
    expect(result.dataUrl).toBe(`data:image/png;base64,${result.bytes.toString("base64")}`);
    expect(result.telemetry).toMatchObject({ outputFormat: "jpeg", providerRequestCount: 1 });
    expect(result.durationMs).toBeGreaterThanOrEqual(result.telemetry!.providerDurationMs);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = edit ? Object.fromEntries((init.body as FormData).entries()) : JSON.parse(String(init.body));
    expect(body).toMatchObject({ output_format: "jpeg", output_compression: edit ? "100" : 100,
      quality: "high", size: "1024x1536", model: "gpt-image-2" });
  });

  it.each([true, false])("reviews the exact teaser while retaining full-resolution pixels and telemetry (parallel=%s)", async (parallel) => {
    const records: any[] = [], reviewed: Buffer[] = [];
    const result = await generateQualityLockedPreview(event, {
      generateImage: generateArtwork, maxCandidates: parallel ? 2 : 1, parallelCandidates: parallel,
      runTier1: () => ({ passed: true, findings: [], salientRegions: [], durationMs: 0 }),
      runVision: async ({ bytes }) => {
        reviewed.push(bytes);
        return { scores: { textLogoWatermarkFree: 5, artifactFree: 5, premiumFinish: 5,
          briefFidelity: 5, compositionQuality: 5, ageAppropriate: 5 }, requiredPresent: [], excludedFound: [],
          passed: true, unavailable: false, failureCodes: [], notes: "", durationMs: 1,
          requestCount: 1, usage: { inputTokens: 10, outputTokens: 10 } };
      },
      attemptRetention: { eventId: event.id, ownerToken: "synthetic-owner",
        store: { record: async (input: any) => { records.push(input); return { ...input, id: records.length }; } } as never },
    });
    expect(result.kind).toBe("approved-image");
    expect(records).toHaveLength(parallel ? 2 : 1);
    for (const record of records) {
      expect(Buffer.from(decodePng(record.bytes).rgb).equals(decodedRgb)).toBe(true);
      const teaser = customerVisiblePreviewBytes(record.bytes);
      expect(readPngSize(teaser)).toEqual({ width: 373, height: 560 });
      expect(reviewed.some(bytes => bytes.equals(teaser))).toBe(true);
      expect(record.reviewEvidence.reviewedAssetHash).toBe(createHash("sha256").update(teaser).digest("hex"));
      expect(record.reviewEvidence.generationTelemetry).toMatchObject({ outputFormat: "jpeg", providerRequestCount: 1 });
      expect(record.reviewEvidence.verdict.requestCount).toBe(1);
    }
    if (result.kind === "approved-image") {
      expect(Buffer.from(result.dataUrl.split(",")[1], "base64").equals(records[0].bytes)).toBe(true);
    }
  });

  it.each(["corrupt", "truncated", "wrong dimensions"])("retains %s responses privately without a critic or extra image request", async (failure) => {
    const bytes = failure === "corrupt" ? Buffer.from("invalid JPEG") : failure === "truncated"
      ? jpeg.subarray(0, Math.floor(jpeg.length / 2))
      : encodeJpeg({ width: 16, height: 16, data: Buffer.alloc(16 * 16 * 4, 255) }, 100).data;
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({ data: [{ b64_json: bytes.toString("base64") }] })));
    const records: any[] = [];
    const critic = vi.fn();
    const result = await generateQualityLockedPreview(event, { generateImage: generateArtwork, maxCandidates: 1,
      runVision: critic, attemptRetention: { eventId: event.id, ownerToken: "synthetic-owner",
        store: { record: async (input: any) => { records.push(input); return input; } } as never },
    });
    expect(result.kind).toBe("unavailable");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(critic).not.toHaveBeenCalled();
    expect(records).toHaveLength(1);
    expect(records[0].bytes.equals(bytes)).toBe(true);
    expect(records[0].reviewEvidence).toMatchObject({ verdict: null, reviewedAssetHash: null,
      generationTelemetry: { outputFormat: "jpeg", providerRequestCount: 1 } });
    expect(records[0].reviewEvidence.reviewError).toContain("JPEG normalization failed");
  });

  it("does not expose private response pixels through error logging", () => {
    const error = new ArtworkNormalizationError("bad JPEG", { bytes: jpeg, dataUrl: "private", durationMs: 1 });
    expect(Object.keys(error)).not.toContain("result");
    expect(error.result.bytes).toBe(jpeg);
  });
});

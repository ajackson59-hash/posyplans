from pathlib import Path
import re


def one(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected one match in {path}, found {count}: {old[:120]!r}")
    file.write_text(text.replace(old, new, 1))


quality = "server/prePaymentPreviewQuality.ts"
one(
    quality,
    '''import type { AiFirstArtworkAttemptStore } from "./aiFirst/artworkAttemptStore";
import { buildEventBrief, type EventBrief } from "./aiFirst/brief";''',
    '''import type { AiFirstArtworkAttemptStore } from "./aiFirst/artworkAttemptStore";
import { boxDownsampleRgb, decodePng, encodePng } from "./aiFirst/png";
import { buildEventBrief, type EventBrief } from "./aiFirst/brief";''',
)
one(
    quality,
    '''import { prePaymentPreviewSourceBrief } from "./prePaymentPreviewConcept";
''',
    '''import { PRE_PAYMENT_PREVIEW_LONG_EDGE } from "./prePaymentPreview";
import { prePaymentPreviewSourceBrief } from "./prePaymentPreviewConcept";
''',
)
one(
    quality,
    '''export type PrePaymentPreviewMode = "off" | "direction-card" | "quality-image";
''',
    '''export type PrePaymentPreviewMode = "off" | "direction-card" | "quality-image";

/**
 * Produces the exact low-resolution PNG bytes an unpaid customer receives.
 * Quality review runs on these bytes—not a larger source that the browser later
 * transforms—so the approved pixels and the served pixels are equivalent.
 */
export function customerVisiblePreviewBytes(source: Buffer): Buffer {
  const decoded = decodePng(source);
  return encodePng(boxDownsampleRgb(decoded, PRE_PAYMENT_PREVIEW_LONG_EDGE));
}
''',
)
one(
    quality,
    '''    let tier1: Tier1Result;
    let vision: VisionVerdict | undefined;
    try {
      tier1 = runTier1({
        bytes: generated.bytes,''',
    '''    let reviewedBytes: Buffer;
    try {
      reviewedBytes = customerVisiblePreviewBytes(generated.bytes);
    } catch (error) {
      return {
        kind: "unavailable",
        attempts: candidate,
        model,
        reviews,
        error: `Generated artwork could not be prepared for customer review: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    const reviewedDataUrl = `data:image/png;base64,${reviewedBytes.toString("base64")}`;

    let tier1: Tier1Result;
    let vision: VisionVerdict | undefined;
    try {
      tier1 = runTier1({
        bytes: reviewedBytes,''',
)
one(
    quality,
    '''        vision = await runVision({ bytes: generated.bytes, concept, brief });''',
    '''        vision = await runVision({ bytes: reviewedBytes, concept, brief });''',
)
one(
    quality,
    '''          bytes: generated.bytes,
          previewId: null,''',
    '''          bytes: reviewedBytes,
          previewId: null,''',
)
one(
    quality,
    '''        dataUrl: generated.dataUrl,
        attempts: candidate,''',
    '''        dataUrl: reviewedDataUrl,
        attempts: candidate,''',
)

test = "tests/prePaymentPreviewQuality.test.ts"
one(
    test,
    '''import type { VisionVerdict } from "../server/aiFirst/visionGate";
import {''',
    '''import type { VisionVerdict } from "../server/aiFirst/visionGate";
import { encodePng, readPngSize } from "../server/aiFirst/png";
import {''',
)
one(
    test,
    '''} as unknown as Event;

function tier1''',
    '''} as unknown as Event;

function generatedPng(fill: number, width = 630, height = 1120): Buffer {
  const rgb = new Uint8Array(width * height * 3);
  rgb.fill(fill);
  return encodePng({ width, height, rgb });
}

function tier1''',
)
text = Path(test).read_text()
text = re.sub(r'Buffer\.alloc\(50_000,\s*(\d+)\)', r'generatedPng(\1)', text)
Path(test).write_text(text)
one(
    test,
    '''    expect(result.dataUrl).toBe("data:image/png;base64,SECOND");''',
    '''    expect(result.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(readPngSize(Buffer.from(result.dataUrl.split(",")[1], "base64"))).toEqual({ width: 315, height: 560 });''',
)
one(
    test,
    '''      expect(result.dataUrl).toBe("data:image/png;base64,APPROVED");''',
    '''      expect(result.dataUrl).toMatch(/^data:image\/png;base64,/);
      expect(readPngSize(Buffer.from(result.dataUrl.split(",")[1], "base64"))).toEqual({ width: 315, height: 560 });''',
)
one(
    test,
    '''  it("returns no customer-visible pixels when both private candidates fail", async () => {''',
    '''  it("reviews and returns the exact 560px customer-visible teaser pixels", async () => {
    const sourceBytes = generatedPng(9);
    const runTier1 = vi.fn(() => tier1(true));
    const runVision = vi.fn(async () => vision(true));
    const result = await generateQualityLockedPreview(event, {
      generateImage: async () => ({
        bytes: sourceBytes,
        dataUrl: `data:image/png;base64,${sourceBytes.toString("base64")}`,
        durationMs: 100,
      }),
      runTier1,
      runVision,
      maxCandidates: 1,
    });

    expect(result.kind).toBe("approved-image");
    if (result.kind !== "approved-image") throw new Error("expected approved image");
    const returnedBytes = Buffer.from(result.dataUrl.split(",")[1], "base64");
    expect(readPngSize(returnedBytes)).toEqual({ width: 315, height: 560 });
    expect(Buffer.compare(runTier1.mock.calls[0][0].bytes, returnedBytes)).toBe(0);
    expect(Buffer.compare(runVision.mock.calls[0][0].bytes, returnedBytes)).toBe(0);
  });

  it("returns no customer-visible pixels when both private candidates fail", async () => {''',
)

reference = "tests/prePaymentPreviewReferenceQuality.test.ts"
one(
    reference,
    '''import type { VisionVerdict } from "../server/aiFirst/visionGate";
import { generateQualityLockedPreview }''',
    '''import type { VisionVerdict } from "../server/aiFirst/visionGate";
import { encodePng, readPngSize } from "../server/aiFirst/png";
import { generateQualityLockedPreview }''',
)
one(
    reference,
    '''} as unknown as Event;

const tier1''',
    '''} as unknown as Event;

function generatedPng(fill: number, width = 630, height = 1120): Buffer {
  const rgb = new Uint8Array(width * height * 3);
  rgb.fill(fill);
  return encodePng({ width, height, rgb });
}

const tier1''',
)
text = Path(reference).read_text()
text = re.sub(r'Buffer\.alloc\(50_000,\s*(\d+)\)', r'generatedPng(\1)', text)
Path(reference).write_text(text)
one(
    reference,
    '''    expect(result.dataUrl).toBe("data:image/png;base64,SECOND");''',
    '''    expect(result.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(readPngSize(Buffer.from(result.dataUrl.split(",")[1], "base64"))).toEqual({ width: 315, height: 560 });''',
)

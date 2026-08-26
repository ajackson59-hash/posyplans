// Round-trip coverage for the PNG encoder + RGB box-downsampler added for
// the pre-payment preview (server/prePaymentPreview.ts). These synthesize a
// small in-memory image, run it decode -> downsample -> encode -> decode,
// and check dimensions/averaging rather than depending on any fixture file.

import { describe, expect, it } from "vitest";
import { boxDownsampleRgb, decodePng, encodePng, type DecodedImage } from "../server/aiFirst/png";

function solidImage(width: number, height: number, r: number, g: number, b: number): DecodedImage {
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < width * height; i += 1) {
    rgb[i * 3] = r;
    rgb[i * 3 + 1] = g;
    rgb[i * 3 + 2] = b;
  }
  return { width, height, rgb };
}

/** Four quadrants of different flat colours — exercises real averaging. */
function quadrantImage(size: number): DecodedImage {
  const rgb = new Uint8Array(size * size * 3);
  const half = size / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const i = (y * size + x) * 3;
      const left = x < half;
      const top = y < half;
      if (top && left) { rgb[i] = 255; rgb[i + 1] = 0; rgb[i + 2] = 0; }
      else if (top && !left) { rgb[i] = 0; rgb[i + 1] = 255; rgb[i + 2] = 0; }
      else if (!top && left) { rgb[i] = 0; rgb[i + 1] = 0; rgb[i + 2] = 255; }
      else { rgb[i] = 255; rgb[i + 1] = 255; rgb[i + 2] = 255; }
    }
  }
  return { width: size, height: size, rgb };
}

describe("encodePng / decodePng round trip", () => {
  it("preserves dimensions and exact pixel values for a solid colour image", () => {
    const original = solidImage(12, 8, 30, 140, 210);
    const bytes = encodePng(original);
    // A real PNG signature + IHDR/IDAT/IEND, decodable by our own decoder.
    const decoded = decodePng(bytes);

    expect(decoded.width).toBe(12);
    expect(decoded.height).toBe(8);
    expect(Array.from(decoded.rgb)).toEqual(Array.from(original.rgb));
  });

  it("preserves a non-trivial multi-colour image exactly (lossless encoder)", () => {
    const original = quadrantImage(16);
    const decoded = decodePng(encodePng(original));

    expect(decoded.width).toBe(16);
    expect(decoded.height).toBe(16);
    expect(Array.from(decoded.rgb)).toEqual(Array.from(original.rgb));
  });
});

describe("boxDownsampleRgb", () => {
  it("shrinks to roughly the requested long edge and keeps a solid colour intact", () => {
    const original = solidImage(1024, 1024, 12, 200, 44);
    const small = boxDownsampleRgb(original, 28);

    expect(Math.max(small.width, small.height)).toBeLessThanOrEqual(28);
    expect(Math.max(small.width, small.height)).toBeGreaterThan(0);
    // Every pixel of a solid-colour source should still average out exactly.
    for (let i = 0; i < small.width * small.height; i += 1) {
      expect(small.rgb[i * 3]).toBe(12);
      expect(small.rgb[i * 3 + 1]).toBe(200);
      expect(small.rgb[i * 3 + 2]).toBe(44);
    }
  });

  it("genuinely destroys detail: a downsampled quadrant image no longer has sharp boundaries", () => {
    const original = quadrantImage(400);
    const small = boxDownsampleRgb(original, 24);

    // At this target size the box windows straddle quadrant boundaries, so
    // averaged pixels near the centre must be a blend, not a pure channel —
    // proof the four flat colours were actually mixed, not just resized.
    const midX = Math.floor(small.width / 2);
    const midY = Math.floor(small.height / 2);
    const i = (midY * small.width + midX) * 3;
    const isPureChannel =
      (small.rgb[i] === 255 || small.rgb[i] === 0) &&
      (small.rgb[i + 1] === 255 || small.rgb[i + 1] === 0) &&
      (small.rgb[i + 2] === 255 || small.rgb[i + 2] === 0);
    expect(isPureChannel).toBe(false);
  });

  it("round-trips through encodePng and stays a decodable, smaller PNG", () => {
    const original = solidImage(800, 600, 90, 90, 90);
    const small = boxDownsampleRgb(original, 24);
    const bytes = encodePng(small);
    const decoded = decodePng(bytes);

    expect(decoded.width).toBe(small.width);
    expect(decoded.height).toBe(small.height);
    expect(bytes.length).toBeLessThan(encodePng(original).length);
  });
});

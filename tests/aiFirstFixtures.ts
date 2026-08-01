// Shared fixtures for the AI-first tests. Not a test file itself.

import { deflateSync } from "node:zlib";
import type { AiFirstConcept } from "@shared/aiFirstInvite";

export function concept(overrides: Partial<AiFirstConcept> = {}): AiFirstConcept {
  return {
    conceptName: "Midnight Bloom",
    description: "A candlelit garden at dusk, ink-dark with brass warmth.",
    styleLaneId: "editorial-premium",
    layoutStyle: "full-bleed",
    borderStyle: "thin-frame",
    fontPairingId: "editorial-serif",
    baseThemeId: "garden-editorial",
    placementId: "centre",
    texture: { style: "cotton", intensity: 0.6 },
    dividerStyle: "diamond-rule",
    motif: { id: "botanical-sprig", placement: "side-mirrored" },
    semanticPalette: {
      textSurface: "#f7f3ec",
      headlineColor: "#1c1a17",
      bodyColor: "#3a352d",
      accentColor: "#8a6a2f",
    },
    art: {
      medium: "watercolor",
      composition: "single off-centre focal subject",
      prompt:
        "A dusk garden of deep ink-blue foliage with brass-warm candlelight glinting through the leaves, painted loosely in watercolour.",
    },
    safeTypographyRegion: "center",
    minOverlay: "veil",
    ...overrides,
  };
}

/** Deterministic pseudo-random in [0,1). Same bytes on every machine. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/**
 * Pixels that behave like real artwork as far as Tier 1 is concerned: textured
 * everywhere (so no flat band, and no uniform border ring that would read as a
 * printed margin) with detail concentrated centrally (so the object-cover crop
 * clips nothing salient). Deliberately not random — the same seed gives the
 * same image, so a gate result is reproducible.
 */
function artworkRgb(
  width: number,
  height: number,
  seed: number,
  visible: { x: number; y: number } = { x: 1, y: 1 },
): Buffer {
  const rand = lcg(seed);
  const rgb = Buffer.alloc(width * height * 3);
  // The subject occupies the middle 60% of whatever the crop leaves visible —
  // what a model that obeyed `safeFramingRequirement` would return.
  const scaleX = 1 / (visible.x * 0.3);
  const scaleY = 1 / (visible.y * 0.3);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = Math.abs(x / width - 0.5) * scaleX;
      const dy = Math.abs(y / height - 0.5) * scaleY;
      const central = Math.max(0, 1 - Math.hypot(dx, dy));
      const amplitude = 24 + 120 * central * central;
      // A low-frequency wash under the grain. Tier 1 measures a downsampled
      // grid, where per-pixel grain averages away but real illustration
      // structure does not — so the fixture has to carry both.
      const wash =
        (9 + 30 * central) * Math.sin(x * 0.13) * Math.cos(y * 0.09) +
        (7 + 18 * central) * Math.sin((x + y) * 0.05);
      const value = Math.max(0, Math.min(255, Math.round(128 + wash + (rand() - 0.5) * amplitude)));
      const at = (y * width + x) * 3;
      rgb[at] = value;
      rgb[at + 1] = value;
      rgb[at + 2] = value;
    }
  }
  return rgb;
}

export function artworkPng(width = 256, height = 384, seed = 7): Buffer {
  return encodePng(width, height, artworkRgb(width, height, seed));
}

/**
 * The pixel size and the tightest visible window of any layout that requests
 * each aspect, so one fixture image is crop-safe for all of them.
 */
const ASPECT_PROFILE: Record<
  "16:9" | "1:1" | "9:16",
  { size: [number, number]; visible: { x: number; y: number } }
> = {
  "16:9": { size: [384, 256], visible: { x: 1, y: 0.88 } },
  "1:1": { size: [320, 320], visible: { x: 1, y: 0.6 } },
  "9:16": { size: [256, 384], visible: { x: 0.45, y: 0.89 } },
};

/** Artwork at the aspect the layout asked for, as the real provider returns. */
export function artworkForAspect(aspect: "16:9" | "1:1" | "9:16", seed = 7): Buffer {
  const { size, visible } = ASPECT_PROFILE[aspect];
  return encodePng(size[0], size[1], artworkRgb(size[0], size[1], seed, visible));
}

/** The defective counterpart of `artworkForAspect`. */
export function framedArtworkForAspect(aspect: "16:9" | "1:1" | "9:16"): Buffer {
  const [width, height] = ASPECT_PROFILE[aspect].size;
  return framedArtworkPng(width, height);
}

/**
 * The same artwork with a flat printed margin painted around it — the defect
 * the renderer's own frame turns into a visible double border.
 */
export function framedArtworkPng(width = 256, height = 384, marginFraction = 0.06): Buffer {
  const rgb = artworkRgb(width, height, 7);
  const margin = Math.round(Math.min(width, height) * marginFraction);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (x >= margin && x < width - margin && y >= margin && y < height - margin) continue;
      const at = (y * width + x) * 3;
      rgb[at] = 250;
      rgb[at + 1] = 250;
      rgb[at + 2] = 250;
    }
  }
  return encodePng(width, height, rgb);
}

/**
 * A minimal but genuinely valid PNG: an 8x8 solid block, deflated by hand at
 * store level so no dependency is needed. Used where the code under test only
 * has to decode a real file, not judge a real image.
 */
export function solidPng(size = 8, value = 0x80): Buffer {
  return encodePng(size, size, Buffer.alloc(size * size * 3, value));
}

/** Builds a truecolour PNG from raw RGB, so the tests need no image library. */
function encodePng(width: number, height: number, rgb: Buffer): Buffer {
  const crcTable: number[] = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crcTable[n] = c >>> 0;
  }
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc(body));
    return Buffer.concat([head, body, tail]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour
  const stride = width * 3;
  const raw = Buffer.concat(
    Array.from({ length: height }, (_unused, y) =>
      Buffer.concat([Buffer.from([0]), rgb.subarray(y * stride, (y + 1) * stride)]),
    ),
  );

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

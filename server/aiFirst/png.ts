// Minimal PNG decoder for the deterministic quality gate.
//
// The gate must inspect real pixels before deciding whether to pay for a
// second image, and it must do so on Vercel's serverless runtime. Pulling in
// sharp (a native binary) or jimp (a large dependency tree) for what amounts
// to "inflate an IDAT and undo five filters" is not worth it — Node's own
// zlib does the hard part.
//
// Supports the colour types gpt-image-1 actually returns: 8-bit truecolour
// with and without alpha, plus 8-bit greyscale. Anything else is reported as
// undecodable, which the gate treats as a file-integrity failure rather than
// crashing.

import { crc32, deflateSync, inflateSync } from "node:zlib";

export interface DecodedImage {
  width: number;
  height: number;
  /** RGB triples, row-major, length width*height*3. */
  rgb: Uint8Array;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export class PngDecodeError extends Error {}

interface Header {
  width: number;
  height: number;
  bitDepth: number;
  colorType: number;
  interlace: number;
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };

export function decodePng(buffer: Buffer): DecodedImage {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(SIGNATURE)) {
    throw new PngDecodeError("not a PNG (bad signature)");
  }

  let header: Header | null = null;
  const idat: Buffer[] = [];
  let offset = 8;
  let sawEnd = false;

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buffer.length) throw new PngDecodeError(`truncated chunk ${type}`);

    if (type === "IHDR") {
      header = {
        width: buffer.readUInt32BE(dataStart),
        height: buffer.readUInt32BE(dataStart + 4),
        bitDepth: buffer[dataStart + 8],
        colorType: buffer[dataStart + 9],
        interlace: buffer[dataStart + 12],
      };
    } else if (type === "IDAT") {
      idat.push(buffer.subarray(dataStart, dataEnd));
    } else if (type === "IEND") {
      sawEnd = true;
      break;
    }
    offset = dataEnd + 4;
  }

  if (!header) throw new PngDecodeError("no IHDR chunk");
  if (!sawEnd) throw new PngDecodeError("no IEND chunk — file is truncated");
  if (idat.length === 0) throw new PngDecodeError("no image data");
  if (header.bitDepth !== 8) throw new PngDecodeError(`unsupported bit depth ${header.bitDepth}`);
  if (header.interlace !== 0) throw new PngDecodeError("interlaced PNGs are not supported");

  const channels = CHANNELS[header.colorType];
  if (!channels) throw new PngDecodeError(`unsupported colour type ${header.colorType}`);

  let raw: Buffer;
  try {
    raw = inflateSync(Buffer.concat(idat));
  } catch (err) {
    throw new PngDecodeError(`IDAT inflate failed: ${(err as Error).message}`);
  }

  const { width, height } = header;
  const stride = width * channels;
  if (raw.length < (stride + 1) * height) {
    throw new PngDecodeError("inflated data is shorter than the declared image");
  }

  const pixels = unfilter(raw, width, height, channels);
  return { width, height, rgb: toRgb(pixels, width, height, channels, header.colorType) };
}

/** Undoes the five PNG scanline filters in place. */
function unfilter(raw: Buffer, width: number, height: number, channels: number): Buffer {
  const stride = width * channels;
  const out = Buffer.alloc(stride * height);

  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    const prev = dst - stride;

    for (let x = 0; x < stride; x += 1) {
      const value = raw[src + x];
      const a = x >= channels ? out[dst + x - channels] : 0;
      const b = y > 0 ? out[prev + x] : 0;
      const c = x >= channels && y > 0 ? out[prev + x - channels] : 0;

      let recon: number;
      switch (filter) {
        case 0: recon = value; break;
        case 1: recon = value + a; break;
        case 2: recon = value + b; break;
        case 3: recon = value + ((a + b) >> 1); break;
        case 4: recon = value + paeth(a, b, c); break;
        default: throw new PngDecodeError(`unknown scanline filter ${filter} on row ${y}`);
      }
      out[dst + x] = recon & 0xff;
    }
  }
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  return pb <= pc ? b : c;
}

/** Flattens to RGB, compositing any alpha over white (the card's paper). */
function toRgb(
  pixels: Buffer,
  width: number,
  height: number,
  channels: number,
  colorType: number,
): Uint8Array {
  const rgb = new Uint8Array(width * height * 3);
  const count = width * height;

  for (let i = 0; i < count; i += 1) {
    const src = i * channels;
    const dst = i * 3;
    let r: number;
    let g: number;
    let b: number;
    let alpha = 255;

    if (colorType === 0) {
      r = g = b = pixels[src];
    } else if (colorType === 4) {
      r = g = b = pixels[src];
      alpha = pixels[src + 1];
    } else if (colorType === 2) {
      r = pixels[src];
      g = pixels[src + 1];
      b = pixels[src + 2];
    } else {
      r = pixels[src];
      g = pixels[src + 1];
      b = pixels[src + 2];
      alpha = pixels[src + 3];
    }

    if (alpha === 255) {
      rgb[dst] = r;
      rgb[dst + 1] = g;
      rgb[dst + 2] = b;
    } else {
      const a = alpha / 255;
      rgb[dst] = Math.round(r * a + 255 * (1 - a));
      rgb[dst + 1] = Math.round(g * a + 255 * (1 - a));
      rgb[dst + 2] = Math.round(b * a + 255 * (1 - a));
    }
  }
  return rgb;
}

/** Reads just the dimensions, without inflating. Cheap pre-check. */
export function readPngSize(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(SIGNATURE)) return null;
  if (buffer.toString("ascii", 12, 16) !== "IHDR") return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/* ── Sampling helpers used by the deterministic checks ───────────────── */

/** Rec. 709 luma, 0-255. */
export function lumaAt(image: DecodedImage, x: number, y: number): number {
  const i = (y * image.width + x) * 3;
  return 0.2126 * image.rgb[i] + 0.7152 * image.rgb[i + 1] + 0.0722 * image.rgb[i + 2];
}

/**
 * Box-downsamples to a luma grid. Every pixel-level check runs on this rather
 * than the full 1024² image: it is ~40x less work and none of the checks care
 * about detail below a few pixels.
 */
export function lumaGrid(image: DecodedImage, targetLongEdge = 160): {
  width: number;
  height: number;
  data: Float32Array;
} {
  const scale = Math.max(1, Math.round(Math.max(image.width, image.height) / targetLongEdge));
  const width = Math.max(1, Math.floor(image.width / scale));
  const height = Math.max(1, Math.floor(image.height / scale));
  const data = new Float32Array(width * height);

  for (let gy = 0; gy < height; gy += 1) {
    for (let gx = 0; gx < width; gx += 1) {
      let sum = 0;
      let n = 0;
      for (let dy = 0; dy < scale; dy += 1) {
        const y = gy * scale + dy;
        if (y >= image.height) break;
        for (let dx = 0; dx < scale; dx += 1) {
          const x = gx * scale + dx;
          if (x >= image.width) break;
          sum += lumaAt(image, x, y);
          n += 1;
        }
      }
      data[gy * width + gx] = n > 0 ? sum / n : 0;
    }
  }
  return { width, height, data };
}

/* ── Encoder + downsampler for the pre-payment blurred preview ────────
 * (server/prePaymentPreview.ts, routes.ts). The decoder above already
 * covers everything needed to read gpt-image-1 output; these two functions
 * are the minimum needed to turn that into a genuinely-destroyed-detail
 * preview server-side. "Genuinely destroyed" matters: a CSS blur on the
 * full-resolution image is trivially undone via devtools/network tab, so
 * the actual pixel data sent to an unpaid client must already be tiny.
 */

/**
 * Area-averages an RGB image to an exact target long edge, keeping full colour
 * (unlike lumaGrid above, which is greyscale-only for the quality gate). The
 * earlier integer-scale implementation rounded 320/300 down to 1 and quietly
 * returned the original 320px asset unchanged. Fractional source rectangles
 * guarantee that any source larger than the cap is genuinely resampled and
 * that the caller receives the requested safe dimensions.
 */
export function boxDownsampleRgb(image: DecodedImage, targetLongEdge: number): DecodedImage {
  const sourceLongEdge = Math.max(image.width, image.height);
  if (!Number.isFinite(targetLongEdge) || targetLongEdge < 1 || sourceLongEdge <= targetLongEdge) {
    return image;
  }

  const ratio = targetLongEdge / sourceLongEdge;
  const width = Math.max(1, Math.round(image.width * ratio));
  const height = Math.max(1, Math.round(image.height * ratio));
  const rgb = new Uint8Array(width * height * 3);

  for (let gy = 0; gy < height; gy += 1) {
    const sourceY0 = (gy * image.height) / height;
    const sourceY1 = ((gy + 1) * image.height) / height;
    const firstY = Math.floor(sourceY0);
    const lastY = Math.ceil(sourceY1);

    for (let gx = 0; gx < width; gx += 1) {
      const sourceX0 = (gx * image.width) / width;
      const sourceX1 = ((gx + 1) * image.width) / width;
      const firstX = Math.floor(sourceX0);
      const lastX = Math.ceil(sourceX1);
      let r = 0;
      let g = 0;
      let b = 0;
      let weight = 0;

      // Weight boundary pixels by the fraction of their area that overlaps the
      // destination rectangle. This avoids nearest-neighbour aliasing and
      // genuinely removes fine detail even for a small 320 -> 300 reduction.
      for (let y = firstY; y < lastY; y += 1) {
        if (y < 0 || y >= image.height) continue;
        const overlapY = Math.max(0, Math.min(sourceY1, y + 1) - Math.max(sourceY0, y));
        if (overlapY <= 0) continue;
        for (let x = firstX; x < lastX; x += 1) {
          if (x < 0 || x >= image.width) continue;
          const overlapX = Math.max(0, Math.min(sourceX1, x + 1) - Math.max(sourceX0, x));
          const pixelWeight = overlapX * overlapY;
          if (pixelWeight <= 0) continue;
          const src = (y * image.width + x) * 3;
          r += image.rgb[src] * pixelWeight;
          g += image.rgb[src + 1] * pixelWeight;
          b += image.rgb[src + 2] * pixelWeight;
          weight += pixelWeight;
        }
      }

      const dst = (gy * width + gx) * 3;
      if (weight > 0) {
        rgb[dst] = Math.round(r / weight);
        rgb[dst + 1] = Math.round(g / weight);
        rgb[dst + 2] = Math.round(b / weight);
      }
    }
  }
  return { width, height, rgb };
}

/**
 * Minimal PNG encoder: IHDR (8-bit truecolour, colour type 2) + one IDAT
 * (filter-byte-0 scanlines, deflated) + IEND. The inverse of decodePng's
 * IHDR/IDAT/IEND handling above, kept equally small on purpose — this only
 * ever needs to round-trip images this module itself produced or read.
 */
export function encodePng(image: DecodedImage): Buffer {
  const { width, height, rgb } = image;
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0; // filter type "None"
    for (let x = 0; x < stride; x += 1) {
      raw[rowStart + 1 + x] = rgb[y * stride + x];
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  const idat = deflateSync(raw);

  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

export function mean(values: ArrayLike<number>): number {
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) sum += values[i];
  return values.length > 0 ? sum / values.length : 0;
}

export function stdev(values: ArrayLike<number>): number {
  const m = mean(values);
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) sum += (values[i] - m) ** 2;
  return values.length > 0 ? Math.sqrt(sum / values.length) : 0;
}

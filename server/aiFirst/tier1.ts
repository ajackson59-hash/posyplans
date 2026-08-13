// Tier 1: deterministic quality checks. No model, no provider call, $0.00.
//
// These run BEFORE the paid vision pass, because most of what actually went
// wrong with generated invitation artwork is measurable: printed paper
// margins, crops that eat the subject, blank output, banding, lettering, and
// text set on a region the artwork never left quiet. A gate that only asks a
// model "does this look good" pays money to miss all of it.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  decodePng,
  lumaGrid,
  mean,
  PngDecodeError,
  readPngSize,
  stdev,
  type DecodedImage,
} from "./png";
import {
  evaluateCropSafety,
  MIN_FOCAL_VISIBILITY_RATIO,
  typePlacementFrame,
  type SalientRegion,
} from "@shared/aiFirstLayout";
import { contrastRatio } from "@shared/aiFirstPalette";
import { LAYOUT_FRAMES } from "@shared/inviteLayout";
import type { AiFirstConcept } from "@shared/aiFirstInvite";
import { aspectRatioForLayout } from "@shared/aiFirstInvite";
import { LOCAL_TYPE_SURFACE_ALPHA } from "@shared/themeCatalog";

export type Tier1Code =
  | "file-integrity"
  | "file-size"
  | "dimensions"
  | "blank-degenerate"
  | "flat-bands"
  | "printed-margin"
  | "crop-unsafe"
  | "quiet-region"
  | "text-contrast"
  | "overlay-coverage"
  | "layout-opacity"
  | "text-detected";

export interface Tier1Finding {
  code: Tier1Code;
  /** A critical defect can never be shown to a customer. */
  critical: boolean;
  message: string;
  measured?: number;
  limit?: number;
}

export interface Tier1Result {
  passed: boolean;
  findings: Tier1Finding[];
  /** Present when the file decoded — reused by the layout pass. */
  image?: DecodedImage;
  salientRegions: SalientRegion[];
  durationMs: number;
}

/* ── Thresholds ──────────────────────────────────────────────────────── */

const MIN_BYTES = 40 * 1024;
const MAX_BYTES = 12 * 1024 * 1024;
const ASPECT_TOLERANCE = 0.01;
const MIN_GLOBAL_STDEV = 4;
const MAX_FLAT_BAND_FRACTION = 0.08;
const MAX_MARGIN_RING_FRACTION = 0.015;
/** A ring counts as "uniform" below this luma spread. */
const MARGIN_UNIFORMITY_STDEV = 3.5;
const SALIENCE_TOP_DECILE = 0.9;
/**
 * A block also has to carry this much more detail than the typical block to
 * count as salient. Without an absolute floor the top decile is salient by
 * definition, so even a flat wash would report "clipped motifs".
 */
const SALIENCE_MIN_RATIO = 1.5;
/**
 * A motif carrying less than this share of the image's salient area is
 * background texture. Cropping it is not the "clipped motif" defect.
 */
const MIN_MOTIF_SALIENCE_SHARE = 0.2;
const MIN_OCR_TOKEN_LENGTH = 3;
const OCR_MIN_CONFIDENCE = 60;
/**
 * The former raw-art limit was 150. A 0.86 local veil reduced that to 21 on
 * the rendered card, so 21 remains the launch bar. The renderer now uses a
 * slightly stronger 0.88 veil, creating deterministic safety margin without
 * lowering the standard.
 */
export const MAX_RENDERED_TYPE_REGION_LUMA_SPREAD = 21;
const MAX_UNPROTECTED_TYPE_REGION_LUMA_SPREAD = 90;

const EXPECTED_ASPECT: Record<"16:9" | "1:1" | "9:16", number> = {
  "16:9": 1536 / 1024,
  "1:1": 1,
  "9:16": 1024 / 1536,
};

/* ── The gate ────────────────────────────────────────────────────────── */

export interface Tier1Input {
  bytes: Buffer;
  concept: AiFirstConcept;
  /** Overlay actually applied, for the coverage check. */
  overlayCoverage: number;
  /** Artwork opacity actually applied by the layout. */
  artworkOpacity: number;
  /** Enables the OCR pass. Off in unit tests, on in production. */
  ocr?: boolean;
}

export function runTier1Checks(input: Tier1Input): Tier1Result {
  const started = Date.now();
  const findings: Tier1Finding[] = [];
  const { bytes, concept } = input;

  // D2 — file size. Cheap, and a near-empty file makes every later check lie.
  if (bytes.length < MIN_BYTES) {
    findings.push({
      code: "file-size",
      critical: true,
      message: `artwork is ${bytes.length} bytes — too small to be a real illustration`,
      measured: bytes.length,
      limit: MIN_BYTES,
    });
  } else if (bytes.length > MAX_BYTES) {
    findings.push({
      code: "file-size",
      critical: true,
      message: `artwork is ${(bytes.length / 1e6).toFixed(1)} MB — pathological`,
      measured: bytes.length,
      limit: MAX_BYTES,
    });
  }

  // D1 — file integrity.
  let image: DecodedImage;
  try {
    image = decodePng(bytes);
  } catch (err) {
    findings.push({
      code: "file-integrity",
      critical: true,
      message: err instanceof PngDecodeError ? err.message : `decode failed: ${(err as Error).message}`,
    });
    return { passed: false, findings, salientRegions: [], durationMs: Date.now() - started };
  }

  // D3 — dimensions match the aspect the layout asked for.
  const expected = EXPECTED_ASPECT[aspectRatioForLayout(concept.layoutStyle)];
  const actual = image.width / image.height;
  if (Math.abs(actual - expected) / expected > ASPECT_TOLERANCE) {
    findings.push({
      code: "dimensions",
      critical: true,
      message: `artwork is ${image.width}x${image.height} (${actual.toFixed(3)}) but the ${concept.layoutStyle} layout requested ${expected.toFixed(3)}`,
      measured: actual,
      limit: expected,
    });
  }

  const grid = lumaGrid(image);

  // D4 — blank / degenerate.
  const globalStdev = stdev(grid.data);
  if (globalStdev < MIN_GLOBAL_STDEV) {
    findings.push({
      code: "blank-degenerate",
      critical: true,
      message: `artwork is effectively flat (luma stdev ${globalStdev.toFixed(2)})`,
      measured: globalStdev,
      limit: MIN_GLOBAL_STDEV,
    });
  }

  // D5 — flat bands / corruption.
  const band = longestFlatBand(grid);
  if (band > MAX_FLAT_BAND_FRACTION) {
    findings.push({
      code: "flat-bands",
      critical: true,
      message: `a flat band covers ${(band * 100).toFixed(1)}% of the long edge, which reads as corruption`,
      measured: band,
      limit: MAX_FLAT_BAND_FRACTION,
    });
  }

  // D6 — printed paper margin / generated card frame.
  const ring = uniformBorderRingFraction(grid);
  if (ring > MAX_MARGIN_RING_FRACTION) {
    findings.push({
      code: "printed-margin",
      critical: true,
      message: `the artwork draws its own ${(ring * 100).toFixed(1)}% uniform border — the renderer already frames the card`,
      measured: ring,
      limit: MAX_MARGIN_RING_FRACTION,
    });
  }

  // D7 — object-cover crop safety.
  const salientRegions = findSalientRegions(grid);
  const crop = evaluateCropSafety(concept.layoutStyle, image, salientRegions);
  if (!crop.safe) {
    findings.push({
      code: "crop-unsafe",
      critical: true,
      message: crop.issues[0]?.message ?? "the layout crop removes too much salient content",
      measured: crop.worstCroppedFraction,
      limit: 0.25,
    });
  }

  // D8 — the declared typography-safe region is actually quiet.
  const quiet = quietnessOfTypeRegion(grid, concept);
  if (!quiet.quiet) {
    findings.push({
      code: "quiet-region",
      critical: true,
      message:
        `placement "${concept.placementId}" has a rendered luma spread of ${quiet.spread.toFixed(0)} ` +
        `after ${concept.minOverlay} protection (raw ${quiet.rawSpread.toFixed(0)}), too busy for live invitation type`,
      measured: quiet.spread,
      limit: quiet.limit,
    });
  }

  // D9 — composited live-text contrast against the surface the type sits on.
  for (const [role, floor] of [
    ["headlineColor", 3.0],
    ["bodyColor", 4.5],
    ["accentColor", 4.5],
  ] as const) {
    const ratio = contrastRatio(concept.semanticPalette[role], concept.semanticPalette.textSurface);
    if (ratio < floor) {
      findings.push({
        code: "text-contrast",
        critical: true,
        message: `${role} is ${ratio.toFixed(2)}:1 against textSurface, below the ${floor}:1 floor`,
        measured: ratio,
        limit: floor,
      });
    }
  }

  // D10 — overlay coverage.
  if (input.overlayCoverage > 0.4) {
    findings.push({
      code: "overlay-coverage",
      critical: false,
      message: `the overlay covers ${(input.overlayCoverage * 100).toFixed(0)}% of the card`,
      measured: input.overlayCoverage,
      limit: 0.4,
    });
  }

  // D11 — layout-opacity sanity. A focal subject faded to invisibility is the
  // defect that passed every check the old gate had.
  if (input.artworkOpacity < 0.5) {
    const visibility = focalVisibilityAfterOpacity(grid, input.artworkOpacity, concept.semanticPalette.textSurface);
    if (visibility < MIN_FOCAL_VISIBILITY_RATIO) {
      findings.push({
        code: "layout-opacity",
        critical: true,
        message: `at ${input.artworkOpacity} opacity the artwork's focal region sits at ${visibility.toFixed(2)}:1 against the card surface — effectively erased`,
        measured: visibility,
        limit: MIN_FOCAL_VISIBILITY_RATIO,
      });
    }
  }

  // D12 — OCR for generated words, letters, numbers, logos and watermarks.
  if (input.ocr !== false) {
    const ocr = detectText(bytes);
    if (ocr.found) {
      findings.push({
        code: "text-detected",
        critical: true,
        message: `OCR read lettering in the artwork: ${ocr.tokens.slice(0, 5).join(", ")}`,
        measured: ocr.tokens.length,
      });
    }
  }

  return {
    passed: findings.every((f) => !f.critical),
    findings,
    image,
    salientRegions,
    durationMs: Date.now() - started,
  };
}

/* ── Individual measurements ─────────────────────────────────────────── */

interface Grid {
  width: number;
  height: number;
  data: Float32Array;
}

/** Longest run of near-identical consecutive rows or columns, as a fraction. */
export function longestFlatBand(grid: Grid): number {
  const rowRun = longestRun(grid.height, (i) => rowSignature(grid, i));
  const colRun = longestRun(grid.width, (i) => colSignature(grid, i));
  return Math.max(rowRun / grid.height, colRun / grid.width);
}

function rowSignature(grid: Grid, y: number): Float32Array {
  return grid.data.subarray(y * grid.width, (y + 1) * grid.width);
}

function colSignature(grid: Grid, x: number): Float32Array {
  const out = new Float32Array(grid.height);
  for (let y = 0; y < grid.height; y += 1) out[y] = grid.data[y * grid.width + x];
  return out;
}

function longestRun(count: number, get: (i: number) => Float32Array): number {
  let best = 0;
  let run = 1;
  for (let i = 1; i < count; i += 1) {
    const a = get(i - 1);
    const b = get(i);
    let diff = 0;
    for (let k = 0; k < a.length; k += 1) diff += Math.abs(a[k] - b[k]);
    if (diff / a.length < 0.75) {
      run += 1;
    } else {
      best = Math.max(best, run);
      run = 1;
    }
  }
  return Math.max(best, run);
}

/**
 * Thickness of a uniform, constant-colour ring around the whole perimeter, as
 * a fraction of the short edge. This is the printed-paper-margin detector.
 */
export function uniformBorderRingFraction(grid: Grid): number {
  const shortEdge = Math.min(grid.width, grid.height);
  const maxRing = Math.floor(shortEdge / 4);
  let thickness = 0;

  for (let r = 0; r < maxRing; r += 1) {
    const ring = ringPixels(grid, r);
    if (ring.length === 0) break;
    if (stdev(ring) > MARGIN_UNIFORMITY_STDEV) break;
    // The ring must also match the previous ones — a gradient is not a margin.
    if (r > 0) {
      const previous = ringPixels(grid, r - 1);
      if (Math.abs(mean(ring) - mean(previous)) > MARGIN_UNIFORMITY_STDEV) break;
    }
    thickness = r + 1;
  }
  return thickness / shortEdge;
}

function ringPixels(grid: Grid, r: number): Float32Array {
  const { width, height, data } = grid;
  if (r >= Math.floor(width / 2) || r >= Math.floor(height / 2)) return new Float32Array(0);
  const out: number[] = [];
  for (let x = r; x < width - r; x += 1) {
    out.push(data[r * width + x], data[(height - 1 - r) * width + x]);
  }
  for (let y = r + 1; y < height - r - 1; y += 1) {
    out.push(data[y * width + r], data[y * width + (width - 1 - r)]);
  }
  return Float32Array.from(out);
}

/**
 * Blocks in the top decile of local variance, merged into regions. "Salient"
 * here means "where the detail is", which is a good enough proxy for "what a
 * person would notice being cut off".
 */
export function findSalientRegions(grid: Grid, blocks = 12): SalientRegion[] {
  const bw = Math.max(1, Math.floor(grid.width / blocks));
  const bh = Math.max(1, Math.floor(grid.height / blocks));
  const scores: { x: number; y: number; score: number }[] = [];

  for (let by = 0; by + bh <= grid.height; by += bh) {
    for (let bx = 0; bx + bw <= grid.width; bx += bw) {
      const block: number[] = [];
      for (let y = by; y < by + bh; y += 1) {
        for (let x = bx; x < bx + bw; x += 1) block.push(grid.data[y * grid.width + x]);
      }
      scores.push({ x: bx, y: by, score: stdev(block) });
    }
  }
  if (scores.length === 0) return [];

  const sorted = [...scores].sort((a, b) => a.score - b.score);
  const median = sorted[Math.floor(sorted.length / 2)]?.score ?? 0;
  const threshold = Math.max(
    sorted[Math.floor(sorted.length * SALIENCE_TOP_DECILE)]?.score ?? 0,
    median * SALIENCE_MIN_RATIO,
  );
  if (threshold <= 0) return [];

  const salient = scores.filter((s) => s.score >= threshold);
  const merged = mergeAdjacent(salient, bw, bh);
  const totalArea = merged.reduce((sum, r) => sum + r.width * r.height, 0);
  if (totalArea <= 0) return [];

  return merged
    .filter((r) => (r.width * r.height) / totalArea >= MIN_MOTIF_SALIENCE_SHARE)
    .map((r) => ({
      x: r.x / grid.width,
      y: r.y / grid.height,
      width: r.width / grid.width,
      height: r.height / grid.height,
    }));
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Groups touching salient blocks into one motif and returns each motif's
 * bounding box. Without this a single block of background texture is its own
 * "region", and a layout that legitimately crops that texture away is judged
 * to have clipped a motif.
 */
function mergeAdjacent(blocks: { x: number; y: number }[], bw: number, bh: number): Box[] {
  const key = (x: number, y: number) => `${x},${y}`;
  const remaining = new Map(blocks.map((b) => [key(b.x, b.y), b]));
  const regions: Box[] = [];

  while (remaining.size > 0) {
    const [firstKey, first] = remaining.entries().next().value as [string, { x: number; y: number }];
    remaining.delete(firstKey);
    const queue = [first];
    let minX = first.x;
    let minY = first.y;
    let maxX = first.x;
    let maxY = first.y;

    while (queue.length > 0) {
      const cell = queue.pop()!;
      minX = Math.min(minX, cell.x);
      minY = Math.min(minY, cell.y);
      maxX = Math.max(maxX, cell.x);
      maxY = Math.max(maxY, cell.y);
      for (const [dx, dy] of [
        [bw, 0],
        [-bw, 0],
        [0, bh],
        [0, -bh],
      ]) {
        const neighbourKey = key(cell.x + dx, cell.y + dy);
        const neighbour = remaining.get(neighbourKey);
        if (neighbour) {
          remaining.delete(neighbourKey);
          queue.push(neighbour);
        }
      }
    }

    regions.push({ x: minX, y: minY, width: maxX - minX + bw, height: maxY - minY + bh });
  }

  return regions;
}

/** Luma spread inside the exact inherited placement the renderer uses. */
export function quietnessOfTypeRegion(
  grid: Grid,
  concept: AiFirstConcept,
): { quiet: boolean; spread: number; rawSpread: number; limit: number } {
  const frame = typePlacementFrame(concept);
  const x0 = Math.floor((frame.left / 100) * grid.width);
  const x1 = Math.min(grid.width, Math.ceil(((frame.left + frame.width) / 100) * grid.width));
  const y0 = Math.floor((frame.top / 100) * grid.height);
  const y1 = Math.min(grid.height, Math.ceil(((frame.top + frame.height) / 100) * grid.height));

  const values: number[] = [];
  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) values.push(grid.data[y * grid.width + x]);
  }
  if (values.length === 0) return { quiet: true, spread: 0, rawSpread: 0, limit: 0 };

  values.sort((a, b) => a - b);
  const p2 = values[Math.floor(values.length * 0.02)];
  const p98 = values[Math.min(values.length - 1, Math.floor(values.length * 0.98))];
  const rawSpread = p98 - p2;
  const surfaceAlpha = LOCAL_TYPE_SURFACE_ALPHA[concept.minOverlay];
  // A uniform surface colour shifts every pixel by the same amount, so its
  // luma spread is attenuated exactly by the remaining artwork opacity.
  const spread = rawSpread * (1 - surfaceAlpha);
  const limit = surfaceAlpha > 0
    ? MAX_RENDERED_TYPE_REGION_LUMA_SPREAD
    : MAX_UNPROTECTED_TYPE_REGION_LUMA_SPREAD;
  return { quiet: spread <= limit, spread, rawSpread, limit };
}

/**
 * Contrast between the artwork's most salient area and the card surface AFTER
 * the layout's opacity is applied — i.e. what a person actually sees.
 */
export function focalVisibilityAfterOpacity(grid: Grid, opacity: number, surfaceHex: string): number {
  const values = Array.from(grid.data).sort((a, b) => a - b);
  const dark = values[Math.floor(values.length * 0.05)];
  const light = values[Math.floor(values.length * 0.95)];
  const surface = parseInt(surfaceHex.replace("#", ""), 16);
  const surfaceLuma =
    0.2126 * ((surface >> 16) & 255) + 0.7152 * ((surface >> 8) & 255) + 0.0722 * (surface & 255);

  // Compositing artwork at `opacity` over the surface.
  const blend = (v: number) => Math.round(v * opacity + surfaceLuma * (1 - opacity));
  const toHex = (v: number) => `#${v.toString(16).padStart(2, "0").repeat(3)}`;
  const compositedDark = toHex(Math.max(0, Math.min(255, blend(dark))));
  const compositedLight = toHex(Math.max(0, Math.min(255, blend(light))));

  return contrastRatio(compositedDark, compositedLight);
}

/* ── OCR ─────────────────────────────────────────────────────────────── */

export interface OcrResult {
  found: boolean;
  tokens: string[];
  /** True when no OCR engine was available, so this check did not run. */
  skipped: boolean;
}

/**
 * Shells out to Tesseract at two scales. Deliberately not a dependency: if the
 * binary is missing the check reports `skipped` and the Tier 2 vision pass
 * still scores `text_free`, so a missing engine degrades the gate rather than
 * breaking it.
 */
export function detectText(bytes: Buffer): OcrResult {
  let dir: string | null = null;
  try {
    dir = mkdtempSync(join(tmpdir(), "posy-ocr-"));
    const file = join(dir, "art.png");
    writeFileSync(file, bytes);

    const tokens = new Set<string>();
    for (const psm of ["11", "6"]) {
      let tsv: string;
      try {
        tsv = execFileSync("tesseract", [file, "stdout", "--psm", psm, "tsv"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 20_000,
        });
      } catch {
        return { found: false, tokens: [], skipped: true };
      }
      for (const line of tsv.split("\n").slice(1)) {
        const cols = line.split("\t");
        if (cols.length < 12) continue;
        const confidence = parseFloat(cols[10]);
        const text = (cols[11] || "").trim();
        if (!Number.isFinite(confidence) || confidence < OCR_MIN_CONFIDENCE) continue;
        const alnum = text.replace(/[^A-Za-z0-9]/g, "");
        if (alnum.length >= MIN_OCR_TOKEN_LENGTH) tokens.add(text);
      }
    }
    return { found: tokens.size > 0, tokens: Array.from(tokens), skipped: false };
  } catch {
    return { found: false, tokens: [], skipped: true };
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

/** Maps Tier 1 findings onto the retry-remedy vocabulary. */
export function retryCodesFor(findings: Tier1Finding[]): string[] {
  return Array.from(new Set(findings.map((f) => f.code)));
}

export { readPngSize };

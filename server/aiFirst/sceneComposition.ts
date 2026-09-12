/**
 * Private design-system prototype. There is deliberately no customer route,
 * automatic asset selection, or quality-approved persistence marker here.
 *
 * Assets and recipes must come from a server-owned, human-reviewed registry,
 * never a request body. Hashes prevent changed assets/briefs being passed off
 * as reviewed ones; they do NOT establish licensing rights or visual quality.
 * The complete resulting 560px teaser still needs the existing quality gate.
 */
import { createHash } from "node:crypto";
import type { EventBrief } from "./brief";
import { decodePng, encodePng, readPngSize } from "./png";

export interface SceneAsset {
  id: string;
  /** Unmatted 8-bit RGB PNG; optional separate alpha mask avoids white halos. */
  png: Buffer;
  alpha?: Uint8Array;
  certificate: {
    digest: string;
    styleId: string;
    reviewer: string;
    /** Reference to an ownership/license record, not a claim inferred by AI. */
    rightsRecord: string;
    ownerScope: string | null;
    namedThemeId: string | null;
    /** Exact brief requirements a human established this asset can represent. */
    requirements: string[];
  };
}

export interface SceneRecipe {
  id: string;
  styleId: string;
  /** Bind ALL event facts, including preferred details and exclusions. */
  briefDigest: string;
  namedThemeId: string | null;
  width: number;
  height: number;
  /** Back-to-front order. Fit without crop or distortion in normalized boxes. */
  layers: Array<{
    assetId: string;
    role: "background" | "hero" | "support";
    box: { x: number; y: number; width: number; height: number };
    requirements: string[];
  }>;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value).filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, v]) => `${JSON.stringify(key)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export const sceneBriefDigest = (brief: EventBrief): string =>
  createHash("sha256").update(canonical(brief)).digest("hex");

export const sceneAssetDigest = (png: Buffer, alpha?: Uint8Array): string =>
  createHash("sha256").update(png).update(alpha ?? new Uint8Array()).digest("hex");

const MAX_PIXELS = 4_000_000;
function dimensions(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width * height > MAX_PIXELS) throw new Error("Invalid scene dimensions");
}

/** No network, generation, caching, personal-asset sharing, or implicit fallback. */
export function composeScenePrototype(input: {
  brief: EventBrief;
  namedThemeId: string | null;
  ownerScope: string;
  recipe: SceneRecipe;
  assets: readonly SceneAsset[];
}): { kind: "unreviewed-composite"; bytes: Buffer; recipeId: string; briefDigest: string } {
  const { brief, recipe } = input;
  dimensions(recipe.width, recipe.height);
  if (!recipe.id || !recipe.styleId || recipe.layers.length < 1 || recipe.layers.length > 12) {
    throw new Error("Invalid scene recipe");
  }
  const digest = sceneBriefDigest(brief);
  if (recipe.briefDigest !== digest) throw new Error("Recipe does not match the complete current brief");
  if (recipe.namedThemeId !== input.namedThemeId) throw new Error("Named theme mismatch");
  if (new Set(input.assets.map((a) => a.id)).size !== input.assets.length ||
      new Set(recipe.layers.map((a) => a.assetId)).size !== recipe.layers.length) {
    throw new Error("Duplicate scene asset");
  }
  const assets = new Map(input.assets.map((asset) => [asset.id, asset]));
  const covered = new Set<string>();
  const rgb = new Uint8Array(recipe.width * recipe.height * 3);
  const topLayer = new Int16Array(recipe.width * recipe.height).fill(-1);
  const painted = recipe.layers.map(() => 0);

  recipe.layers.forEach((layer, index) => {
    const asset = assets.get(layer.assetId);
    if (!asset) throw new Error(`Missing reviewed asset: ${layer.assetId}`);
    const cert = asset.certificate;
    if (!cert.reviewer.trim() || !cert.rightsRecord.trim()) throw new Error("Asset lacks approval provenance");
    if (cert.ownerScope !== null && cert.ownerScope !== input.ownerScope) throw new Error("Private asset owner mismatch");
    if (cert.styleId !== recipe.styleId) throw new Error("Mixed art directions are not certified");
    if (cert.namedThemeId !== null && cert.namedThemeId !== input.namedThemeId) throw new Error("Asset identity mismatch");
    if (cert.digest !== sceneAssetDigest(asset.png, asset.alpha)) throw new Error("Reviewed asset bytes changed");
    const size = readPngSize(asset.png);
    if (!size) throw new Error("Invalid scene asset PNG");
    dimensions(size.width, size.height);
    // Transparent providers should export a separate reviewed mask. decodePng
    // otherwise flattens RGBA to white, which would create composite halos.
    if (asset.png[25] !== 2) throw new Error("Scene asset requires unmatted RGB PNG");
    if (asset.alpha && asset.alpha.length !== size.width * size.height) throw new Error("Invalid asset alpha mask");
    const box = layer.box;
    if (![box.x, box.y, box.width, box.height].every(Number.isFinite) ||
        box.x < 0 || box.y < 0 || box.width <= 0 || box.height <= 0 ||
        box.x + box.width > 1 || box.y + box.height > 1) throw new Error("Scene layer would crop outside canvas");
    if (layer.role !== "background" && (box.x < .04 || box.y < .04 ||
        box.x + box.width > .96 || box.y + box.height > .96)) throw new Error("Scene subject lacks safe framing");
    if (index === 0 && (layer.role !== "background" || box.x !== 0 || box.y !== 0 || box.width !== 1 || box.height !== 1 ||
        size.width * recipe.height !== size.height * recipe.width || asset.alpha)) {
      throw new Error("Scene needs one opaque native-ratio full-bleed background");
    }
    if (index > 0 && layer.role === "background") throw new Error("Duplicate background");
    for (const requirement of layer.requirements) {
      if (!brief.requirements.required.includes(requirement) || !cert.requirements.includes(requirement)) {
        throw new Error("Uncertified or invented visual requirement");
      }
      covered.add(requirement);
    }
    const source = decodePng(asset.png);
    const scale = Math.min(box.width * recipe.width / source.width, box.height * recipe.height / source.height);
    if (scale > 1.001) throw new Error("Scene asset resolution is insufficient");
    const width = Math.max(1, Math.round(source.width * scale));
    const height = Math.max(1, Math.round(source.height * scale));
    const x0 = Math.round((box.x + box.width / 2) * recipe.width - width / 2);
    const y0 = Math.round((box.y + box.height / 2) * recipe.height - height / 2);
    const teaserScale = 560 / Math.max(recipe.width, recipe.height);
    if (layer.requirements.length && Math.min(width, height) * teaserScale < 32) throw new Error("Required scene detail is too small in the teaser");

    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const sx = Math.max(0, Math.min(source.width - 1, (x + .5) / scale - .5));
      const sy = Math.max(0, Math.min(source.height - 1, (y + .5) / scale - .5));
      const left = Math.floor(sx), top = Math.floor(sy);
      const fx = sx - left, fy = sy - top;
      let alpha = 0;
      const premultiplied = [0, 0, 0];
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const pos = Math.min(top + dy, source.height - 1) * source.width + Math.min(left + dx, source.width - 1);
        const weight = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy) * (asset.alpha ? asset.alpha[pos] / 255 : 1);
        alpha += weight;
        for (let c = 0; c < 3; c++) premultiplied[c] += source.rgb[pos * 3 + c] * weight;
      }
      const dest = (y0 + y) * recipe.width + x0 + x;
      for (let c = 0; c < 3; c++) rgb[dest * 3 + c] = Math.round(premultiplied[c] + rgb[dest * 3 + c] * (1 - alpha));
      if (alpha >= .5) { topLayer[dest] = index; painted[index]++; }
    }
  });
  if (brief.requirements.required.some((requirement) => !covered.has(requirement))) throw new Error("Recipe omits required brief details");
  const visible = recipe.layers.map(() => 0);
  for (let pixel = 0; pixel < topLayer.length; pixel++) {
    const index = topLayer[pixel];
    if (index >= 0) visible[index]++;
  }
  recipe.layers.forEach((layer, index) => {
    if (layer.requirements.length && (painted[index] === 0 || visible[index] / painted[index] < .6)) {
      throw new Error("Required scene detail is transparent or obscured");
    }
  });
  return { kind: "unreviewed-composite", bytes: encodePng({ width: recipe.width, height: recipe.height, rgb }),
    recipeId: recipe.id, briefDigest: digest };
}

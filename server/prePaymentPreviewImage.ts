import { boxDownsampleRgb, decodePng, encodePng } from "./aiFirst/png";
import { PRE_PAYMENT_PREVIEW_LONG_EDGE } from "./prePaymentPreview";

export type PreviewImageProfile = "legacy" | "detail-v1";
export const DETAIL_PREVIEW_LONG_EDGE = 1536;
export const DETAIL_PREVIEW_MAX_BYTES = 4_000_000;
const STANDARD_PREFIX = "data:image/png;base64,";
const PREFIXES: Record<PreviewImageProfile, string> = {
  legacy: "data:image/png;posy-quality-approved;base64,",
  "detail-v1": "data:image/png;posy-quality-approved-detail-v1;base64,",
};

/** The persisted approval version binds review and delivery to one transform.
 * Existing approvals retain their original 560px pixels; never upgrade them
 * silently to a resolution that their gate did not inspect. */
export function readApprovedPreview(value: string | null | undefined): {
  payload: string; profile: PreviewImageProfile;
} | null {
  for (const profile of ["legacy", "detail-v1"] as const) {
    if (value?.startsWith(PREFIXES[profile])) {
      const payload = value.slice(PREFIXES[profile].length);
      return payload ? { payload, profile } : null;
    }
  }
  return null;
}

export function markApprovedPreview(value: string, profile: PreviewImageProfile = "legacy"): string | null {
  if (profile !== "legacy" && profile !== "detail-v1") return null;
  const existing = readApprovedPreview(value);
  if (existing) return existing.profile === profile ? value : null;
  if (!value.startsWith(STANDARD_PREFIX)) return null;
  const payload = value.slice(STANDARD_PREFIX.length);
  return payload ? `${PREFIXES[profile]}${payload}` : null;
}

export function previewImageBytes(source: Buffer, profile: PreviewImageProfile = "legacy"): Buffer {
  if (profile !== "legacy" && profile !== "detail-v1") throw new Error("Unknown preview image profile");
  const original = decodePng(source);
  if (profile === "legacy") return encodePng(boxDownsampleRgb(original, PRE_PAYMENT_PREVIEW_LONG_EDGE));
  // Sub filtering reduces transfer bytes losslessly. It does not sharpen,
  // hallucinate detail, upscale a small source, or change decoded pixels.
  // Exceptionally noisy square images can exceed function response limits.
  // Both the reviewer and GET route use the same bounded, deterministic
  // fallback, always sampling the original rather than a previous resize.
  for (const longEdge of [DETAIL_PREVIEW_LONG_EDGE, 1280, 1024]) {
    const bytes = encodePng(boxDownsampleRgb(original, longEdge), "sub");
    if (bytes.length <= DETAIL_PREVIEW_MAX_BYTES) return bytes;
  }
  throw new Error("Preview image exceeds delivery limit");
}

export function browserRenderablePreviewUrl(value: string): string {
  const approved = readApprovedPreview(value);
  return approved ? `${STANDARD_PREFIX}${approved.payload}` : value;
}

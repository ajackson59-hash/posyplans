/** Analysis views only. Never replace, repaint, resize or approve the artwork. */
import { createHash } from "node:crypto";
import { decodePng, encodePng, readPngSize, type DecodedImage } from "./png";

export interface PixelRegion { x: number; y: number; width: number; height: number }
const hash = (v: Buffer | Uint8Array) => createHash("sha256").update(v).digest("hex");
export function boundedReviewImage(bytes: Buffer) {
  const size = readPngSize(bytes);
  if (bytes.length > 4_000_000 || !size || size.width < 1 || size.height < 1 ||
      size.width > 1536 || size.height > 1536) throw Error("detail-source-format");
  return decodePng(bytes);
}

/** Copies decoded RGB samples; no interpolation or enhancement. PNG decoding
 * uses the existing gate's white alpha composite. The original bytes stay intact. */
export function copyReviewRegion(image: DecodedImage, region: PixelRegion) {
  const { x, y, width, height } = region;
  if (![x, y, width, height].every(Number.isSafeInteger) || x < 0 || y < 0 ||
      width < 1 || height < 1 || x + width > image.width || y + height > image.height)
    throw Error("detail-region-outside-source");
  const rgb = new Uint8Array(width * height * 3);
  for (let row = 0; row < height; row++) {
    const start = ((y + row) * image.width + x) * 3;
    rgb.set(image.rgb.subarray(start, start + width * 3), row * width * 3);
  }
  return { width, height, rgb };
}

/** A fixed overlapping grid covers the ENTIRE image, independently of subject,
 * brief, expected answer, prior failure or model-produced region selection. */
export function prepareReviewDetailViews(bytes: Buffer) {
  const source = boundedReviewImage(bytes), sourceHash = hash(bytes);
  const width = Math.ceil(source.width * 0.6), height = Math.ceil(source.height * 0.6);
  const regions = Math.max(source.width, source.height) <= 768 ? [] : [
    { x: 0, y: 0, width, height }, { x: source.width - width, y: 0, width, height },
    { x: 0, y: source.height - height, width, height },
    { x: source.width - width, y: source.height - height, width, height },
  ];
  return regions.map((region, index) => {
    const pixels = copyReviewRegion(source, region), detail = encodePng(pixels, "sub");
    return { id: `candidate-detail-${index + 1}`, bytes: detail, sourceHash, region,
      sourceWidth: source.width, sourceHeight: source.height,
      sha256: hash(detail), decodedRgbSha256: hash(pixels.rgb), transformation: "native-rgb-region" as const };
  });
}

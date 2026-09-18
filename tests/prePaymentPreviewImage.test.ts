import { describe, expect, it } from "vitest";
import { decodePng, encodePng, readPngSize } from "../server/aiFirst/png";
import { browserRenderablePreviewUrl, DETAIL_PREVIEW_MAX_BYTES, markApprovedPreview, previewImageBytes, readApprovedPreview } from "../server/prePaymentPreviewImage";

function source(width: number, height: number) {
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < rgb.length; i++) rgb[i] = (i * 31 + Math.floor(i / 97)) % 256;
  return { rgb, width, height };
}

describe("versioned preview pixels", () => {
  it("preserves every decoded sample under lossless Sub filtering, including row boundaries and byte wrap", () => {
    const original = source(17, 19);
    const encoded = encodePng(original, "sub");
    expect(Buffer.from(decodePng(encoded).rgb).equals(Buffer.from(original.rgb))).toBe(true);
    expect(readPngSize(encoded)).toEqual({ width: 17, height: 19 });
  });

  it.each([[1024, 1536], [1536, 1024], [640, 640]])("keeps existing %ix%i source detail without upscaling", (width, height) => {
    const original = source(width, height);
    const output = previewImageBytes(encodePng(original), "detail-v1");
    expect(readPngSize(output)).toEqual({ width, height });
    expect(Buffer.from(decodePng(output).rgb).equals(Buffer.from(original.rgb))).toBe(true);
  });

  it("caps a larger portrait proportionally while retaining the historical transform independently", () => {
    const png = encodePng(source(1152, 2048));
    expect(readPngSize(previewImageBytes(png, "detail-v1"))).toEqual({ width: 864, height: 1536 });
    expect(readPngSize(previewImageBytes(png))).toEqual({ width: 315, height: 560 });
    expect(readPngSize(previewImageBytes(png, "legacy"))).toEqual({ width: 315, height: 560 });
  });

  it("bounds a poorly compressible square to a deliverable payload deterministically", () => {
    const image = source(1536, 1536);
    let state = 123456789;
    for (let i = 0; i < image.rgb.length; i++) {
      state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
      image.rgb[i] = state & 255;
    }
    const png = encodePng(image);
    const result = previewImageBytes(png, "detail-v1");
    expect(result.length).toBeLessThanOrEqual(DETAIL_PREVIEW_MAX_BYTES);
    const size = readPngSize(result);
    expect(size.width).toBe(size.height);
    expect(size.width).toBeLessThan(1536);
    expect(previewImageBytes(png, "detail-v1").equals(result)).toBe(true);
  }, 15_000);

  it.each(["legacy", "detail-v1"] as const)("retains the %s approval profile and original paid bytes", profile => {
    const dataUrl = `data:image/png;base64,${encodePng(source(17, 19)).toString("base64")}`;
    const approved = markApprovedPreview(dataUrl, profile)!;
    expect(readApprovedPreview(approved)).toEqual({ profile, payload: dataUrl.split(",")[1] });
    expect(browserRenderablePreviewUrl(approved)).toBe(dataUrl);
    expect(markApprovedPreview(approved, profile)).toBe(approved);
    expect(markApprovedPreview(approved, profile === "legacy" ? "detail-v1" : "legacy")).toBeNull();
  });

  it("does not interpret unapproved images, empty approvals or unknown profiles as approved artwork", () => {
    for (const value of ["data:image/png;base64,AAAA", "data:image/png;posy-quality-approved;base64,",
      "data:image/png;posy-quality-approved-detail-v2;base64,AAAA"]) expect(readApprovedPreview(value)).toBeNull();
    expect(markApprovedPreview("data:image/png;base64,AAAA", "toString" as never)).toBeNull();
    expect(() => previewImageBytes(Buffer.alloc(0), "unknown" as never)).toThrow("Unknown preview image profile");
  });
});

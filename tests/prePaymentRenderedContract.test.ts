import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Customer-visible release contract for the pre-payment first look.
 * These assertions intentionally inspect the production page source rather
 * than mocking <img> behavior: the browser must never crop a reviewed asset,
 * and raw artwork must not be covered by a sales gradient/text overlay after
 * the private quality gate has already approved its pixels.
 */
describe("pre-payment rendered first-look contract", () => {
  const source = readFileSync("client/src/pages/DraftGenerating.tsx", "utf8");

  it("renders completed first-look assets at their native aspect ratio", () => {
    const imageBlock = source.match(/<img[\s\S]*?data-testid="img-prepayment-preview"[\s\S]*?\/>/)?.[0] ?? "";
    expect(imageBlock).toContain("w-full");
    expect(imageBlock).toContain("h-auto");
    expect(imageBlock).not.toMatch(/object-cover|aspect-square|aspect-\[9\/16\]/);
  });

  it("does not add a browser sales overlay on top of privately reviewed artwork", () => {
    const readyBranch = source.match(/previewReady && !previewImageFailed[\s\S]*?: previewInProgress/)?.[0] ?? "";
    expect(readyBranch).not.toContain("bg-gradient-to-t");
    expect(readyBranch).not.toContain("A first look, made from your details");
    expect(readyBranch).not.toContain("Unlock your complete plan and full invitation designs");
  });

  it("keeps the generation state useful instead of an empty artwork box", () => {
    expect(source).toContain("Creating your personalized first look");
    expect(source).toMatch(/finding the right visual references|reviewing the artwork privately/i);
  });
});

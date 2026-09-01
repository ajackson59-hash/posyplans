import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Customer-visible release contract for the pre-payment first look.
 * These assertions intentionally inspect the production page source rather
 * than mocking <img> behavior: the browser must never crop a reviewed asset,
 * raw artwork must not be covered by a sales overlay after private approval,
 * and a host should see immediate proof that Posy understood the event while
 * slower artwork work continues in the background.
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

  it("shows event-specific understanding immediately while artwork is generating", () => {
    expect(source).toMatch(/directionCard\??:/);
    const progressBranch = source.match(/previewInProgress \? \([\s\S]*?\) : previewCouldNotBeShown/)?.[0] ?? "";
    expect(progressBranch).toMatch(/directionCard/);
    expect(progressBranch).toMatch(/headline|cues|eventName/);
    expect(progressBranch).toContain("Creating your personalized first look");
  });
});

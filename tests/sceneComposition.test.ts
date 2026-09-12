import { describe, expect, it } from "vitest";
import type { Event } from "@shared/schema";
import { buildQualityLockedPreviewBrief, customerVisiblePreviewBytes } from "../server/prePaymentPreviewQuality";
import { composeScenePrototype, sceneAssetDigest, sceneBriefDigest, type SceneAsset, type SceneRecipe } from "../server/aiFirst/sceneComposition";
import { decodePng, encodePng, readPngSize } from "../server/aiFirst/png";

// These deliberately plain engineering fixtures are NOT approved customer art.
// They establish deterministic pixels and contract enforcement, not aesthetics.
const briefs = [
  ["Brian's fourth birthday", "Blippi and Meekah dancing at indoor soft play. Include a large ball pit, foam climbing structures, visible bubbles and an ice-cream station. No candles or invented child."],
  ["Hayden's birthday", "Unicorn Academy riders and bonded unicorns inside a glowing snowy igloo."],
  ["Performance party", "KPop Demon Hunters with the distinct heroine trio and supernatural stage lighting."],
  ["Grayson's birthday", "Construction party with a crane, excavator and a sand play area. No candles."],
  ["Garden at dusk", "An elegant adult dinner with terracotta flowers, linen and warm candlelight."],
];

async function fixture(name = briefs[0][0], vibe = briefs[0][1]) {
  const { brief, namedReference } = await buildQualityLockedPreviewBrief({
    eventName: name, vibeDescription: vibe, eventType: "Celebration", themeName: "",
    eventDate: "Saturday, November 7, 2026", paletteColors: "[]", estimatedGuestCount: 20,
  } as Event);
  const png = encodePng({ width: 400, height: 600, rgb: new Uint8Array(400 * 600 * 3).fill(210) });
  const asset: SceneAsset = {
    id: "engineering-fixture", png,
    certificate: { digest: sceneAssetDigest(png), styleId: "fixture-only", reviewer: "fixture-reviewer",
      rightsRecord: "locally-created-test-pixels", ownerScope: null, namedThemeId: namedReference?.id ?? null,
      requirements: [...brief.requirements.required] },
  };
  const recipe: SceneRecipe = {
    id: "fixture-layout", styleId: "fixture-only", briefDigest: sceneBriefDigest(brief),
    namedThemeId: namedReference?.id ?? null, width: 400, height: 600,
    layers: [{ assetId: asset.id, role: "background", box: { x: 0, y: 0, width: 1, height: 1 }, requirements: [...brief.requirements.required] }],
  };
  return { brief, recipe, namedThemeId: namedReference?.id ?? null, ownerScope: "owner-a", assets: [asset] };
}

describe("private design-led scene composition prototype", () => {
  it.each(briefs)("preserves the full brief and deterministic native pixels: %s", async (name, vibe) => {
    const input = await fixture(name, vibe);
    const first = composeScenePrototype(input);
    const second = composeScenePrototype(input);
    expect(first.kind).toBe("unreviewed-composite");
    expect(first.bytes.equals(second.bytes)).toBe(true);
    expect(readPngSize(first.bytes)).toEqual({ width: 400, height: 600 });
    expect(readPngSize(customerVisiblePreviewBytes(first.bytes))).toEqual({ width: 373, height: 560 });
    expect(first).not.toHaveProperty("dataUrl");
    expect(first).not.toHaveProperty("approved");
  });

  it.each(["vibe", "themeName", "dateLine", "eventName", "inspirationNotes"] as const)("rejects stale recipes after changing %s", async (field) => {
    const input = await fixture();
    input.brief[field] += " changed";
    expect(() => composeScenePrototype(input)).toThrow("complete current brief");
  });

  it.each(["required", "preferred", "excluded"] as const)("does not drop changed %s requirements", async (field) => {
    const input = await fixture();
    input.brief.requirements[field].push("New host instruction");
    expect(() => composeScenePrototype(input)).toThrow("complete current brief");
  });

  it("rejects missing details instead of substituting a generic scene", async () => {
    const input = await fixture();
    input.recipe.layers[0].requirements = [];
    expect(() => composeScenePrototype(input)).toThrow("omits required brief details");
  });

  it("does not let a recipe invent certificates for an asset", async () => {
    const input = await fixture();
    input.assets[0].certificate.requirements = [];
    expect(() => composeScenePrototype(input)).toThrow("Uncertified or invented");
  });

  it.each(["theme", "owner", "style", "rights", "reviewer", "bytes"])("rejects invalid asset provenance: %s", async (failure) => {
    const input = await fixture();
    const asset = input.assets[0];
    if (failure === "theme") asset.certificate.namedThemeId = "a-different-show";
    if (failure === "owner") asset.certificate.ownerScope = "owner-b";
    if (failure === "style") asset.certificate.styleId = "unrelated-photo-style";
    if (failure === "rights") asset.certificate.rightsRecord = "";
    if (failure === "reviewer") asset.certificate.reviewer = "";
    if (failure === "bytes") asset.png = Buffer.from("unapproved replacement");
    expect(() => composeScenePrototype(input)).toThrow();
  });

  it("requires the exact named theme even if assets are generic", async () => {
    const input = await fixture();
    input.namedThemeId = "different-theme";
    expect(() => composeScenePrototype(input)).toThrow("Named theme mismatch");
  });

  it("contains a subject without cropping or stretching, leaving its source bytes unchanged", async () => {
    const input = await fixture();
    const png = encodePng({ width: 100, height: 200, rgb: new Uint8Array(100 * 200 * 3).fill(70) });
    const subject: SceneAsset = { id: "subject", png, certificate: {
      ...input.assets[0].certificate, digest: sceneAssetDigest(png), requirements: [],
    } };
    input.assets.push(subject);
    input.recipe.layers.push({ assetId: "subject", role: "hero", box: { x: .25, y: .25, width: .5, height: .5 }, requirements: [] });
    // Source isn't large enough for the requested box; fail rather than upscale.
    expect(() => composeScenePrototype(input)).toThrow("resolution is insufficient");
    input.recipe.layers[1].box = { x: .25, y: .25, width: .25, height: 1 / 3 };
    const result = decodePng(composeScenePrototype(input).bytes);
    expect(result.rgb[(150 * 400 + 100) * 3]).toBe(70);
    expect(result.rgb[(150 * 400 + 99) * 3]).toBe(210);
    expect(sceneAssetDigest(subject.png)).toBe(subject.certificate.digest);
  });

  it.each(["cropped", "tiny", "transparent", "obscured"])("rejects a required subject that is %s", async (failure) => {
    const input = await fixture();
    const required = input.recipe.layers[0].requirements.pop()!;
    const png = encodePng({ width: 200, height: 200, rgb: new Uint8Array(200 * 200 * 3).fill(70) });
    const alpha = failure === "transparent" ? new Uint8Array(200 * 200) : undefined;
    input.assets.push({ id: "subject", png, alpha, certificate: { ...input.assets[0].certificate,
      digest: sceneAssetDigest(png, alpha), requirements: [required] } });
    input.recipe.layers.push({ assetId: "subject", role: "hero", box: { x: .25, y: .25, width: .5, height: 1 / 3 }, requirements: [required] });
    if (failure === "cropped") input.recipe.layers[1].box.x = .95;
    if (failure === "tiny") input.recipe.layers[1].box = { x: .25, y: .25, width: .01, height: .01 };
    if (failure === "obscured") {
      input.assets.push({ ...input.assets[1], id: "occluder" });
      input.recipe.layers.push({ ...input.recipe.layers[1], assetId: "occluder", requirements: [] });
    }
    expect(() => composeScenePrototype(input)).toThrow();
  });
});

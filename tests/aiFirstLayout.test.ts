// Layout compatibility and palette normalization.
//
// Both run before a customer sees anything, and both are constrained the same
// way: they may repair the AI concept, never the eight studio templates. Every
// test here checks the repair happened AND that it stayed inside that boundary.

import { describe, expect, it } from "vitest";
import {
  BACKDROP_RESCUE_OPACITY,
  MAX_OVERLAY_COVERAGE,
  OVERLAY_COVERAGE,
  MAX_SALIENT_CROP_FRACTION,
  MIN_SAFE_TYPE_PLACEMENT_COVERAGE,
  canonicalSafeTypographyRegion,
  canonicalTypeGeometry,
  evaluateCropSafety,
  safeTypographyPlacementCoverage,
  strongerOverlay,
  validateLayoutBeforeGeneration,
} from "@shared/aiFirstLayout";
import {
  FRAME_MINIMUM_CONTRAST,
  INVISIBLE_CONTRAST_CEILING,
  ROLE_MINIMUM_CONTRAST,
  contrastRatio,
  hasInvisibleDetail,
  normalizeRole,
  normalizeSemanticPalette,
} from "@shared/aiFirstPalette";
import { LAUNCH_THEMES } from "@shared/themeCatalog";
import { LAYOUT_FRAMES } from "@shared/inviteLayout";
import { concept } from "./aiFirstFixtures";
import { bindConceptsToBrief } from "../server/aiFirst/conceptBindings";
import { buildEventBrief } from "../server/aiFirst/brief";
import type { Event } from "@shared/schema";

const art = (over: Partial<{ medium: string; composition: string; prompt: string }>) => ({
  medium: "watercolor",
  composition: "single off-centre focal subject",
  prompt: "A dusk garden painted loosely in watercolour.",
  ...over,
});

describe("layout — before generation", () => {
  it("leaves a compatible concept completely alone", () => {
    const repair = validateLayoutBeforeGeneration(concept({ focalStrategy: "iconic-detail" }));
    expect(repair.clean).toBe(true);
    expect(repair.issues).toEqual([]);
    expect(repair.layoutStyle).toBe("full-bleed");
    expect(repair.artworkOpacity).toBeUndefined();
  });

  it("gives a full-bleed narrative scene a solid paper panel before any provider spend", () => {
    const repair = validateLayoutBeforeGeneration(
      concept({ layoutStyle: "full-bleed", focalStrategy: "narrative-scene", minOverlay: "veil" }),
    );

    expect(repair.overlay).toBe("plate");
    expect(repair.issues).toContainEqual(expect.objectContaining({
      code: "art-behind-type-needs-local-surface",
      repair: "strengthen-overlay",
    }));
  });

  it("rescues a focal subject that a backdrop's 30% would erase", () => {
    const repair = validateLayoutBeforeGeneration(
      concept({ layoutStyle: "backdrop", art: art({ composition: "a single focal subject, centred" }) }),
    );
    expect(repair.issues.map((i) => i.code)).toContain("backdrop-erases-focal-subject");
    expect(repair.artworkOpacity).toBe(BACKDROP_RESCUE_OPACITY);
    // The rescue is a per-concept override, not a template change.
    expect(LAYOUT_FRAMES.backdrop.artOpacity).toBe(0.3);
  });

  it("leaves a backdrop alone when the art is a field, which survives 30%", () => {
    const repair = validateLayoutBeforeGeneration(
      concept({
        layoutStyle: "backdrop",
        minOverlay: "veil",
        art: art({ composition: "an all-over scattered pattern of small motifs" }),
      }),
    );
    expect(repair.issues.map((i) => i.code)).not.toContain("backdrop-erases-focal-subject");
    expect(repair.artworkOpacity).toBeUndefined();
  });

  it("moves wide artwork off the split layout's tall panel", () => {
    const repair = validateLayoutBeforeGeneration(
      concept({ layoutStyle: "split", art: art({ composition: "a wide panoramic horizon" }) }),
    );
    expect(repair.issues.map((i) => i.code)).toContain("split-art-not-panel-shaped");
    expect(repair.layoutStyle).toBe("banner");
  });

  it("canonicalizes type after a deterministic split-to-banner repair", () => {
    const wideSplit = concept({
      layoutStyle: "split",
      baseThemeId: "garden-editorial",
      placementId: "left-column",
      safeTypographyRegion: "right-panel",
      art: art({ composition: "a wide panoramic performance stage" }),
    });
    const event = {
      id: 1,
      eventName: "Maya's Birthday",
      eventType: "birthday",
      vibeDescription: "cinematic K-pop performance",
      themeName: "KPop Demon Hunters",
      paletteColors: "[]",
      eventDate: "8 August 2026",
      location: "",
      venueName: "",
    } as unknown as Event;
    const brief = buildEventBrief({ event, dna: {}, guestCount: 15 });

    const [bound] = bindConceptsToBrief([wideSplit], brief);

    expect(bound.layoutStyle).toBe("banner");
    expect(safeTypographyPlacementCoverage(bound)).toBeGreaterThanOrEqual(MIN_SAFE_TYPE_PLACEMENT_COVERAGE);
    expect(validateLayoutBeforeGeneration(bound).issues.map((issue) => issue.code)).not.toContain(
      "safe-region-outside-type-area",
    );
  });

  it("refuses a banner whose artwork draws its own mat", () => {
    const repair = validateLayoutBeforeGeneration(
      concept({ layoutStyle: "banner", art: art({ prompt: "A scene inside a printed border and paper margin." }) }),
    );
    const issue = repair.issues.find((i) => i.code === "banner-internal-mat");
    expect(issue).toBeDefined();
    expect(issue?.repair).toBe("regenerate");
  });

  it("gives busy all-over art a quiet place for the words", () => {
    const repair = validateLayoutBeforeGeneration(
      concept({
        focalStrategy: "graphic-world",
        minOverlay: "none",
        art: art({ composition: "an all-over scattered field of stars" }),
      }),
    );
    expect(repair.issues.map((i) => i.code)).toContain("busy-scatter-without-quiet-region");
    expect(repair.overlay).toBe("veil");
  });

  it("replaces a top-fading gradient when artwork sits behind the whole type block", () => {
    const repair = validateLayoutBeforeGeneration(
      concept({ focalStrategy: "iconic-detail", layoutStyle: "full-bleed", minOverlay: "gradient" }),
    );
    expect(repair.overlay).toBe("veil");
    expect(repair.issues).toContainEqual(expect.objectContaining({
      code: "art-behind-type-needs-local-surface",
      repair: "strengthen-overlay",
    }));
  });

  it("does not add a veil when the layout already keeps type off the artwork", () => {
    const repair = validateLayoutBeforeGeneration(
      concept({
        layoutStyle: "banner",
        baseThemeId: "deco-midnight",
        placementId: "low",
        safeTypographyRegion: "lower-third",
        minOverlay: "none",
      }),
    );
    expect(repair.overlay).toBe("none");
    expect(repair.issues.map((issue) => issue.code)).not.toContain("art-behind-type-needs-local-surface");
  });

  it("never lets an overlay swallow the artwork it sits on", () => {
    expect(MAX_OVERLAY_COVERAGE).toBe(0.4);
    for (const overlay of ["none", "veil", "gradient", "plate"] as const) {
      const repair = validateLayoutBeforeGeneration(concept({ minOverlay: overlay }));
      expect(repair.issues.map((i) => i.code)).not.toContain("overlay-obscures-artwork");
    }
  });

  it("measures the coverage the gate is told about from one table", () => {
    // The pipeline used to re-derive this inline as 0.4/0.3/0, so Tier 1's
    // coverage check and the layout validator disagreed about a veil.
    expect(OVERLAY_COVERAGE).toEqual({ none: 0, veil: 0.28, gradient: 0.34, plate: 0.4 });
    for (const value of Object.values(OVERLAY_COVERAGE)) {
      expect(value).toBeLessThanOrEqual(MAX_OVERLAY_COVERAGE);
    }
  });

  it("strengthens an overlay but never weakens one", () => {
    expect(strongerOverlay("none", "plate")).toBe("plate");
    expect(strongerOverlay("plate", "veil")).toBe("plate");
    expect(strongerOverlay("veil", "veil")).toBe("veil");
  });

  it("rejects the artwork panel and accepts the split layout's actual text panel", () => {
    const left = validateLayoutBeforeGeneration(concept({ layoutStyle: "split", safeTypographyRegion: "left-panel" }));
    const right = validateLayoutBeforeGeneration(concept({ layoutStyle: "split", safeTypographyRegion: "right-panel" }));
    expect(left.issues.map((i) => i.code)).toContain("safe-region-outside-type-area");
    expect(right.issues.map((i) => i.code)).not.toContain("safe-region-outside-type-area");
  });

  it("rejects the canary's token intersection between upper-third and centred type", () => {
    const canary = concept({ safeTypographyRegion: "upper-third", placementId: "centre" });
    expect(safeTypographyPlacementCoverage(canary)).toBeLessThan(MIN_SAFE_TYPE_PLACEMENT_COVERAGE);
    const repair = validateLayoutBeforeGeneration(canary);
    expect(repair.issues).toContainEqual(expect.objectContaining({
      code: "safe-region-outside-type-area",
      repair: "regenerate",
    }));
  });

  it("derives the compatible region from exact placement geometry instead of retry roulette", () => {
    const mismatched = concept({
      layoutStyle: "full-bleed",
      baseThemeId: "deco-midnight",
      placementId: "high",
      safeTypographyRegion: "upper-third",
    });
    expect(safeTypographyPlacementCoverage(mismatched)).toBeLessThan(MIN_SAFE_TYPE_PLACEMENT_COVERAGE);
    expect(canonicalSafeTypographyRegion(mismatched)).toBe("center");
    expect(
      safeTypographyPlacementCoverage({
        ...mismatched,
        safeTypographyRegion: canonicalSafeTypographyRegion(mismatched),
      }),
    ).toBeGreaterThanOrEqual(MIN_SAFE_TYPE_PLACEMENT_COVERAGE);
  });

  it("moves an impossible straddling placement within the same curated theme", () => {
    const straddling = concept({
      layoutStyle: "backdrop",
      baseThemeId: "pool-editorial",
      placementId: "high",
      safeTypographyRegion: "upper-third",
    });
    const regionOnly = canonicalSafeTypographyRegion(straddling);
    expect(
      safeTypographyPlacementCoverage({ ...straddling, safeTypographyRegion: regionOnly }),
    ).toBeLessThan(MIN_SAFE_TYPE_PLACEMENT_COVERAGE);

    const geometry = canonicalTypeGeometry(straddling);
    expect(geometry.placementId).not.toBe("high");
    expect(
      safeTypographyPlacementCoverage({
        ...straddling,
        placementId: geometry.placementId,
        safeTypographyRegion: geometry.safeTypographyRegion,
      }),
    ).toBeGreaterThanOrEqual(MIN_SAFE_TYPE_PLACEMENT_COVERAGE);
  });

  it("accepts a quiet centre that covers the actual centred placement", () => {
    const centred = concept({ safeTypographyRegion: "center", placementId: "centre" });
    expect(safeTypographyPlacementCoverage(centred)).toBeGreaterThanOrEqual(MIN_SAFE_TYPE_PLACEMENT_COVERAGE);
    expect(validateLayoutBeforeGeneration(centred).issues.map((i) => i.code)).not.toContain(
      "safe-region-outside-type-area",
    );
  });

  it("never renames a layout to something the renderer cannot draw", () => {
    for (const layoutStyle of ["full-bleed", "backdrop", "banner", "split", "centered"] as const) {
      const repair = validateLayoutBeforeGeneration(concept({ layoutStyle }));
      expect(Object.keys(LAYOUT_FRAMES)).toContain(repair.layoutStyle);
    }
  });
});

describe("layout — crop safety before composition", () => {
  const canvas = { width: 1024, height: 1536 };

  it("keeps a centred subject safe under a full-bleed crop", () => {
    const result = evaluateCropSafety("full-bleed", canvas, [{ x: 0.35, y: 0.4, width: 0.3, height: 0.2 }]);
    expect(result.safe).toBe(true);
    expect(result.worstCroppedFraction).toBe(0);
    expect(result.issues).toEqual([]);
  });

  it("catches a motif the crop clips off the top edge", () => {
    const result = evaluateCropSafety("full-bleed", canvas, [{ x: 0.4, y: 0, width: 0.2, height: 0.05 }]);
    expect(result.safe).toBe(false);
    expect(result.worstCroppedFraction).toBeGreaterThan(MAX_SALIENT_CROP_FRACTION);
    expect(result.issues[0].code).toBe("full-bleed-crop-unsafe");
    expect(result.issues[0].repair).toBe("change-layout");
  });

  it("reports the worst region, not the average", () => {
    const result = evaluateCropSafety("full-bleed", canvas, [
      { x: 0.4, y: 0.4, width: 0.2, height: 0.2 },
      { x: 0.4, y: 0, width: 0.2, height: 0.04 },
    ]);
    expect(result.safe).toBe(false);
  });

  it("holds the clip limit at a quarter of a salient region", () => {
    expect(MAX_SALIENT_CROP_FRACTION).toBe(0.25);
  });
});

describe("palette — floors", () => {
  it("uses the floors the renderer actually needs", () => {
    expect(ROLE_MINIMUM_CONTRAST).toEqual({ headlineColor: 3.0, bodyColor: 4.5, accentColor: 4.5 });
    expect(FRAME_MINIMUM_CONTRAST).toBe(1.6);
  });

  it("computes WCAG contrast correctly", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 1);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
  });
});

describe("palette — normalization", () => {
  const failing = {
    textSurface: "#FFFFFF",
    headlineColor: "#1A1A1A",
    bodyColor: "#DDDDDD",
    accentColor: "#C9A227",
  };

  it("leaves a role that already clears its floor untouched", () => {
    const fix = normalizeRole("headlineColor", failing);
    expect(fix.changed).toBe(false);
    expect(fix.after).toBe(failing.headlineColor);
  });

  it("repairs a failing role from the concept's own declared colours", () => {
    const fix = normalizeRole("bodyColor", failing);
    expect(fix.changed).toBe(true);
    expect(fix.afterRatio).toBeGreaterThanOrEqual(ROLE_MINIMUM_CONTRAST.bodyColor);
    // The replacement came from the brief's own family, not an invented hue.
    expect(Object.values(failing).map((h) => h.toUpperCase())).toContain(fix.after.toUpperCase());
  });

  it("falls back to a role-safe neutral only when nothing declared clears the floor", () => {
    const hopeless = {
      textSurface: "#FFFFFF",
      headlineColor: "#FEFEFE",
      bodyColor: "#FDFDFD",
      accentColor: "#FCFCFC",
    };
    const fix = normalizeRole("bodyColor", hopeless);
    expect(fix.after).toBe("#000000");
    expect(fix.afterRatio).toBeGreaterThanOrEqual(ROLE_MINIMUM_CONTRAST.bodyColor);
  });

  it("is deterministic — the same palette normalizes identically every time", () => {
    expect(normalizeSemanticPalette(failing)).toEqual(normalizeSemanticPalette(failing));
  });

  it("produces a drop-in PaletteVariant that preserves the concept's surface", () => {
    const normalized = normalizeSemanticPalette(failing);
    expect(normalized.variant.surface).toBe(failing.textSurface);
    expect(Object.keys(normalized.variant).sort()).toEqual(["accent", "body", "id", "ink", "label", "surface"]);
  });

  it("leaves every live text role at or above its floor afterwards", () => {
    const normalized = normalizeSemanticPalette(failing);
    for (const fix of normalized.fixes) {
      expect(contrastRatio(fix.after, failing.textSurface), fix.role).toBeGreaterThanOrEqual(fix.required);
    }
  });

  it("reports the frame's own contrast separately, at its lower non-text floor", () => {
    const normalized = normalizeSemanticPalette(failing);
    expect(normalized.framePasses).toBe(normalized.frameContrast >= FRAME_MINIMUM_CONTRAST);
  });

  it("flags an invisible detail rather than shipping a missing element", () => {
    expect(hasInvisibleDetail({ ...failing, accentColor: "#FEFEFE" })).toBe(true);
    expect(hasInvisibleDetail({ textSurface: "#FFFFFF", headlineColor: "#000000", bodyColor: "#222222", accentColor: "#333333" })).toBe(false);
    expect(INVISIBLE_CONTRAST_CEILING).toBe(1.15);
  });

  it("does not redesign the eight studio themes", () => {
    // Their palettes are curated; normalization is only ever applied to an AI
    // concept's own semantic palette.
    expect(LAUNCH_THEMES).toHaveLength(8);
    for (const theme of LAUNCH_THEMES) {
      expect(theme.palettes.length).toBeGreaterThan(0);
      expect(theme.palettes[0].id).not.toBe("ai-semantic");
    }
  });
});

// The quality gate. Tier 1 is deterministic and free, so it runs first and
// catches the defects that are measurable; Tier 2 is the paid critic and is
// the only thing that can judge taste. The invariant both share is that
// "acceptable" is not good enough — the old overall>=3 bar is what let the
// proof's weak cards through, so every dimension has to clear 4.

import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import {
  findSalientRegions,
  focalVisibilityAfterOpacity,
  longestFlatBand,
  MAX_RENDERED_TYPE_REGION_LUMA_SPREAD,
  quietnessOfTypeRegion,
  retryCodesFor,
  runTier1Checks,
  uniformBorderRingFraction,
} from "../server/aiFirst/tier1";
import { MIN_DIMENSION_SCORE, runVisionGate, visionCostUsd } from "../server/aiFirst/visionGate";
import {
  ARTWORK_EDGE_REQUIREMENT,
  ARTWORK_TEXT_REQUIREMENT,
  aspectRatioForLayout,
  buildArtworkPrompt,
  safeFramingRequirement,
  typographySafetyRequirement,
  visibleFractionForLayout,
} from "@shared/aiFirstInvite";
import { artworkPng, busyTypeRegionPng, concept, framedArtworkPng, solidPng } from "./aiFirstFixtures";
import type { EventBrief } from "../server/aiFirst/brief";
import { concreteSubjectReviewRequirementsForBrief } from "../server/aiFirst/conceptPreflight";

const tier1 = (bytes: Buffer, over: Partial<Parameters<typeof runTier1Checks>[0]> = {}) =>
  runTier1Checks({ bytes, concept: concept(), overlayCoverage: 0.3, artworkOpacity: 1, ocr: false, ...over });

const codes = (bytes: Buffer, over: Partial<Parameters<typeof runTier1Checks>[0]> = {}) =>
  tier1(bytes, over).findings.map((f) => f.code);

/** A grid literal is enough for the pure measurements. */
const grid = (width: number, height: number, at: (x: number, y: number) => number) => {
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) data[y * width + x] = at(x, y);
  return { width, height, data };
};

describe("tier 1 — a clean image", () => {
  it("passes with no findings at all", () => {
    const result = tier1(artworkPng());
    expect(result.findings).toEqual([]);
    expect(result.passed).toBe(true);
  });

  it("costs nothing to run, so it can gate every attempt", () => {
    expect(tier1(artworkPng()).durationMs).toBeLessThan(2_000);
  });
});

describe("tier 1 — critical defects", () => {
  it("rejects a file too small to be an illustration", () => {
    expect(codes(solidPng())).toContain("file-size");
  });

  it("rejects a corrupt file without throwing", () => {
    const result = tier1(Buffer.from("this is not a png at all"));
    expect(result.passed).toBe(false);
    expect(result.findings.map((f) => f.code)).toContain("file-integrity");
  });

  it("rejects a blank, degenerate image", () => {
    // Large enough to clear the size floor, but flat.
    expect(codes(solidPng(400))).toContain("blank-degenerate");
  });

  it("rejects artwork that draws its own printed margin", () => {
    const found = codes(framedArtworkPng());
    expect(found).toContain("printed-margin");
    expect(tier1(framedArtworkPng()).passed).toBe(false);
  });

  it("rejects artwork whose aspect does not match the layout it was made for", () => {
    // A banner asks for 16:9; this is the 9:16 canvas.
    expect(codes(artworkPng(), { concept: concept({ layoutStyle: "banner" }) })).toContain("dimensions");
  });

  it("treats every one of those as critical, never merely advisory", () => {
    for (const finding of tier1(framedArtworkPng()).findings) {
      if (finding.code === "printed-margin") expect(finding.critical).toBe(true);
    }
  });
});

describe("tier 1 — palette diagnostics", () => {
  it("hard-rejects low text contrast if upstream normalization is ever bypassed", () => {
    const washedOut = concept({
      semanticPalette: { textSurface: "#FFFFFF", headlineColor: "#F2F2F2", bodyColor: "#EFEFEF", accentColor: "#EEEEEE" },
    });
    const result = tier1(artworkPng(), { concept: washedOut });
    expect(result.findings.map((f) => f.code)).toContain("text-contrast");
    expect(result.findings.filter((f) => f.code === "text-contrast").every((f) => f.critical)).toBe(true);
    expect(result.passed).toBe(false);
  });

  it("hard-rejects artwork that is busy under the exact live-type placement", () => {
    const result = tier1(busyTypeRegionPng(), {
      concept: concept({ minOverlay: "veil", placementId: "centre", safeTypographyRegion: "center" }),
    });
    const finding = result.findings.find((candidate) => candidate.code === "quiet-region");
    expect(finding).toBeDefined();
    expect(finding?.critical).toBe(true);
    expect(result.passed).toBe(false);
  });
});

describe("tier 1 — the measurements themselves", () => {
  it("judges the protected card, preserving the old bar while giving the local veil deterministic margin", () => {
    const canaryRange = grid(100, 100, (x, y) => ((x + y) % 2 === 0 ? 46 : 210));
    const protectedRegion = quietnessOfTypeRegion(canaryRange, concept({ minOverlay: "veil" }));
    expect(protectedRegion.rawSpread).toBe(164);
    expect(protectedRegion.spread).toBeCloseTo(19.68, 2);
    expect(protectedRegion.limit).toBe(MAX_RENDERED_TYPE_REGION_LUMA_SPREAD);
    expect(protectedRegion.quiet).toBe(true);

    const unprotectedRegion = quietnessOfTypeRegion(canaryRange, concept({ minOverlay: "none" }));
    expect(unprotectedRegion.quiet).toBe(false);

    const extremeRange = grid(100, 100, (x, y) => ((x + y) % 2 === 0 ? 12 : 244));
    expect(quietnessOfTypeRegion(extremeRange, concept({ minOverlay: "veil" })).quiet).toBe(false);
  });

  it("measures a flat band as a fraction of the edge", () => {
    expect(longestFlatBand(grid(40, 40, () => 128))).toBe(1);
    expect(longestFlatBand(grid(40, 40, (x, y) => ((x * 7 + y * 13) % 5) * 60))).toBeLessThan(1);
  });

  it("measures a uniform ring only when it is genuinely uniform", () => {
    const framed = grid(60, 60, (x, y) => (x < 6 || y < 6 || x >= 54 || y >= 54 ? 250 : ((x * 11 + y * 5) % 7) * 36));
    expect(uniformBorderRingFraction(framed)).toBeGreaterThan(0.05);
    const noisy = grid(60, 60, (x, y) => ((x * 11 + y * 5) % 7) * 36);
    expect(uniformBorderRingFraction(noisy)).toBe(0);
  });

  it("shows a focal subject collapsing as opacity drops — the backdrop defect", () => {
    const art = grid(40, 40, (x, y) => (x > 12 && x < 28 && y > 12 && y < 28 ? 10 : 240));
    const full = focalVisibilityAfterOpacity(art, 1, "#FFFFFF");
    const faded = focalVisibilityAfterOpacity(art, 0.3, "#FFFFFF");
    expect(full).toBeGreaterThan(faded);
    expect(faded).toBeLessThan(full / 2);
  });

  it("finds nothing salient in an image that is uniformly flat", () => {
    // The top decile is salient by definition, so without an absolute floor a
    // flat wash would report motifs — and then report them as clipped.
    expect(findSalientRegions(grid(120, 120, () => 128))).toEqual([]);
  });

  it("returns one motif for a cluster of touching blocks, not one per block", () => {
    const blob = grid(120, 120, (x, y) =>
      x > 40 && x < 80 && y > 40 && y < 80 ? ((x * 31 + y * 17) % 9) * 28 : 128,
    );
    const regions = findSalientRegions(blob);
    expect(regions).toHaveLength(1);
    expect(regions[0].width).toBeGreaterThan(1 / 12);
  });

  it("ignores a speck of background texture beside a real motif", () => {
    const noise = (x: number, y: number) => ((x * 31 + y * 17) % 9) * 28;
    const withSpeck = grid(120, 120, (x, y) => {
      if (x > 40 && x < 80 && y > 40 && y < 80) return noise(x, y);
      if (x > 104 && y > 104) return noise(x, y);
      return 128;
    });
    // Both are detected as detail, but only the motif is big enough to matter.
    expect(findSalientRegions(withSpeck)).toHaveLength(1);
  });

  it("maps findings onto retry remedies without duplicates", () => {
    expect(
      retryCodesFor([
        { code: "printed-margin", critical: true, message: "" },
        { code: "printed-margin", critical: true, message: "" },
        { code: "crop-unsafe", critical: true, message: "" },
      ]),
    ).toEqual(["printed-margin", "crop-unsafe"]);
  });
});

describe("the artwork edge rule", () => {
  it("is appended verbatim to every artwork prompt", () => {
    expect(ARTWORK_EDGE_REQUIREMENT).toBe(
      "Artwork extends fully to every canvas edge. No paper margin, mat, card border, printed frame or blank perimeter.",
    );
    for (const layoutStyle of ["full-bleed", "banner", "split", "backdrop", "centered"] as const) {
      const prompt = buildArtworkPrompt(concept({ layoutStyle }));
      expect(prompt).toContain(ARTWORK_EDGE_REQUIREMENT);
      expect(prompt).toContain(ARTWORK_TEXT_REQUIREMENT);
    }
  });
});

describe("protecting the exact live-type box", () => {
  it("gives full-card artwork exact renderer coordinates and explicit subject exclusion", () => {
    const prompt = buildArtworkPrompt(concept({
      layoutStyle: "full-bleed",
      baseThemeId: "garden-editorial",
      placementId: "centre",
      safeTypographyRegion: "center",
    }));
    expect(prompt).toContain("Reserve the rectangle from 21% to 79% of canvas width");
    expect(prompt).toContain("32% to 72% of canvas height");
    expect(prompt).toContain("Keep every face, person, hero object, required subject");
    expect(prompt).toContain("overrides any conflicting quiet-region wording");
  });

  it("does not invent an image-space type box when layout panels already separate art and words", () => {
    expect(typographySafetyRequirement(concept({ layoutStyle: "split" }))).toBe("");
    expect(typographySafetyRequirement(concept({ layoutStyle: "banner" }))).toBe("");
    expect(typographySafetyRequirement(concept({ layoutStyle: "centered" }))).toBe("");
  });
});

describe("composing for the crop the renderer will apply", () => {
  it("generates split artwork tall, since its panel is 40% of the card's width", () => {
    expect(aspectRatioForLayout("split")).toBe("9:16");
    expect(aspectRatioForLayout("banner")).toBe("16:9");
    expect(aspectRatioForLayout("centered")).toBe("1:1");
  });

  it("tells the model where the crop lands when it discards a lot", () => {
    expect(safeFramingRequirement("split")).toContain("central 45% of the width");
    expect(safeFramingRequirement("centered")).toContain("central 60% of the height");
    expect(buildArtworkPrompt(concept({ layoutStyle: "split" }))).toContain("central 45% of the width");
  });

  it("stays quiet for the layouts that show almost the whole canvas", () => {
    for (const layoutStyle of ["full-bleed", "backdrop", "banner"] as const) {
      expect(safeFramingRequirement(layoutStyle)).toBe("");
      expect(visibleFractionForLayout(layoutStyle).x).toBe(1);
    }
  });

  it("still demands full-edge coverage, so the crop advice cannot invite a margin", () => {
    const prompt = buildArtworkPrompt(concept({ layoutStyle: "split" }));
    expect(prompt).toContain(ARTWORK_EDGE_REQUIREMENT);
    expect(prompt).toContain("Background texture still reaches every edge");
  });
});

/* ── Tier 2 ──────────────────────────────────────────────────────────── */

const brief = (over: Partial<EventBrief> = {}): EventBrief => ({
  eventName: "Ada's 4th Birthday",
  eventType: "birthday",
  milestone: "4th",
  vibe: "modern space cowgirl",
  themeName: "space cowgirl",
  colors: ["dusty rose", "brass"],
  formality: "playful",
  dateLine: "12 September 2026",
  season: "autumn",
  venueType: "home",
  guestCount: 18,
  dna: {},
  inspirationNotes: "",
  requirements: {
    required: ["the space cowgirl visual identity, unmistakably present"],
    preferred: [],
    excluded: ["photographic realism"],
  },
  ...over,
});

/** A stub critic returning whatever the test wants it to have seen. */
function critic(body: Record<string, unknown>): Anthropic {
  return {
    messages: {
      create: async () => ({
        content: [{ type: "text", text: JSON.stringify(body) }],
        usage: { input_tokens: 1200, output_tokens: 180 },
      }),
    },
  } as unknown as Anthropic;
}

const allFive = {
  textLogoWatermarkFree: 5,
  artifactFree: 5,
  premiumFinish: 5,
  briefFidelity: 5,
  compositionQuality: 5,
  ageAppropriate: 5,
};

const runVision = (body: Record<string, unknown>, over: Partial<EventBrief> = {}) =>
  runVisionGate({
    bytes: artworkPng(),
    concept: concept(),
    brief: brief(over),
    client: critic({
      ...allFive,
      requiredPresent: [],
      excludedFound: [],
      notes: "",
      ...body,
    }),
  });

describe("tier 2 — acceptance", () => {
  it("passes only when every dimension is at least 4", async () => {
    expect(MIN_DIMENSION_SCORE).toBe(4);
    expect((await runVision({})).passed).toBe(true);
    expect((await runVision({ premiumFinish: 4 })).passed).toBe(true);
  });

  it("rejects the score the old gate accepted", async () => {
    // overall>=3 used to ship this. It must not any more.
    const verdict = await runVision({ premiumFinish: 3 });
    expect(verdict.passed).toBe(false);
    expect(verdict.failureCodes).toContain("premium-feel");
  });

  it("fails each dimension independently", async () => {
    const cases: [string, string][] = [
      ["textLogoWatermarkFree", "text-detected"],
      ["artifactFree", "artifact"],
      ["premiumFinish", "premium-feel"],
      ["briefFidelity", "brief-fidelity"],
      ["compositionQuality", "crop-unsafe"],
      ["ageAppropriate", "age-appropriate"],
    ];
    for (const [dimension, code] of cases) {
      const verdict = await runVision({ [dimension]: 3 });
      expect(verdict.passed, dimension).toBe(false);
      expect(verdict.failureCodes, dimension).toContain(code);
    }
  });

  it("fails when a REQUIRED item is missing even though every score is 5", async () => {
    const construction = brief({
      eventName: "I'm 3 & Digging It",
      milestone: "3rd",
      vibe: "backyard BBQ construction themed for our favorite little builder",
      themeName: "construction",
      requirements: {
        required: [
          "the construction visual identity, unmistakably present",
          "age-appropriate celebratory character for a 3rd birthday",
        ],
        preferred: [],
        excluded: ["photographic realism"],
      },
    });
    const visible = concreteSubjectReviewRequirementsForBrief(construction);
    const verdict = await runVision(
      { requiredPresent: visible.map((requirement, index) => ({ requirement, present: index !== 0 })) },
      construction,
    );
    expect(verdict.passed).toBe(false);
    expect(verdict.failureCodes).toContain("brief-fidelity");
  });

  it("fails when an EXCLUDED item is visible even though every score is 5", async () => {
    const verdict = await runVision({ excludedFound: ["photographic realism"] });
    expect(verdict.passed).toBe(false);
    expect(verdict.failureCodes).toContain("excluded-present");
  });

  it("does not accept a critic that ignored a non-empty visible must-have list", async () => {
    const construction = brief({
      vibe: "construction birthday",
      themeName: "construction",
      requirements: { required: ["construction identity"], preferred: [], excluded: [] },
    });
    const verdict = await runVision({ requiredPresent: [] }, construction);
    expect(verdict.passed).toBe(false);
    expect(verdict.failureCodes).toContain("brief-fidelity");
  });

  it("does not turn framing and negative prompt rules into visible checklist items", async () => {
    const construction = brief({
      eventName: "I'm 3 & Digging It",
      milestone: "3rd",
      vibe: "backyard BBQ construction themed for our favorite little builder",
      themeName: "construction",
      requirements: {
        required: [
          "the construction visual identity, unmistakably present",
          "age-appropriate celebratory character for a 3rd birthday",
        ],
        preferred: [],
        excluded: ["photographic realism"],
      },
    });
    const visible = concreteSubjectReviewRequirementsForBrief(construction);
    expect(visible).toHaveLength(1);

    let reviewText = "";
    const capturingCritic = {
      messages: {
        create: async (request: any) => {
          reviewText = request.messages[0].content.find((part: any) => part.type === "text")?.text ?? "";
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  ...allFive,
                  requiredPresent: visible.map((requirement) => ({ requirement, present: true })),
                  excludedFound: [],
                  notes: "",
                }),
              },
            ],
            usage: { input_tokens: 1200, output_tokens: 180 },
          };
        },
      },
    } as unknown as Anthropic;

    const verdict = await runVisionGate({
      bytes: artworkPng(),
      concept: concept(),
      brief: construction,
      client: capturingCritic,
    });

    expect(verdict.passed).toBe(true);
    expect(verdict.requiredPresent).toEqual(visible.map((requirement) => ({ requirement, present: true })));
    const checklist = reviewText.split("VISIBLE MUST-HAVES")[1]?.split("EXCLUDED:")[0] ?? "";
    expect(checklist).toContain("construction / little-builder identity");
    expect(checklist).toContain("at least two coherent builder or jobsite cues");
    expect(checklist).not.toContain("central 70%");
    expect(checklist).not.toContain("do not satisfy or replace");
    expect(reviewText).toContain("the construction visual identity, unmistakably present");
    expect(reviewText).toContain("age-appropriate celebratory character for a 3rd birthday");
    expect(reviewText).toContain("LIVE TYPOGRAPHY BOX");
    expect(reviewText).toContain("left 21%, top 32%, width 58%, height 40%");
    expect(reviewText).toContain("no face, person, hero object or required subject");
  });

  it("is never a silent pass when the critic is unreachable", async () => {
    const exploding = {
      messages: {
        create: async () => {
          throw new Error("upstream down");
        },
      },
    } as unknown as Anthropic;
    const verdict = await runVisionGate({ bytes: artworkPng(), concept: concept(), brief: brief(), client: exploding });
    expect(verdict.unavailable).toBe(true);
    expect(verdict.passed).toBe(false);
  });

  it("is never a silent pass when the critic returns unparseable prose", async () => {
    const verdict = await runVisionGate({
      bytes: artworkPng(),
      concept: concept(),
      brief: brief(),
      client: { messages: { create: async () => ({ content: [{ type: "text", text: "looks nice!" }], usage: {} }) } } as unknown as Anthropic,
    });
    expect(verdict.unavailable).toBe(true);
    expect(verdict.passed).toBe(false);
  });

  it("prices the critic call for the ledger", () => {
    expect(visionCostUsd({ inputTokens: 1_000_000, outputTokens: 0 })).toBeCloseTo(3);
    expect(visionCostUsd({ inputTokens: 0, outputTokens: 1_000_000 })).toBeCloseTo(15);
  });
});

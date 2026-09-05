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
  meaningfulOcrTokensFromTsv,
  quietnessOfTypeRegion,
  retryCodesFor,
  runTier1Checks,
  uniformBorderRingFraction,
} from "../server/aiFirst/tier1";
import { MIN_DIMENSION_SCORE, runVisionGate, visibleReviewRequirementsForBrief, visionCostUsd } from "../server/aiFirst/visionGate";
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

describe("tier 1 — OCR evidence", () => {
  const tsv = (entries: Array<[number, string]>) => [
    "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext",
    ...entries.map(([confidence, token], index) =>
      `5\t1\t1\t1\t1\t${index + 1}\t0\t0\t10\t10\t${confidence}\t${token}`,
    ),
  ].join("\n");

  it("ignores one medium-confidence three-letter fragment", () => {
    expect(meaningfulOcrTokensFromTsv([tsv([[72.8, "ype"]]), tsv([])])).toEqual([]);
  });

  it("blocks one strongly recognized word or number", () => {
    expect(meaningfulOcrTokensFromTsv([tsv([[91, "RSVP"]]), tsv([])])).toEqual(["RSVP"]);
    expect(meaningfulOcrTokensFromTsv([tsv([[94, "2026"]]), tsv([])])).toEqual(["2026"]);
  });

  it("blocks short lettering when both segmentation modes agree", () => {
    expect(meaningfulOcrTokensFromTsv([tsv([[71, "VIP"]]), tsv([[76, "VIP"]])])).toEqual(["VIP"]);
  });

  it("blocks a medium-confidence phrase without requiring either token to be strong", () => {
    expect(meaningfulOcrTokensFromTsv([tsv([[68, "SAVE"], [70, "DATE"]]), tsv([])])).toEqual([
      "SAVE",
      "DATE",
    ]);
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

  it("does not apply invitation-only crop, type and overlay checks to a standalone teaser", () => {
    const result = tier1(busyTypeRegionPng(), {
      concept: concept({
        minOverlay: "none",
        placementId: "centre",
        safeTypographyRegion: "center",
        semanticPalette: {
          textSurface: "#FFFFFF",
          headlineColor: "#F2F2F2",
          bodyColor: "#EFEFEF",
          accentColor: "#EEEEEE",
        },
      }),
      overlayCoverage: 0.9,
      artworkOpacity: 0.2,
      layoutApplied: false,
    });
    const found = result.findings.map((finding) => finding.code);
    expect(found).not.toContain("crop-unsafe");
    expect(found).not.toContain("quiet-region");
    expect(found).not.toContain("text-contrast");
    expect(found).not.toContain("overlay-coverage");
    expect(found).not.toContain("layout-opacity");
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

  it("still names a shallow cover crop because it can clip an edge detail", () => {
    expect(safeFramingRequirement("full-bleed")).toContain("central 89% of the height");
    expect(safeFramingRequirement("backdrop")).toContain("central 89% of the height");
    expect(safeFramingRequirement("banner")).toContain("central 88% of the height");
    expect(visibleFractionForLayout("full-bleed").x).toBe(1);
  });

  it("still demands full-edge coverage, so the crop advice cannot invite a margin", () => {
    const prompt = buildArtworkPrompt(concept({ layoutStyle: "split" }));
    expect(prompt).toContain(ARTWORK_EDGE_REQUIREMENT);
    expect(prompt).toContain("painted edge-to-edge with no blank margin");
  });

  it("tells the model background elements (sky, floor, horizon) must also stay inside the safe zone", () => {
    // B1a: a banner-layout image that obeyed the old "background reaches every
    // edge" wording literally would paint sky/floor right up to the crop line,
    // which the renderer's object-cover crop then clips. The requirement must
    // now name background/setting content explicitly and forbid a horizon or
    // floor line sitting at the canvas edge.
    const bannerRequirement = safeFramingRequirement("banner");
    expect(bannerRequirement).toContain("central 88% of the height");
    expect(bannerRequirement).toContain("background");
    expect(bannerRequirement).toContain("sky, ground, walls");
    expect(bannerRequirement).toContain("disposable bleed");
    expect(bannerRequirement).toContain("Do not paint a horizon, sky-to-ground transition or floor line right at the canvas edge");

    const prompt = buildArtworkPrompt(concept({ layoutStyle: "banner" }));
    expect(prompt).toContain("disposable bleed");
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

const passingDimensionEvidence = {
  textLogoWatermarkFree: "No typography or brand marks in foreground or background.",
  artifactFree: "Figures have clean anatomy and coherent ground contact.",
  premiumFinish: "Purposeful layered illustration, controlled highlights and brushwork.",
  briefFidelity: "The scene visibly delivers the requested world and activities.",
  compositionQuality: "All lead subjects are complete within the frame.",
  ageAppropriate: "Playful family-audience treatment without mature content.",
};

const passingTeaserChecks = {
  milestone: { evidence: "No exact count is required.", correct: true },
  identity: { evidence: "The requested event world is specific and accurate.", accurate: true },
  purchase: { evidence: "The finish is distinctive and premium.", wouldCreatePurchaseDesire: true },
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
  it.each([5.9, 6, "5", null])("rejects malformed score %s instead of clamping it to a pass", async (value) => {
    expect((await runVision({ artifactFree: value })).passed).toBe(false);
  });

  it("does not recycle a reordered checklist answer for an omitted requirement", async () => {
    const verdict = await runVision({ requiredPresent: [{ requirement: "bubbles", present: true }] }, {
      requirements: { required: ["[VISIBLE HOST DETAIL] ice cream", "[VISIBLE HOST DETAIL] bubbles"], preferred: [], excluded: [] },
    });
    expect(verdict.requiredPresent).toEqual([
      { requirement: "ice cream", present: false }, { requirement: "bubbles", present: true },
    ]);
    expect(verdict.passed).toBe(false);
  });

  it("rejects conflicting duplicate checklist answers", async () => {
    const verdict = await runVision({ requiredPresent: [{ requirement: "bubbles", present: true }, { requirement: "bubbles", present: false }] }, {
      requirements: { required: ["[VISIBLE HOST DETAIL] bubbles"], preferred: [], excluded: [] },
    });
    expect(verdict.passed).toBe(false);
  });

  it.each(["dimensionEvidence", "identity", "purchase", "requirement"])("keeps unsupported 5/5 teaser private when %s evidence is missing", async (missing) => {
    const verdict = await runVisionGate({ bytes: artworkPng(), concept: concept(), reviewMode: "teaser",
      brief: brief({ requirements: { required: ["[VISIBLE HOST DETAIL] bubbles"], preferred: [], excluded: [] } }),
      client: critic({ ...allFive, excludedFound: [], notes: "",
        requiredPresent: [{ requirement: "bubbles", present: true, evidence: missing === "requirement" ? " " : "Visible in the upper foreground" }],
        dimensionEvidence: missing === "dimensionEvidence" ? {} : passingDimensionEvidence,
        teaserChecks: { ...passingTeaserChecks,
          ...(missing === "identity" ? { identity: { accurate: true, evidence: " " } } : {}),
          ...(missing === "purchase" ? { purchase: { wouldCreatePurchaseDesire: true, evidence: " " } } : {}),
        },
      }),
    });
    expect(verdict.passed).toBe(false);
  });

  it("fails closed on a token-truncated response even when its visible JSON looks complete", async () => {
    let calls = 0;
    const verdict = await runVisionGate({ bytes: artworkPng(), concept: concept(), brief: brief(), client: {
      messages: { create: async () => { calls += 1; return { stop_reason: "max_tokens",
        content: [{ type: "text", text: JSON.stringify({ ...allFive, requiredPresent: [], excludedFound: [], notes: "" }) }],
        usage: { input_tokens: 10, output_tokens: 700 } }; } },
    } as unknown as Anthropic });
    expect(calls).toBe(2);
    expect(verdict.unavailable).toBe(true);
    expect(verdict.passed).toBe(false);
    expect(verdict.usage.outputTokens).toBe(1400);
  });

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

  it("turns teaser milestone, named-identity and host-detail contracts into binary must-haves", async () => {
    const teaser = brief({
      requirements: {
        required: [
          "[VISIBLE MILESTONE] exactly four separate unnumbered birthday candles",
          "[VISIBLE NAMED IDENTITY] Meekah is unmistakably recognizable as the requested co-host",
          "[VISIBLE HOST DETAIL] floating bubbles and colorful ice-cream treats",
        ],
        preferred: [],
        excluded: [],
      },
    });
    const visible = visibleReviewRequirementsForBrief(teaser);
    expect(visible).toEqual([
      "exactly four separate unnumbered birthday candles",
      "Meekah is unmistakably recognizable as the requested co-host",
      "floating bubbles and colorful ice-cream treats",
    ]);
    const verdict = await runVision(
      {
        requiredPresent: visible.map((requirement, index) => ({ requirement, present: index !== 0 })),
      },
      teaser,
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
    expect(reviewText).toContain("FINAL TYPE PROTECTION: veil (88% local surface opacity)");
    expect(reviewText).toContain("no face, person, hero object or required subject");
  });

  it("reviews a teaser as exact standalone pixels without inventing a live type box", async () => {
    let reviewText = "";
    let systemText = "";
    let outputConfig: any;
    const capturingCritic = {
      messages: {
        create: async (request: any) => {
          systemText = request.system;
          outputConfig = request.output_config;
          reviewText = request.messages[0].content.find((part: any) => part.type === "text")?.text ?? "";
          return {
            content: [{
              type: "text",
              text: JSON.stringify({
                ...allFive,
                requiredPresent: [],
                excludedFound: [],
                teaserChecks: passingTeaserChecks,
                dimensionEvidence: passingDimensionEvidence,
                notes: "",
              }),
            }],
            usage: { input_tokens: 1200, output_tokens: 180 },
          };
        },
      },
    } as unknown as Anthropic;

    const verdict = await runVisionGate({
      bytes: artworkPng(),
      concept: concept({ minOverlay: "none" }),
      brief: brief(),
      client: capturingCritic,
      reviewMode: "teaser",
    });

    expect(verdict.passed).toBe(true);
    expect(systemText).toContain("exact final pixels");
    expect(systemText).toContain("no browser crop");
    expect(systemText).toContain("exact count must match the stated number exactly");
    expect(systemText).toContain("weak named identity");
    expect(systemText).toContain("requires 5 in every dimension");
    expect(systemText).toContain("count each visible item one by one");
    expect(reviewText).toContain("FINAL CUSTOMER SURFACE");
    expect(reviewText).toContain("TEASER PASS/FAIL CHECKS");
    expect(reviewText).toContain("would these exact pixels");
    expect(reviewText).not.toContain("LIVE TYPOGRAPHY BOX");
    expect(reviewText).not.toContain("FINAL TYPE PROTECTION");
    expect(outputConfig?.format?.type).toBe("json_schema");
    expect(outputConfig?.format?.schema?.required).toContain("teaserChecks");
    expect(outputConfig?.format?.schema?.additionalProperties).toBe(false);
  });

  it("holds a merely professional 4/5 teaser private even though invitation review accepts 4/5", async () => {
    const teaser = await runVisionGate({
      bytes: artworkPng(),
      concept: concept({ minOverlay: "none" }),
      brief: brief(),
      client: critic({
        ...allFive,
        premiumFinish: 4,
        requiredPresent: [],
        excludedFound: [],
        teaserChecks: passingTeaserChecks,
        dimensionEvidence: passingDimensionEvidence,
        notes: "Professional, but not exceptional.",
      }),
      reviewMode: "teaser",
    });
    const invitation = await runVision({ premiumFinish: 4 });

    expect(teaser.passed).toBe(false);
    expect(teaser.failureCodes).toContain("premium-feel");
    expect(invitation.passed).toBe(true);
  });

  it("rejects a wrong physical milestone count even when the critic scores every dimension 5", async () => {
    const milestoneBrief = brief({
      milestone: "4th",
      themeName: "Blippi + Meekah",
      requirements: {
        required: [
          "a clear non-text 4th birthday cue using four separate unnumbered birthday candles or an equally explicit physical count",
        ],
        preferred: [],
        excluded: [],
      },
    });
    const verdict = await runVisionGate({
      bytes: artworkPng(),
      concept: concept({ minOverlay: "none" }),
      brief: milestoneBrief,
      client: critic({
        ...allFive,
        requiredPresent: [],
        excludedFound: [],
        teaserChecks: {
          ...passingTeaserChecks,
          milestone: { evidence: "Six candles are visible.", correct: false },
        },
        notes: "The candle count contradicts the fourth-birthday brief.",
      }),
      reviewMode: "teaser",
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.failureCodes).toEqual(expect.arrayContaining(["brief-fidelity", "age-appropriate"]));
    expect(verdict.teaserChecks?.milestone).toEqual(expect.objectContaining({
      required: true,
      evidence: "Six candles are visible.",
      correct: false,
    }));
  });

  it("rejects palette-only named characters and stock-promo purchase desire", async () => {
    const namedBrief = brief({
      themeName: "Blippi + Meekah",
      requirements: { required: [], preferred: [], excluded: [] },
    });
    const verdict = await runVisionGate({
      bytes: artworkPng(),
      concept: concept({ minOverlay: "none" }),
      brief: namedBrief,
      client: critic({
        ...allFive,
        requiredPresent: [],
        excludedFound: [],
        teaserChecks: {
          milestone: { evidence: "No exact count required.", correct: true },
          identity: { evidence: "Meekah is only suggested by purple clothing.", accurate: false },
          purchase: { evidence: "The scene feels like a stock promo.", wouldCreatePurchaseDesire: false },
        },
        notes: "Generic adjacent identity and synthetic promo finish.",
      }),
      reviewMode: "teaser",
    });

    expect(verdict.passed).toBe(false);
    expect(verdict.failureCodes).toEqual(expect.arrayContaining(["brief-fidelity", "premium-feel"]));
    expect(verdict.teaserChecks?.identity.required).toBe(true);
  });

  it("reviews a paper-panel concept as the final protected card without hiding required subjects", async () => {
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
                  requiredPresent: [],
                  excludedFound: [],
                  notes: "The required artwork remains visible outside the protected type panel.",
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
      concept: concept({ minOverlay: "plate" }),
      brief: brief(),
      client: capturingCritic,
    });

    expect(verdict.passed).toBe(true);
    expect(reviewText).toContain("FINAL TYPE PROTECTION: a 94%-opaque solid paper panel");
    expect(reviewText).toContain("Treat raw pixels beneath the box as covered");
    expect(reviewText).toContain("Required subjects must remain clearly recognizable outside the panel");
  });

  it("reviews a replacement identity without sending the inherited feeling to the critic", async () => {
    let reviewText = "";
    let systemText = "";
    const capturingCritic = {
      messages: {
        create: async (request: any) => {
          systemText = request.system;
          reviewText = request.messages[0].content.find((part: any) => part.type === "text")?.text ?? "";
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ ...allFive, requiredPresent: [], excludedFound: [], notes: "" }),
              },
            ],
            usage: { input_tokens: 1200, output_tokens: 180 },
          };
        },
      },
    } as unknown as Anthropic;

    await runVisionGate({
      bytes: artworkPng(),
      concept: concept(),
      brief: brief({
        vibe: "Construction / Dump Truck",
        themeName: "KPop Demon Hunters",
        visualIdentityOverride: "KPop Demon Hunters",
      }),
      client: capturingCritic,
    });

    expect(reviewText).toContain("Current host-selected visual identity: KPop Demon Hunters");
    expect(reviewText).not.toContain("Intended feeling: Construction");
    expect(systemText).toContain("all-ages action or fantasy identity");
    expect(systemText).toContain("non-graphic supernatural creatures");
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
    let calls = 0;
    const verdict = await runVisionGate({
      bytes: artworkPng(),
      concept: concept(),
      brief: brief(),
      client: { messages: { create: async () => {
        calls += 1;
        return { content: [{ type: "text", text: "looks nice!" }], usage: {} };
      } } } as unknown as Anthropic,
    });
    expect(calls).toBe(2);
    expect(verdict.unavailable).toBe(true);
    expect(verdict.passed).toBe(false);
  });

  it("retries one malformed critic response and accepts only a valid ordinary verdict", async () => {
    let calls = 0;
    const valid = {
      ...allFive,
      requiredPresent: [],
      excludedFound: [],
      notes: "clean repair",
    };
    const verdict = await runVisionGate({
      bytes: artworkPng(),
      concept: concept(),
      brief: brief(),
      client: { messages: { create: async () => {
        calls += 1;
        return {
          content: [{ type: "text", text: calls === 1 ? "The image is excellent." : JSON.stringify(valid) }],
          usage: { input_tokens: 10, output_tokens: 5 },
        };
      } } } as unknown as Anthropic,
    });

    expect(calls).toBe(2);
    expect(verdict.unavailable).toBe(false);
    expect(verdict.passed).toBe(true);
    expect(verdict.notes).toBe("clean repair");
    expect(verdict.usage).toEqual({ inputTokens: 20, outputTokens: 10 });
  });

  it("prices the critic call for the ledger", () => {
    expect(visionCostUsd({ inputTokens: 1_000_000, outputTokens: 0 })).toBeCloseTo(3);
    expect(visionCostUsd({ inputTokens: 0, outputTokens: 1_000_000 })).toBeCloseTo(15);
  });
});

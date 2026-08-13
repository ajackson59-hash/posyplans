// Regression for the seven-attempt construction failure.
//
// All providers are fakes. The important boundary is that the entire creative
// quartet must prove full-event fidelity and meaningful diversity before the
// injected image generator can be reached, even when only one proof image is
// requested.

import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { parseAiFirstConcept, type AiFirstConcept } from "@shared/aiFirstInvite";
import type { EventBrief } from "../server/aiFirst/brief";
import { preflightConceptQuartet } from "../server/aiFirst/conceptQuartet";
import { subjectFamiliesForBrief } from "../server/aiFirst/conceptPreflight";
import { runConceptOnlyProof } from "../server/aiFirst/conceptOnlyProof";
import { runAiFirstPipeline } from "../server/aiFirst/pipeline";
import { InMemoryPreviewStore } from "../server/aiFirst/previewStore";
import { InMemoryUsageStore } from "../server/aiFirst/usage";
import { artworkForAspect, concept } from "./aiFirstFixtures";

export const CONSTRUCTION_REVIEW_BRIEF: EventBrief = {
  eventName: "I'm 3 & Digging It",
  eventType: "Birthday Party",
  milestone: "3rd",
  vibe: "A backyard BBQ construction themed for our favorite little builder. Theme heavily centered around construction and building.",
  themeName: "construction / little builder",
  colors: ["warm construction yellow", "ink navy", "concrete cream"],
  formality: "refined-playful",
  dateLine: "",
  season: "summer",
  venueType: "private home",
  guestCount: 24,
  dna: {},
  inspirationNotes: "Modern, polished, age-appropriate invitation; elevated rather than cartoonish.",
  requirements: {
    required: [
      "the backyard BBQ construction / little-builder visual identity, unmistakably present",
      "age-appropriate celebratory character for a 3rd birthday",
    ],
    preferred: ["modern stationery finish"],
    excluded: ["generic equipment poster", "babyish clip art", "generated text"],
  },
};

export const CONSTRUCTION_REVIEW_QUARTET: AiFirstConcept[] = [
  concept({
    conceptName: "Backyard Build Day",
    description: "A cinematic third-birthday construction story unfolding across a polished backyard BBQ.",
    focalStrategy: "narrative-scene",
    visualMood: "cinematic-narrative",
    styleLaneId: "editorial-premium",
    fontPairingId: "garden-editorial-type",
    baseThemeId: "garden-editorial",
    placementId: "centre",
    layoutStyle: "banner",
    art: {
      medium: "editorial watercolor",
      composition: "wide upper-banner backyard build-zone party scene above a calm lower type panel",
      prompt:
        "A refined summer backyard BBQ transformed into a third-birthday little-builder jobsite celebration: measured lumber and scaffold frames create a timber build zone, hard hats and safety cones rest near a picnic table, restrained bunting, warm late-afternoon light, ink navy shadows, concrete cream and construction yellow, sophisticated watercolor detail, festive but never cartoonish.",
    },
    safeTypographyRegion: "lower-third",
    minOverlay: "veil",
  }),
  concept({
    conceptName: "Yellow Iron Study",
    description: "A sculptural bulldozer detail gives the third-birthday construction celebration editorial weight.",
    focalStrategy: "iconic-detail",
    visualMood: "sculptural-editorial",
    styleLaneId: "bold-graphic",
    fontPairingId: "deco-luxe",
    baseThemeId: "dinosaur-museum",
    placementId: "high",
    layoutStyle: "full-bleed",
    art: {
      medium: "layered gouache",
      composition: "close sculptural crop of one bulldozer track and blade below a quiet upper third",
      prompt:
        "A beautifully observed bulldozer steel track and blade treated as premium editorial machinery detail, parked on a backyard lawn with one hard hat and a distant picnic-table garland signaling a polished third-birthday BBQ, restrained construction yellow, charcoal, warm cream and brushed-metal texture, bold but age-appropriate.",
    },
    safeTypographyRegion: "upper-third",
    minOverlay: "none",
  }),
  concept({
    conceptName: "Site Plan Celebration",
    description: "A modern third-birthday construction world built from backyard site-plan graphics and party rhythm.",
    focalStrategy: "graphic-world",
    visualMood: "graphic-modernist",
    styleLaneId: "minimal-modern",
    fontPairingId: "minimal-geometric",
    baseThemeId: "meadow-storybook",
    placementId: "left-column",
    layoutStyle: "split",
    art: {
      medium: "cut-paper collage",
      composition: "tall site-plan grid with layered construction markings beside a quiet text panel",
      prompt:
        "An intelligent cut-paper backyard site plan for a little-builder third birthday: survey grid, measured lumber shapes, tiny traffic-cone markers, caution-stripe rhythm, picnic-table footprint and confetti-like construction markings, modern warm yellow, navy and concrete cream, unmistakably construction and celebration without a full vehicle or generic blueprint poster.",
    },
    safeTypographyRegion: "right-panel",
    minOverlay: "plate",
  }),
  concept({
    conceptName: "Builder's Table",
    description: "A tactile third-birthday builder still life makes the backyard BBQ feel collected and personal.",
    focalStrategy: "tactile-still-life",
    visualMood: "tactile-artisanal",
    styleLaneId: "handcrafted-rustic",
    fontPairingId: "rustic-handwritten",
    baseThemeId: "garden-editorial",
    placementId: "centre",
    layoutStyle: "centered",
    art: {
      medium: "hand-carved linocut",
      composition: "small centred still life of builder materials with generous ivory breathing room",
      prompt:
        "An elevated backyard third-birthday party-table still life arranged from a child-sized hard hat, measuring tape, work gloves, neat lumber offcuts and one shovel, softened by restrained bunting and a single birthday candle, tactile hand-carved linocut grain in construction yellow, ink navy and warm ivory, artisanal and celebratory rather than clip art.",
    },
    safeTypographyRegion: "lower-third",
    minOverlay: "none",
  }),
];

const passingVision = {
  textLogoWatermarkFree: 5,
  artifactFree: 5,
  premiumFinish: 5,
  briefFidelity: 5,
  compositionQuality: 5,
  ageAppropriate: 5,
  requiredPresent: [{ requirement: "construction identity", present: true }],
  excludedFound: [],
  notes: "fixture pass",
};

function quartetClient(concepts: AiFirstConcept[], onEmit?: () => void): Anthropic {
  return {
    messages: {
      stream: async () =>
        (async function* () {
          for (const item of concepts) {
            onEmit?.();
            yield { type: "content_block_delta", delta: { type: "text_delta", text: `${JSON.stringify(item)}\n` } };
          }
        })(),
      create: async () => ({
        content: [{ type: "text", text: JSON.stringify(passingVision) }],
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    },
  } as unknown as Anthropic;
}

const FAILED_PROVIDER_QUARTET: AiFirstConcept[] = CONSTRUCTION_REVIEW_QUARTET.map((item, index) => {
  const names = [
    "Jobsite Celebration — Narrative Scene",
    "Steel & Confetti — Iconic Detail",
    "Site Plan for a Party — Graphic World",
    "Builder's Table — Tactile Still Life",
  ];
  const prompts = [
    "A dump truck dominates a backyard birthday construction jobsite with hard hats, lumber, a picnic table and party bunting.",
    "A dump truck isolated as an editorial object at a backyard birthday party.",
    "A dump truck dominates a backyard birthday blueprint site-plan world with survey grids, measured lumber and construction markings.",
    "A dump truck dominates a backyard birthday builder still life with a hard hat, measuring tape, work gloves and lumber offcuts.",
  ];
  return concept({
    ...item,
    conceptName: names[index],
    description: "A polished construction direction for a backyard little-builder celebration.",
    art: {
      medium: "digital illustration",
      composition: `provider composition ${index + 1}`,
      prompt: prompts[index],
    },
  });
});

function sequentialQuartetClient(attempts: AiFirstConcept[][]): {
  client: Anthropic;
  streamCalls: () => number;
} {
  let calls = 0;
  const client = {
    messages: {
      stream: async () => {
        const concepts = attempts[Math.min(calls, attempts.length - 1)];
        calls += 1;
        return (async function* () {
          for (const item of concepts) {
            yield { type: "content_block_delta", delta: { type: "text_delta", text: `${JSON.stringify(item)}\n` } };
          }
        })();
      },
    },
  } as unknown as Anthropic;
  return { client, streamCalls: () => calls };
}

describe("whole-quartet creative preflight", () => {
  it("does not misclassify a construction dump-truck brief as vehicles/racing", () => {
    const families = subjectFamiliesForBrief(CONSTRUCTION_REVIEW_BRIEF).map((family) => family.id);
    expect(families).toContain("construction");
    expect(families).not.toContain("vehicles");
  });

  it("deterministically restores required milestone and construction cues without a correction call", async () => {
    const omittedFacts = CONSTRUCTION_REVIEW_QUARTET.map((item, index) =>
      index === 0
        ? concept({
            ...item,
            art: {
              ...item.art,
              composition: "wide outdoor scene with a quiet centre",
              prompt: "A refined backyard birthday scene with bunting and one construction jobsite.",
            },
          })
        : index === 1
          ? concept({ ...item, description: "A sculptural construction detail for a polished backyard celebration." })
          : item,
    );
    let calls = 0;
    const result = await runConceptOnlyProof({
      brief: CONSTRUCTION_REVIEW_BRIEF,
      anthropic: quartetClient(omittedFacts, () => {
        calls += 1;
      }),
    });

    expect(calls).toBe(4);
    expect(result.concepts[0].art.prompt).toContain("hard hats");
    expect(result.concepts[1].description).toContain("3rd birthday");
    expect(result.conceptRejections).toBe(0);
  });

  it("keeps every review fixture inside the production concept schema", () => {
    CONSTRUCTION_REVIEW_QUARTET.forEach((item, index) => {
      const parsed = parseAiFirstConcept(item);
      if (!parsed.ok) throw new Error(`fixture ${index + 1}: ${parsed.errors.join("; ")}`);
    });
  });

  it("approves four distinct interpretations carrying third birthday, backyard BBQ, and construction", () => {
    const result = preflightConceptQuartet(CONSTRUCTION_REVIEW_QUARTET, CONSTRUCTION_REVIEW_BRIEF);
    if (process.env.POSY_PRINT_CONCEPT_REVIEW === "1") {
      process.stdout.write(`\nPOSY_CONCEPT_REVIEW=${JSON.stringify(result.reviewCards, null, 2)}\n`);
    }
    expect(result.errors).toEqual([]);
    expect(result.reviewCards).toHaveLength(4);
    expect(new Set(result.reviewCards.map((card) => card.focalStrategy)).size).toBe(4);
    expect(new Set(result.reviewCards.map((card) => card.medium)).size).toBe(4);
    for (const card of result.reviewCards) {
      expect(card.exactArtworkPrompt).toContain("BINDING EVENT-BRIEF CONSTRAINTS");
      expect(card.exactArtworkPrompt).toContain("3rd birthday");
      expect(card.exactArtworkPrompt).toContain("No text, no letters, no words, no numbers");
    }
  });

  it("blocks the canary's upper-third promise with a centred inherited placement before image spend", () => {
    const mismatched = CONSTRUCTION_REVIEW_QUARTET.map((item, index) =>
      index === 0
        ? concept({
            ...item,
            layoutStyle: "full-bleed",
            baseThemeId: "garden-editorial",
            placementId: "centre",
            safeTypographyRegion: "upper-third",
          })
        : item,
    );
    const result = preflightConceptQuartet(mismatched, CONSTRUCTION_REVIEW_BRIEF);
    expect(result.passed).toBe(false);
    expect(result.errors.join(" ")).toContain('safeTypographyRegion "upper-third" covers only');
  });

  it("canonicalizes a provider geometry mismatch before correction or image spend", async () => {
    const mismatched = CONSTRUCTION_REVIEW_QUARTET.map((item, index) =>
      index === 1
        ? concept({
            ...item,
            layoutStyle: "full-bleed",
            baseThemeId: "deco-midnight",
            placementId: "high",
            safeTypographyRegion: "upper-third",
          })
        : item,
    );
    let emitted = 0;
    const result = await runConceptOnlyProof({
      brief: CONSTRUCTION_REVIEW_BRIEF,
      anthropic: quartetClient(mismatched, () => {
        emitted += 1;
      }),
    });

    expect(emitted).toBe(4);
    expect(result.concepts[1].safeTypographyRegion).toBe("center");
    expect(result.conceptRejections).toBe(0);
    expect(result.imageProviderCalls).toBe(0);
    expect(result.billedArtworkAttempts).toBe(0);
  });

  it("repairs the exact milestone/media/machine failure once while preserving the zero-image boundary", async () => {
    const first = preflightConceptQuartet(FAILED_PROVIDER_QUARTET, CONSTRUCTION_REVIEW_BRIEF);
    const failures = first.errors.join(" ");
    expect(failures).toContain("host-facing description omits the 3rd milestone");
    expect(failures).toContain("artwork direction omits the 3rd milestone");
    expect(failures).toContain("at least two coherent construction/jobsite cue groups");
    expect(failures).toContain("4 distinct illustration media");
    expect(failures).toContain("repeats dump truck as a dominant subject");
    expect(failures).toContain("machine-led construction artwork in more than two directions");

    const sequence = sequentialQuartetClient([FAILED_PROVIDER_QUARTET, CONSTRUCTION_REVIEW_QUARTET]);
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error("text-only concept correction must never reach an image provider");
    }) as typeof fetch;
    try {
      const result = await runConceptOnlyProof({
        brief: CONSTRUCTION_REVIEW_BRIEF,
        anthropic: sequence.client,
      });
      expect(sequence.streamCalls()).toBe(2);
      expect(result.concepts).toEqual(CONSTRUCTION_REVIEW_QUARTET);
      expect(result.conceptRejections).toBeGreaterThan(0);
      expect(result.imageProviderCalls).toBe(0);
      expect(result.billedArtworkAttempts).toBe(0);
      expect(fetchCalls).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("stops after one text-only correction instead of looping", async () => {
    const sequence = sequentialQuartetClient([
      FAILED_PROVIDER_QUARTET,
      FAILED_PROVIDER_QUARTET,
      CONSTRUCTION_REVIEW_QUARTET,
    ]);
    await expect(
      runConceptOnlyProof({ brief: CONSTRUCTION_REVIEW_BRIEF, anthropic: sequence.client }),
    ).rejects.toThrow("after 1 text-only correction pass");
    expect(sequence.streamCalls()).toBe(2);
  });

  it("repairs prompt-level machine repetition before the image boundary while the raw gate stays strict", async () => {
    const repetitive = CONSTRUCTION_REVIEW_QUARTET.map((item, index) =>
      concept({
        ...item,
        conceptName: `Excavator Variation ${index + 1}`,
        description: "A third-birthday construction excavator scene for a backyard BBQ.",
        art: {
          medium: ["watercolor", "gouache", "cut-paper collage", "linocut"][index],
          // This deliberately keeps the structural field generic. The
          // regression was that three strategies were checked only here,
          // allowing the provider prompt below to repeat the paid subject.
          composition: `distinct abstract composition lane ${index + 1}`,
          prompt:
            "A giant yellow excavator dominates a backyard birthday BBQ jobsite scene with party bunting, builder tools, construction materials, and blueprint markings.",
        },
      }),
    );
    let imageCalls = 0;

    const raw = preflightConceptQuartet(repetitive, CONSTRUCTION_REVIEW_BRIEF);
    expect(raw.passed).toBe(false);
    expect(raw.errors).toContain("quartet repeats machine-led construction artwork in more than two directions");
    expect(raw.errors).toContain("quartet repeats excavator as a dominant subject");

    const summary = await runAiFirstPipeline({
      eventId: 1,
      brief: CONSTRUCTION_REVIEW_BRIEF,
      previewStore: new InMemoryPreviewStore(),
      usageStore: new InMemoryUsageStore(),
      allowance: 1,
      directionLimit: 1,
      disableAutomaticRetry: true,
      sink: () => {},
      anthropic: quartetClient(repetitive),
      ocr: false,
      generateImage: async ({ prompt, aspectRatio }) => {
        expect(prompt).not.toMatch(/\b(excavator|digger|dump truck|bulldozer|backhoe|loader|crane)\b/i);
        expect(prompt).toContain("Builder activity and construction materials create the story");
        imageCalls += 1;
        return { bytes: artworkForAspect(aspectRatio), dataUrl: "data:image/png;base64,x", durationMs: 1 };
      },
    });

    expect(summary.directions).toBe(1);
    expect(imageCalls).toBe(1);
  });

  it("compares all four text concepts before a one-image proof can start", async () => {
    let emitted = 0;
    let imageCalls = 0;

    const summary = await runAiFirstPipeline({
      eventId: 1,
      brief: CONSTRUCTION_REVIEW_BRIEF,
      previewStore: new InMemoryPreviewStore(),
      usageStore: new InMemoryUsageStore(),
      allowance: 1,
      directionLimit: 1,
      disableAutomaticRetry: true,
      sink: () => {},
      anthropic: quartetClient(CONSTRUCTION_REVIEW_QUARTET, () => {
        emitted += 1;
      }),
      ocr: false,
      generateImage: async ({ aspectRatio }) => {
        expect(emitted).toBe(4);
        imageCalls += 1;
        return { bytes: artworkForAspect(aspectRatio), dataUrl: "data:image/png;base64,x", durationMs: 1 };
      },
    });

    expect(summary.directions).toBe(1);
    expect(imageCalls).toBe(1);
  });

  it("blocks a direction that drops the backyard celebration even when construction is clear", () => {
    const incomplete = CONSTRUCTION_REVIEW_QUARTET.map((item, index) =>
      index === 2
        ? {
            ...item,
            art: {
              ...item.art,
              prompt:
                "A construction blueprint and survey grid with caution-stripe markings and lumber measurements, modern and precise.",
            },
          }
        : item,
    );
    const result = preflightConceptQuartet(incomplete, CONSTRUCTION_REVIEW_BRIEF);
    expect(result.passed).toBe(false);
    expect(result.errors.join(" ")).toContain("backyard BBQ/outdoor celebration setting");
  });
});

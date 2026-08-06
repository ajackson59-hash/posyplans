// The pipeline, driven end to end with fake providers.
//
// What matters here is not that it produces four cards — it is HOW. Artwork
// starts on the first concept rather than the last, never more than two images
// are in flight, a direction gets exactly one retry, and a direction that
// still fails is replaced rather than shown or silently dropped. The proof
// build got the output right and all four of those wrong.

import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import {
  MAX_ARTWORK_ATTEMPTS,
  PROGRESS_MESSAGES,
  TARGET_CONCEPT_COUNT,
  cropRescueLayouts,
  runAiFirstPipeline,
} from "../server/aiFirst/pipeline";
import { MAX_ARTWORK_CONCURRENCY, InMemoryUsageStore } from "../server/aiFirst/usage";
import { InMemoryPreviewStore } from "../server/aiFirst/previewStore";
import type { PipelineEvent } from "@shared/aiFirstStream";
import type { EventBrief } from "../server/aiFirst/brief";
import type { ArtworkRequest } from "../server/aiFirst/artwork";
import { artworkForAspect, concept, framedArtworkForAspect } from "./aiFirstFixtures";

const brief: EventBrief = {
  eventName: "Ada's 4th Birthday",
  eventType: "birthday",
  milestone: "4th",
  vibe: "modern editorial celebration",
  themeName: "modern editorial",
  colors: ["dusty rose"],
  formality: "playful",
  dateLine: "12 September 2026",
  season: "autumn",
  venueType: "home",
  guestCount: 18,
  dna: {},
  inspirationNotes: "",
  requirements: { required: ["age-appropriate modern editorial artwork"], preferred: [], excluded: ["photographic realism"] },
};

/** Four structurally distinct concepts, as the real model is asked to emit. */
const CONCEPTS = [
  concept({ conceptName: "Lariat & Starlight", baseThemeId: "celestial-heirloom", placementId: "centre", layoutStyle: "full-bleed" }),
  concept({ conceptName: "Dust & Chrome", baseThemeId: "deco-midnight", placementId: "high", layoutStyle: "banner", fontPairingId: "deco-luxe" }),
  concept({ conceptName: "Prairie Orbit", baseThemeId: "meadow-storybook", placementId: "left-column", layoutStyle: "split", fontPairingId: "storybook-garamond" }),
  concept({ conceptName: "Rocket Rodeo", baseThemeId: "neon-arena", placementId: "stacked", layoutStyle: "centered", fontPairingId: "neon-display" }),
];

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const visionBody = (pass: boolean) => ({
  textLogoWatermarkFree: 5,
  artifactFree: 5,
  premiumFinish: pass ? 5 : 2,
  briefFidelity: 5,
  compositionQuality: 5,
  ageAppropriate: 5,
  requiredPresent: [{ requirement: "age-appropriate modern editorial artwork", present: true }],
  excludedFound: [],
  notes: "",
});

interface FakeOptions {
  /** Emits the concepts one at a time with a gap, as a real stream does. */
  conceptGapMs?: number;
  visionPasses?: (call: number) => boolean;
}

function fakeAnthropic(options: FakeOptions = {}): { client: Anthropic; visionCalls: () => number } {
  let visionCalls = 0;
  const client = {
    messages: {
      stream: async () =>
        (async function* () {
          for (const item of CONCEPTS) {
            if (options.conceptGapMs) await wait(options.conceptGapMs);
            yield { type: "content_block_delta", delta: { type: "text_delta", text: `${JSON.stringify(item)}\n` } };
          }
        })(),
      create: async () => {
        visionCalls += 1;
        const pass = options.visionPasses ? options.visionPasses(visionCalls) : true;
        return {
          content: [{ type: "text", text: JSON.stringify(visionBody(pass)) }],
          usage: { input_tokens: 1000, output_tokens: 150 },
        };
      },
    },
  } as unknown as Anthropic;
  return { client, visionCalls: () => visionCalls };
}

interface RunOptions extends FakeOptions {
  artworkDelayMs?: number;
  bytesFor?: (call: number, aspect: ArtworkRequest["aspectRatio"]) => Buffer;
  allowance?: number;
}

async function run(options: RunOptions = {}) {
  const events: PipelineEvent[] = [];
  const usageStore = new InMemoryUsageStore();
  const { client, visionCalls } = fakeAnthropic(options);

  let imageCalls = 0;
  let inFlight = 0;
  let peakInFlight = 0;
  const promptsSeen: string[] = [];

  const summary = await runAiFirstPipeline({
    eventId: 1,
    email: "host@example.com",
    brief,
    previewStore: new InMemoryPreviewStore(),
    usageStore,
    allowance: options.allowance ?? 40,
    sink: (event) => events.push(event),
    anthropic: client,
    ocr: false,
    generateImage: async ({ prompt, aspectRatio }) => {
      imageCalls += 1;
      // Captured before awaiting: two images are in flight, so the counter
      // will have moved on by the time this one resolves.
      const call = imageCalls;
      promptsSeen.push(prompt);
      inFlight += 1;
      peakInFlight = Math.max(peakInFlight, inFlight);
      try {
        await wait(options.artworkDelayMs ?? 5);
        return {
          bytes: options.bytesFor ? options.bytesFor(call, aspectRatio) : artworkForAspect(aspectRatio),
          dataUrl: `data:image/png;base64,fake-${call}`,
          durationMs: 1,
        };
      } finally {
        inFlight -= 1;
      }
    },
  });

  return { summary, events, usageStore, imageCalls: () => imageCalls, visionCalls, peakInFlight: () => peakInFlight, promptsSeen };
}

const directionsOf = (events: PipelineEvent[]) =>
  events.filter((e): e is Extract<PipelineEvent, { type: "direction" }> => e.type === "direction");
const messagesOf = (events: PipelineEvent[]) =>
  events.filter((e): e is Extract<PipelineEvent, { type: "progress" }> => e.type === "progress").map((e) => e.message);

describe("a clean run", () => {
  it("finishes four directions", async () => {
    const { summary, events } = await run();
    expect(summary.directions).toBe(TARGET_CONCEPT_COUNT);
    expect(directionsOf(events)).toHaveLength(4);
    expect(summary.degraded).toEqual([]);
  });

  it("buys exactly one image per direction when nothing fails", async () => {
    const { summary, imageCalls } = await run();
    expect(imageCalls()).toBe(4);
    expect(summary.billedImages).toBe(4);
    expect(summary.retries).toBe(0);
  });

  it("reveals each direction as it is approved, not in one batch at the end", async () => {
    const { events } = await run({ conceptGapMs: 4 });
    const doneAt = events.findIndex((e) => e.type === "done");
    const directionIndexes = events.map((e, i) => (e.type === "direction" ? i : -1)).filter((i) => i >= 0);
    expect(directionIndexes).toHaveLength(4);
    // Every card lands before the run closes, and they are not all adjacent.
    expect(Math.max(...directionIndexes)).toBeLessThan(doneAt);
    expect(directionIndexes[3] - directionIndexes[0]).toBeGreaterThan(3);
  });

  it("does not make a later direction wait for an earlier slow one", async () => {
    const events: PipelineEvent[] = [];
    const { client } = fakeAnthropic();
    let call = 0;
    await runAiFirstPipeline({
      eventId: 1,
      brief,
      previewStore: new InMemoryPreviewStore(),
      usageStore: new InMemoryUsageStore(),
      allowance: 40,
      sink: (event) => events.push(event),
      anthropic: client,
      ocr: false,
      generateImage: async ({ aspectRatio }) => {
        call += 1;
        // The first direction is by far the slowest.
        await wait(call === 1 ? 120 : 5);
        return { bytes: artworkForAspect(aspectRatio), dataUrl: `data:image/png;base64,fake-${call}`, durationMs: 1 };
      },
    });
    const finished = directionsOf(events).map((e) => e.direction.index);
    expect(finished).toHaveLength(4);
    expect(finished[0]).not.toBe(0);
  });

  it("reports real progress messages in order, with no invented timer", async () => {
    const { events } = await run();
    const messages = messagesOf(events);
    expect(messages[0]).toBe(PROGRESS_MESSAGES.understanding);
    expect(messages).toContain(PROGRESS_MESSAGES.firstDirection);
    expect(messages).toContain(PROGRESS_MESSAGES.anotherDirection);
    expect(messages).toContain(PROGRESS_MESSAGES.finishing);
    expect(messages[messages.length - 1]).toBe(PROGRESS_MESSAGES.ready);
  });

  it("uses exactly the five host-facing progress strings", () => {
    expect(Object.values(PROGRESS_MESSAGES)).toEqual([
      "Understanding the event's visual direction…",
      "Creating the first invitation direction…",
      "Building another interpretation…",
      "Checking the finishing details…",
      "Four directions are ready.",
    ]);
  });

  it("times the first concept before the first direction before the last", async () => {
    const { summary } = await run({ conceptGapMs: 3, artworkDelayMs: 10 });
    expect(summary.msToFirstConcept).not.toBeNull();
    expect(summary.msToFirstDirection).not.toBeNull();
    expect(summary.msToFirstConcept!).toBeLessThanOrEqual(summary.msToFirstDirection!);
    expect(summary.msToFirstDirection!).toBeLessThanOrEqual(summary.msToAllDirections!);
  });
});

describe("zero-cost concept preflight", () => {
  it("skips an unthemed concept and spends only on the next direction that depicts the brief", async () => {
    const constructionBrief: EventBrief = {
      ...brief,
      eventName: "Theo is Three",
      themeName: "construction",
      vibe: "modern elevated construction theme",
      requirements: {
        required: ["an unmistakable construction / little-builder visual identity"],
        preferred: [],
        excluded: ["generic abstract geometry"],
      },
    };
    const genericBlueprint = concept({
      conceptName: "Blueprint Morning",
      art: {
        medium: "architectural gouache",
        composition: "asymmetric blueprint geometry",
        prompt: "Inky blueprint lines and amber blocks on softly textured paper.",
      },
    });
    const realConstruction = concept({
      conceptName: "Little Builder",
      art: {
        medium: "cut-paper collage",
        composition: "one excavator crossing the lower third",
        prompt: "A clearly recognisable excavator and hard hat in refined cut paper, warm amber and navy.",
      },
    });
    let imageCalls = 0;
    const events: PipelineEvent[] = [];
    const client = {
      messages: {
        stream: async () =>
          (async function* () {
            yield {
              type: "content_block_delta",
              delta: {
                type: "text_delta",
                text: `${JSON.stringify(genericBlueprint)}\n${JSON.stringify(realConstruction)}\n`,
              },
            };
          })(),
        create: async () => ({
          content: [{ type: "text", text: JSON.stringify(visionBody(true)) }],
          usage: { input_tokens: 10, output_tokens: 10 },
        }),
      },
    } as unknown as Anthropic;

    const summary = await runAiFirstPipeline({
      eventId: 1,
      brief: constructionBrief,
      previewStore: new InMemoryPreviewStore(),
      usageStore: new InMemoryUsageStore(),
      allowance: 1,
      directionLimit: 1,
      disableAutomaticRetry: true,
      sink: (event) => events.push(event),
      anthropic: client,
      ocr: false,
      generateImage: async ({ aspectRatio, prompt }) => {
        imageCalls += 1;
        expect(prompt).toContain("excavator");
        expect(prompt).toContain("BINDING EVENT-BRIEF CONSTRAINTS");
        return { bytes: artworkForAspect(aspectRatio), dataUrl: "data:image/png;base64,x", durationMs: 1 };
      },
    });

    expect(imageCalls).toBe(1);
    expect(summary.billedImages).toBe(1);
    expect(summary.conceptRejections).toBe(1);
    expect(directionsOf(events)[0].direction.concept.conceptName).toBe("Little Builder");
    expect(
      events.some((event) => event.type === "warning" && event.message.includes("blocked before artwork spend")),
    ).toBe(true);
  });
});

describe("concurrency", () => {
  it("never has more than two images in flight", async () => {
    const { peakInFlight } = await run({ artworkDelayMs: 40 });
    expect(MAX_ARTWORK_CONCURRENCY).toBe(2);
    expect(peakInFlight()).toBeLessThanOrEqual(MAX_ARTWORK_CONCURRENCY);
  });

  it("still uses both slots rather than running one at a time", async () => {
    const { peakInFlight } = await run({ artworkDelayMs: 40 });
    expect(peakInFlight()).toBe(2);
  });
});

describe("retry and fallback", () => {
  it("reuses portrait artwork only for the compatible split-layout crop rescue", () => {
    expect(cropRescueLayouts("split")).toEqual(["full-bleed", "backdrop"]);
    expect(cropRescueLayouts("full-bleed")).toEqual([]);
    expect(cropRescueLayouts("banner")).toEqual([]);
  });

  it("retries a failed direction exactly once", async () => {
    // Every vision call fails, so every direction exhausts its attempts.
    const { summary, imageCalls } = await run({ visionPasses: () => false });
    expect(MAX_ARTWORK_ATTEMPTS).toBe(2);
    expect(imageCalls()).toBe(4 * MAX_ARTWORK_ATTEMPTS);
    expect(summary.retries).toBe(4);
  });

  it("replaces a direction that fails twice instead of showing it", async () => {
    const { summary, events } = await run({ visionPasses: () => false });
    expect(summary.directions).toBe(4);
    expect(summary.adaptedDirections).toBe(4);
    for (const event of directionsOf(events)) {
      expect(event.direction.source).toBe("adapted-studio-direction");
    }
  });

  it("still returns four customer-safe choices when every image is defective", async () => {
    const { summary, events } = await run({ bytesFor: (_call, aspect) => framedArtworkForAspect(aspect) });
    expect(summary.directions).toBe(4);
    expect(directionsOf(events)).toHaveLength(4);
  });

  it("keeps the evidence of what failed rather than discarding it", async () => {
    const { events } = await run({ bytesFor: (_call, aspect) => framedArtworkForAspect(aspect) });
    const attempts = directionsOf(events).flatMap((e) => e.direction.attempts);
    expect(attempts.length).toBeGreaterThan(0);
    expect(attempts.some((a) => a.failureCodes.includes("printed-margin"))).toBe(true);
    // Both attempts are on the record, not just the last one.
    expect(directionsOf(events).every((e) => e.direction.attempts.length === MAX_ARTWORK_ATTEMPTS)).toBe(true);
  });

  it("makes the retry prompt name the measured defect", async () => {
    const { promptsSeen } = await run({ bytesFor: (_call, aspect) => framedArtworkForAspect(aspect) });
    const retries = promptsSeen.filter((p) => p.includes("CRITICAL"));
    expect(retries.length).toBe(4);
    expect(retries[0].toLowerCase()).toContain("paper margin");
  });

  it("does not pay the vision critic for an image tier 1 already rejected", async () => {
    const { visionCalls } = await run({ bytesFor: (_call, aspect) => framedArtworkForAspect(aspect) });
    expect(visionCalls()).toBe(0);
  });

  it("succeeds on the retry when the second image is good", async () => {
    // Direction 1's first image is defective; everything else is clean.
    const { summary } = await run({ bytesFor: (call, aspect) => (call === 1 ? framedArtworkForAspect(aspect) : artworkForAspect(aspect)) });
    expect(summary.directions).toBe(4);
    expect(summary.adaptedDirections).toBe(0);
    expect(summary.retries).toBe(1);
  });
});

describe("the ledger the run writes", () => {
  it("bills each image once and marks only the retry automatic", async () => {
    const { usageStore } = await run({ bytesFor: (call, aspect) => (call === 1 ? framedArtworkForAspect(aspect) : artworkForAspect(aspect)) });
    const billed = usageStore.all.filter((row) => row.billed);
    expect(billed).toHaveLength(5);
    expect(billed.filter((row) => row.automatic)).toHaveLength(1);
    expect(billed.filter((row) => row.reason === "quality-retry")).toHaveLength(1);
  });

  it("stops spending at the allowance instead of overrunning it", async () => {
    const { summary, imageCalls } = await run({ visionPasses: () => false, allowance: 5 });
    expect(imageCalls()).toBe(5);
    expect(summary.billedImages).toBe(5);
    expect(summary.degraded).toContain("billed-image allowance exhausted");
    // The host is still given four choices.
    expect(summary.directions).toBe(4);
  });

  it("charges nothing to reuse an identical concept on a second run", async () => {
    const previewStore = new InMemoryPreviewStore();
    const usageStore = new InMemoryUsageStore();
    const base = {
      eventId: 1,
      brief,
      previewStore,
      usageStore,
      allowance: 40,
      sink: () => {},
      ocr: false,
      generateImage: async ({ aspectRatio }) => ({ bytes: artworkForAspect(aspectRatio), dataUrl: "data:image/png;base64,x", durationMs: 1 }),
    };
    const first = await runAiFirstPipeline({ ...base, anthropic: fakeAnthropic().client });
    const second = await runAiFirstPipeline({ ...base, anthropic: fakeAnthropic().client });
    expect(first.billedImages).toBe(4);
    expect(second.billedImages).toBe(0);
    expect(second.reusedImages).toBe(4);
    expect(second.directions).toBe(4);
  });
});

describe("degradation", () => {
  it("reports a short set rather than pretending it delivered four", async () => {
    const events: PipelineEvent[] = [];
    const partial = {
      messages: {
        stream: async () =>
          (async function* () {
            yield { type: "content_block_delta", delta: { type: "text_delta", text: `${JSON.stringify(CONCEPTS[0])}\n` } };
          })(),
        create: async () => ({
          content: [{ type: "text", text: JSON.stringify(visionBody(true)) }],
          usage: { input_tokens: 10, output_tokens: 10 },
        }),
      },
    } as unknown as Anthropic;

    const summary = await runAiFirstPipeline({
      eventId: 1,
      brief,
      previewStore: new InMemoryPreviewStore(),
      usageStore: new InMemoryUsageStore(),
      allowance: 40,
      sink: (event) => events.push(event),
      anthropic: partial,
      ocr: false,
      generateImage: async ({ aspectRatio }) => ({ bytes: artworkForAspect(aspectRatio), dataUrl: "data:image/png;base64,x", durationMs: 1 }),
    });

    expect(summary.directions).toBe(1);
    expect(summary.degraded.join(" ")).toContain("only 1 of 4");
    expect(messagesOf(events)).not.toContain(PROGRESS_MESSAGES.ready);
  });

  it("does not claim success when the concept stream itself fails", async () => {
    const events: PipelineEvent[] = [];
    const broken = {
      messages: {
        stream: async () => {
          throw new Error("model unavailable");
        },
      },
    } as unknown as Anthropic;

    await expect(
      runAiFirstPipeline({
        eventId: 1,
        brief,
        previewStore: new InMemoryPreviewStore(),
        usageStore: new InMemoryUsageStore(),
        allowance: 40,
        sink: (event) => events.push(event),
        anthropic: broken,
        ocr: false,
        generateImage: async ({ aspectRatio }) => ({ bytes: artworkForAspect(aspectRatio), dataUrl: "data:image/png;base64,x", durationMs: 1 }),
      }),
    ).rejects.toThrow("concept generation failed: model unavailable");

    // The route persists the failed run, then emits the single error terminal.
    expect(events.some((e) => e.type === "error" || e.type === "done")).toBe(false);
  });
});

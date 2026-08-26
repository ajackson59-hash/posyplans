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
import type { AiFirstConcept } from "@shared/aiFirstInvite";
import { evaluateCropSafety } from "@shared/aiFirstLayout";
import {
  artworkForAspect,
  busyTypeRegionPng,
  concept,
  conceptQuartet,
  framedArtworkForAspect,
} from "./aiFirstFixtures";

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
const CONCEPTS = conceptQuartet(
  concept({ conceptName: "Lariat & Starlight", baseThemeId: "celestial-heirloom", placementId: "centre" }),
);

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
  concepts?: AiFirstConcept[];
}

function fakeAnthropic(options: FakeOptions = {}): { client: Anthropic; visionCalls: () => number } {
  let visionCalls = 0;
  const client = {
    messages: {
      stream: async () =>
        (async function* () {
          for (const item of options.concepts ?? CONCEPTS) {
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
    const { summary, events, imageCalls } = await run();
    expect(imageCalls()).toBe(4);
    expect(summary.billedImages).toBe(4);
    expect(summary.retries).toBe(0);
    const narrative = directionsOf(events).find((event) => event.direction.index === 0)?.direction;
    expect(narrative?.concept.layoutStyle).toBe("banner");
    expect(narrative?.overlay).toBe("veil");
  });

  it("validates all concepts before revealing each approved artwork direction", async () => {
    const { events } = await run({ conceptGapMs: 4 });
    const doneAt = events.findIndex((e) => e.type === "done");
    const directionIndexes = events.map((e, i) => (e.type === "direction" ? i : -1)).filter((i) => i >= 0);
    const conceptIndexes = events.map((e, i) => (e.type === "concept" ? i : -1)).filter((i) => i >= 0);
    expect(directionIndexes).toHaveLength(4);
    expect(conceptIndexes).toHaveLength(4);
    // The complete text quartet is visible before the first paid result, and
    // every approved card still lands before the run closes.
    expect(Math.max(...conceptIndexes)).toBeLessThan(Math.min(...directionIndexes));
    expect(Math.max(...directionIndexes)).toBeLessThan(doneAt);
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

  it("uses exactly the six host-facing progress strings", () => {
    expect(Object.values(PROGRESS_MESSAGES)).toEqual([
      "Understanding the event's visual direction…",
      "Comparing four creative directions before artwork…",
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
  it("reuses portrait artwork for every layout whose crop math can genuinely differ", () => {
    // split's art box is a narrow 40%-wide panel — a materially different
    // crop from the two full-canvas layouts, so it is always worth trying.
    expect(cropRescueLayouts("split")).toEqual(["full-bleed", "backdrop"]);
    // full-bleed and backdrop share the exact same 100%x100% art box (they
    // differ only in artwork opacity, which evaluateCropSafety ignores), so
    // rescuing one into the other can never change a crop-unsafe verdict.
    // They are still attempted — the candidate loop's own tier1 re-check
    // means a dead branch is inert, not incorrect — and split, which does
    // have different geometry, is offered as the one candidate that can
    // actually rescue a full-bleed/backdrop crop failure.
    expect(cropRescueLayouts("full-bleed")).toEqual(["backdrop", "split"]);
    expect(cropRescueLayouts("backdrop")).toEqual(["full-bleed", "split"]);
    // banner and centered keep their own aspect ratio / frame shape and have
    // no compatible portrait sibling to fall back to.
    expect(cropRescueLayouts("banner")).toEqual([]);
    expect(cropRescueLayouts("centered")).toEqual([]);
  });

  it("confirms full-bleed and backdrop art boxes are geometrically identical", () => {
    // This is the reason the previous test's full-bleed/backdrop pairing is
    // a safety net rather than an active fix: evaluateCropSafety only reads
    // LAYOUT_FRAMES[...].art (never artOpacity), and full-bleed/backdrop
    // share the same art frame, so a crop-unsafe verdict against one always
    // reproduces identically against the other.
    const canvas = { width: 1024, height: 1536 };
    const salientRegion = [{ x: 0, y: 0, width: 0.2, height: 0.08 }];
    const fullBleed = evaluateCropSafety("full-bleed", canvas, salientRegion);
    const backdrop = evaluateCropSafety("backdrop", canvas, salientRegion);
    expect(backdrop.worstCroppedFraction).toBe(fullBleed.worstCroppedFraction);
    expect(backdrop.safe).toBe(fullBleed.safe);
  });

  it("lets split's narrower panel rescue a crop that clips a full-bleed region", () => {
    // full-bleed's visible window loses ~11% off the top/bottom (a 1024x1536
    // portrait image cropped to feed a 3:4 card). A salient region sitting
    // just below the top margin is more than a quarter clipped there —
    // genuinely crop-unsafe — but split's visible window spans the full
    // vertical extent, so the identical region is completely visible under
    // split. This is the exact shape of geometry that makes full-bleed to
    // split (not full-bleed to backdrop) the rescue that can actually work.
    const canvas = { width: 1024, height: 1536 };
    const salientRegion = [{ x: 0.4, y: 0.01, width: 0.2, height: 0.1 }];
    const fullBleed = evaluateCropSafety("full-bleed", canvas, salientRegion);
    const split = evaluateCropSafety("split", canvas, salientRegion);
    expect(fullBleed.safe).toBe(false);
    expect(fullBleed.issues[0]?.code).toBe("full-bleed-crop-unsafe");
    expect(split.safe).toBe(true);
    expect(split.worstCroppedFraction).toBe(0);
  });

  it("retries a failed direction exactly once", async () => {
    // Every vision call fails, so every direction exhausts its attempts.
    const { summary, imageCalls } = await run({ visionPasses: () => false });
    expect(MAX_ARTWORK_ATTEMPTS).toBe(2);
    expect(imageCalls()).toBe(4 * MAX_ARTWORK_ATTEMPTS);
    expect(summary.retries).toBe(4);
  });

  it("rescues a quiet-region-only failure with a local paper panel and no second image call", async () => {
    const concepts = CONCEPTS.map((item) => ({ ...item }));
    [concepts[0].focalStrategy, concepts[1].focalStrategy] = [concepts[1].focalStrategy, concepts[0].focalStrategy];
    [concepts[0].visualMood, concepts[1].visualMood] = [concepts[1].visualMood, concepts[0].visualMood];
    const { summary, events, imageCalls } = await run({
      concepts,
      bytesFor: (call, aspect) => (call === 1 ? busyTypeRegionPng() : artworkForAspect(aspect)),
    });

    expect(imageCalls()).toBe(4);
    expect(summary.billedImages).toBe(4);
    expect(summary.retries).toBe(0);
    expect(summary.degraded).toContain(
      "direction 1 reused its paid artwork with a deterministic paper panel after a quiet-region-only failure",
    );
    expect(directionsOf(events).find((event) => event.direction.index === 0)?.direction.overlay).toBe("plate");
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
  it("blocks an incomplete concept set instead of spending on a short set", async () => {
    const events: PipelineEvent[] = [];
    let imageCalls = 0;
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

    await expect(
      runAiFirstPipeline({
        eventId: 1,
        brief,
        previewStore: new InMemoryPreviewStore(),
        usageStore: new InMemoryUsageStore(),
        allowance: 40,
        sink: (event) => events.push(event),
        anthropic: partial,
        ocr: false,
        generateImage: async ({ aspectRatio }) => {
          imageCalls += 1;
          return { bytes: artworkForAspect(aspectRatio), dataUrl: "data:image/png;base64,x", durationMs: 1 };
        },
      }),
    ).rejects.toThrow("concept provider returned 1; exactly 4 are required before artwork spend");

    expect(imageCalls).toBe(0);
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

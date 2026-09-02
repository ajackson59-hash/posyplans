import { afterEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import type { Event } from "@shared/schema";
import type { Tier1Result } from "../server/aiFirst/tier1";
import type { VisionVerdict } from "../server/aiFirst/visionGate";
import { decodePng, encodePng, readPngSize } from "../server/aiFirst/png";
import {
  buildDirectionCard,
  buildQualityLockedPreviewBrief,
  clearNamedThemeDetectionCache,
  detectNamedCreativeReference,
  detectNamedCreativeReferenceSync,
  directionCardDataUrl,
  generateQualityLockedPreview,
  readPrePaymentPreviewMode,
} from "../server/prePaymentPreviewQuality";

/** Minimal fake matching the one Anthropic call shape this module needs. */
function fakeAnthropicClient(jsonText: string): Anthropic {
  return {
    messages: {
      create: vi.fn(async () => ({
        content: [{ type: "text", text: jsonText }],
      })),
    },
  } as unknown as Anthropic;
}

const event = {
  id: 10,
  eventName: "Brian and Blippi's Extravaganza",
  eventType: "Birthday Party",
  eventDate: "Saturday, November 7, 2026",
  themeName: "",
  vibeDescription:
    "Brian's fourth birthday with Blippi and Mika at indoor soft play with bubbles and ice cream treats.",
  paletteColors: "[]",
  estimatedGuestCount: 32,
  prePaymentPreviewAttempts: 0,
  prePaymentPreviewUrl: "",
  prePaymentPreviewUsedAt: null,
  sparkUnlockedAt: null,
} as unknown as Event;

function generatedPng(fill: number, width = 630, height = 1120): Buffer {
  const rgb = new Uint8Array(width * height * 3);
  rgb.fill(fill);
  return encodePng({ width, height, rgb });
}

function tier1(passed = true): Tier1Result {
  return {
    passed,
    findings: passed ? [] : [{ code: "printed-margin", critical: true, message: "printed margin" }],
    salientRegions: [],
    durationMs: 1,
  };
}

function vision(passed: boolean, notes = "none"): VisionVerdict {
  return {
    scores: {
      textLogoWatermarkFree: passed ? 5 : 4,
      artifactFree: 5,
      premiumFinish: 5,
      briefFidelity: passed ? 5 : 2,
      compositionQuality: 5,
      ageAppropriate: 5,
    },
    requiredPresent: passed
      ? [{ requirement: "Blippi and Meekah together", present: true }]
      : [{ requirement: "Blippi and Meekah together", present: false }],
    excludedFound: [],
    notes,
    passed,
    failureCodes: passed ? [] : ["brief-fidelity"],
    unavailable: false,
    durationMs: 1,
    usage: { inputTokens: 10, outputTokens: 5 },
  };
}

describe("prepayment preview quality lock", () => {
  afterEach(() => {
    clearNamedThemeDetectionCache();
  });

  it("keeps teaser artwork full-bleed instead of generating an unfinished blank panel", async () => {
    const { brief, concept } = await buildQualityLockedPreviewBrief(event);
    expect(concept.minOverlay).toBe("none");
    const binding = brief.requirements.required.join(" ");
    expect(binding).toContain("indoor soft play with bubbles and ice cream treats");
    expect(binding).not.toContain("[VISIBLE MILESTONE]");
    expect(binding).toContain("[VISIBLE NAMED IDENTITY] Blippi is visibly identifiable");
    expect(binding).toContain("[VISIBLE NAMED IDENTITY] Meekah is visibly identifiable");
    expect(concept.art.composition).toContain("no panel");
    expect(concept.art.prompt).toContain("full portrait canvas");
    expect(concept.art.prompt).toContain("NO DESIGN SURFACES");
    expect(concept.art.prompt).toContain("STORY:");
    expect(concept.art.prompt).toContain("DEPTH/MATERIAL");
    expect(concept.art.prompt).toContain("HANDS/PROPS");
    expect(concept.art.prompt).toContain("MILESTONE:");
    expect(concept.art.prompt).toContain("NATIVE STYLE");
    expect(concept.art.prompt).toContain("correct hands, joints, scale, gravity/perspective");
    expect(concept.art.prompt).toContain("contact/cast shadows");
    expect(concept.art.prompt).toContain("controlled saturation");
    expect(concept.art.prompt).toContain("repeated object clusters");
    expect(concept.art.prompt).toContain("directional key + subtle rim light");
    expect(concept.art.prompt).toContain("no food or small props in hands");
    expect(concept.art.prompt.length).toBeLessThanOrEqual(1200);
    expect(concept.art.prompt).not.toContain("invitation artwork");
    expect(concept.art.prompt).not.toContain("stationery artwork");
    expect(concept.borderStyle).toBe("none");
    expect(concept.texture).toEqual({ style: "none", intensity: 0 });
    expect(concept.dividerStyle).toBe("none");
    expect(brief.requirements.excluded).toContain(
      "a visible blank card, white rectangle, paper panel, placard, sign, frame or placeholder box inside the artwork",
    );
    expect(brief.requirements.excluded).toContain(
      "a lead character's face or head cropped off by the canvas edge",
    );
    expect(brief.requirements.excluded).toContain(
      "an invented portrait, gender or physical appearance for the celebrant when the host did not supply a personal visual reference",
    );
    expect(brief.requirements.excluded).toContain(
      "any child in the foreground or central hero plane when the host did not supply a personal visual reference for the celebrant",
    );
    expect(concept.art.prompt).toContain("do not invent any child in the foreground or central hero plane");
    expect(brief.requirements.excluded).toContain(
      "birthday candles, numeral-shaped props or other countable age markers when the host did not explicitly request a count",
    );
    expect(brief.requirements.preferred.join(" ")).not.toMatch(/stationery/i);
    expect(concept.art.prompt).toContain("Do not show birthday candles");
    expect(`${concept.art.medium}.`).not.toContain("illustration illustration");
  });
  it("fails closed to the deterministic direction-card mode", () => {
    expect(readPrePaymentPreviewMode({})).toBe("direction-card");
    expect(readPrePaymentPreviewMode({ POSY_PREPAYMENT_PREVIEW_MODE: "nonsense" })).toBe("direction-card");
    expect(readPrePaymentPreviewMode({ POSY_PREPAYMENT_PREVIEW_MODE: "quality-image" })).toBe("quality-image");
  });

  it("makes an explicit host scene list binding for the final teaser pixels", async () => {
    const detailed = {
      ...event,
      eventName: "Brian's 4th Birthday",
      themeName: "Blippi + Meekah",
      vibeDescription:
        "A joyful fourth birthday at an upscale indoor soft-play center. Include bright foam climbing structures, a ball pit, floating bubbles, and colorful ice-cream treats. The result should feel polished and premium.",
    } as unknown as Event;

    const { brief } = await buildQualityLockedPreviewBrief(detailed);
    const required = brief.requirements.required.join(" \n ");
    expect(required).toContain("[VISIBLE HOST DETAIL] bright foam climbing structures, a ball pit, floating bubbles, and colorful ice-cream treats");
    expect(required).toContain("[VISIBLE HOST DETAIL] an upscale indoor soft-play center");
    expect(required).not.toContain("[VISIBLE MILESTONE]");
    expect(brief.requirements.excluded.join(" ")).toContain("countable age markers");
    expect(brief.requirements.preferred.join(" ")).not.toContain("ball pit");
  });

  it("keeps an exact milestone count binary when the host explicitly asks for candles", async () => {
    const candleEvent = {
      ...event,
      eventName: "Brian's 4th Birthday",
      themeName: "Blippi + Meekah",
      vibeDescription:
        "Blippi and Meekah at indoor soft play with bubbles and ice cream. Include four birthday candles on the cake.",
    } as unknown as Event;

    const { brief, concept } = await buildQualityLockedPreviewBrief(candleEvent);
    expect(brief.requirements.required.join(" ")).toContain(
      "[VISIBLE MILESTONE] exactly four separate unnumbered birthday candles",
    );
    expect(brief.requirements.excluded.join(" ")).not.toContain("countable age markers when the host did not explicitly request a count");
    expect(concept.art.prompt).toContain("show exactly four separate unnumbered birthday candles");
  });

  it("detects exact entertainment references instead of collapsing them to a generic category via the curated fast path", async () => {
    expect((await detectNamedCreativeReference("Blippi and Meekah party"))?.id).toBe("blippi-meekah");
    expect((await detectNamedCreativeReference("Unicorn Academy TV series winter party"))?.id).toBe("unicorn-academy");
    expect(await detectNamedCreativeReference("simple unicorn garden party")).toBeNull();
  });

  it("has no curated entry for a generic theme with no named IP, and the classifier is never consulted when a client is not supplied", async () => {
    // No client and no API key: the general path must fail closed to null
    // rather than throwing, so a transient outage never breaks the preview.
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    expect(await detectNamedCreativeReference("simple dinosaur museum party")).toBeNull();
    vi.unstubAllEnvs();
  });

  it("recognizes an arbitrary named entertainment property via the general LLM classifier, not just the five curated franchises", async () => {
    const cases: { text: string; label: string }[] = [
      { text: "Sesame Street themed party", label: "Sesame Street" },
      { text: "Cocomelon birthday bash", label: "Cocomelon" },
      { text: "Frozen party for my daughter", label: "Frozen" },
      { text: "Spider-Man party for my son", label: "Spider-Man" },
      { text: "Pokemon themed celebration", label: "Pokemon" },
      { text: "Mickey Mouse clubhouse party", label: "Mickey Mouse" },
    ];
    for (const { text, label } of cases) {
      clearNamedThemeDetectionCache();
      const client = fakeAnthropicClient(JSON.stringify({
        named: true,
        label,
        cues: [`${label} world`, "Signature characters", "Event setting", "No generic substitute"],
        palette: ["#111111", "#222222", "#eeeeee", "#999999"],
        requirements: [`The ${label} identity is unmistakable through its real, recognizable visual details—not a generic substitute.`],
      }));
      const detected = await detectNamedCreativeReference(text, { client });
      expect(detected).not.toBeNull();
      expect(detected?.label).toBe(label);
      expect(detected?.id).toMatch(/^named-theme-/);
      expect(detected?.requirements.join(" ")).toContain(label);
    }
  });

  it("memoizes a general classification so a second identical lookup does not call the model again", async () => {
    const client = fakeAnthropicClient(JSON.stringify({
      named: true,
      label: "Bobs Burgers",
      cues: ["a", "b", "c", "d"],
      palette: ["#111111", "#222222", "#eeeeee", "#999999"],
      requirements: ["req one"],
    }));
    const first = await detectNamedCreativeReference("Bobs Burgers party", { client });
    const second = await detectNamedCreativeReference("Bobs Burgers party", { client });
    expect(first?.label).toBe("Bobs Burgers");
    expect(second?.label).toBe("Bobs Burgers");
    expect((client.messages.create as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });

  it("treats a clearly generic theme as not-named even when the classifier is consulted", async () => {
    const client = fakeAnthropicClient(JSON.stringify({ named: false }));
    const detected = await detectNamedCreativeReference("simple dinosaur museum party", { client });
    expect(detected).toBeNull();
  });

  it("fails closed to null instead of throwing when the classifier call errors", async () => {
    const client = {
      messages: { create: vi.fn(async () => { throw new Error("boom"); }) },
    } as unknown as Anthropic;
    const detected = await detectNamedCreativeReference("some never-before-seen franchise party", { client });
    expect(detected).toBeNull();
  });

  it("fails closed to null instead of throwing when Anthropic client construction itself throws, not just the request", async () => {
    // Regression test: client construction (`new Anthropic(...)`) must live
    // inside the same fail-closed try/catch as the request itself. This is
    // exercised by injecting a "client factory" shape that fails exactly
    // where the real constructor would — proving the surrounding try/catch
    // covers construction, not just the network call.
    const throwingClient = new Proxy({}, {
      get() {
        throw new Error("client misconfigured");
      },
    }) as unknown as Anthropic;
    await expect(
      detectNamedCreativeReference("some never-before-seen franchise party", { client: throwingClient }),
    ).resolves.toBeNull();
  });

  it("detectNamedCreativeReferenceSync never touches the network and only recognizes curated franchises", () => {
    // This is the function every pure read path (readiness polling, asset
    // delivery, direction-card rendering) must use so an ordinary page load
    // never pays for or awaits a model call.
    expect(detectNamedCreativeReferenceSync("Blippi and Meekah party")?.id).toBe("blippi-meekah");
    expect(detectNamedCreativeReferenceSync("Sesame Street themed party")).toBeNull();
    expect(detectNamedCreativeReferenceSync("simple unicorn garden party")).toBeNull();
    expect(detectNamedCreativeReferenceSync("")).toBeNull();
  });

  it("buildDirectionCard and directionCardDataUrl are synchronous and never invoke the general classifier by default", () => {
    // Regression test for the read-path latency/cost bug: these are called
    // from readiness polling (every 2.5s) and asset delivery. They must not
    // return a Promise that depends on an awaited model call — curated-only
    // detection is used unless the caller explicitly passes an
    // already-resolved reference.
    const card = buildDirectionCard(event);
    expect(card.headline).toBe("Blippi + Meekah");
    const dataUrl = directionCardDataUrl(event);
    expect(dataUrl).toMatch(/^data:image\/svg\+xml;base64,/);

    const genericEvent = {
      ...event,
      eventName: "Ella's Sesame Street Party",
      themeName: "Sesame Street",
      vibeDescription: "Sesame Street themed party",
    } as unknown as Event;
    // Sesame Street is not curated, and no resolvedNamed override is passed,
    // so the sync path must not recognize it even though the general
    // classifier could — proving no network path is reachable here.
    const genericCard = buildDirectionCard(genericEvent);
    expect(genericCard.namedReference).toBeNull();
  });

  it("buildDirectionCard reflects an already-resolved general-classifier reference when explicitly passed", () => {
    // This is how the background job (after the one legitimate POST-time
    // classifier call) gets the fallback direction card to reflect a
    // non-curated franchise without buildDirectionCard itself awaiting
    // anything.
    const resolved = {
      id: "named-theme-sesame-street",
      trigger: /sesame street/i,
      label: "Sesame Street",
      cues: ["Sesame Street world", "Signature characters", "Event setting", "No generic substitute"],
      palette: ["#111111", "#222222", "#eeeeee", "#999999"],
      requirements: ["The Sesame Street identity is unmistakable through its real, recognizable visual details."],
    };
    const genericEvent = {
      ...event,
      eventName: "Ella's Sesame Street Party",
      themeName: "Sesame Street",
      vibeDescription: "Sesame Street themed party",
    } as unknown as Event;
    const card = buildDirectionCard(genericEvent, resolved);
    expect(card.namedReference).toEqual({ id: "named-theme-sesame-street", label: "Sesame Street" });
  });

  it("builds a useful deterministic proof from the host's actual details", async () => {
    const card = await buildDirectionCard(event);
    expect(card.eventName).toContain("Brian");
    expect(card.headline).toBe("Blippi + Meekah");
    expect(card.cues).toEqual(expect.arrayContaining(["Indoor soft play", "Bubbles", "Ice-cream treats"]));
    expect(card.referenceRecommended).toBe(true);
    expect(card.supportingCopy).toContain("Weak or generic artwork is never shown.");

    const dataUrl = await directionCardDataUrl(event);
    expect(dataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
    const svg = Buffer.from(dataUrl.split(",")[1], "base64").toString("utf8");
    expect(svg).toContain("Brian and Blippi&apos;s Extravaganza");
    expect(svg).toContain("Blippi + Meekah");
    expect(svg).toContain("Indoor soft play");
    expect(svg).toContain("Weak or generic");
    expect(svg).toContain("artwork is never shown.");
    expect(svg).toContain(".cue { font: 600 26px");
    expect(svg).toContain(".copy { font: 400 27px");
    expect(svg).toContain(".foot { font: 700 18px");
  });

  it("renders two private text-first candidates in parallel and returns only the stronger approved result", async () => {
    let started = 0;
    let release!: () => void;
    const bothStarted = new Promise<void>((resolve) => { release = resolve; });
    const generateImage = vi.fn(async () => {
      const candidate = ++started;
      if (started === 2) release();
      await bothStarted;
      const bytes = generatedPng(candidate);
      return {
        bytes,
        dataUrl: `data:image/png;base64,${bytes.toString("base64")}`,
        durationMs: 100,
      };
    });
    const runVision = vi.fn(async (input: { bytes: Buffer }) => {
      const fill = decodePng(input.bytes).rgb[0];
      return vision(fill === 2, fill === 2 ? "strong alternate" : "first take rejected");
    });

    const result = await generateQualityLockedPreview(event, {
      generateImage,
      runTier1: () => tier1(true),
      runVision: runVision as never,
      maxCandidates: 2,
      parallelCandidates: true,
    });

    expect(result.kind).toBe("approved-image");
    expect(generateImage).toHaveBeenCalledTimes(2);
    expect(runVision).toHaveBeenCalledTimes(2);
    expect(result.attempts).toBe(2);
    expect(result.reviews).toHaveLength(2);
    expect(generateImage.mock.calls[1][0].prompt).toContain("PRIVATE ALTERNATE TAKE");
    if (result.kind !== "approved-image") throw new Error("expected approved image");
    const approvedBytes = Buffer.from(result.dataUrl.split(",")[1], "base64");
    expect(decodePng(approvedBytes).rgb[0]).toBe(2);
    expect(readPngSize(approvedBytes)).toEqual({ width: 630, height: 1120 });
  });

  it("keeps a rejected first candidate private and returns only the approved correction", async () => {
    const generateImage = vi.fn()
      .mockResolvedValueOnce({
        bytes: generatedPng(1),
        dataUrl: "data:image/png;base64,FIRST",
        durationMs: 100,
      })
      .mockResolvedValueOnce({
        bytes: generatedPng(2),
        dataUrl: "data:image/png;base64,SECOND",
        durationMs: 100,
      });
    const runTier1 = vi.fn(() => tier1(true));
    const runVision = vi.fn()
      .mockResolvedValueOnce(vision(false, "Meekah is missing; the second adult is generic."))
      .mockResolvedValueOnce(vision(true));

    const result = await generateQualityLockedPreview(event, {
      generateImage,
      runTier1,
      runVision,
      maxCandidates: 2,
    });

    expect(result.kind).toBe("approved-image");
    if (result.kind !== "approved-image") throw new Error("expected approved image");
    expect(result.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(readPngSize(Buffer.from(result.dataUrl.split(",")[1], "base64"))).toEqual({ width: 630, height: 1120 });
    expect(result.attempts).toBe(2);
    expect(generateImage).toHaveBeenCalledTimes(2);
    expect(generateImage.mock.calls[0][0]).toEqual(expect.objectContaining({
      model: "gpt-image-2",
      quality: "medium",
      aspectRatio: "9:16",
    }));
    expect(generateImage.mock.calls[1][0].prompt).toContain("Meekah is missing");
    expect(generateImage.mock.calls[0][0].prompt).toContain("NO DESIGN SURFACES");
    expect(generateImage.mock.calls[0][0].prompt).toContain("STORY:");
    expect(generateImage.mock.calls[0][0].prompt).toContain("DEPTH/MATERIAL");
    expect(generateImage.mock.calls[0][0].prompt).toContain("BINDING SOFT-PLAY MATERIAL PHYSICS");
    expect(generateImage.mock.calls[0][0].prompt).toContain("tactile matte textile or vinyl");
    expect(generateImage.mock.calls[0][0].prompt).toContain("never glossy toy plastic");
    expect(generateImage.mock.calls[0][0].prompt).toContain("BINDING FOOD STAGING");
    expect(generateImage.mock.calls[0][0].prompt).toContain("one restrained midground serving station");
    expect(generateImage.mock.calls[0][0].prompt).toContain("Never place food on ball-pit flooring");
    expect(generateImage.mock.calls[0][0].prompt).toContain("no lower-corner product shot");
    expect(generateImage.mock.calls[0][0].prompt).toContain("MILESTONE:");
    expect(generateImage.mock.calls[0][0].prompt).toContain("full portrait canvas");
    expect(generateImage.mock.calls[0][0].prompt).not.toContain("stationery artwork");
    expect(generateImage.mock.calls[0][0].prompt).not.toContain("garden-editorial");
    expect(generateImage.mock.calls[0][0].prompt).not.toContain("botanical-sprig");
    expect(generateImage.mock.calls[0][0].prompt).not.toContain("visually quiet typography zone");
    expect(generateImage.mock.calls[0][0].prompt).not.toContain("cropped away");
    expect(JSON.stringify(result)).not.toContain("FIRST");
  });

  it("reviews the exact 560px teaser pixels while preserving the full approved source", async () => {
    const sourceBytes = generatedPng(9);
    const runTier1 = vi.fn(() => tier1(true));
    const runVision = vi.fn(async () => vision(true));
    const result = await generateQualityLockedPreview(event, {
      generateImage: async () => ({
        bytes: sourceBytes,
        dataUrl: `data:image/png;base64,${sourceBytes.toString("base64")}`,
        durationMs: 100,
      }),
      runTier1,
      runVision,
      maxCandidates: 1,
    });

    expect(result.kind).toBe("approved-image");
    if (result.kind !== "approved-image") throw new Error("expected approved image");
    const returnedBytes = Buffer.from(result.dataUrl.split(",")[1], "base64");
    const customerBytes = runTier1.mock.calls[0][0].bytes as Buffer;
    expect(readPngSize(returnedBytes)).toEqual({ width: 630, height: 1120 });
    expect(Buffer.compare(returnedBytes, sourceBytes)).toBe(0);
    expect(readPngSize(customerBytes)).toEqual({ width: 315, height: 560 });
    expect(Buffer.compare(runVision.mock.calls[0][0].bytes, customerBytes)).toBe(0);
    expect(runTier1.mock.calls[0][0].layoutApplied).toBe(false);
    expect(runVision.mock.calls[0][0].reviewMode).toBe("teaser");
  });

  it("forwards one AbortSignal to image generation and vision review", async () => {
    const sourceBytes = generatedPng(10);
    const controller = new AbortController();
    const generateImage = vi.fn(async () => ({
      bytes: sourceBytes,
      dataUrl: `data:image/png;base64,${sourceBytes.toString("base64")}`,
      durationMs: 10,
    }));
    const runVision = vi.fn(async () => vision(true));

    const result = await generateQualityLockedPreview(event, {
      generateImage,
      runTier1: () => tier1(true),
      runVision,
      maxCandidates: 1,
      signal: controller.signal,
    });

    expect(result.kind).toBe("approved-image");
    expect(generateImage.mock.calls[0][0].signal).toBe(controller.signal);
    expect(runVision.mock.calls[0][0].signal).toBe(controller.signal);
  });

  it("returns no customer-visible pixels when both private candidates fail", async () => {
    const generateImage = vi.fn(async () => ({
      bytes: generatedPng(3),
      dataUrl: "data:image/png;base64,REJECTED",
      durationMs: 100,
    }));

    const result = await generateQualityLockedPreview(event, {
      generateImage,
      runTier1: () => tier1(true),
      runVision: async () => vision(false, "generic adjacent character art"),
      maxCandidates: 2,
    });

    expect(result.kind).toBe("rejected");
    expect(JSON.stringify(result)).not.toContain("REJECTED");
    expect(generateImage).toHaveBeenCalledTimes(2);
  });

  it("fails closed when the provider is unavailable", async () => {
    const result = await generateQualityLockedPreview(event, {
      generateImage: async () => {
        throw new Error("credit_balance_exhausted");
      },
      runTier1: () => tier1(true),
      runVision: async () => vision(true),
    });

    expect(result.kind).toBe("unavailable");
    expect(result.attempts).toBe(0);
    expect(JSON.stringify(result)).not.toContain("data:image");
  });

  // Item 3 (retained rejection diagnostics): before this, a rejected
  // candidate's tier1/vision evidence lived only in the local `reviews[]`
  // variable and evaporated once the request finished. These tests prove
  // every billed candidate — rejected or approved — is durably recorded
  // when a retention store is supplied, and that retention is genuinely
  // optional and fail-open so it can never change the customer-visible
  // approve/reject outcome.
  describe("attempt evidence retention", () => {
    function fakeAttemptStore() {
      const records: Array<Record<string, unknown>> = [];
      return {
        records,
        store: {
          record: vi.fn(async (input: Record<string, unknown>) => {
            records.push(input);
            return { id: `attempt-${records.length}`, ...input } as never;
          }),
          listForOwner: vi.fn(async () => []),
          findById: vi.fn(async () => undefined),
        },
      };
    }

    it("records a rejected candidate with its failure codes and gate findings", async () => {
      const { store, records } = fakeAttemptStore();
      const generateImage = vi.fn(async () => ({
        bytes: generatedPng(3),
        dataUrl: "data:image/png;base64,REJECTED",
        durationMs: 100,
      }));

      const result = await generateQualityLockedPreview(event, {
        generateImage,
        runTier1: () => tier1(true),
        runVision: async () => vision(false, "generic adjacent character art"),
        maxCandidates: 2,
        attemptRetention: { store: store as never, eventId: event.id, ownerToken: "owner-token-abc" },
      });

      expect(result.kind).toBe("rejected");
      expect(store.record).toHaveBeenCalledTimes(2);
      for (const record of records) {
        expect(record.eventId).toBe(event.id);
        expect(record.ownerToken).toBe("owner-token-abc");
        expect(record.status).toBe("rejected");
        expect(record.failureCodes).toEqual(["brief-fidelity"]);
        // The raw bytes must be retained too — a reviewer needs to see the
        // actual rejected image, not only the codes that rejected it.
        expect(Buffer.isBuffer(record.bytes)).toBe(true);
        expect(readPngSize(record.bytes as Buffer)).toEqual({ width: 630, height: 1120 });
      }
    });

    it("records an approved candidate as accepted", async () => {
      const { store, records } = fakeAttemptStore();
      const generateImage = vi.fn(async () => ({
        bytes: generatedPng(4),
        dataUrl: "data:image/png;base64,APPROVED",
        durationMs: 100,
      }));

      const result = await generateQualityLockedPreview(event, {
        generateImage,
        runTier1: () => tier1(true),
        runVision: async () => vision(true),
        maxCandidates: 2,
        attemptRetention: { store: store as never, eventId: event.id, ownerToken: "owner-token-abc" },
      });

      expect(result.kind).toBe("approved-image");
      expect(store.record).toHaveBeenCalledTimes(1);
      expect(records[0].status).toBe("accepted");
      expect(records[0].failureCodes).toEqual([]);
      expect(readPngSize(records[0].bytes as Buffer)).toEqual({ width: 630, height: 1120 });
    });

    it("stays fail-open: a retention error never changes the customer-visible result", async () => {
      const store = {
        record: vi.fn(async () => {
          throw new Error("db unavailable");
        }),
        listForOwner: vi.fn(async () => []),
        findById: vi.fn(async () => undefined),
      };
      const generateImage = vi.fn(async () => ({
        bytes: generatedPng(5),
        dataUrl: "data:image/png;base64,APPROVED",
        durationMs: 100,
      }));

      const result = await generateQualityLockedPreview(event, {
        generateImage,
        runTier1: () => tier1(true),
        runVision: async () => vision(true),
        maxCandidates: 2,
        attemptRetention: { store: store as never, eventId: event.id, ownerToken: "owner-token-abc" },
      });

      expect(result.kind).toBe("approved-image");
      if (result.kind !== "approved-image") throw new Error("expected approved image");
      expect(result.dataUrl).toMatch(/^data:image\/png;base64,/);
      expect(readPngSize(Buffer.from(result.dataUrl.split(",")[1], "base64"))).toEqual({ width: 630, height: 1120 });
    });

    it("omits retention entirely when no store is supplied, exactly as before", async () => {
      const generateImage = vi.fn(async () => ({
        bytes: generatedPng(6),
        dataUrl: "data:image/png;base64,APPROVED",
        durationMs: 100,
      }));

      const result = await generateQualityLockedPreview(event, {
        generateImage,
        runTier1: () => tier1(true),
        runVision: async () => vision(true),
        maxCandidates: 2,
      });

      expect(result.kind).toBe("approved-image");
    });
  });
});

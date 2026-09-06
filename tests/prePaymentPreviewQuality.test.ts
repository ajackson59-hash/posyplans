import { afterEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import type { Event } from "@shared/schema";
import type { Tier1Result } from "../server/aiFirst/tier1";
import type { VisionVerdict } from "../server/aiFirst/visionGate";
import type { ArtworkRequest } from "../server/aiFirst/artwork";
import { InMemoryArtworkAttemptStore } from "../server/aiFirst/artworkAttemptStore";
import { decodePng, encodePng, readPngSize } from "../server/aiFirst/png";
import { concreteSubjectRequirementsForBrief, concreteSubjectReviewRequirementsForBrief } from "../server/aiFirst/conceptPreflight";
import { namedReferenceIdentityNotes } from "../server/namedReferenceResolver";
import {
  buildDirectionCard,
  buildQualityLockedPreviewBrief,
  clearNamedThemeDetectionCache,
  detectNamedCreativeReference,
  detectNamedCreativeReferenceSync,
  directionCardDataUrl,
  generateQualityLockedPreview,
  customerVisiblePreviewBytes,
  readPrePaymentPreviewMode,
  NAMED_THEME_DETECTION_MODEL,
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

function nearPassVision(
  notes: string,
  overrides: Partial<VisionVerdict["scores"]> = {},
  failureCodes = ["artifact"],
): VisionVerdict {
  const approved = vision(true, notes);
  return {
    ...approved,
    scores: {
      ...approved.scores,
      artifactFree: 4,
      ...overrides,
    },
    passed: false,
    failureCodes,
    teaserChecks: {
      milestone: { required: false, evidence: "No milestone prop requested or shown.", correct: true },
      identity: { required: true, evidence: "Both named subjects are independently recognizable.", accurate: true },
      purchase: { evidence: "Professional and desirable, with one local defect.", wouldCreatePurchaseDesire: true },
    },
  };
}

describe("prepayment preview quality lock", () => {
  afterEach(() => {
    clearNamedThemeDetectionCache();
  });

  it.each([
    ["Rumi", ["Rumi"], ["Mira", "Zoey"]],
    ["Rumi and Zoey", ["Rumi", "Zoey"], ["Mira"]],
    ["Rumi, Mira and Zoey", ["Rumi", "Mira", "Zoey"], []],
    ["Jinu", ["Jinu"], ["Rumi", "Mira", "Zoey"]],
  ])("preserves the requested KPop cast: %s", async (cast, included, absent) => {
    const { brief, namedReference } = await buildQualityLockedPreviewBrief({ ...event,
      eventName: "Character portrait study", themeName: "KPop Demon Hunters", vibeDescription: `Show ${cast} in a quiet watercolor garden portrait. No weapons or stage.` } as Event);
    const requirements = brief.requirements.required.join(" ");
    for (const subject of included as string[]) expect(requirements).toContain(`${subject} is independently recognizable`);
    for (const subject of absent as string[]) expect(requirements).not.toContain(`${subject} is independently recognizable`);
    const inferred = concreteSubjectReviewRequirementsForBrief(brief).join(" ");
    expect(inferred).not.toMatch(/trio is visibly|three distinct central|supernatural.*unmistakably/);
    expect(concreteSubjectRequirementsForBrief(brief).join(" ")).toContain("host's exact cast scope");
    expect(brief.vibe).toContain("quiet watercolor garden portrait");
    expect(brief.requirements.excluded.join(" ")).toContain("weapons or stage");
    expect(namedReferenceIdentityNotes(namedReference!)).toContain("They do not add cast members");
    expect(namedReferenceIdentityNotes(namedReference!)).not.toContain("Preserve all three");
  });

  it.each([
    ["Blippi", "Blippi", "Meekah"], ["Meekah", "Meekah", "Blippi"],
    ["Blippi only. No Meekah", "Blippi", "Meekah"],
  ])("does not add the other host to %s", async (direction, present, absent) => {
    const { brief, namedReference } = await buildQualityLockedPreviewBrief({ ...event,
      eventName: "Character portrait study", themeName: "", vibeDescription: `${direction}. A watercolor seaside portrait.` } as Event);
    expect(namedReference?.label).toBe(present);
    expect(brief.requirements.required.join(" ")).toContain(`${present} is visibly identifiable`);
    expect(brief.requirements.required.join(" ")).not.toContain(`${absent} is visibly identifiable`);
    expect(namedReference?.cues.join(" ")).not.toMatch(/soft play|bubbles|ice.cream/i);
  });

  it("keeps both explicitly requested hosts independently binding", async () => {
    const { brief } = await buildQualityLockedPreviewBrief({ ...event,
      themeName: "Blippi + Meekah", vibeDescription: "Show Blippi and Meekah in a hand-painted garden scene." } as Event);
    expect(brief.requirements.required.join(" ")).toContain("Blippi is visibly identifiable");
    expect(brief.requirements.required.join(" ")).toContain("Meekah is visibly identifiable");
  });

  it.each(["Unicorn Academy", "PAW Patrol", "Bluey"])("keeps preset scenes out of %s host requirements", async (theme) => {
    const { brief, namedReference } = await buildQualityLockedPreviewBrief({ ...event,
      eventName: "Character portrait study", themeName: theme, vibeDescription: "A restrained embroidered character portrait with a linen background." } as Event);
    expect(brief.vibe).toContain("embroidered character portrait");
    expect(brief.requirements.required.join(" ")).not.toMatch(/winter wonderland|glowing igloo|snow.globe|both central|rescue-team world/);
    expect(namedReference?.cues.join(" ")).not.toMatch(/winter|igloo|snow.globe/i);
    expect(namedReferenceIdentityNotes(namedReference!)).toContain("Explicit host scope and exclusions remain binding");
  });

  it("shows requested scene cues and omits negated preset details on the direction card", () => {
    const card = buildDirectionCard({ ...event, eventName: "A garden party", themeName: "Unicorn Academy",
      vibeDescription: "In a garden. No igloo, snow globe, bubbles or ice cream." } as Event);
    expect(card.cues).toContain("Garden florals");
    expect(card.cues.join(" ")).not.toMatch(/igloo|snow.globe|bubbles|ice.cream/i);
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
    expect(concept.art.medium).toBe("premium commissioned hand-painted editorial illustration");
    expect(concept.art.prompt).toContain("ORIGINAL ILLUSTRATION:");
    expect(concept.art.prompt).toContain("no photography, live-action performers, promotional stills");
    expect(concept.art.prompt).not.toContain("natural live-action materials/light");
    expect(concept.art.prompt).toContain("STORY:");
    expect(concept.art.prompt).toContain("DEPTH/MATERIAL");
    expect(concept.art.prompt).toContain("HANDS/PROPS");
    expect(concept.art.prompt).toContain("MILESTONE:");
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
    expect(brief.requirements.excluded).toContain(
      "the letter M, initials, monograms, wordmarks, badges, logos or any glyph-bearing patch on either character's clothing; keep Meekah's chest fabric plain or abstractly color-blocked",
    );
    expect(brief.requirements.excluded).toContain(
      "unrequested photographs, photoreal live-action frames, promotional stills, cosplay, mascot suits, lookalike actors or stock-photo substitutions for the requested named-character treatment",
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

  it("keeps the fresh canary's prohibited objects out of required teaser details", async () => {
    const negated = {
      ...event,
      eventName: "Brian's 4th Birthday",
      themeName: "Blippi + Meekah",
      vibeDescription:
        "Show Blippi and Meekah dancing together as the central heroes, with a large ball pit, bright foam climbing structures, clearly visible bubbles, and a built-in ice-cream station with colorful treats. Do not include a child portrait or any candles, numerals, words, logos, signs, or posters.",
    } as unknown as Event;

    const { brief, concept } = await buildQualityLockedPreviewBrief(negated);
    const required = brief.requirements.required.join(" \n ");
    const excluded = brief.requirements.excluded.join(" \n ");
    expect(required).toContain("[VISIBLE HOST DETAIL] Blippi and Meekah dancing together");
    expect(required).not.toContain("[VISIBLE HOST DETAIL] a child portrait or any candles");
    expect(required).not.toContain("[VISIBLE MILESTONE]");
    expect(excluded).toContain(
      "[HOST EXCLUSION] a child portrait or any candles, numerals, words, logos, signs, or posters",
    );
    expect(excluded).toContain("countable age markers when the host did not explicitly request a count");
    expect(concept.art.prompt).toContain("Do not show birthday candles");
  });

  it("treats equivalent negative phrasing as a hard exclusion for future previews", async () => {
    const variants = [
      "Please avoid showing candles or numeral props. Include a large ball pit.",
      "Create the celebration without candles or numeral props. Feature a large ball pit.",
      "No candles or numeral props. Show a large ball pit.",
      "Never depict candles or numeral props. Include a large ball pit.",
      "The scene must not feature candles or numeral props. Show a large ball pit.",
    ];

    for (const vibeDescription of variants) {
      const { brief, concept } = await buildQualityLockedPreviewBrief({
        ...event,
        eventName: "Brian's 4th Birthday",
        themeName: "Playful soft play",
        vibeDescription,
      } as unknown as Event);
      const visibleRequirements = brief.requirements.required.filter((item) =>
        item.startsWith("[VISIBLE HOST DETAIL]"),
      ).join(" ");
      expect(visibleRequirements).toContain("large ball pit");
      expect(visibleRequirements).not.toMatch(/candles|numeral props/i);
      expect(brief.requirements.required.join(" ")).not.toContain("[VISIBLE MILESTONE]");
      expect(brief.requirements.excluded.join(" ")).toContain("[HOST EXCLUSION]");
      expect(concept.art.prompt).toContain("Do not show birthday candles");
    }
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
        subjects: [],
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
      subjects: [],
    }));
    const first = await detectNamedCreativeReference("Bobs Burgers party", { client });
    const second = await detectNamedCreativeReference("Bobs Burgers party", { client });
    expect(first?.label).toBe("Bobs Burgers");
    expect(second?.label).toBe("Bobs Burgers");
    expect((client.messages.create as ReturnType<typeof vi.fn>)).toHaveBeenCalledTimes(1);
  });

  it("uses a compact structured identity response without discarding the host's medium or any requested character", async () => {
    const subjects = ["Moana", "Maui", "Elsa", "Anna", "Mickey Mouse"];
    const hostDirection = "Moana, Maui, Elsa, Anna and Mickey Mouse in a moon garden. Medium: lacquer inlay. Silver foliage, blue shell petals and a dark pond. No other characters.";
    const client = fakeAnthropicClient(JSON.stringify({ named: true, label: "Disney characters", subjects }));
    const namedReference = await detectNamedCreativeReference(hostDirection, { client, requireResolvedClassification: true });
    const [request] = vi.mocked(client.messages.create).mock.calls[0];
    expect(NAMED_THEME_DETECTION_MODEL).toBe("claude-haiku-4-5-20251001");
    expect(request).toMatchObject({ model: NAMED_THEME_DETECTION_MODEL, max_tokens: 350,
      output_config: { format: { type: "json_schema", schema: {
        additionalProperties: false, required: ["named", "label", "subjects"],
      } } }, messages: [{ role: "user", content: hostDirection }],
    });
    expect(namedReference!.requirements.filter((requirement) => requirement.includes("independently recognizable"))).toHaveLength(5);
    for (const subject of subjects) expect(namedReference!.requirements.join(" ")).toContain(subject);
    const { brief } = await buildQualityLockedPreviewBrief({ ...event, eventName: "Moon garden", vibeDescription: hostDirection } as Event,
      "", namedReference);
    expect(JSON.stringify(brief)).toContain(hostDirection);
    for (const subject of subjects) expect(JSON.stringify(brief)).toContain(subject);
  });

  it("treats a clearly generic theme as not-named even when the classifier is consulted", async () => {
    const client = fakeAnthropicClient(JSON.stringify({ named: false, label: "", subjects: [] }));
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

  it("uses an abortable single classifier request and requires an explicit original-theme verdict", async () => {
    const client = fakeAnthropicClient('{"named":false,"label":"","subjects":[]}');
    const controller = new AbortController();
    expect(await detectNamedCreativeReference("An original moonlit gallery", {
      client, signal: controller.signal, requireResolvedClassification: true,
    })).toBeNull();
    expect(client.messages.create).toHaveBeenCalledTimes(1);
    expect(client.messages.create).toHaveBeenCalledWith(expect.anything(), {
      signal: controller.signal, maxRetries: 0,
    });
  });

  it.each(['{}', '{"named":true}', '{"named":false}', '{"named":false,"label":"Frozen","subjects":[]}', '{"named":true,"label":"Frozen","subjects":[null]}', 'unparseable'])
    ("does not cache unresolved recognition as an original theme: %s", async (invalid) => {
      const client = fakeAnthropicClient(invalid);
      expect(await detectNamedCreativeReference("An unfamiliar property celebration", { client })).toBeNull();
      await expect(detectNamedCreativeReference("An unfamiliar property celebration", {
        client, requireResolvedClassification: true,
      })).rejects.toThrow("complete classification");
      expect(client.messages.create).toHaveBeenCalledTimes(2);
    });

  it("does not route a truncated classifier response as an original theme", async () => {
    const client = { messages: { create: vi.fn(async () => ({
      content: [{ type: "text", text: '{"named":false,"label":"","subjects":[]}' }], stop_reason: "max_tokens",
    })) } } as unknown as Anthropic;
    await expect(detectNamedCreativeReference("An unfamiliar art world", {
      client, requireResolvedClassification: true,
    })).rejects.toThrow("complete classification");
    expect(client.messages.create).toHaveBeenCalledTimes(1);
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

  it.each([false, true])("records each render tier and keeps a rejected faster candidate private (fast rejected=%s)", async (rejectFast) => {
    const attempts = new InMemoryArtworkAttemptStore();
    const generateImage = vi.fn(async (request: ArtworkRequest) => {
      const bytes = generatedPng(request.quality === "medium" ? 1 : 2);
      return { bytes, dataUrl: `data:image/png;base64,${bytes.toString("base64")}`, durationMs: 1 };
    });
    const result = await generateQualityLockedPreview(event, {
      quality: "high", candidateQualities: ["medium", "high"], parallelCandidates: true, maxCandidates: 2,
      attemptRetention: { store: attempts, eventId: event.id, ownerToken: "private-test-owner" },
      generateImage, runTier1: () => tier1(),
      runVision: async ({ bytes }) => {
        const rejected = rejectFast && decodePng(bytes).rgb[0] === 1;
        return { ...vision(!rejected), failureCodes: rejected ? ["artifact"] : [] };
      },
    });
    expect(result.kind).toBe("approved-image");
    expect(generateImage).toHaveBeenCalledTimes(2);
    expect(generateImage.mock.calls.map(([request]) => request.quality)).toEqual(["medium", "high"]);
    for (const [request] of generateImage.mock.calls) expect(request).toMatchObject({ outputFormat: "jpeg", maxTransientRetries: 0 });
    const rows = attempts.all.slice().sort((a, b) => a.attempt - b.attempt);
    expect(rows.map((row) => row.quality)).toEqual(["medium", "high"]);
    expect(rows.map((row) => row.costUsdMicros)).toEqual([41_000, 165_000]);
    expect(rows[0].status).toBe(rejectFast ? "rejected" : "accepted");
    if (result.kind === "approved-image") {
      const source = Buffer.from(result.dataUrl.split(",")[1], "base64");
      expect(readPngSize(source)).toEqual({ width: 630, height: 1120 });
      expect(decodePng(source).rgb[0]).toBe(rejectFast ? 2 : 1);
    }
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

  it("renders two private text-first candidates in parallel and returns an approved result", async () => {
    let started = 0;
    let release!: () => void;
    const bothStarted = new Promise<void>((resolve) => { release = resolve; });
    const generateImage = vi.fn(async () => {
      const candidate = ++started;
      if (started === 2) release();
      await bothStarted;
      const bytes = generatedPng(candidate, 1260, 2240);
      return {
        bytes,
        dataUrl: `data:image/png;base64,${bytes.toString("base64")}`,
        durationMs: 100,
      };
    });
    const runVision = vi.fn(async (input: { bytes: Buffer }) => {
      expect(readPngSize(input.bytes)).toEqual({ width: 315, height: 560 });
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
    expect(generateImage.mock.calls[0][0].prompt).toContain("PRIVATE CANDIDATE ONE — CINEMATIC CEL-PAINTED EDITORIAL");
    expect(generateImage.mock.calls[1][0].prompt).toContain("PRIVATE CANDIDATE TWO — GOUACHE STORYBOOK EDITORIAL");
    expect(generateImage.mock.calls[0][0].prompt).toContain("DEFAULT ORIGINAL-ILLUSTRATION MEDIUM");
    expect(generateImage.mock.calls[0][0].prompt).toContain("Only when the host has not requested a medium");
    expect(generateImage.mock.calls[0][0].prompt).toContain("In this default treatment use no photograph");
    expect(generateImage.mock.calls[0][0].prompt).toContain("BINDING FIRST-GLANCE SCENE HIERARCHY");
    expect(generateImage.mock.calls[0][0].prompt).toContain("560-pixel customer teaser size");
    expect(generateImage.mock.calls[0][0].prompt).toContain("BINDING SOFT-PLAY SCENE MAP");
    expect(generateImage.mock.calls[0][0].prompt).toContain("ball pit a large lower-to-middle scene anchor");
    expect(generateImage.mock.calls[0][0].prompt).toContain("BINDING VISIBLE BUBBLES");
    expect(generateImage.mock.calls[0][0].prompt).toContain("BINDING VISIBLE SERVING STATION");
    expect(generateImage.mock.calls[0][0].prompt).not.toContain("PRIVATE CANDIDATE TWO");
    expect(generateImage.mock.calls[1][0].prompt).not.toContain("PRIVATE CANDIDATE ONE");
    if (result.kind !== "approved-image") throw new Error("expected approved image");
    const approvedBytes = Buffer.from(result.dataUrl.split(",")[1], "base64");
    expect(decodePng(approvedBytes).rgb[0]).toBe(2);
    expect(readPngSize(approvedBytes)).toEqual({ width: 1260, height: 2240 });
  });

  it("publishes the first full pass before its sibling settles and never swaps the winning source", async () => {
    let finishSibling!: () => void;
    const sibling = new Promise<void>((resolve) => { finishSibling = resolve; });
    let published!: () => void;
    const publishedSignal = new Promise<void>((resolve) => { published = resolve; });
    let calls = 0;
    const generateImage = vi.fn(async () => {
      const fill = ++calls;
      if (fill === 1) await sibling;
      const bytes = generatedPng(fill);
      return { bytes, dataUrl: "ignored", durationMs: 10 };
    });
    const onApproved = vi.fn(async (result) => {
      expect(decodePng(Buffer.from(result.dataUrl.split(",")[1], "base64")).rgb[0]).toBe(2);
      published();
    });
    let settled = false;
    const running = generateQualityLockedPreview(event, {
      generateImage, runTier1: () => tier1(), runVision: async () => vision(true),
      parallelCandidates: true, maxCandidates: 2, onApproved,
    }).then((result) => { settled = true; return result; });
    await publishedSignal;
    expect(settled).toBe(false);
    expect(onApproved).toHaveBeenCalledTimes(1);
    finishSibling();
    const result = await running;
    expect(onApproved).toHaveBeenCalledTimes(1);
    if (result.kind !== "approved-image") throw new Error("expected pass");
    expect(decodePng(Buffer.from(result.dataUrl.split(",")[1], "base64")).rgb[0]).toBe(2);
    expect(result.reviews).toHaveLength(2);
  });

  it("never starts an automatic third render even when both candidates are near-passes", async () => {
    const generateImage = vi.fn(async () => ({ bytes: generatedPng(3), dataUrl: "ignored", durationMs: 10 }));
    const onApproved = vi.fn();
    const result = await generateQualityLockedPreview(event, {
      generateImage, runTier1: () => tier1(), runVision: async () => nearPassVision("Local seam."),
      parallelCandidates: true, maxCandidates: 2, onApproved,
    });
    expect(result.kind).toBe("rejected");
    expect(generateImage).toHaveBeenCalledTimes(2);
    expect(onApproved).not.toHaveBeenCalled();
  });

  it("does not publish a review that arrives after cancellation", async () => {
    const controller = new AbortController();
    const onApproved = vi.fn();
    const generateImage = vi.fn(async () => ({ bytes: generatedPng(4), dataUrl: "ignored", durationMs: 10 }));
    await generateQualityLockedPreview(event, {
      generateImage, runTier1: () => tier1(), runVision: async () => {
        controller.abort();
        return vision(true);
      },
      parallelCandidates: true, maxCandidates: 2, onApproved, signal: controller.signal,
    });
    expect(onApproved).not.toHaveBeenCalled();
    expect(generateImage).toHaveBeenCalledTimes(2);
  });

  it("rebuilds an artifact or premium near-pass independently and rechecks the exact teaser pixels", async () => {
    let call = 0;
    const retained: Array<Record<string, unknown>> = [];
    const attemptStore = {
      record: vi.fn(async (input: Record<string, unknown>) => {
        retained.push(input);
        return { id: `attempt-${retained.length}`, ...input } as never;
      }),
      listForOwner: vi.fn(async () => []),
      findById: vi.fn(async () => undefined),
    };
    const generateImage = vi.fn(async () => {
      call += 1;
      const bytes = generatedPng(call, 1260, 2240);
      return {
        bytes,
        dataUrl: `data:image/png;base64,${bytes.toString("base64")}`,
        durationMs: 100,
      };
    });
    const runVision = vi.fn(async (input: { bytes: Buffer }) => {
      expect(readPngSize(input.bytes)).toEqual({ width: 315, height: 560 });
      const fill = decodePng(input.bytes).rgb[0];
      if (fill === 1) {
        return nearPassVision(
          "Several material and depth details need local cleanup.",
          { premiumFinish: 4, compositionQuality: 4 },
          ["artifact", "premium-feel", "crop-unsafe"],
        );
      }
      if (fill === 2) {
        return nearPassVision(
          "Some repeated spheres show copy-stamp uniformity and the subject's skin has a mild waxy specular finish.",
          { premiumFinish: 4, compositionQuality: 5 },
          ["artifact", "premium-feel"],
        );
      }
      return vision(true, "The localized correction passes every dimension.");
    });

    const result = await generateQualityLockedPreview(event, {
      generateImage,
      runTier1: () => tier1(true),
      runVision: runVision as never,
      maxCandidates: 2,
      parallelCandidates: true,
      allowTargetedCorrection: true,
      attemptRetention: {
        store: attemptStore as never,
        eventId: event.id,
        ownerToken: "owner-token-abc",
      },
    });

    expect(result.kind).toBe("approved-image");
    expect(result.attempts).toBe(3);
    expect(result.reviews).toHaveLength(3);
    expect(generateImage).toHaveBeenCalledTimes(3);
    expect(runVision).toHaveBeenCalledTimes(3);

    const correction = generateImage.mock.calls[2][0];
    expect(correction).toEqual(expect.objectContaining({
      model: "gpt-image-2",
      quality: "high",
    }));
    expect(correction.inputFidelity).toBeUndefined();
    expect(correction.referenceImages).toBeUndefined();
    expect(correction.prompt).toContain("INDEPENDENT CRITIC-LED RECONSTRUCTION");
    expect(correction.prompt).toContain("Generate a completely new image from the written event brief");
    expect(correction.prompt).toContain("no prior pixel arrangement");
    expect(correction.prompt).toContain("Measured failure classes to eliminate: artifact, premium-feel");
    expect(correction.prompt).toContain("Some repeated spheres show copy-stamp uniformity");
    expect(correction.prompt).toContain("organic variation in scale, occlusion, edge shape, highlights, texture and depth spacing");
    expect(correction.prompt).toContain("Skin and faces need restrained specular highlights");
    expect(correction.prompt).toContain("matte ink-and-tempera editorial illustration");
    expect(correction.prompt).not.toContain("SOURCE-LOCKED NEAR-PASS");
    expect(correction.prompt).not.toContain("Make the smallest localized corrections");
    expect(retained).toHaveLength(3);
    expect(retained.map((record) => record.model)).toEqual([
      "gpt-image-2",
      "gpt-image-2",
      "gpt-image-2",
    ]);
    expect(retained.reduce((sum, record) => sum + Number(record.costUsdMicros), 0)).toBe(495_000);

    if (result.kind !== "approved-image") throw new Error("expected approved image");
    expect(result.model).toBe("gpt-image-2");
    const approvedBytes = Buffer.from(result.dataUrl.split(",")[1], "base64");
    expect(readPngSize(approvedBytes)).toEqual({ width: 1260, height: 2240 });
    expect(decodePng(approvedBytes).rgb[0]).toBe(3);
  });

  it("keeps high-fidelity source editing for a clean near-pass that only needs safer framing", async () => {
    let call = 0;
    const generateImage = vi.fn(async () => {
      call += 1;
      const bytes = generatedPng(call, 1260, 2240);
      return { bytes, dataUrl: `data:image/png;base64,${bytes.toString("base64")}`, durationMs: 100 };
    });
    const runVision = vi.fn(async (input: { bytes: Buffer }) => {
      const fill = decodePng(input.bytes).rgb[0];
      if (fill < 3) {
        return nearPassVision(
          "Move the existing subjects inward to restore safe breathing room.",
          { artifactFree: 5, premiumFinish: 5, compositionQuality: 4 },
          ["crop-unsafe"],
        );
      }
      return vision(true, "The reframed source now passes every dimension.");
    });

    const result = await generateQualityLockedPreview(event, {
      generateImage,
      runTier1: () => tier1(true),
      runVision: runVision as never,
      maxCandidates: 2,
      parallelCandidates: true,
      allowTargetedCorrection: true,
    });

    expect(result.kind).toBe("approved-image");
    const correction = generateImage.mock.calls[2][0];
    expect(correction).toEqual(expect.objectContaining({
      model: "gpt-image-1.5",
      quality: "high",
      inputFidelity: "high",
    }));
    expect(correction.prompt).toContain("SOURCE-GUIDED NEAR-PASS REBUILD");
    expect(correction.prompt).toContain("COMPOSITION SAFETY REBUILD");
    expect(correction.referenceImages).toHaveLength(1);
    expect(readPngSize(correction.referenceImages![0].bytes)).toEqual({ width: 1260, height: 2240 });
  });

  it("keeps a failed targeted correction private and returns the safe fallback", async () => {
    let call = 0;
    const generateImage = vi.fn(async () => {
      call += 1;
      const bytes = generatedPng(call);
      return { bytes, dataUrl: `data:image/png;base64,${bytes.toString("base64")}`, durationMs: 100 };
    });
    const runVision = vi.fn(async (input: { bytes: Buffer }) => {
      const fill = decodePng(input.bytes).rgb[0];
      return nearPassVision(
        fill === 3 ? "The correction still has a local seam." : `Near-pass ${fill}.`,
      );
    });

    const result = await generateQualityLockedPreview(event, {
      generateImage,
      runTier1: () => tier1(true),
      runVision: runVision as never,
      maxCandidates: 2,
      parallelCandidates: true,
      allowTargetedCorrection: true,
    });

    expect(result.kind).toBe("rejected");
    expect(result.attempts).toBe(3);
    expect(result.reviews).toHaveLength(3);
    expect(generateImage).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(result)).not.toContain("data:image");
  });

  it("does not spend a correction call when a named identity is inaccurate", async () => {
    const generateImage = vi.fn(async () => {
      const bytes = generatedPng(7);
      return { bytes, dataUrl: `data:image/png;base64,${bytes.toString("base64")}`, durationMs: 100 };
    });
    const inaccurateIdentity = nearPassVision("One named subject is only color-adjacent.");
    inaccurateIdentity.teaserChecks!.identity = {
      required: true,
      evidence: "The second subject is generic rather than independently recognizable.",
      accurate: false,
    };

    const result = await generateQualityLockedPreview(event, {
      generateImage,
      runTier1: () => tier1(true),
      runVision: async () => inaccurateIdentity,
      maxCandidates: 2,
      parallelCandidates: true,
    });

    expect(result.kind).toBe("rejected");
    expect(generateImage).toHaveBeenCalledTimes(2);
    expect(result.reviews).toHaveLength(2);
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
      quality: "high",
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
    expect(generateImage.mock.calls[0][0].prompt).toContain("one built-in rear or midground serving counter");
    expect(generateImage.mock.calls[0][0].prompt).toContain("never the foreground or lower third");
    expect(generateImage.mock.calls[0][0].prompt).toContain("one camera and lens");
    expect(generateImage.mock.calls[0][0].prompt).toContain("no shallow-focus product insert");
    expect(generateImage.mock.calls[0][0].prompt).toContain("Never place food on ball-pit flooring");
    expect(generateImage.mock.calls[0][0].prompt).toContain("BINDING BUBBLE OPTICS");
    expect(generateImage.mock.calls[0][0].prompt).toContain("reflection and refraction aligned to the same room and key light");
    expect(generateImage.mock.calls[0][0].prompt).toContain("no repeated circles");
    expect(generateImage.mock.calls[0][0].prompt).toContain("BINDING CHARACTER INTEGRATION");
    expect(generateImage.mock.calls[0][0].prompt).toContain("nuanced facial shading");
    expect(generateImage.mock.calls[0][0].prompt).toContain("shared color spill and matching focus");
    expect(generateImage.mock.calls[0][0].prompt).toContain("the letter M, initials, monograms");
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
        expect(record.reviewEvidence).toEqual({
          version: 1,
          reviewedAssetHash: createHash("sha256").update(customerVisiblePreviewBytes(record.bytes as Buffer)).digest("hex"),
          verdict: vision(false, "generic adjacent character art"), generationDurationMs: 100,
        });
      }
    });

    it.each([true, false])("retains billed images when review throws (parallel=%s)", async (parallel) => {
      const { store, records } = fakeAttemptStore();
      const generateImage = vi.fn(async (_input: ArtworkRequest) => ({ bytes: generatedPng(5), dataUrl: "unused", durationMs: 100 }));
      const result = await generateQualityLockedPreview(event, {
        generateImage, runTier1: () => tier1(true), runVision: async () => { throw new Error("review transport failed"); },
        parallelCandidates: parallel, maxCandidates: 2,
        attemptRetention: { store: store as never, eventId: event.id, ownerToken: "private-owner" },
      });
      expect(result.kind).not.toBe("approved-image");
      expect(records).toHaveLength(generateImage.mock.calls.length);
      for (const record of records) {
        expect(record.status).toBe("rejected");
        expect(record.reviewEvidence).toMatchObject({ verdict: null, reviewError: "review transport failed" });
      }
      expect(generateImage.mock.calls.every(([input]) => input.maxTransientRetries === 0)).toBe(true);
      expect(generateImage).toHaveBeenCalledTimes(parallel ? 2 : 1);
    });

    it("retains malformed provider bytes rather than silently losing the billed attempt", async () => {
      const { store, records } = fakeAttemptStore();
      const bytes = Buffer.from("not a PNG");
      await generateQualityLockedPreview(event, { generateImage: async () => ({ bytes, dataUrl: "unused", durationMs: 100 }),
        maxCandidates: 1, attemptRetention: { store: store as never, eventId: event.id, ownerToken: "private-owner" } });
      expect(records).toHaveLength(1);
      expect(records[0].bytes).toEqual(bytes);
      expect(records[0].reviewEvidence).toMatchObject({ reviewedAssetHash: null, verdict: null });
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

    it("labels retained candidates when the critic verdict is unavailable", async () => {
      const { store, records } = fakeAttemptStore();
      const unavailable: VisionVerdict = {
        ...vision(false),
        scores: {
          textLogoWatermarkFree: 0,
          artifactFree: 0,
          premiumFinish: 0,
          briefFidelity: 0,
          compositionQuality: 0,
          ageAppropriate: 0,
        },
        requiredPresent: [],
        failureCodes: [],
        unavailable: true,
        notes: "vision response was not parseable JSON",
      };

      const result = await generateQualityLockedPreview(event, {
        generateImage: async () => ({
          bytes: generatedPng(7),
          dataUrl: "data:image/png;base64,RETAINED",
          durationMs: 100,
        }),
        runTier1: () => tier1(true),
        runVision: async () => unavailable,
        maxCandidates: 2,
        parallelCandidates: true,
        attemptRetention: { store: store as never, eventId: event.id, ownerToken: "owner-token-abc" },
      });

      expect(result.kind).toBe("rejected");
      expect(records).toHaveLength(2);
      expect(records.every((record) => record.failureCodes[0] === "vision-unavailable")).toBe(true);
    });

    it("retains full source pixels for both parallel candidates", async () => {
      const { store, records } = fakeAttemptStore();
      let call = 0;
      const generateImage = vi.fn(async () => {
        call += 1;
        const bytes = generatedPng(call, 1260, 2240);
        return { bytes, dataUrl: `data:image/png;base64,${bytes.toString("base64")}`, durationMs: 100 };
      });
      const runVision = vi.fn(async (input: { bytes: Buffer }) =>
        vision(decodePng(input.bytes).rgb[0] === 2));

      const result = await generateQualityLockedPreview(event, {
        generateImage,
        runTier1: () => tier1(true),
        runVision: runVision as never,
        maxCandidates: 2,
        parallelCandidates: true,
        attemptRetention: { store: store as never, eventId: event.id, ownerToken: "owner-token-abc" },
      });

      expect(result.kind).toBe("approved-image");
      expect(records).toHaveLength(2);
      for (const record of records) {
        expect(readPngSize(record.bytes as Buffer)).toEqual({ width: 1260, height: 2240 });
      }
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

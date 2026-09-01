import { afterEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import type { Event } from "@shared/schema";
import type { Tier1Result } from "../server/aiFirst/tier1";
import type { VisionVerdict } from "../server/aiFirst/visionGate";
import {
  buildDirectionCard,
  buildQualityLockedPreviewBrief,
  clearNamedThemeDetectionCache,
  detectNamedCreativeReference,
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
    expect(concept.minOverlay).toBe("veil");
    expect(concept.art.composition).toContain("no visible panel");
    expect(concept.art.prompt).toContain("Do not draw a blank card");
    expect(brief.requirements.excluded).toContain(
      "a visible blank card, white rectangle, paper panel, placard, sign, frame or placeholder box inside the artwork",
    );
    expect(brief.requirements.excluded).toContain(
      "a lead character's face or head cropped off by the canvas edge",
    );
  });
  it("fails closed to the deterministic direction-card mode", () => {
    expect(readPrePaymentPreviewMode({})).toBe("direction-card");
    expect(readPrePaymentPreviewMode({ POSY_PREPAYMENT_PREVIEW_MODE: "nonsense" })).toBe("direction-card");
    expect(readPrePaymentPreviewMode({ POSY_PREPAYMENT_PREVIEW_MODE: "quality-image" })).toBe("quality-image");
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

  it("keeps a rejected first candidate private and returns only the approved correction", async () => {
    const generateImage = vi.fn()
      .mockResolvedValueOnce({
        bytes: Buffer.alloc(50_000, 1),
        dataUrl: "data:image/png;base64,FIRST",
        durationMs: 100,
      })
      .mockResolvedValueOnce({
        bytes: Buffer.alloc(50_000, 2),
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
    expect(result.dataUrl).toBe("data:image/png;base64,SECOND");
    expect(result.attempts).toBe(2);
    expect(generateImage).toHaveBeenCalledTimes(2);
    expect(generateImage.mock.calls[0][0]).toEqual(expect.objectContaining({
      model: "gpt-image-2",
      quality: "medium",
      aspectRatio: "9:16",
    }));
    expect(generateImage.mock.calls[1][0].prompt).toContain("Meekah is missing");
    expect(generateImage.mock.calls[0][0].prompt).toContain("FINISH CONTRACT");
    expect(generateImage.mock.calls[0][0].prompt).toContain("visually quiet typography zone");
    expect(JSON.stringify(result)).not.toContain("FIRST");
  });

  it("returns no customer-visible pixels when both private candidates fail", async () => {
    const generateImage = vi.fn(async () => ({
      bytes: Buffer.alloc(50_000, 3),
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
});

import { describe, expect, it, vi } from "vitest";
import type { Event } from "@shared/schema";
import type { Tier1Result } from "../server/aiFirst/tier1";
import type { VisionVerdict } from "../server/aiFirst/visionGate";
import {
  buildDirectionCard,
  detectNamedCreativeReference,
  directionCardDataUrl,
  generateQualityLockedPreview,
  readPrePaymentPreviewMode,
} from "../server/prePaymentPreviewQuality";

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
  it("fails closed to the deterministic direction-card mode", () => {
    expect(readPrePaymentPreviewMode({})).toBe("direction-card");
    expect(readPrePaymentPreviewMode({ POSY_PREPAYMENT_PREVIEW_MODE: "nonsense" })).toBe("direction-card");
    expect(readPrePaymentPreviewMode({ POSY_PREPAYMENT_PREVIEW_MODE: "quality-image" })).toBe("quality-image");
  });

  it("detects exact entertainment references instead of collapsing them to a generic category", () => {
    expect(detectNamedCreativeReference("Blippi and Meekah party")?.id).toBe("blippi-meekah");
    expect(detectNamedCreativeReference("Unicorn Academy TV series winter party")?.id).toBe("unicorn-academy");
    expect(detectNamedCreativeReference("simple unicorn garden party")).toBeNull();
  });

  it("builds a useful deterministic proof from the host's actual details", () => {
    const card = buildDirectionCard(event);
    expect(card.eventName).toContain("Brian");
    expect(card.headline).toBe("Blippi + Meekah");
    expect(card.cues).toEqual(expect.arrayContaining(["Indoor soft play", "Bubbles", "Ice-cream treats"]));
    expect(card.referenceRecommended).toBe(true);
    expect(card.supportingCopy).toContain("Weak or generic artwork is never shown.");

    const dataUrl = directionCardDataUrl(event);
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
    expect(generateImage.mock.calls[0][0]).toEqual(expect.objectContaining({ model: "gpt-image-2", quality: "medium" }));
    expect(generateImage.mock.calls[1][0].prompt).toContain("Meekah is missing");
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

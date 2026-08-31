import { describe, expect, it, vi } from "vitest";
import type { Event } from "@shared/schema";
import type { Tier1Result } from "../server/aiFirst/tier1";
import type { VisionVerdict } from "../server/aiFirst/visionGate";
import { generateQualityLockedPreview } from "../server/prePaymentPreviewQuality";

// The live image-edits API currently accepts explicit input fidelity on the
// reference model, while generic text-only generation remains on GPT Image 2.
const event = {
  id: 710,
  eventName: "Hayden's Unicorn Academy Birthday",
  eventType: "Birthday Party",
  eventDate: "Saturday, January 16, 2027",
  themeName: "",
  vibeDescription: "Unicorn Academy riders and bonded unicorns inside a glowing winter igloo.",
  paletteColors: "[]",
  estimatedGuestCount: 24,
} as unknown as Event;

const tier1: Tier1Result = {
  passed: true,
  findings: [],
  salientRegions: [],
  durationMs: 1,
};

const vision: VisionVerdict = {
  scores: {
    textLogoWatermarkFree: 5,
    artifactFree: 5,
    premiumFinish: 5,
    briefFidelity: 5,
    compositionQuality: 5,
    ageAppropriate: 5,
  },
  requiredPresent: [{ requirement: "recognizable academy riders and bonded unicorns", present: true }],
  excludedFound: [],
  notes: "approved",
  passed: true,
  failureCodes: [],
  unavailable: false,
  durationMs: 1,
  usage: { inputTokens: 10, outputTokens: 5 },
};

describe("reference-led preview quality", () => {
  it("uses the supported high-fidelity reference model and forwards the original pixels", async () => {
    const referenceImages = [{
      bytes: Buffer.from("official-reference-pixels"),
      mimeType: "image/png" as const,
      filename: "reference.png",
    }];
    const generateImage = vi.fn(async () => ({
      bytes: Buffer.alloc(50_000, 1),
      dataUrl: "data:image/png;base64,APPROVED",
      durationMs: 100,
    }));

    const result = await generateQualityLockedPreview(event, {
      referenceImages,
      generateImage,
      runTier1: () => tier1,
      runVision: async () => vision,
      maxCandidates: 1,
    });

    expect(result.kind).toBe("approved-image");
    expect(generateImage).toHaveBeenCalledTimes(1);
    expect(generateImage.mock.calls[0][0]).toEqual(expect.objectContaining({
      model: "gpt-image-1.5",
      quality: "high",
      inputFidelity: "high",
      aspectRatio: "9:16",
      referenceImages,
    }));
  });

  it("keeps generic no-reference preview generation on GPT Image 2 at medium quality", async () => {
    const generateImage = vi.fn(async () => ({
      bytes: Buffer.alloc(50_000, 2),
      dataUrl: "data:image/png;base64,APPROVED",
      durationMs: 100,
    }));

    await generateQualityLockedPreview({
      ...event,
      eventName: "Garden at Dusk",
      vibeDescription: "A candlelit garden dinner with layered florals.",
    }, {
      generateImage,
      runTier1: () => tier1,
      runVision: async () => vision,
      maxCandidates: 1,
    });

    expect(generateImage.mock.calls[0][0]).toEqual(expect.objectContaining({
      model: "gpt-image-2",
      quality: "medium",
      inputFidelity: undefined,
    }));
  });
});

import { describe, expect, it, vi } from "vitest";
import type { Event } from "@shared/schema";
import type { Tier1Result } from "../server/aiFirst/tier1";
import type { VisionVerdict } from "../server/aiFirst/visionGate";
import { encodePng, readPngSize } from "../server/aiFirst/png";
import { generateQualityLockedPreview } from "../server/prePaymentPreviewQuality";

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

function generatedPng(fill: number, width = 630, height = 1120): Buffer {
  const rgb = new Uint8Array(width * height * 3);
  rgb.fill(fill);
  return encodePng({ width, height, rgb });
}

const tier1: Tier1Result = {
  passed: true,
  findings: [],
  salientRegions: [],
  durationMs: 1,
};

function vision(passed: boolean, notes = "approved"): VisionVerdict {
  return {
    scores: {
      textLogoWatermarkFree: 5,
      artifactFree: passed ? 5 : 4,
      premiumFinish: passed ? 5 : 3,
      briefFidelity: passed ? 5 : 2,
      compositionQuality: passed ? 5 : 4,
      ageAppropriate: 5,
    },
    requiredPresent: [{
      requirement: "recognizable academy riders and bonded unicorns",
      present: passed,
    }],
    excludedFound: passed ? [] : ["generic adjacent aesthetic"],
    notes,
    passed,
    failureCodes: passed ? [] : ["brief-fidelity"],
    unavailable: false,
    durationMs: 1,
    usage: { inputTokens: 10, outputTokens: 5 },
  };
}

describe("reference-led preview quality", () => {
  it("uses high-fidelity reference generation first, then GPT Image 2 only as a private correction", async () => {
    const referenceImages = [{
      bytes: Buffer.from("official-reference-pixels"),
      mimeType: "image/png" as const,
      filename: "reference.png",
    }];
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
    const runVision = vi.fn()
      .mockResolvedValueOnce(vision(false, "The rider and unicorn identity is too generic."))
      .mockResolvedValueOnce(vision(true));

    const result = await generateQualityLockedPreview(event, {
      referenceImages,
      generateImage,
      runTier1: () => tier1,
      runVision,
      maxCandidates: 2,
    });

    expect(result.kind).toBe("approved-image");
    if (result.kind !== "approved-image") throw new Error("expected approved image");
    expect(result.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(readPngSize(Buffer.from(result.dataUrl.split(",")[1], "base64"))).toEqual({ width: 315, height: 560 });
    expect(result.model).toBe("gpt-image-2");
    expect(generateImage).toHaveBeenCalledTimes(2);
    expect(generateImage.mock.calls[0][0]).toEqual(expect.objectContaining({
      model: "gpt-image-1.5",
      quality: "high",
      inputFidelity: "high",
      aspectRatio: "9:16",
      referenceImages,
    }));
    expect(generateImage.mock.calls[1][0]).toEqual(expect.objectContaining({
      model: "gpt-image-2",
      quality: "high",
      inputFidelity: undefined,
      aspectRatio: "9:16",
      referenceImages,
    }));
    expect(generateImage.mock.calls[1][0].prompt).toContain("too generic");
  });

  it("keeps generic no-reference preview generation on GPT Image 2 at medium quality", async () => {
    const generateImage = vi.fn(async () => ({
      bytes: generatedPng(2),
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
      runVision: async () => vision(true),
      maxCandidates: 1,
    });

    expect(generateImage.mock.calls[0][0]).toEqual(expect.objectContaining({
      model: "gpt-image-2",
      quality: "medium",
      inputFidelity: undefined,
    }));
  });
});

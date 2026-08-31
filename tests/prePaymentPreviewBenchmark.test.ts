import { describe, expect, it } from "vitest";
import type { Event } from "@shared/schema";
import {
  buildDirectionCard,
  detectNamedCreativeReference,
  directionCardDataUrl,
} from "../server/prePaymentPreviewQuality";
import { PREPAYMENT_PREVIEW_BENCHMARK } from "./fixtures/prePaymentPreviewBenchmark";

function benchmarkEvent(testCase: (typeof PREPAYMENT_PREVIEW_BENCHMARK)[number]): Event {
  return {
    id: 1,
    eventName: testCase.eventName,
    eventType: testCase.eventType,
    eventDate: "",
    themeName: "",
    vibeDescription: testCase.vibeDescription,
    paletteColors: "[]",
    estimatedGuestCount: 20,
    prePaymentPreviewAttempts: 0,
    prePaymentPreviewUrl: "",
    prePaymentPreviewUsedAt: null,
    sparkUnlockedAt: null,
  } as unknown as Event;
}

describe("fixed prepayment-preview release benchmark", () => {
  it("contains 24 representative event briefs", () => {
    expect(PREPAYMENT_PREVIEW_BENCHMARK).toHaveLength(24);
  });

  for (const testCase of PREPAYMENT_PREVIEW_BENCHMARK) {
    it(`${testCase.id}: produces a complete safe direction and correct named-reference routing`, () => {
      const event = benchmarkEvent(testCase);
      const identity = [testCase.eventName, testCase.eventType, testCase.vibeDescription].join(" ");
      const detected = detectNamedCreativeReference(identity);
      expect(detected?.id).toBe(testCase.expectedNamedReference);

      const card = buildDirectionCard(event);
      expect(card.cues).toHaveLength(4);
      expect(card.cues).toEqual(expect.arrayContaining(testCase.expectedCues));
      expect(card.referenceRecommended).toBe(Boolean(testCase.expectedNamedReference));

      const dataUrl = directionCardDataUrl(event);
      expect(dataUrl).toMatch(/^data:image\/svg\+xml;base64,/);
      const svg = Buffer.from(dataUrl.split(",")[1], "base64").toString("utf8");
      expect(svg).toContain("<svg");
      expect(svg).toContain("FIRST LOOK");
      expect(svg).not.toContain("undefined");
    });
  }
});

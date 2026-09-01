import { describe, expect, it } from "vitest";
import {
  buildPrePaymentPreviewConcept,
  normalizePrePaymentPreviewBrief,
} from "../server/prePaymentPreviewConcept";

describe("pre-payment preview literal fidelity", () => {
  it("normalizes the likely Mika spelling inside a Blippi brief", () => {
    expect(
      normalizePrePaymentPreviewBrief("A Blippi and Mika indoor soft-play birthday"),
    ).toBe("A Blippi and Meekah indoor soft-play birthday");
  });

  it("builds the Blippi preview from the full literal event rather than an accessory", () => {
    const { sourceBrief, concept } = buildPrePaymentPreviewConcept({
      eventName: "Brian and Blippi's Extravaganza",
      eventType: "Birthday Party",
      themeName: "",
      vibeDescription:
        "Brian's 4th birthday featuring Blippi and Mika at an indoor soft-play space with foam blocks, tunnels, slides, bubbles, bubble wands, dancing and ice cream treats.",
    } as never);

    expect(sourceBrief).toContain("Blippi and Meekah");
    expect(concept.artDirection?.subjectFocus).toContain("Blippi and Meekah");
    expect(concept.illustrationPrompt).toContain("indoor soft-play");
    expect(concept.illustrationPrompt).toContain("ice-cream treats");
    expect(concept.illustrationPrompt).toContain("Do not substitute an abstract symbol");
    expect(concept.illustrationPrompt).toContain("bow tie");
    expect(concept.illustrationPrompt).toContain("dots");
    expect(concept.layoutStyle).toBe("centered");
  });

  it("keeps the complete original brief authoritative for a non-character event", () => {
    const { sourceBrief, concept } = buildPrePaymentPreviewConcept({
      eventName: "Nina's Fortieth",
      eventType: "Birthday Party",
      themeName: "",
      vibeDescription: "Candlelit rooftop dinner in terracotta and gold at sunset",
    } as never);

    expect(sourceBrief).toContain("Candlelit rooftop dinner");
    expect(concept.illustrationPrompt).toContain(sourceBrief);
    expect(concept.illustrationPrompt).toContain("literal people, characters, setting, activities and defining objects");
  });
});

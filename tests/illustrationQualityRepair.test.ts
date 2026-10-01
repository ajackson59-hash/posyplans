import { describe, expect, it } from "vitest";
import {
  tightenIllustrationPrompt,
  type ArtQualityScore,
} from "../server/illustrationGen";

describe("illustration quality repair", () => {
  it("feeds the art critic's concrete franchise and character findings into the retry", () => {
    const score: ArtQualityScore = {
      text_free: 2,
      composition: 4,
      premium_feel: 4,
      theme_fit: 2,
      overall: 3,
      issues:
        "Generic unicorn riders; show Sophia and Wildstar with their recognizable Unicorn Academy visual cues, and remove the fake title text.",
    };

    const repaired = tightenIllustrationPrompt("Original image brief", score);

    expect(repaired).toContain("ART DIRECTOR'S SPECIFIC CORRECTIONS");
    expect(repaired).toContain("Sophia and Wildstar");
    expect(repaired).toContain("remove the fake title text");
    expect(repaired).toContain("absolutely no text");
    expect(repaired).toContain("specifically requested concept");
  });

  it("bounds provider feedback before appending it to a retry prompt", () => {
    const score: ArtQualityScore = {
      text_free: 5,
      composition: 2,
      premium_feel: 2,
      theme_fit: 2,
      overall: 2.75,
      issues: "x".repeat(1200),
    };

    const repaired = tightenIllustrationPrompt("Original image brief", score);
    const marker = "ART DIRECTOR'S SPECIFIC CORRECTIONS: ";
    const feedback = repaired.split(marker)[1] ?? "";

    expect(feedback).toHaveLength(800);
  });
});

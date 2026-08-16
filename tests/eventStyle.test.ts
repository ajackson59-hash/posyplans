import { describe, expect, it } from "vitest";
import { eventStyleParts, eventStyleSeed, eventStyleSummary, isSavedEventStyle } from "@shared/eventStyle";

describe("the event style follows the host through the product", () => {
  it("uses the intake description when the short theme field is blank", () => {
    const event = {
      themeName: "",
      vibeDescription: "A modern, elevated construction party with warm yellow iron and blueprint details.",
    };

    expect(eventStyleSeed(event)).toBe(event.vibeDescription);
    expect(eventStyleSummary(event)).toBe(event.vibeDescription);
    expect(isSavedEventStyle(event, `  ${event.vibeDescription}  `)).toBe(true);
  });

  it("keeps a short theme and the fuller creative brief together", () => {
    const event = {
      themeName: "Little Builder",
      vibeDescription: "Architectural linework, sun-warmed machinery, and no cartoon clip art.",
    };

    expect(eventStyleSeed(event)).toBe("Little Builder");
    expect(eventStyleSummary(event)).toBe(
      "Little Builder — Architectural linework, sun-warmed machinery, and no cartoon clip art.",
    );
  });

  it("deduplicates the same saved style and has a useful fallback", () => {
    expect(eventStyleParts({ themeName: "Under the Stars", vibeDescription: "under the stars" })).toEqual([
      "Under the Stars",
    ]);
    expect(eventStyleSummary({ eventType: "Birthday Party", eventName: "Mara is Four" })).toBe(
      "Birthday Party for Mara is Four",
    );
  });
});

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildEventDetailsUpdate } from "@/lib/eventDetails";
import { updateEventSchema } from "@shared/schema";

const draft = {
  eventName: "  Our Anniversary  ",
  eventType: "Anniversary",
  eventDate: "Sat, Nov 7, 2026",
  location: "  The venue  ",
  hostNames: "  Alex & Jamie  ",
  estimatedGuestCount: " 42 ",
  vibeDescription: "  Candlelit dinner with warm autumn florals.  ",
};

describe("editable event details", () => {
  it("saves the event type, guest estimate, and planning brief without generation data", () => {
    expect(buildEventDetailsUpdate(draft)).toEqual({
      eventName: "Our Anniversary",
      eventType: "Anniversary",
      eventDate: "Sat, Nov 7, 2026",
      location: "The venue",
      hostNames: "Alex & Jamie",
      estimatedGuestCount: 42,
      vibeDescription: "Candlelit dinner with warm autumn florals.",
    });
  });

  it("allows an event without a guest estimate", () => {
    expect(buildEventDetailsUpdate({ ...draft, estimatedGuestCount: "" }).estimatedGuestCount).toBeNull();
  });

  it.each(["0", "2001", "2.5", "many"])("rejects an invalid guest estimate: %s", (value) => {
    expect(() => buildEventDetailsUpdate({ ...draft, estimatedGuestCount: value })).toThrow(
      "Estimated guest count must be a whole number between 1 and 2,000.",
    );
  });

  it("rejects a planning brief over 500 characters", () => {
    expect(() => buildEventDetailsUpdate({ ...draft, vibeDescription: "x".repeat(501) })).toThrow(
      "Planning brief must be 500 characters or fewer.",
    );
  });

  it("allows the editable foundation through the owner-scoped update schema", () => {
    expect(
      updateEventSchema.safeParse({
        eventType: "Anniversary",
        estimatedGuestCount: 42,
        vibeDescription: "Candlelit dinner with warm autumn florals.",
      }).success,
    ).toBe(true);
  });

  it("wires every previously locked field into the dashboard without triggering generation", () => {
    const source = fs.readFileSync(path.resolve("client/src/pages/Dashboard.tsx"), "utf8");
    const saveDetails = source.slice(source.indexOf("const saveDetails"), source.indexOf("const saveVenue"));

    expect(source).toContain('data-testid="select-details-event-type"');
    expect(source).toContain('data-testid="input-details-guest-count"');
    expect(source).toContain('data-testid="input-details-planning-brief"');
    expect(saveDetails).toContain("buildEventDetailsUpdate");
    expect(saveDetails).not.toContain("master-planner/generate");
  });
});

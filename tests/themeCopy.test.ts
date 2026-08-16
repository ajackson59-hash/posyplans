import { describe, expect, it } from "vitest";
import { LAUNCH_THEMES, themeCopyForEvent } from "@shared/themeCatalog";
import { parseEventDate } from "@shared/rsvpDeadline";

describe("real-event invitation copy", () => {
  const theme = LAUNCH_THEMES.find((item) => item.id === "celestial-heirloom")!;

  it("never leaks catalogue sample facts into a host's invitation", () => {
    const copy = themeCopyForEvent(theme, {
      eventDate: "August 8, 2099",
      location: "The back garden",
      rsvpDeadline: "November 20, 2099",
    });

    expect(copy.dateLine).toBe("August 8, 2099");
    expect(copy.timeLine).toBe("");
    expect(copy.locationLine).toBe("The back garden");
    expect(Object.values(copy).join(" ")).not.toContain("Observatory");
    expect(Object.values(copy).join(" ")).not.toContain("November 20");
  });

  it("leaves missing event facts blank rather than using demo copy", () => {
    const copy = themeCopyForEvent(theme, {});
    expect(copy).toEqual({
      eyebrow: "Please join us",
      dateLine: "",
      timeLine: "",
      locationLine: "",
      rsvpLine: "",
    });
  });

  it("understands the day-first date format already stored by Posy", () => {
    expect(parseEventDate("12 September 2026")?.getFullYear()).toBe(2026);
  });
});

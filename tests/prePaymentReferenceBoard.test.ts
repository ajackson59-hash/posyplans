import { describe, expect, it } from "vitest";
import type { Event } from "@shared/schema";
import {
  REFERENCE_BOARD_DATA_URL_PREFIX,
  isReferenceBoardDataUrl,
  referenceBoardDataUrl,
  renderReferenceBoardSvg,
} from "../server/prePaymentReferenceBoard";

const event = {
  id: 12,
  eventName: "Hayden's Unicorn Academy 7th Birthday",
  eventType: "Birthday Party",
  eventDate: "Saturday, January 16, 2027",
  themeName: "",
  vibeDescription:
    "Unicorn Academy riders and bonded unicorns in a winter wonderland inside a glowing igloo.",
  paletteColors: "[]",
  estimatedGuestCount: 24,
} as unknown as Event;

const references = [
  {
    bytes: Buffer.from("first exact reference pixels"),
    mimeType: "image/png" as const,
    filename: "first.png",
  },
  {
    bytes: Buffer.from("second exact reference pixels"),
    mimeType: "image/jpeg" as const,
    filename: "second.jpg",
  },
];

describe("reference-backed prepayment preview board", () => {
  it("embeds only the host's exact reference bytes alongside the captured event direction", () => {
    const svg = renderReferenceBoardSvg(event, references);

    expect(svg).toContain('data-posy-preview-kind="reference-board"');
    expect(svg).toContain("Hayden&apos;s Unicorn Academy 7th Birthday");
    expect(svg).toContain("Unicorn Academy");
    expect(svg).toContain("Academy riders");
    expect(svg).toContain("Winter snow-globe igloo");
    expect(svg).toContain(
      `data:image/png;base64,${references[0].bytes.toString("base64")}`,
    );
    expect(svg).toContain(
      `data:image/jpeg;base64,${references[1].bytes.toString("base64")}`,
    );
    expect(svg).not.toContain("http://");
    expect(svg).not.toContain("https://");
    expect(svg).toContain('preserveAspectRatio="xMidYMid meet"');
  });

  it("uses a distinct data-URL marker without decoding a large stored SVG", () => {
    const dataUrl = referenceBoardDataUrl(event, references.slice(0, 1));
    expect(dataUrl.startsWith(REFERENCE_BOARD_DATA_URL_PREFIX)).toBe(true);
    expect(isReferenceBoardDataUrl(dataUrl)).toBe(true);
    expect(isReferenceBoardDataUrl("data:image/svg+xml;base64,AAAA")).toBe(false);

    const svg = Buffer.from(dataUrl.slice(REFERENCE_BOARD_DATA_URL_PREFIX.length), "base64")
      .toString("utf8");
    expect(svg).toContain("VISUAL REFERENCE CAPTURED");
  });

  it("requires one or two validated reference images", () => {
    expect(() => renderReferenceBoardSvg(event, [])).toThrow(/one or two/i);
    expect(() => renderReferenceBoardSvg(event, [...references, references[0]])).toThrow(/one or two/i);
  });
});

// The three verification briefs, expressed as the event records the product
// would actually hold — so `buildEventBrief` derives the brief exactly as it
// does in production rather than the harness hand-writing one.

import type { DnaAxis } from "@shared/eventDna";

export interface BriefSpec {
  id: string;
  label: string;
  event: Record<string, unknown>;
  dna: Partial<Record<DnaAxis, number>>;
  guestCount: number | null;
}

export const BRIEFS: BriefSpec[] = [
  {
    id: "A",
    label: "Modern space-cowgirl fourth birthday",
    event: {
      id: 9001,
      shareSlug: "brief-a",
      eventName: "Ada's 4th Birthday",
      eventType: "birthday",
      themeName: "space cowgirl",
      vibeDescription:
        "modern space cowgirl — sleek and a bit cinematic, not a dress-up cartoon. Big desert sky, chrome and dust.",
      paletteColors: JSON.stringify(["dusty rose", "brass", "deep navy"]),
      eventDate: "12 September 2026",
      location: "our back garden",
      venueName: "",
    },
    dna: { formalPlayful: 0.45, elegantCasual: 0.1, modernTraditional: -0.6, boldSubtle: 0.2 },
    guestCount: 18,
  },
  {
    id: "B",
    label: "Elegant candlelit 40th birthday dinner",
    event: {
      id: 9002,
      shareSlug: "brief-b",
      eventName: "Marianne's 40th Birthday Dinner",
      eventType: "birthday dinner",
      themeName: "candlelit dinner",
      vibeDescription:
        "elegant and candlelit — a long table, low warm light, wine and quiet glamour. Grown-up, unfussy, nothing novelty.",
      paletteColors: JSON.stringify(["ink", "oxblood", "warm gold"]),
      eventDate: "7 November 2026",
      location: "Ferrier's, the private dining room",
      venueName: "Ferrier's",
    },
    dna: { formalPlayful: -0.5, elegantCasual: -0.65, modernTraditional: 0.15, boldSubtle: -0.3 },
    guestCount: 14,
  },
  {
    id: "C",
    label: "Modern elevated construction-themed third birthday",
    event: {
      id: 9003,
      shareSlug: "brief-c",
      eventName: "Theo's 3rd Birthday",
      eventType: "birthday",
      themeName: "construction site",
      vibeDescription:
        "construction themed but elevated and modern — think architectural drawings and honest materials, not plastic digger clipart.",
      paletteColors: JSON.stringify(["safety amber", "concrete grey", "blueprint blue"]),
      eventDate: "21 March 2027",
      location: "Weald Park, the meadow shelter",
      venueName: "Weald Park",
    },
    dna: { formalPlayful: 0.5, elegantCasual: 0.2, modernTraditional: -0.7, boldSubtle: 0.45 },
    guestCount: 22,
  },
];

export interface PrePaymentPreviewBenchmarkCase {
  id: string;
  eventName: string;
  eventType: string;
  vibeDescription: string;
  expectedNamedReference?: string;
  expectedCues: string[];
}

/**
 * Fixed release corpus. Real-image benchmark tooling may run each case three
 * times, but this fixture is also used by zero-cost tests so coverage cannot
 * silently shrink before provider spend is enabled.
 */
export const PREPAYMENT_PREVIEW_BENCHMARK: readonly PrePaymentPreviewBenchmarkCase[] = [
  {
    id: "blippi-soft-play",
    eventName: "Brian and Blippi's Extravaganza",
    eventType: "Birthday Party",
    vibeDescription: "Blippi and Meekah at indoor soft play with bubbles, dancing and ice cream treats.",
    expectedNamedReference: "blippi-meekah",
    expectedCues: ["Indoor soft play", "Bubbles", "Ice-cream treats"],
  },
  {
    id: "blippi-common-typo",
    eventName: "Blipi Birthday",
    eventType: "Birthday Party",
    vibeDescription: "Blipi and Mika with foam climbing blocks and bubble wands.",
    expectedNamedReference: "blippi-meekah",
    expectedCues: ["Indoor soft play", "Bubbles"],
  },
  {
    id: "unicorn-academy-igloo",
    eventName: "Hayden's Unicorn Academy 7th Birthday",
    eventType: "Birthday Party",
    vibeDescription: "Unicorn Academy TV-series riders and bonded unicorns in a winter wonderland inside a glowing outdoor igloo, like a party in a snow globe.",
    expectedNamedReference: "unicorn-academy",
    expectedCues: ["Unicorn Academy", "Academy riders", "Bonded magical unicorns", "Winter snow-globe igloo"],
  },
  {
    id: "unicorn-academy-typo",
    eventName: "Unicorn Acadamy Party",
    eventType: "Birthday Party",
    vibeDescription: "Unicorn Acadamy riders and magical unicorns in snow.",
    expectedNamedReference: "unicorn-academy",
    expectedCues: ["Unicorn Academy", "Academy riders"],
  },
  {
    id: "kpop-demon-hunters",
    eventName: "KPop Demon Hunters Dance Party",
    eventType: "Birthday Party",
    vibeDescription: "Rumi, Mira and Zoey performance energy with supernatural demon-hunting details and dancing.",
    expectedNamedReference: "kpop-demon-hunters",
    expectedCues: ["KPop Demon Hunters", "Heroine trio"],
  },
  {
    id: "paw-patrol",
    eventName: "PAW Patrol Rescue Party",
    eventType: "Birthday Party",
    vibeDescription: "PAW Patrol rescue pups, teamwork and an outdoor obstacle course.",
    expectedNamedReference: "paw-patrol",
    expectedCues: ["PAW Patrol", "Rescue pups"],
  },
  {
    id: "paw-patrol-typo",
    eventName: "Paw Patroll Party",
    eventType: "Birthday Party",
    vibeDescription: "Paw Patroll rescue adventure.",
    expectedNamedReference: "paw-patrol",
    expectedCues: ["PAW Patrol", "Rescue pups"],
  },
  {
    id: "bluey",
    eventName: "Bluey Backyard Games",
    eventType: "Birthday Party",
    vibeDescription: "Bluey-inspired imaginative family games outside in the backyard.",
    expectedNamedReference: "bluey",
    expectedCues: ["Bluey", "Playful family energy"],
  },
  {
    id: "generic-unicorn",
    eventName: "Pastel Unicorn Garden",
    eventType: "Birthday Party",
    vibeDescription: "A soft pastel unicorn garden with flowers and a magical outdoor tea table.",
    expectedCues: ["Magical unicorns", "Garden florals", "Outdoor setting"],
  },
  {
    id: "construction",
    eventName: "I'm 3 and Diggin' It",
    eventType: "Birthday Party",
    vibeDescription: "A construction birthday with a crane, excavator, safety vests and builder activities.",
    expectedCues: ["Little-builder details"],
  },
  {
    id: "dinosaur-museum",
    eventName: "Dinosaur Discovery",
    eventType: "Birthday Party",
    vibeDescription: "A sophisticated dinosaur museum expedition with fossils and a dramatic T-rex reveal.",
    expectedCues: [],
  },
  {
    id: "mermaid-pool",
    eventName: "Mermaid Lagoon",
    eventType: "Birthday Party",
    vibeDescription: "An under-the-sea mermaid pool party with pearly details and swimming.",
    expectedCues: ["Poolside energy"],
  },
  {
    id: "safari",
    eventName: "Little Explorer Safari",
    eventType: "Birthday Party",
    vibeDescription: "Warm safari animals, canvas tents and an outdoor explorer trail.",
    expectedCues: ["Outdoor setting"],
  },
  {
    id: "space",
    eventName: "Orbit Seven",
    eventType: "Birthday Party",
    vibeDescription: "A cinematic space mission with astronauts, planets and a glowing galaxy.",
    expectedCues: [],
  },
  {
    id: "western",
    eventName: "Modern Cowgirl",
    eventType: "Birthday Party",
    vibeDescription: "A refined western ranch party with horses, lariat details and sunset tones.",
    expectedCues: [],
  },
  {
    id: "pool-editorial",
    eventName: "Summer Splash",
    eventType: "Birthday Party",
    vibeDescription: "A chic poolside celebration with swimming, cabanas and citrus drinks.",
    expectedCues: ["Poolside energy"],
  },
  {
    id: "garden-dinner",
    eventName: "Garden at Dusk",
    eventType: "Dinner Party",
    vibeDescription: "A candlelit garden dinner with layered florals and a relaxed seated meal.",
    expectedCues: ["Candlelit atmosphere", "Garden florals", "Seated dinner"],
  },
  {
    id: "rooftop-fortieth",
    eventName: "Nina's Fortieth",
    eventType: "Birthday Party",
    vibeDescription: "An elegant candlelit rooftop dinner in terracotta and gold at sunset.",
    expectedCues: ["Candlelit atmosphere", "Rooftop setting", "Seated dinner"],
  },
  {
    id: "anniversary",
    eventName: "Twenty Years Together",
    eventType: "Anniversary",
    vibeDescription: "An intimate candlelit anniversary dinner with warm florals.",
    expectedCues: ["Candlelit atmosphere", "Garden florals", "Seated dinner"],
  },
  {
    id: "baby-shower",
    eventName: "A Little Love Is Blooming",
    eventType: "Baby Shower",
    vibeDescription: "An elevated garden brunch with wildflowers and soft linen.",
    expectedCues: ["Garden florals", "Brunch gathering"],
  },
  {
    id: "graduation",
    eventName: "The Next Chapter",
    eventType: "Graduation Party",
    vibeDescription: "Modern editorial graduation dinner with black, ivory and brass details.",
    expectedCues: ["Seated dinner"],
  },
  {
    id: "family-reunion",
    eventName: "The Jackson Reunion",
    eventType: "Family Reunion",
    vibeDescription: "A warm outdoor family gathering with long tables, games and memory displays.",
    expectedCues: ["Outdoor setting"],
  },
  {
    id: "holiday-cocktail",
    eventName: "Winter Cocktail Hour",
    eventType: "Holiday Party",
    vibeDescription: "An elegant winter gathering with candlelight, evergreen and champagne.",
    expectedCues: ["Candlelit atmosphere", "Winter wonderland"],
  },
  {
    id: "roller-disco",
    eventName: "Roll Into Eight",
    eventType: "Birthday Party",
    vibeDescription: "A vibrant roller disco with dancing, mirrored lights and modern neon.",
    expectedCues: ["Dancing"],
  },
] as const;

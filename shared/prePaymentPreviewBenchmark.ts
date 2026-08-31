export interface PrePaymentPreviewBenchmarkCase {
  id: string;
  eventName: string;
  eventType: string;
  vibeDescription: string;
  expectedNamedReference?: string;
  expectedCues: string[];
  /**
   * Fixed notes representing the visual facts Posy's screenshot analyzer must
   * recover for a named entertainment reference. Runtime customer generation
   * still receives notes extracted from the host's actual uploaded screenshot;
   * the release benchmark uses these deterministic notes so repeated runs
   * measure the image/quality pipeline rather than changing source evidence.
   */
  benchmarkReferenceNotes?: string;
}

const BLIPPI_REFERENCE =
  "The reference shows two distinct live-action educational hosts together. Blippi is an adult man in a bright blue shirt with orange suspenders, an orange bow tie, orange glasses and a blue-and-orange cap. Meekah is an adult woman with natural curly hair in a distinct purple-and-orange play-and-learn outfit. Preserve both full hosts and their friendly energetic identities; do not substitute an isolated bow tie, color palette, logo, text or generic second adult.";

const UNICORN_ACADEMY_REFERENCE =
  "The reference shows the polished animated Unicorn Academy world: distinct academy-age girl riders in jewel-toned riding uniforms, each visibly bonded with a different magical unicorn carrying its own mane color, markings and personality. Preserve recognizable rider-and-unicorn pairs and the academy fantasy identity; do not substitute generic children, generic horses, rainbow clipart or an unrelated unicorn party.";

const KPOP_DEMON_HUNTERS_REFERENCE =
  "The reference shows a distinct stylized animated heroine trio: three different young women with clearly different faces, hair silhouettes and coordinated contemporary K-pop performance styling. Preserve all three as central performers while adding unmistakable supernatural hunter energy, weapons or magical combat details; do not substitute a generic girl group or abstract neon.";

const PAW_PATROL_REFERENCE =
  "The reference shows the polished animated PAW Patrol rescue team: multiple distinct puppy breeds with recognizable colored rescue uniforms, badges, packs and job-specific gear. Preserve the team identity and Adventure Bay rescue-world energy; do not substitute generic puppies in random hats.";

const BLUEY_REFERENCE =
  "The reference shows the recognizable flat 2D Bluey blue-heeler family world with its specific rounded dog silhouettes, blue color blocking, warm Australian-home atmosphere and imaginative family-play energy. Do not substitute generic blue dogs, realistic dogs or unrelated cartoon animals.";

/**
 * Fixed release corpus. The funded provider benchmark runs every case three
 * times. Zero-cost tests also consume this exact corpus so coverage cannot
 * silently shrink before generated previews are enabled.
 */
export const PREPAYMENT_PREVIEW_BENCHMARK: readonly PrePaymentPreviewBenchmarkCase[] = [
  {
    id: "blippi-soft-play",
    eventName: "Brian and Blippi's Extravaganza",
    eventType: "Birthday Party",
    vibeDescription: "Blippi and Meekah at indoor soft play with bubbles, dancing and ice cream treats.",
    expectedNamedReference: "blippi-meekah",
    expectedCues: ["Indoor soft play", "Bubbles", "Ice-cream treats"],
    benchmarkReferenceNotes: BLIPPI_REFERENCE,
  },
  {
    id: "blippi-common-typo",
    eventName: "Blipi Birthday",
    eventType: "Birthday Party",
    vibeDescription: "Blipi and Mika with foam climbing blocks and bubble wands.",
    expectedNamedReference: "blippi-meekah",
    expectedCues: ["Indoor soft play", "Bubbles"],
    benchmarkReferenceNotes: BLIPPI_REFERENCE,
  },
  {
    id: "unicorn-academy-igloo",
    eventName: "Hayden's Unicorn Academy 7th Birthday",
    eventType: "Birthday Party",
    vibeDescription: "Unicorn Academy TV-series riders and bonded unicorns in a winter wonderland inside a glowing outdoor igloo, like a party in a snow globe.",
    expectedNamedReference: "unicorn-academy",
    expectedCues: ["Unicorn Academy", "Academy riders", "Bonded magical unicorns", "Winter snow-globe igloo"],
    benchmarkReferenceNotes: UNICORN_ACADEMY_REFERENCE,
  },
  {
    id: "unicorn-academy-typo",
    eventName: "Unicorn Acadamy Party",
    eventType: "Birthday Party",
    vibeDescription: "Unicorn Acadamy riders and magical unicorns in snow.",
    expectedNamedReference: "unicorn-academy",
    expectedCues: ["Unicorn Academy", "Academy riders"],
    benchmarkReferenceNotes: UNICORN_ACADEMY_REFERENCE,
  },
  {
    id: "kpop-demon-hunters",
    eventName: "KPop Demon Hunters Dance Party",
    eventType: "Birthday Party",
    vibeDescription: "Rumi, Mira and Zoey performance energy with supernatural demon-hunting details and dancing.",
    expectedNamedReference: "kpop-demon-hunters",
    expectedCues: ["KPop Demon Hunters", "Heroine trio"],
    benchmarkReferenceNotes: KPOP_DEMON_HUNTERS_REFERENCE,
  },
  {
    id: "paw-patrol",
    eventName: "PAW Patrol Rescue Party",
    eventType: "Birthday Party",
    vibeDescription: "PAW Patrol rescue pups, teamwork and an outdoor obstacle course.",
    expectedNamedReference: "paw-patrol",
    expectedCues: ["PAW Patrol", "Rescue pups"],
    benchmarkReferenceNotes: PAW_PATROL_REFERENCE,
  },
  {
    id: "paw-patrol-typo",
    eventName: "Paw Patroll Party",
    eventType: "Birthday Party",
    vibeDescription: "Paw Patroll rescue adventure.",
    expectedNamedReference: "paw-patrol",
    expectedCues: ["PAW Patrol", "Rescue pups"],
    benchmarkReferenceNotes: PAW_PATROL_REFERENCE,
  },
  {
    id: "bluey",
    eventName: "Bluey Backyard Games",
    eventType: "Birthday Party",
    vibeDescription: "Bluey-inspired imaginative family games outside in the backyard.",
    expectedNamedReference: "bluey",
    expectedCues: ["Bluey", "Playful family energy"],
    benchmarkReferenceNotes: BLUEY_REFERENCE,
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

export function getPrePaymentPreviewBenchmarkCase(id: string): PrePaymentPreviewBenchmarkCase | undefined {
  return PREPAYMENT_PREVIEW_BENCHMARK.find((testCase) => testCase.id === id);
}

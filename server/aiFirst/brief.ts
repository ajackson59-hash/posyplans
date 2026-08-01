// The structured event brief.
//
// Requirement: a Concierge user never re-enters what Posy already knows. This
// assembles the complete brief from existing event data — name, type, age or
// milestone, vibe, theme, colours, motifs, exclusions, formality, date and
// season, venue type, guest count, Event DNA, and any inspiration analysis —
// and it owns the REQUIRED / PREFERRED / EXCLUDED classification.
//
// Classification lives here, not in the model, for two reasons: the server is
// what audits the finished artwork against the list, and a model that invents
// its own requirements can always satisfy them.

import type { Event } from "@shared/schema";
import { DNA_AXES, type DnaAxis } from "@shared/eventDna";

export interface BriefRequirements {
  /** Must be visibly present. Audited against the finished artwork. */
  required: string[];
  /** Should be present. Not a gate failure. */
  preferred: string[];
  /** Must be absent. Audited against the finished artwork. */
  excluded: string[];
}

export interface EventBrief {
  eventName: string;
  eventType: string;
  /** "4th birthday", "40th birthday", or "" when there is no milestone. */
  milestone: string;
  /** The host's own words. Never paraphrased away. */
  vibe: string;
  themeName: string;
  colors: string[];
  formality: string;
  dateLine: string;
  season: string;
  venueType: string;
  guestCount: number | null;
  dna: Partial<Record<DnaAxis, number>>;
  /** Vision analysis of uploaded inspiration, when the host supplied any. */
  inspirationNotes: string;
  requirements: BriefRequirements;
}

/* ── Derivations from existing event data ────────────────────────────── */

const MONTH_SEASON: Record<string, string> = {
  january: "winter", february: "winter", december: "winter",
  march: "spring", april: "spring", may: "spring",
  june: "summer", july: "summer", august: "summer",
  september: "autumn", october: "autumn", november: "autumn",
};

export function seasonFromDate(dateLine: string): string {
  const lower = (dateLine || "").toLowerCase();
  for (const [month, season] of Object.entries(MONTH_SEASON)) {
    if (lower.includes(month)) return season;
  }
  return "";
}

/**
 * Pulls an age or milestone out of the event name or type — "Ada's 4th
 * Birthday", "Fortieth", "40th birthday dinner".
 */
export function milestoneFrom(eventName: string, eventType: string, vibe: string): string {
  const haystack = `${eventName} ${eventType} ${vibe}`;
  const ordinal = /\b(\d{1,3})(st|nd|rd|th)\b/i.exec(haystack);
  if (ordinal) return `${ordinal[1]}${ordinal[2].toLowerCase()}`;
  const words: Record<string, string> = {
    first: "1st", second: "2nd", third: "3rd", fourth: "4th", fifth: "5th",
    sixth: "6th", seventh: "7th", eighth: "8th", ninth: "9th", tenth: "10th",
    thirteenth: "13th", sixteenth: "16th", eighteenth: "18th", twentieth: "20th",
    thirtieth: "30th", fortieth: "40th", fiftieth: "50th", sixtieth: "60th",
    seventieth: "70th", eightieth: "80th", ninetieth: "90th", hundredth: "100th",
  };
  for (const [word, value] of Object.entries(words)) {
    if (new RegExp(`\\b${word}\\b`, "i").test(haystack)) return value;
  }
  return "";
}

/** Numeric age when the milestone is a child's birthday, else null. */
export function ageFromMilestone(milestone: string): number | null {
  const m = /^(\d{1,3})/.exec(milestone);
  if (!m) return null;
  return parseInt(m[1], 10);
}

export function venueTypeFrom(event: Pick<Event, "location" | "venueName">): string {
  const text = `${event.venueName || ""} ${event.location || ""}`.toLowerCase();
  if (/\b(home|house|backyard|garden|yard|apartment)\b/.test(text)) return "private home";
  if (/\b(park|beach|farm|orchard|vineyard|outdoor)\b/.test(text)) return "outdoor venue";
  if (/\b(restaurant|bistro|dining|supper|kitchen)\b/.test(text)) return "restaurant";
  if (/\b(hall|ballroom|hotel|club|loft|gallery|studio|venue|space|centre|center)\b/.test(text)) {
    return "indoor event space";
  }
  return text.trim() ? "venue" : "";
}

export function formalityFrom(dna: Partial<Record<DnaAxis, number>>, milestone: string): string {
  const elegant = dna.elegantCasual ?? 0;
  const playful = dna.formalPlayful ?? 0;
  const age = ageFromMilestone(milestone);
  if (age !== null && age <= 12) return playful > 0.2 ? "playful and celebratory" : "refined-playful";
  if (elegant < -0.3) return "formal and elegant";
  if (elegant > 0.3) return "relaxed and casual";
  return "elevated but unstuffy";
}

function parseColors(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.filter((c): c is string => typeof c === "string") : [];
  } catch {
    return [];
  }
}

/* ── Requirement classification, owned by the server ─────────────────── */

/**
 * Exclusions that apply to every brief. These are the failure modes that make
 * a generated invitation look generated.
 */
const UNIVERSAL_EXCLUSIONS = [
  "generated text, letters, words or numbers",
  "logos, signatures or watermarks",
  "clip art or generic template graphics",
  "stock photography",
  "plastic-looking 3D render objects",
  "printed paper margins, mats or card frames inside the artwork",
];

/** Extra exclusions for young children's parties. */
const CHILD_EXCLUSIONS = ["babyish or infantile imagery", "repetitive rounded cartoon shapes", "visual kitsch"];

/** Extra exclusions for grown-up milestone events. */
const ADULT_EXCLUSIONS = ["cartoon characters", "childish motifs", "novelty party imagery"];

const MOTIF_STOPWORDS = new Set([
  "a", "an", "and", "the", "with", "for", "of", "in", "on", "at", "to", "very", "really",
  "party", "birthday", "themed", "theme", "celebration", "vibe", "feel", "want", "like",
]);

/**
 * Pulls candidate must-have motifs out of the host's own vibe/theme words.
 * Deliberately conservative: a required item is audited against the finished
 * artwork, so a false positive here fails good work.
 */
export function motifsFrom(vibe: string, themeName: string): string[] {
  const source = `${themeName} ${vibe}`.toLowerCase();
  const words = source
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !MOTIF_STOPWORDS.has(w));
  return Array.from(new Set(words)).slice(0, 6);
}

export function classifyRequirements(input: {
  themeName: string;
  vibe: string;
  colors: string[];
  milestone: string;
  formality: string;
}): BriefRequirements {
  const required: string[] = [];
  const preferred: string[] = [];
  const age = ageFromMilestone(input.milestone);

  const themeIdentity = input.themeName.trim() || input.vibe.trim();
  if (themeIdentity) required.push(`the ${themeIdentity} visual identity, unmistakably present`);
  if (input.colors.length > 0) required.push(`the stated colour family: ${input.colors.join(", ")}`);
  if (input.milestone) {
    required.push(
      age !== null && age <= 12
        ? `age-appropriate celebratory character for a ${input.milestone} birthday`
        : `a ${input.milestone} milestone that reads as grown-up, not novelty`,
    );
  }

  for (const motif of motifsFrom(input.vibe, input.themeName)) {
    preferred.push(`a restrained interpretation of "${motif}"`);
  }
  preferred.push(`${input.formality} styling`, "modern stationery finish");

  const excluded = [...UNIVERSAL_EXCLUSIONS];
  if (age !== null && age <= 12) excluded.push(...CHILD_EXCLUSIONS);
  else if (age !== null) excluded.push(...ADULT_EXCLUSIONS);

  return { required, preferred, excluded };
}

/* ── Assembly ────────────────────────────────────────────────────────── */

export interface BuildBriefInput {
  event: Event;
  dna: Partial<Record<DnaAxis, number>>;
  guestCount: number | null;
  inspirationNotes?: string;
  /** The single answer collected when a manual event had no usable brief. */
  vibeAnswer?: string;
}

export function buildEventBrief(input: BuildBriefInput): EventBrief {
  const { event } = input;
  const vibe = (input.vibeAnswer?.trim() || event.vibeDescription || "").trim();
  const milestone = milestoneFrom(event.eventName, event.eventType, vibe);
  const formality = formalityFrom(input.dna, milestone);
  const colors = parseColors(event.paletteColors);

  return {
    eventName: event.eventName || "",
    eventType: event.eventType || "",
    milestone,
    vibe,
    themeName: event.themeName || "",
    colors,
    formality,
    dateLine: event.eventDate || "",
    season: seasonFromDate(event.eventDate || ""),
    venueType: venueTypeFrom(event),
    guestCount: input.guestCount,
    dna: input.dna,
    inspirationNotes: (input.inspirationNotes || "").trim(),
    requirements: classifyRequirements({
      themeName: event.themeName || "",
      vibe,
      colors,
      milestone,
      formality,
    }),
  };
}

/**
 * Is there enough here to art-direct from? Concierge events always are —
 * intake collects the vibe. A manually created event may not be, and that is
 * the only case where the host is asked anything at all.
 */
export function briefIsSufficient(event: Event): boolean {
  // An event type on its own ("birthday") is a category, not a visual
  // direction, so it cannot answer the question the model is being asked.
  const direction = [event.vibeDescription, event.themeName]
    .map((v) => (v || "").trim())
    .filter(Boolean);
  return direction.join(" ").length >= 8;
}

/** The one question, asked only when `briefIsSufficient` is false. */
export const SINGLE_BRIEF_QUESTION = "What should this celebration feel like?";

/** Renders the brief as the compact block the model receives. */
export function briefToPromptBlock(brief: EventBrief): string {
  const dnaLine = DNA_AXES.map((axis) => {
    const value = brief.dna[axis.key];
    return value === undefined ? null : `${axis.key} ${value > 0 ? axis.poleB : axis.poleA} (${value.toFixed(2)})`;
  })
    .filter(Boolean)
    .join(", ");

  const lines: string[] = [
    `Event: ${brief.eventName || "(unnamed)"}${brief.eventType ? ` · ${brief.eventType}` : ""}`,
  ];
  if (brief.milestone) lines.push(`Milestone: ${brief.milestone}`);
  if (brief.vibe) lines.push(`Host's words: ${brief.vibe}`);
  if (brief.themeName) lines.push(`Theme: ${brief.themeName}`);
  if (brief.colors.length) lines.push(`Colours: ${brief.colors.join(", ")}`);
  lines.push(`Formality: ${brief.formality}`);
  if (brief.dateLine) lines.push(`Date: ${brief.dateLine}${brief.season ? ` (${brief.season})` : ""}`);
  if (brief.venueType) lines.push(`Venue: ${brief.venueType}`);
  if (brief.guestCount !== null) lines.push(`Guests: ${brief.guestCount}`);
  if (dnaLine) lines.push(`Event DNA: ${dnaLine}`);
  if (brief.inspirationNotes) lines.push(`Inspiration: ${brief.inspirationNotes}`);

  lines.push("", `REQUIRED (every concept must deliver all of these):`);
  brief.requirements.required.forEach((r) => lines.push(`- ${r}`));
  if (brief.requirements.preferred.length) {
    lines.push("", "PREFERRED (deliver where it strengthens the concept):");
    brief.requirements.preferred.forEach((r) => lines.push(`- ${r}`));
  }
  lines.push("", "EXCLUDED (must not appear):");
  brief.requirements.excluded.forEach((r) => lines.push(`- ${r}`));

  return lines.join("\n");
}

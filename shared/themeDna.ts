// Theme DNA: a structured style profile derived from an applied Invitation
// Intelligence concept, used to coordinate the rest of the event stationery
// suite (envelope, liner, stamp, backdrop, thank-you card) so everything reads
// as one considered piece rather than a single card.
//
// Every value here is derived DETERMINISTICALLY from fields the concept
// already carries (palette, fontPairingId, borderStyle, conceptName,
// illustrationPrompt). There are no LLM calls and no randomness — the same
// concept always yields the same DNA, so a host's suite never shifts under them.
//
// Kept framework-agnostic (plain objects, no React types) so it can be imported
// by both the Express server and the React client.

import type { InviteDesignConcept, BorderStyle } from "./inviteDesign";

export const LINER_PATTERNS = ["solid", "dots", "stripes", "chevron", "floral"] as const;
export type LinerPattern = (typeof LINER_PATTERNS)[number];

export const STAMP_STYLES = ["classic", "seal", "postmark", "motif"] as const;
export type StampStyle = (typeof STAMP_STYLES)[number];

export const FORMALITY_LEVELS = ["casual", "playful", "elegant"] as const;
export type Formality = (typeof FORMALITY_LEVELS)[number];

export interface ThemeDna {
  paletteColors: string[];
  primaryColor: string;
  accentColor: string;
  backgroundColor: string;
  /** Font pairing id (see FONT_PAIRINGS) — resolve with getFontPairing() to get the actual families. */
  fontHeadingId: string;
  fontBodyId: string;
  /** Short phrase describing the concept's visual subject, e.g. "construction equipment". */
  motifDescriptor: string;
  formality: Formality;
  linerPattern: LinerPattern;
  stampStyle: StampStyle;
}

const FALLBACK_PALETTE = ["#7c3aed", "#c4b5fd", "#f5f3ff", "#4c1d95"];

/** Relative luminance (0 = black, 1 = white) for a #RRGGBB string. */
function luminance(hex: string): number {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!m) return 0.5;
  const int = parseInt(m[1], 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;
  // Perceptual weighting — good enough for picking "lightest" and "most
  // contrasting" from a 4-color palette without pulling in a color library.
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Motif keywords worth surfacing, ordered so more specific subjects win over
// generic ones when a prompt mentions several.
const MOTIF_KEYWORDS: string[] = [
  "construction equipment", "construction", "dinosaur", "unicorn", "mermaid", "pirate",
  "superhero", "space", "rocket", "astronaut", "safari", "jungle", "dragon", "castle",
  "princess", "fairy", "butterfly", "rainbow", "balloon", "confetti", "streamer",
  "floral", "flower", "botanical", "foliage", "leaf", "garden", "tropical", "palm",
  "woodland", "forest", "mountain", "ocean", "wave", "nautical", "anchor", "beach",
  "star", "moon", "celestial", "sparkle", "geometric", "stripe", "polka dot", "plaid",
  "vintage", "retro", "art deco", "watercolor", "marble", "terrazzo",
  "cake", "cupcake", "donut", "ice cream", "candy", "picnic", "tea party",
  "train", "race car", "car", "airplane", "boat", "robot", "video game",
  "animal", "cat", "dog", "bear", "fox", "bunny", "farm", "tractor",
  "snow", "winter", "autumn", "pumpkin", "holiday",
];

/**
 * Pulls a short, human-readable motif phrase out of the concept's own text.
 * Prefers an explicit keyword match in the illustration prompt (the most
 * descriptive field), then the concept name, then falls back to the first few
 * meaningful words of the prompt.
 */
function deriveMotifDescriptor(concept: InviteDesignConcept): string {
  const prompt = (concept.illustrationPrompt || "").toLowerCase();
  const name = (concept.conceptName || "").toLowerCase();
  const description = (concept.description || "").toLowerCase();

  for (const keyword of MOTIF_KEYWORDS) {
    if (prompt.includes(keyword) || name.includes(keyword) || description.includes(keyword)) {
      return keyword;
    }
  }

  // No known keyword — use the concept name if it reads like a subject, else
  // the opening words of the illustration prompt with filler stripped out.
  if (concept.conceptName?.trim()) return concept.conceptName.trim().toLowerCase();

  const stopWords = new Set(["a", "an", "the", "of", "with", "and", "in", "on", "for", "no", "text", "letters", "words", "numbers"]);
  const words = prompt
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w && !stopWords.has(w))
    .slice(0, 3);
  return words.length > 0 ? words.join(" ") : "decorative";
}

// Font pairings whose personality leans formal vs. distinctly playful. Used
// alongside border style so formality doesn't hinge on a single signal.
const ELEGANT_FONTS = new Set(["editorial-serif", "flowing-script", "classic-formal", "bold-editorial"]);
const PLAYFUL_FONTS = new Set(["playful-rounded", "rustic-handwritten"]);
const PLAYFUL_NAME_WORDS = ["party", "fun", "playful", "whimsical", "confetti", "bright", "silly", "pop", "carnival", "circus"];
const ELEGANT_NAME_WORDS = ["elegant", "classic", "timeless", "refined", "formal", "luxe", "golden", "vintage", "romantic"];

function deriveFormality(concept: InviteDesignConcept): Formality {
  const border = concept.borderStyle;
  const font = concept.fontPairingId;
  const name = (concept.conceptName || "").toLowerCase();

  // Border style is the strongest signal — it's the most deliberate formality
  // choice the concept makes.
  if (border === "double-frame" || border === "corner-flourish") return "elegant";
  if (border === "dashed-frame") return "playful";

  // "none" / "thin-frame" are neutral, so fall through to the font pairing.
  if (ELEGANT_FONTS.has(font)) return "elegant";
  if (PLAYFUL_FONTS.has(font)) return "playful";

  // Last resort: the concept's own name.
  if (PLAYFUL_NAME_WORDS.some((w) => name.includes(w))) return "playful";
  if (ELEGANT_NAME_WORDS.some((w) => name.includes(w))) return "elegant";
  return "casual";
}

const LINER_BY_BORDER: Record<BorderStyle, LinerPattern> = {
  "none": "solid",
  "thin-frame": "stripes",
  "double-frame": "chevron",
  "dashed-frame": "dots",
  "corner-flourish": "floral",
};

function deriveStampStyle(formality: Formality, border: BorderStyle): StampStyle {
  if (formality === "elegant") return "seal";
  if (formality === "playful") return "motif";
  // Casual splits on how bare the card is: an unframed card gets the more
  // characterful postmark, a framed one the plain classic stamp.
  return border === "none" ? "postmark" : "classic";
}

/**
 * Derives the coordinated stationery profile for an applied concept.
 * Pure and deterministic — no LLM calls, no randomness.
 */
export function deriveThemeDna(concept: InviteDesignConcept): ThemeDna {
  const paletteColors =
    Array.isArray(concept.paletteColors) && concept.paletteColors.length > 0
      ? concept.paletteColors
      : FALLBACK_PALETTE;

  const primaryColor = paletteColors[0];
  // Lightest color reads as the paper/background surface.
  const backgroundColor = paletteColors.reduce((lightest, c) => (luminance(c) > luminance(lightest) ? c : lightest), paletteColors[0]);
  // Accent = whatever in the palette contrasts hardest against that surface,
  // so overlaid detail stays legible on the envelope and liner.
  const accentColor = paletteColors.reduce(
    (best, c) => (Math.abs(luminance(c) - luminance(backgroundColor)) > Math.abs(luminance(best) - luminance(backgroundColor)) ? c : best),
    paletteColors[0],
  );

  const formality = deriveFormality(concept);
  const linerPattern = LINER_BY_BORDER[concept.borderStyle] ?? "solid";

  return {
    paletteColors,
    primaryColor,
    accentColor,
    backgroundColor,
    fontHeadingId: concept.fontPairingId,
    fontBodyId: concept.fontPairingId,
    motifDescriptor: deriveMotifDescriptor(concept),
    formality,
    linerPattern,
    stampStyle: deriveStampStyle(formality, concept.borderStyle),
  };
}

/**
 * Inline style for an envelope liner, as a CSS background built from the
 * suite's own colors. Shared by the host-side suite preview and the
 * guest-facing envelope so both render identically.
 */
export function linerPatternStyle(pattern: LinerPattern, patternColor: string, baseColor: string): Record<string, string> {
  const base = { backgroundColor: baseColor };
  switch (pattern) {
    case "dots":
      return {
        ...base,
        backgroundImage: `radial-gradient(${patternColor} 1.5px, transparent 1.6px)`,
        backgroundSize: "10px 10px",
      };
    case "stripes":
      return {
        ...base,
        backgroundImage: `repeating-linear-gradient(45deg, ${patternColor} 0 4px, transparent 4px 12px)`,
      };
    case "chevron":
      return {
        ...base,
        backgroundImage:
          `repeating-linear-gradient(135deg, ${patternColor} 0 3px, transparent 3px 10px),` +
          `repeating-linear-gradient(45deg, ${patternColor} 0 3px, transparent 3px 10px)`,
        backgroundSize: "14px 14px",
      };
    case "floral":
      return {
        ...base,
        backgroundImage:
          `radial-gradient(circle at 50% 30%, ${patternColor} 2px, transparent 2.5px),` +
          `radial-gradient(circle at 30% 60%, ${patternColor} 2px, transparent 2.5px),` +
          `radial-gradient(circle at 70% 60%, ${patternColor} 2px, transparent 2.5px)`,
        backgroundSize: "20px 20px",
      };
    default:
      return base;
  }
}

/** Short glyph + label for a stamp style, used by the mini-previews and the envelope. */
export function stampGlyph(style: StampStyle): { glyph: string; label: string } {
  switch (style) {
    case "seal":
      return { glyph: "✦", label: "Seal" };
    case "postmark":
      return { glyph: "◎", label: "Postmark" };
    case "motif":
      return { glyph: "❀", label: "Motif" };
    default:
      return { glyph: "✉", label: "Classic" };
  }
}

export function isLinerPattern(value: unknown): value is LinerPattern {
  return typeof value === "string" && (LINER_PATTERNS as readonly string[]).includes(value);
}

export function isStampStyle(value: unknown): value is StampStyle {
  return typeof value === "string" && (STAMP_STYLES as readonly string[]).includes(value);
}

// Curated Theme Library — professionally designed invitation themes that
// render instantly with SVG decorative art. No AI generation required.
//
// Each theme is a complete design package: palette, typography, border
// treatment, decorative SVG art, envelope styling, and layout — all
// pre-designed to look competitive with Paperless Post / Greenvelope.
//
// Themes are backwards-compatible: each carries an InviteDesignConcept so
// existing rendering code (conceptHeadingStyle, conceptBodyStyle, etc.)
// works without changes. The `decorativeArt` field selects which SVG
// component renders as the card's decorative element.

import type { InviteDesignConcept, BorderStyle, LayoutStyle } from "./inviteDesign";
import type { LinerPattern, StampStyle } from "./themeDna";

export type ThemeCategory = "elegant" | "bold" | "playful";

// IDs for the SVG decorative art components in ThemeArt.tsx
export type DecorativeArtId =
  | "rose-corner"
  | "botanical-sprig"
  | "art-deco-fan"
  | "vintage-lace"
  | "confetti-scatter"
  | "terrazzo"
  | "sunburst-rays"
  | "bunting-garland"
  | "balloon-bouquet"
  | "starry-night";

export interface CuratedTheme {
  id: string;
  name: string;
  description: string;
  category: ThemeCategory;
  decorativeArt: DecorativeArtId;
  concept: InviteDesignConcept;
  // Envelope + suite styling
  envelopeColor: string;
  linerPattern: LinerPattern;
  linerColor: string;
  stampStyle: StampStyle;
  stampColor: string;
  // Background texture for the card (optional CSS)
  cardBackground?: string;
  // Extra accent color for decorative elements
  accentColor: string;
}

export const CURATED_THEMES: CuratedTheme[] = [
  // ═══ ELEGANT / EDITORIAL ═════════════════════════════════════════
  {
    id: "garden-rose",
    name: "Garden Rose",
    description: "Watercolor rose corners with gold framing",
    category: "elegant",
    decorativeArt: "rose-corner",
    accentColor: "#c084a3",
    cardBackground: "#fef7ed",
    concept: {
      conceptName: "Garden Rose Soirée",
      description: "Dusty mauve roses with champagne gold accents on ivory paper",
      paletteColors: ["#9d6b7b", "#d4af37", "#fef7ed", "#a3b8a3"],
      fontPairingId: "editorial-serif",
      borderStyle: "double-frame",
      layoutStyle: "centered",
      illustrationPrompt: "Watercolor garden rose corner with soft petals and gold leaf accents",
      styleLaneId: "editorial-premium",
    },
    envelopeColor: "#9d6b7b",
    linerPattern: "floral",
    linerColor: "#d4af37",
    stampStyle: "seal",
    stampColor: "#d4af37",
  },
  {
    id: "botanical-sage",
    name: "Botanical Sage",
    description: "Olive branch sprig with minimalist gold frame",
    category: "elegant",
    decorativeArt: "botanical-sprig",
    accentColor: "#7c8b6e",
    cardBackground: "#f7f5f0",
    concept: {
      conceptName: "Sage Terrace Brunch",
      description: "Muted sage and cream with delicate olive branch accents",
      paletteColors: ["#7c8b6e", "#c4b99a", "#f7f5f0", "#8b7355"],
      fontPairingId: "classic-formal",
      borderStyle: "thin-frame",
      layoutStyle: "centered",
      illustrationPrompt: "Delicate olive branch sprig with sage leaves",
      styleLaneId: "minimal-modern",
    },
    envelopeColor: "#7c8b6e",
    linerPattern: "waves",
    linerColor: "#c4b99a",
    stampStyle: "motif",
    stampColor: "#8b7355",
  },
  {
    id: "art-deco-gold",
    name: "Art Deco Gold",
    description: "Geometric gold fan corners on midnight black",
    category: "elegant",
    decorativeArt: "art-deco-fan",
    accentColor: "#d4af37",
    cardBackground: "#1a1a2e",
    concept: {
      conceptName: "Gilded Evening",
      description: "Black and gold art deco with geometric fan motifs",
      paletteColors: ["#d4af37", "#1a1a2e", "#f5e6c8", "#8b6914"],
      fontPairingId: "bold-editorial",
      borderStyle: "double-frame",
      layoutStyle: "centered",
      illustrationPrompt: "Art deco geometric gold fan ornament on dark background",
      styleLaneId: "bold-graphic",
    },
    envelopeColor: "#1a1a2e",
    linerPattern: "diamonds",
    linerColor: "#d4af37",
    stampStyle: "wax-seal",
    stampColor: "#d4af37",
  },
  {
    id: "vintage-lace",
    name: "Vintage Lace",
    description: "Delicate lace border on warm ivory",
    category: "elegant",
    decorativeArt: "vintage-lace",
    accentColor: "#c9b89e",
    cardBackground: "#fdfbf7",
    concept: {
      conceptName: "Heirloom Lace",
      description: "Cream and blush with intricate lace border detailing",
      paletteColors: ["#c9b89e", "#e8d5c4", "#fdfbf7", "#a67c52"],
      fontPairingId: "flowing-script",
      borderStyle: "corner-flourish",
      layoutStyle: "centered",
      illustrationPrompt: "Vintage lace border pattern on warm ivory paper",
      styleLaneId: "handcrafted-rustic",
    },
    envelopeColor: "#e8d5c4",
    linerPattern: "lattice",
    linerColor: "#c9b89e",
    stampStyle: "seal",
    stampColor: "#a67c52",
  },

  // ═══ BOLD / VIBRANT ══════════════════════════════════════════════
  {
    id: "confetti-pop",
    name: "Confetti Pop",
    description: "Scattered confetti in sophisticated tones",
    category: "bold",
    decorativeArt: "confetti-scatter",
    accentColor: "#e85d75",
    cardBackground: "#fff8f0",
    concept: {
      conceptName: "Celebration Pop",
      description: "Coral and teal confetti scatter on warm white",
      paletteColors: ["#e85d75", "#2a9d8f", "#fff8f0", "#264653"],
      fontPairingId: "modern-sans",
      borderStyle: "none",
      layoutStyle: "full-bleed",
      illustrationPrompt: "Scattered geometric confetti in coral and teal",
      styleLaneId: "playful-illustrated",
    },
    envelopeColor: "#e85d75",
    linerPattern: "confetti",
    linerColor: "#2a9d8f",
    stampStyle: "motif",
    stampColor: "#264653",
  },
  {
    id: "terrazzo-modern",
    name: "Terrazzo Modern",
    description: "Colorful terrazzo pattern with clean typography",
    category: "bold",
    decorativeArt: "terrazzo",
    accentColor: "#5b8def",
    cardBackground: "#f8f6f3",
    concept: {
      conceptName: "Terrazzo Celebration",
      description: "Playful terrazzo chips in blue, coral, and mustard",
      paletteColors: ["#5b8def", "#ef6f6c", "#f8f6f3", "#f4a261"],
      fontPairingId: "minimal-geometric",
      borderStyle: "thin-frame",
      layoutStyle: "banner",
      illustrationPrompt: "Colorful terrazzo pattern with blue coral and mustard chips",
      styleLaneId: "bold-graphic",
    },
    envelopeColor: "#5b8def",
    linerPattern: "scallops",
    linerColor: "#f4a261",
    stampStyle: "star",
    stampColor: "#ef6f6c",
  },
  {
    id: "sunburst-warm",
    name: "Sunburst",
    description: "Radiating golden rays with warm coral accents",
    category: "bold",
    decorativeArt: "sunburst-rays",
    accentColor: "#e76f51",
    cardBackground: "#fef9f0",
    concept: {
      conceptName: "Golden Hour",
      description: "Warm sunburst rays in coral and gold",
      paletteColors: ["#e76f51", "#f4a261", "#fef9f0", "#264653"],
      fontPairingId: "bold-editorial",
      borderStyle: "none",
      layoutStyle: "full-bleed",
      illustrationPrompt: "Radiating sunburst rays in warm coral and gold",
      styleLaneId: "bold-graphic",
    },
    envelopeColor: "#e76f51",
    linerPattern: "stars",
    linerColor: "#f4a261",
    stampStyle: "star",
    stampColor: "#264653",
  },

  // ═══ PLAYFUL / WHIMSICAL ════════════════════════════════════════
  {
    id: "bunting-garland",
    name: "Bunting Garland",
    description: "Strung pennant garland in soft pastels",
    category: "playful",
    decorativeArt: "bunting-garland",
    accentColor: "#7eb8da",
    cardBackground: "#fefcf8",
    concept: {
      conceptName: "Garden Party Garland",
      description: "Pastel bunting garland across the top with warm tones",
      paletteColors: ["#7eb8da", "#f4c2c2", "#fefcf8", "#8b7355"],
      fontPairingId: "rustic-handwritten",
      borderStyle: "none",
      layoutStyle: "banner",
      illustrationPrompt: "Strung pennant bunting garland in soft pastels",
      styleLaneId: "storybook-whimsical",
    },
    envelopeColor: "#7eb8da",
    linerPattern: "scallops",
    linerColor: "#f4c2c2",
    stampStyle: "bow",
    stampColor: "#8b7355",
  },
  {
    id: "balloon-bouquet",
    name: "Balloon Bouquet",
    description: "Elegant floating balloons in muted tones",
    category: "playful",
    decorativeArt: "balloon-bouquet",
    accentColor: "#d4a5d8",
    cardBackground: "#fdfbff",
    concept: {
      conceptName: "Floating Celebration",
      description: "Soft pastel balloons floating with delicate strings",
      paletteColors: ["#d4a5d8", "#a8d8ea", "#fdfbff", "#6c757d"],
      fontPairingId: "playful-rounded",
      borderStyle: "dashed-frame",
      layoutStyle: "centered",
      illustrationPrompt: "Elegant floating balloons in muted pastel tones",
      styleLaneId: "playful-illustrated",
    },
    envelopeColor: "#d4a5d8",
    linerPattern: "dots",
    linerColor: "#a8d8ea",
    stampStyle: "heart",
    stampColor: "#6c757d",
  },
  {
    id: "starry-night",
    name: "Starry Night",
    description: "Scattered stars and crescent moon on deep blue",
    category: "playful",
    decorativeArt: "starry-night",
    accentColor: "#f0d264",
    cardBackground: "#1b2845",
    concept: {
      conceptName: "Moonlit Celebration",
      description: "Gold stars and crescent moon on midnight blue",
      paletteColors: ["#f0d264", "#1b2845", "#e8e8e8", "#4a5568"],
      fontPairingId: "flowing-script",
      borderStyle: "thin-frame",
      layoutStyle: "full-bleed",
      illustrationPrompt: "Scattered gold stars and crescent moon on deep blue night sky",
      styleLaneId: "storybook-whimsical",
    },
    envelopeColor: "#1b2845",
    linerPattern: "stars",
    linerColor: "#f0d264",
    stampStyle: "star",
    stampColor: "#f0d264",
  },
];

export function getThemeById(id: string): CuratedTheme | undefined {
  return CURATED_THEMES.find((t) => t.id === id);
}

export function themesByCategory(category: ThemeCategory): CuratedTheme[] {
  return CURATED_THEMES.filter((t) => t.category === category);
}

/**
 * Converts a curated theme into the concept JSON + suite fields that the
 * existing API endpoints expect. Calling apply-concept with this concept
 * and then patching the suite fields gives a fully styled event with no
 * AI generation step.
 */
export function themeToEventPatch(theme: CuratedTheme) {
  return {
    concept: theme.concept,
    envelopeColor: theme.envelopeColor,
    envelopeLinerPattern: theme.linerPattern,
    linerColor: theme.linerColor,
    stampStyle: theme.stampStyle,
    stampColor: theme.stampColor,
    paletteColors: theme.concept.paletteColors,
  };
}

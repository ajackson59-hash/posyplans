// Posy Launch Theme Catalog
// ─────────────────────────────────────────────────────────────────────────
// Eight art-directed invitation themes. Each theme owns a piece of original
// portrait (3:4) artwork plus the full design system that sits on top of it:
// curated palette variants, curated type pairings, curated type placements,
// a readable overlay treatment, and a coordinated envelope bundle.
//
// The artwork is a static asset. Selecting a theme is a pure data operation —
// no image model is ever called on this path. Typography is live HTML layered
// over the artwork, so every word stays editable and every design stays
// crisp at any size.
//
// Framework-agnostic (plain data, no React types) so the Express server, the
// React client, and the test suite can all import it.

import type { BorderStyle, InviteDesignConcept, LayoutStyle } from "./inviteDesign";
import type { LinerPattern, StampStyle } from "./themeDna";
import { parseEventDate, suggestRsvpDeadline } from "./rsvpDeadline";

/* ── Filters ─────────────────────────────────────────────────────────── */

export const THEME_STYLES = ["elegant", "modern", "bold", "storybook", "kids"] as const;
export type ThemeStyle = (typeof THEME_STYLES)[number];

export const THEME_STYLE_LABELS: Record<ThemeStyle, string> = {
  elegant: "Elegant",
  modern: "Modern",
  bold: "Bold",
  storybook: "Storybook",
  kids: "Kids & Teen",
};

export const THEME_OCCASIONS = [
  "milestone-birthday",
  "kids-birthday",
  "teen-birthday",
  "dinner-party",
  "shower",
  "celebration",
  "summer-party",
  "holiday-party",
] as const;
export type ThemeOccasion = (typeof THEME_OCCASIONS)[number];

export const THEME_OCCASION_LABELS: Record<ThemeOccasion, string> = {
  "milestone-birthday": "Milestone birthday",
  "kids-birthday": "Kids birthday",
  "teen-birthday": "Teen birthday",
  "dinner-party": "Dinner party",
  shower: "Shower",
  celebration: "Celebration",
  "summer-party": "Summer party",
  "holiday-party": "Holiday party",
};

/* ── Design primitives ───────────────────────────────────────────────── */

/**
 * Where the type block sits on the 3:4 canvas, expressed in percentages so it
 * scales identically in a 180px gallery thumbnail and a 640px editor preview.
 * Every theme ships placements that respect its artwork's own composition —
 * a host cannot drop text onto the roller skate or into the flower corners.
 */
export interface TextPlacement {
  id: string;
  label: string;
  box: { top: number; left: number; width: number; height: number };
  align: "left" | "center" | "right";
  justify: "start" | "center" | "end";
}

/**
 * Readable overlay treatment applied behind the type. Artwork carries the
 * colour; these exist purely so the words stay legible on busy passages.
 * - "none"    : artwork is already quiet where the type sits
 * - "veil"    : soft wash of the palette surface colour across the type box
 * - "plate"   : a defined stationery panel behind the type
 * - "gradient": vertical scrim, strongest behind the type
 */
export const OVERLAY_TREATMENTS = ["none", "veil", "plate", "gradient"] as const;
export type OverlayTreatment = (typeof OVERLAY_TREATMENTS)[number];

export const OVERLAY_LABELS: Record<OverlayTreatment, string> = {
  none: "Clear",
  veil: "Soft veil",
  plate: "Paper panel",
  gradient: "Gradient",
};

/**
 * Stable surface opacity over the complete live-type box. The deterministic
 * quality gate imports the same values as the renderer, so it judges the card
 * customers actually see instead of rejecting safe artwork from raw pixels.
 * A gradient is deliberately zero here: its opacity changes by position and
 * cannot guarantee the whole type block. Full-card AI layouts canonicalize it
 * to a local veil before generation.
 */
export const LOCAL_TYPE_SURFACE_ALPHA: Record<OverlayTreatment, number> = {
  none: 0,
  veil: 0.88,
  plate: 0.94,
  gradient: 0,
};

/**
 * The decorative vector motif a theme draws over its artwork. Every motif is
 * coloured from the live palette, so changing colourway repaints the art.
 */
export const THEME_ART_IDS = [
  "rose-corner",
  "botanical-sprig",
  "art-deco-fan",
  "confetti-scatter",
  "terrazzo",
  "sunburst-rays",
  "bunting-garland",
  "starry-night",
] as const;
export type ThemeArtId = (typeof THEME_ART_IDS)[number];

/**
 * How the motif is composed onto the card. This is the part that stops eight
 * themes reading as one layout in eight colourways.
 * - "corner-mirrored": the motif in all four corners, mirrored into each
 * - "side-mirrored"  : flanking the type block left and right
 * - "band"           : full-width bands across the top and foot
 * - "asymmetric"     : a single motif weighted into one corner
 * - "scatter"        : one large motif spread behind everything
 */
export const ART_PLACEMENTS = ["corner-mirrored", "side-mirrored", "band", "asymmetric", "scatter"] as const;
export type ArtPlacement = (typeof ART_PLACEMENTS)[number];

export interface ThemeArtDirection {
  id: ThemeArtId;
  placement: ArtPlacement;
  /** Motif opacity over the artwork, 0-1. */
  opacity: number;
  /** Size multiplier on the placement's default footprint. */
  scale: number;
}

/**
 * Paper stock simulated behind the type. Deliberately per-theme: a lacquered
 * deco card and a block-printed museum card should not share one grain.
 */
export const TEXTURE_STYLES = ["none", "cotton", "laid", "grain", "gloss"] as const;
export type TextureStyle = (typeof TEXTURE_STYLES)[number];

export interface PaperTexture {
  style: TextureStyle;
  /** Multiplier on the style's base opacity, 0-1. Kept low so type stays legible. */
  intensity: number;
}

/** The rule between the headline and the details. */
export const DIVIDER_STYLES = ["none", "rule", "diamond-rule", "dots"] as const;
export type DividerStyle = (typeof DIVIDER_STYLES)[number];

/**
 * A curated colourway for a theme. Semantic rather than positional, so the
 * renderer never has to guess which of four hexes is the heading colour.
 */
export interface PaletteVariant {
  id: string;
  label: string;
  /** Headline / primary display type. */
  ink: string;
  /** Rules, eyebrow, and the RSVP cue. */
  accent: string;
  /** Overlay + plate surface. */
  surface: string;
  /** Body copy. */
  body: string;
}

/** The legacy 4-hex `paletteColors` contract, derived from a variant. */
export function paletteVariantColors(variant: PaletteVariant): string[] {
  return [variant.ink, variant.accent, variant.surface, variant.body];
}

export interface EnvelopePaperOption {
  id: string;
  label: string;
  color: string;
}

export interface EnvelopeLinerOption {
  id: string;
  label: string;
  pattern: LinerPattern;
  color: string;
}

export interface EnvelopeSealOption {
  id: string;
  label: string;
  style: StampStyle;
  color: string;
}

/**
 * A curated piece of postage. Genuinely separate from the wax seal: the seal is
 * pressed on the flap to hold the envelope shut, the stamp is franked onto the
 * front corner. They coexist on a real piece of mail, so both are offered.
 *
 * A stamp carries more than a glyph — its own paper, ink, denomination and
 * series caption are what make one read as printed postage rather than a
 * recoloured icon.
 */
export interface EnvelopePostageOption {
  id: string;
  label: string;
  motif: StampStyle;
  /** Motif, frame, and lettering ink. */
  inkColor: string;
  /** The stamp's own paper, independent of the envelope stock. */
  paperColor: string;
  /** Face value, e.g. "45". Rendered with a small currency mark. */
  denomination: string;
  /** Series line along the foot of the stamp, e.g. "GARDEN". */
  caption: string;
}

/** Everything the invitation arrives in, coordinated per theme. */
export interface EnvelopeBundle {
  papers: EnvelopePaperOption[];
  liners: EnvelopeLinerOption[];
  seals: EnvelopeSealOption[];
  stamps: EnvelopePostageOption[];
}

/** Realistic stationery copy shown in the gallery before a host edits a word. */
export interface SampleCopy {
  eyebrow: string;
  headline: string;
  dateLine: string;
  timeLine: string;
  locationLine: string;
  rsvpLine: string;
}

export interface ThemeArtwork {
  fullUrl: string;
  thumbUrl: string;
  alt: string;
  width: number;
  height: number;
}

export interface LaunchTheme {
  id: string;
  name: string;
  tagline: string;
  description: string;
  style: ThemeStyle;
  occasions: ThemeOccasion[];
  artwork: ThemeArtwork;
  /** CSS object-position for the artwork, so cropped layouts keep the subject. */
  artFocus: string;
  /** Palette-driven vector motif drawn over the artwork. */
  art: ThemeArtDirection;
  /** Which existing layout archetype the composition is built on. */
  layoutStyle: LayoutStyle;
  texture: PaperTexture;
  divider: DividerStyle;
  /** First entry is the default. */
  palettes: PaletteVariant[];
  /** Curated pairing ids from shared/inviteDesign.ts. First is the default. */
  fontPairingIds: string[];
  /** First entry is the default. */
  placements: TextPlacement[];
  defaultOverlay: OverlayTreatment;
  overlayOptions: OverlayTreatment[];
  envelope: EnvelopeBundle;
  sample: SampleCopy;
  /** Card frame treatment carried into the legacy concept representation. */
  borderStyle: BorderStyle;
  styleLaneId: string;
}

/* ── The eight launch themes ─────────────────────────────────────────── */

export const LAUNCH_THEMES: LaunchTheme[] = [
  {
    id: "garden-editorial",
    name: "Garden Editorial",
    tagline: "Painted roses on deckled cotton",
    description:
      "Watercolour garden roses drift across two corners of soft deckled paper, leaving a quiet centre for beautifully set type.",
    style: "elegant",
    occasions: ["dinner-party", "shower", "milestone-birthday", "celebration"],
    artwork: {
      fullUrl: "/themes/garden-editorial.webp",
      thumbUrl: "/themes/garden-editorial-thumb.webp",
      alt: "Watercolour garden roses in plum and blush painted across the corners of deckled cream paper",
      width: 896,
      height: 1200,
    },
    artFocus: "center",
    // The sheet is already painted with roses in its corners — a second rose in
    // each corner read as translucent blobs. Fine sprigs down the outer margins
    // add the palette-responsive botanical detail without competing.
    art: { id: "botanical-sprig", placement: "side-mirrored", opacity: 0.5, scale: 0.85 },
    // The sheet is painted as a full floral frame with a clear centre — the
    // composition the artist drew is the whole page, so cropping it to a band
    // would throw away three of the four corners.
    layoutStyle: "full-bleed",
    texture: { style: "cotton", intensity: 0.9 },
    divider: "diamond-rule",
    palettes: [
      { id: "plum-garden", label: "Plum Garden", ink: "#6d3f52", accent: "#8d6335", surface: "#f7f0e6", body: "#4a3b3f" },
      { id: "sage-linen", label: "Sage Linen", ink: "#4f5f49", accent: "#846747", surface: "#f6f2e8", body: "#43483f" },
      { id: "ink-charcoal", label: "Charcoal Ink", ink: "#33292c", accent: "#8c5c6d", surface: "#f8f2e9", body: "#3d3639" },
    ],
    fontPairingIds: ["garden-editorial-type", "romantic-italic", "playfair-classic"],
    placements: [
      // Held inside the clear centre the artist left: the painted roses hang to
      // roughly a third of the sheet at the top corners.
      { id: "centre", label: "Centred", box: { top: 32, left: 21, width: 58, height: 40 }, align: "center", justify: "center" },
      { id: "high", label: "Raised", box: { top: 28, left: 21, width: 58, height: 40 }, align: "center", justify: "start" },
      { id: "left-column", label: "Left column", box: { top: 30, left: 20, width: 52, height: 42 }, align: "left", justify: "center" },
    ],
    // A soft wash of the paper colour under the type — the eyebrow sat over
    // painted foliage and lost too much contrast without it.
    defaultOverlay: "veil",
    overlayOptions: ["none", "veil", "plate"],
    envelope: {
      papers: [
        { id: "cotton", label: "Cotton Cream", color: "#efe4d3" },
        { id: "plum", label: "Deep Plum", color: "#6d3f52" },
        { id: "sage", label: "Garden Sage", color: "#7c8f6b" },
      ],
      liners: [
        { id: "floral", label: "Pressed floral", pattern: "floral", color: "#a8763f" },
        { id: "solid", label: "Plain plum", pattern: "solid", color: "#6d3f52" },
        { id: "lattice", label: "Garden lattice", pattern: "lattice", color: "#8a9a7b" },
      ],
      seals: [
        { id: "wax", label: "Gold wax seal", style: "wax-seal", color: "#a8763f" },
        { id: "monogram", label: "Monogram seal", style: "seal", color: "#6d3f52" },
        { id: "botanical", label: "Botanical stamp", style: "motif", color: "#7c8f6b" },
      ],
      stamps: [
        { id: "rose", label: "Painted rose", motif: "floral", inkColor: "#6d3f52", paperColor: "#f5ece0", denomination: "45", caption: "GARDEN" },
        { id: "botanical", label: "Botanical study", motif: "motif", inkColor: "#4f5f49", paperColor: "#eef0e4", denomination: "60", caption: "IN BLOOM" },
        { id: "monogram", label: "Engraved monogram", motif: "monogram", inkColor: "#7a552c", paperColor: "#f7f0e6", denomination: "85", caption: "POSY POST" },
      ],
    },
    sample: {
      eyebrow: "You are warmly invited to",
      headline: "The Summer Garden Dinner",
      dateLine: "Saturday, the fourteenth of June",
      timeLine: "Half past six in the evening",
      locationLine: "The Rosewood Terrace · Charleston",
      rsvpLine: "Kindly reply by the first of June",
    },
    borderStyle: "thin-frame",
    styleLaneId: "editorial-premium",
  },

  {
    id: "deco-midnight",
    name: "Deco Midnight",
    tagline: "Gilded lines on midnight navy",
    description:
      "A fine gold deco frame and a rising sunburst on deep navy — the most formal thing in the catalogue, and the most confident.",
    style: "elegant",
    occasions: ["milestone-birthday", "dinner-party", "holiday-party", "celebration"],
    artwork: {
      fullUrl: "/themes/deco-midnight.webp",
      thumbUrl: "/themes/deco-midnight-thumb.webp",
      alt: "A thin gold Art Deco border and rising sunburst motif on a deep midnight navy field",
      width: 896,
      height: 1200,
    },
    artFocus: "center",
    art: { id: "art-deco-fan", placement: "corner-mirrored", opacity: 0.55, scale: 1.05 },
    layoutStyle: "full-bleed",
    texture: { style: "gloss", intensity: 0.35 },
    divider: "diamond-rule",
    palettes: [
      { id: "gilt", label: "Gilt", ink: "#d8b45f", accent: "#c9a227", surface: "#16233d", body: "#e8ddc4" },
      { id: "ivory", label: "Ivory", ink: "#f2e6cc", accent: "#c9a227", surface: "#16233d", body: "#d7cdb6" },
      { id: "platinum", label: "Platinum", ink: "#dfe4ec", accent: "#9fb0c9", surface: "#141f36", body: "#c3cbd9" },
    ],
    fontPairingIds: ["deco-luxe", "deco-poiret", "quiet-garamond"],
    placements: [
      { id: "centre", label: "Centred", box: { top: 28, left: 17, width: 66, height: 40 }, align: "center", justify: "center" },
      { id: "high", label: "Raised", box: { top: 20, left: 17, width: 66, height: 38 }, align: "center", justify: "start" },
      { id: "low", label: "Above the sunburst", box: { top: 40, left: 17, width: 66, height: 38 }, align: "center", justify: "end" },
    ],
    defaultOverlay: "none",
    overlayOptions: ["none", "gradient"],
    envelope: {
      papers: [
        { id: "midnight", label: "Midnight", color: "#16233d" },
        { id: "champagne", label: "Champagne", color: "#e3d3ab" },
        { id: "onyx", label: "Onyx", color: "#1b1b22" },
      ],
      liners: [
        { id: "diamonds", label: "Deco diamonds", pattern: "diamonds", color: "#c9a227" },
        { id: "chevron", label: "Gold chevron", pattern: "chevron", color: "#c9a227" },
        { id: "solid", label: "Plain champagne", pattern: "solid", color: "#e3d3ab" },
      ],
      seals: [
        { id: "wax", label: "Gold wax seal", style: "wax-seal", color: "#c9a227" },
        { id: "crest", label: "Deco crest", style: "seal", color: "#c9a227" },
        { id: "star", label: "Starburst stamp", style: "star", color: "#d8b45f" },
      ],
      stamps: [
        { id: "sunburst", label: "Gold sunburst", motif: "star", inkColor: "#c9a227", paperColor: "#132747", denomination: "50", caption: "MIDNIGHT" },
        { id: "crest", label: "Deco crest", motif: "seal", inkColor: "#0f2140", paperColor: "#d8b45f", denomination: "75", caption: "SOCIETY" },
        { id: "chevron", label: "Chevron postmark", motif: "postmark", inkColor: "#c9a227", paperColor: "#1b3358", denomination: "90", caption: "DECO" },
      ],
    },
    sample: {
      eyebrow: "Cocktails & celebration",
      headline: "Margaret's Sixtieth",
      dateLine: "Friday, the eleventh of October",
      timeLine: "Eight o'clock in the evening",
      locationLine: "The Astor Room · 220 Fifth Avenue",
      rsvpLine: "Black tie · Kindly reply by October first",
    },
    borderStyle: "double-frame",
    styleLaneId: "bold-graphic",
  },

  {
    id: "neon-arena",
    name: "Neon Arena",
    tagline: "Electric geometry after dark",
    description:
      "Magenta and cyan light traces cut a hard-edged frame through a dark skyline. Built for teenagers who would be embarrassed by anything sweet.",
    style: "kids",
    occasions: ["teen-birthday", "celebration", "milestone-birthday"],
    artwork: {
      fullUrl: "/themes/neon-arena.webp",
      thumbUrl: "/themes/neon-arena-thumb.webp",
      alt: "Magenta and cyan neon light trails forming an angular frame over a dark violet skyline",
      width: 896,
      height: 1200,
    },
    artFocus: "center",
    art: { id: "terrazzo", placement: "scatter", opacity: 0.3, scale: 1 },
    layoutStyle: "full-bleed",
    texture: { style: "gloss", intensity: 0.25 },
    divider: "rule",
    palettes: [
      { id: "magenta", label: "Magenta", ink: "#ff4fa3", accent: "#22d3ee", surface: "#140a26", body: "#e9defb" },
      { id: "cyan", label: "Cyan", ink: "#3fe0f5", accent: "#ff4fa3", surface: "#120a24", body: "#dcecfb" },
      { id: "chrome", label: "Chrome", ink: "#f4f6ff", accent: "#a97bff", surface: "#150c28", body: "#cfc9e6" },
    ],
    fontPairingIds: ["neon-display", "tech-grotesk", "poolside-geometric"],
    placements: [
      { id: "centre", label: "Centred", box: { top: 30, left: 18, width: 64, height: 40 }, align: "center", justify: "center" },
      { id: "stacked", label: "Stacked left", box: { top: 28, left: 18, width: 60, height: 44 }, align: "left", justify: "center" },
      { id: "low", label: "Lower block", box: { top: 42, left: 18, width: 64, height: 38 }, align: "center", justify: "end" },
    ],
    defaultOverlay: "veil",
    overlayOptions: ["none", "veil", "gradient"],
    envelope: {
      papers: [
        { id: "midnight", label: "Midnight violet", color: "#1d1033" },
        { id: "magenta", label: "Hot magenta", color: "#b02576" },
        { id: "graphite", label: "Graphite", color: "#232634" },
      ],
      liners: [
        { id: "chevron", label: "Neon chevron", pattern: "chevron", color: "#22d3ee" },
        { id: "dots", label: "Pixel dots", pattern: "dots", color: "#ff4fa3" },
        { id: "stripes", label: "Light stripes", pattern: "stripes", color: "#a97bff" },
      ],
      seals: [
        { id: "star", label: "Neon star", style: "star", color: "#22d3ee" },
        { id: "motif", label: "Circuit mark", style: "motif", color: "#ff4fa3" },
        { id: "seal", label: "Chrome seal", style: "seal", color: "#c9d4ff" },
      ],
      stamps: [
        { id: "arcade", label: "Arcade star", motif: "star", inkColor: "#22d3ee", paperColor: "#171a3a", denomination: "10", caption: "ARCADE" },
        { id: "circuit", label: "Circuit mark", motif: "motif", inkColor: "#ff4fa3", paperColor: "#1d1140", denomination: "25", caption: "LEVEL UP" },
        { id: "chrome", label: "Chrome postmark", motif: "postmark", inkColor: "#c9d4ff", paperColor: "#101436", denomination: "99", caption: "ARENA" },
      ],
    },
    sample: {
      eyebrow: "Level up",
      headline: "Jordan Turns Fifteen",
      dateLine: "Friday, November 8",
      timeLine: "7:00 PM until 11:00 PM",
      locationLine: "Voltage Arena · 44 Mill Street",
      rsvpLine: "Tap to RSVP by November 1",
    },
    borderStyle: "dashed-frame",
    styleLaneId: "bold-graphic",
  },

  {
    id: "pool-editorial",
    name: "Poolside",
    tagline: "Sunlight on turquoise water",
    description:
      "Afternoon light breaking across a swimming pool, with a single ring float holding the lower corner. Refined rather than inflatable.",
    style: "modern",
    occasions: ["summer-party", "celebration", "milestone-birthday", "teen-birthday"],
    artwork: {
      fullUrl: "/themes/pool-editorial.webp",
      thumbUrl: "/themes/pool-editorial-thumb.webp",
      alt: "Sunlit turquoise swimming pool water with a coral and white ring float in the lower corner",
      width: 896,
      height: 1200,
    },
    artFocus: "center",
    art: { id: "sunburst-rays", placement: "asymmetric", opacity: 0.34, scale: 0.92 },
    layoutStyle: "banner",
    texture: { style: "gloss", intensity: 0.2 },
    divider: "rule",
    palettes: [
      { id: "chlorine", label: "Chlorine White", ink: "#ffffff", accent: "#ffd9c4", surface: "#0d5f86", body: "#eef7fb" },
      { id: "coral", label: "Coral", ink: "#ffe9dd", accent: "#f7a997", surface: "#0b5175", body: "#f4f9fc" },
      { id: "deep-blue", label: "Deep Water", ink: "#06344b", accent: "#0d5f86", surface: "#e9f6fb", body: "#124f6b" },
    ],
    fontPairingIds: ["poolside-geometric", "tech-grotesk", "playfair-classic"],
    placements: [
      { id: "high", label: "Raised", box: { top: 13, left: 13, width: 68, height: 40 }, align: "left", justify: "start" },
      { id: "centre", label: "Centred", box: { top: 20, left: 15, width: 66, height: 40 }, align: "center", justify: "center" },
      { id: "left-column", label: "Left column", box: { top: 16, left: 12, width: 55, height: 50 }, align: "left", justify: "center" },
    ],
    defaultOverlay: "gradient",
    overlayOptions: ["none", "veil", "gradient", "plate"],
    envelope: {
      papers: [
        { id: "pool", label: "Pool Blue", color: "#0d5f86" },
        { id: "sand", label: "Warm Sand", color: "#e8d9c2" },
        { id: "coral", label: "Coral", color: "#e0664a" },
      ],
      liners: [
        { id: "waves", label: "Ripple", pattern: "waves", color: "#7fd3ec" },
        { id: "stripes", label: "Cabana stripe", pattern: "stripes", color: "#f0603f" },
        { id: "scallops", label: "Scallop", pattern: "scallops", color: "#ffd9c4" },
      ],
      seals: [
        { id: "motif", label: "Sun mark", style: "motif", color: "#f0603f" },
        { id: "seal", label: "Wave seal", style: "seal", color: "#0d5f86" },
        { id: "star", label: "Sunburst", style: "star", color: "#f2b134" },
      ],
      stamps: [
        { id: "sun", label: "Sun disc", motif: "motif", inkColor: "#c2542c", paperColor: "#fdf4e8", denomination: "35", caption: "POOLSIDE" },
        { id: "wave", label: "Wave postmark", motif: "postmark", inkColor: "#0d5f86", paperColor: "#e7f3f8", denomination: "50", caption: "HIGH SUMMER" },
        { id: "citrus", label: "Citrus star", motif: "star", inkColor: "#8a6110", paperColor: "#fcf1dc", denomination: "80", caption: "SUNDECK" },
      ],
    },
    sample: {
      eyebrow: "Swim · Sun · Supper",
      headline: "The Poolside Social",
      dateLine: "Saturday, July 19",
      timeLine: "Four in the afternoon",
      locationLine: "18 Alameda Drive",
      rsvpLine: "RSVP by July 10",
    },
    borderStyle: "thin-frame",
    styleLaneId: "minimal-modern",
  },

  {
    id: "meadow-storybook",
    name: "Meadow Storybook",
    tagline: "Wildflowers and two quiet hares",
    description:
      "A hand-painted meadow of grasses and buttercups under a soft morning sky, with all the space in the world above it for your words.",
    style: "storybook",
    occasions: ["shower", "kids-birthday", "celebration", "dinner-party"],
    artwork: {
      fullUrl: "/themes/meadow-storybook.webp",
      thumbUrl: "/themes/meadow-storybook-thumb.webp",
      alt: "A painted wildflower meadow with grasses, buttercups, and two hares beneath a pale morning sky",
      width: 896,
      height: 1200,
    },
    artFocus: "center bottom",
    art: { id: "botanical-sprig", placement: "side-mirrored", opacity: 0.5, scale: 1 },
    // All the painting is in the bottom third, so an inset vignette of that
    // band reads as a storybook plate with the type set beneath it.
    layoutStyle: "centered",
    texture: { style: "laid", intensity: 0.7 },
    divider: "dots",
    palettes: [
      { id: "meadow-sage", label: "Meadow Sage", ink: "#4a5a42", accent: "#866922", surface: "#f4f1e6", body: "#4f5850" },
      { id: "buttercup", label: "Buttercup", ink: "#7a6320", accent: "#627354", surface: "#f6f3e8", body: "#54513f" },
      { id: "soft-ink", label: "Soft Ink", ink: "#3a4048", accent: "#66725b", surface: "#f5f3ea", body: "#4b5158" },
    ],
    fontPairingIds: ["storybook-garamond", "quiet-garamond", "garden-editorial-type"],
    placements: [
      { id: "high", label: "Raised", box: { top: 13, left: 14, width: 72, height: 40 }, align: "center", justify: "start" },
      { id: "centre", label: "Centred", box: { top: 18, left: 15, width: 70, height: 40 }, align: "center", justify: "center" },
      { id: "left-column", label: "Left column", box: { top: 15, left: 13, width: 58, height: 44 }, align: "left", justify: "start" },
    ],
    defaultOverlay: "none",
    overlayOptions: ["none", "veil"],
    envelope: {
      papers: [
        { id: "oat", label: "Oat", color: "#e7e0cd" },
        { id: "sage", label: "Meadow Sage", color: "#7d8f6e" },
        { id: "clay", label: "Soft Clay", color: "#c9a68a" },
      ],
      liners: [
        { id: "floral", label: "Wildflower", pattern: "floral", color: "#b8902f" },
        { id: "solid", label: "Plain oat", pattern: "solid", color: "#e7e0cd" },
        { id: "dots", label: "Seed dots", pattern: "dots", color: "#6f8360" },
      ],
      seals: [
        { id: "motif", label: "Pressed leaf", style: "motif", color: "#6f8360" },
        { id: "seal", label: "Wax seal", style: "seal", color: "#b8902f" },
        { id: "bow", label: "Ribbon", style: "bow", color: "#c9a68a" },
      ],
      stamps: [
        { id: "buttercup", label: "Buttercup", motif: "floral", inkColor: "#7a5f1e", paperColor: "#f7f4e7", denomination: "20", caption: "MEADOW" },
        { id: "leaf", label: "Pressed leaf", motif: "motif", inkColor: "#4e5c43", paperColor: "#eef1e4", denomination: "40", caption: "WILDFLOWER" },
        { id: "ribbon", label: "Ribbon mark", motif: "bow", inkColor: "#8a6647", paperColor: "#f6efe2", denomination: "65", caption: "STORYBOOK" },
      ],
    },
    sample: {
      eyebrow: "A gentle morning for",
      headline: "Baby Wren",
      dateLine: "Sunday, the fourth of May",
      timeLine: "Ten in the morning",
      locationLine: "The Old Meadow House · Hillsdale",
      rsvpLine: "Kindly reply by the twenty-fifth of April",
    },
    borderStyle: "corner-flourish",
    styleLaneId: "storybook-whimsical",
  },

  {
    id: "celestial-heirloom",
    name: "Celestial Heirloom",
    tagline: "Gold constellations on watercolour night",
    description:
      "Hand-painted indigo washes scattered with gilded stars and a crescent moon. Formal without being stiff.",
    style: "elegant",
    occasions: ["milestone-birthday", "dinner-party", "holiday-party", "celebration"],
    artwork: {
      fullUrl: "/themes/celestial-heirloom.webp",
      thumbUrl: "/themes/celestial-heirloom-thumb.webp",
      alt: "Indigo watercolour night sky with gold-leaf constellations, stars, and a crescent moon",
      width: 896,
      height: 1200,
    },
    artFocus: "center",
    art: { id: "starry-night", placement: "scatter", opacity: 0.42, scale: 1 },
    layoutStyle: "full-bleed",
    texture: { style: "cotton", intensity: 0.55 },
    divider: "diamond-rule",
    palettes: [
      { id: "gold-leaf", label: "Gold Leaf", ink: "#e2b455", accent: "#d9a441", surface: "#132a52", body: "#e7e3d5" },
      { id: "moonlight", label: "Moonlight", ink: "#f5efe1", accent: "#d9a441", surface: "#12294f", body: "#dcd8ca" },
      { id: "starlight", label: "Starlight", ink: "#e8eefc", accent: "#9db6e0", surface: "#10224a", body: "#cdd8ee" },
    ],
    fontPairingIds: ["playfair-classic", "quiet-garamond", "deco-luxe"],
    placements: [
      { id: "centre", label: "Centred", box: { top: 30, left: 16, width: 68, height: 40 }, align: "center", justify: "center" },
      { id: "high", label: "Raised", box: { top: 22, left: 17, width: 66, height: 38 }, align: "center", justify: "start" },
      { id: "low", label: "Lower block", box: { top: 40, left: 17, width: 66, height: 38 }, align: "center", justify: "end" },
    ],
    defaultOverlay: "veil",
    overlayOptions: ["none", "veil", "gradient"],
    envelope: {
      papers: [
        { id: "indigo", label: "Indigo", color: "#1c3564" },
        { id: "parchment", label: "Parchment", color: "#efe6d2" },
        { id: "slate", label: "Night Slate", color: "#26324a" },
      ],
      liners: [
        { id: "stars", label: "Star map", pattern: "stars", color: "#d9a441" },
        { id: "diamonds", label: "Gilt diamonds", pattern: "diamonds", color: "#d9a441" },
        { id: "solid", label: "Plain parchment", pattern: "solid", color: "#efe6d2" },
      ],
      seals: [
        { id: "wax", label: "Gold wax seal", style: "wax-seal", color: "#d9a441" },
        { id: "star", label: "Star stamp", style: "star", color: "#e2b455" },
        { id: "seal", label: "Crescent seal", style: "seal", color: "#c8dbff" },
      ],
      stamps: [
        { id: "crescent", label: "Crescent moon", motif: "motif", inkColor: "#d9a441", paperColor: "#12294f", denomination: "45", caption: "CELESTIAL" },
        { id: "constellation", label: "Constellation", motif: "star", inkColor: "#e2b455", paperColor: "#0f2244", denomination: "60", caption: "NIGHT SKY" },
        { id: "observatory", label: "Observatory mark", motif: "postmark", inkColor: "#1a2f56", paperColor: "#e8dfc4", denomination: "95", caption: "HEIRLOOM" },
      ],
    },
    sample: {
      eyebrow: "Under the winter stars",
      headline: "Amelia & Theo",
      dateLine: "Saturday, the thirteenth of December",
      timeLine: "Seven in the evening",
      locationLine: "The Observatory · Hudson, New York",
      rsvpLine: "Kindly reply by the twentieth of November",
    },
    borderStyle: "double-frame",
    styleLaneId: "editorial-premium",
  },

  {
    id: "dinosaur-museum",
    name: "Field Museum",
    tagline: "A block-printed brontosaurus",
    description:
      "A natural-history print on textured cotton: sauropod, palms, and ochre hills. Genuinely exciting for a six-year-old, and no cartoon in sight.",
    style: "kids",
    occasions: ["kids-birthday", "celebration"],
    artwork: {
      fullUrl: "/themes/dinosaur-museum.webp",
      thumbUrl: "/themes/dinosaur-museum-thumb.webp",
      alt: "Block-print illustration of a brontosaurus among palms and ochre hills on textured cream paper",
      width: 896,
      height: 1200,
    },
    artFocus: "center bottom",
    art: { id: "bunting-garland", placement: "band", opacity: 0.6, scale: 1 },
    // The block print sits in the lower half of the sheet; lifting it into a
    // banner puts the dinosaur at the top and gives the party details a clean
    // cream panel of their own.
    layoutStyle: "banner",
    texture: { style: "grain", intensity: 1 },
    divider: "dots",
    palettes: [
      { id: "field-green", label: "Field Green", ink: "#34503f", accent: "#a35131", surface: "#f2ebdc", body: "#4a5347" },
      { id: "terracotta", label: "Terracotta", ink: "#a4502f", accent: "#34503f", surface: "#f3ecdd", body: "#5b4a3d" },
      { id: "ochre", label: "Ochre", ink: "#8a6320", accent: "#3f6b4f", surface: "#f4eede", body: "#55503f" },
    ],
    fontPairingIds: ["museum-slab", "tech-grotesk", "quiet-garamond"],
    placements: [
      { id: "high", label: "Raised", box: { top: 8, left: 12, width: 76, height: 33 }, align: "center", justify: "start" },
      { id: "left-column", label: "Left column", box: { top: 9, left: 11, width: 60, height: 34 }, align: "left", justify: "start" },
      { id: "centre", label: "Centred", box: { top: 10, left: 13, width: 74, height: 32 }, align: "center", justify: "center" },
    ],
    defaultOverlay: "none",
    overlayOptions: ["none", "veil"],
    envelope: {
      papers: [
        { id: "kraft", label: "Kraft", color: "#d7c3a1" },
        { id: "forest", label: "Forest", color: "#34503f" },
        { id: "clay", label: "Clay", color: "#b95c38" },
      ],
      liners: [
        { id: "lattice", label: "Fern lattice", pattern: "lattice", color: "#3f6b4f" },
        { id: "dots", label: "Fossil dots", pattern: "dots", color: "#b95c38" },
        { id: "stripes", label: "Field stripe", pattern: "stripes", color: "#d29b3f" },
      ],
      seals: [
        { id: "motif", label: "Fossil stamp", style: "motif", color: "#34503f" },
        { id: "seal", label: "Museum seal", style: "seal", color: "#b95c38" },
        { id: "star", label: "Expedition star", style: "star", color: "#d29b3f" },
      ],
      stamps: [
        { id: "fossil", label: "Fossil study", motif: "motif", inkColor: "#34503f", paperColor: "#f3ecdc", denomination: "15", caption: "FIELD MUSEUM" },
        { id: "expedition", label: "Expedition star", motif: "star", inkColor: "#8f4529", paperColor: "#f6efe0", denomination: "30", caption: "EXPEDITION" },
        { id: "survey", label: "Survey postmark", motif: "postmark", inkColor: "#6a4e1f", paperColor: "#efe7d4", denomination: "55", caption: "NAT HISTORY" },
      ],
    },
    sample: {
      eyebrow: "A prehistoric expedition for",
      headline: "Felix is Six",
      dateLine: "Saturday, March 22",
      timeLine: "10:30 in the morning",
      locationLine: "Natural History Museum · Hall of Fossils",
      rsvpLine: "RSVP to Dana by March 15",
    },
    borderStyle: "dashed-frame",
    styleLaneId: "handcrafted-rustic",
  },

  {
    id: "roller-editorial",
    name: "Roller Disco",
    tagline: "Seventies swirls and a white skate",
    description:
      "Concentric maroon, rust, and blue arcs sweep around a cream disc, with a single roller skate anchoring the base. Retro poster art, properly typeset.",
    style: "bold",
    occasions: ["teen-birthday", "milestone-birthday", "celebration", "kids-birthday"],
    artwork: {
      fullUrl: "/themes/roller-editorial.webp",
      thumbUrl: "/themes/roller-editorial-thumb.webp",
      alt: "Retro seventies poster of concentric maroon, rust and blue arcs around a cream disc with a white roller skate below",
      width: 896,
      height: 1200,
    },
    artFocus: "center",
    art: { id: "confetti-scatter", placement: "scatter", opacity: 0.3, scale: 1 },
    layoutStyle: "full-bleed",
    texture: { style: "grain", intensity: 0.75 },
    divider: "rule",
    palettes: [
      { id: "maroon", label: "Maroon", ink: "#7c2338", accent: "#ac4b22", surface: "#f4e7c8", body: "#5a3a30" },
      { id: "rust", label: "Rust", ink: "#b7431d", accent: "#2f5c8a", surface: "#f5e9cd", body: "#6a3b26" },
      { id: "midnight-blue", label: "Midnight Blue", ink: "#2f5c8a", accent: "#b2411d", surface: "#f3e6c6", body: "#3f4a5c" },
    ],
    fontPairingIds: ["disco-display", "neon-display", "tech-grotesk"],
    placements: [
      { id: "disc", label: "In the disc", box: { top: 22, left: 25, width: 58, height: 30 }, align: "center", justify: "center" },
      { id: "disc-high", label: "Top of disc", box: { top: 19, left: 24, width: 59, height: 28 }, align: "center", justify: "start" },
      { id: "disc-wide", label: "Wide disc", box: { top: 22, left: 21, width: 64, height: 30 }, align: "center", justify: "center" },
    ],
    // The retro arcs sweep dark maroon straight through the type column, so the
    // eyebrow and RSVP lines need the cream disc washed back in behind them.
    defaultOverlay: "veil",
    overlayOptions: ["none", "veil"],
    envelope: {
      papers: [
        { id: "cream", label: "Disco Cream", color: "#f0e2be" },
        { id: "maroon", label: "Maroon", color: "#7c2338" },
        { id: "rust", label: "Rust", color: "#c1471f" },
      ],
      liners: [
        { id: "stripes", label: "Rainbow stripe", pattern: "stripes", color: "#e0622c" },
        { id: "scallops", label: "Arc scallop", pattern: "scallops", color: "#2f5c8a" },
        { id: "confetti", label: "Confetti", pattern: "confetti", color: "#7c2338" },
      ],
      seals: [
        { id: "star", label: "Disco star", style: "star", color: "#e0622c" },
        { id: "motif", label: "Skate mark", style: "motif", color: "#7c2338" },
        { id: "seal", label: "Retro seal", style: "seal", color: "#2f5c8a" },
      ],
      stamps: [
        { id: "disco", label: "Disco star", motif: "star", inkColor: "#a83c19", paperColor: "#f7ecd2", denomination: "25", caption: "ROLLER DISCO" },
        { id: "skate", label: "Skate mark", motif: "motif", inkColor: "#7c2338", paperColor: "#f4e7c8", denomination: "45", caption: "RINK NIGHT" },
        { id: "retro", label: "Retro postmark", motif: "postmark", inkColor: "#2f5c8a", paperColor: "#eef0e0", denomination: "70", caption: "SKATE CLUB" },
      ],
    },
    sample: {
      eyebrow: "Lace up for",
      headline: "Nina's Roller Disco",
      dateLine: "Saturday, September 6",
      timeLine: "Eight until late",
      locationLine: "The Starlight Rollerdrome",
      rsvpLine: "RSVP by August 30 · Skates provided",
    },
    borderStyle: "corner-flourish",
    styleLaneId: "bold-graphic",
  },
];

/* ── Lookups ─────────────────────────────────────────────────────────── */

export function getLaunchTheme(id: string): LaunchTheme | undefined {
  return LAUNCH_THEMES.find((t) => t.id === id);
}

export function isLaunchThemeId(id: unknown): id is string {
  return typeof id === "string" && LAUNCH_THEMES.some((t) => t.id === id);
}

export function getPaletteVariant(theme: LaunchTheme, id: string | undefined): PaletteVariant {
  return theme.palettes.find((p) => p.id === id) ?? theme.palettes[0];
}

export function getPlacement(theme: LaunchTheme, id: string | undefined): TextPlacement {
  return theme.placements.find((p) => p.id === id) ?? theme.placements[0];
}

export function getPostageStamp(theme: LaunchTheme, id: string | undefined): EnvelopePostageOption {
  return theme.envelope.stamps.find((s) => s.id === id) ?? theme.envelope.stamps[0];
}

export function getOverlay(theme: LaunchTheme, value: unknown): OverlayTreatment {
  return theme.overlayOptions.includes(value as OverlayTreatment)
    ? (value as OverlayTreatment)
    : theme.defaultOverlay;
}

export function getFontPairingIdFor(theme: LaunchTheme, id: string | undefined): string {
  return id && theme.fontPairingIds.includes(id) ? id : theme.fontPairingIds[0];
}

/* ── Persisted design selection ──────────────────────────────────────── */

/**
 * The editable copy that sits on the invitation. Only `headline` and `message`
 * map onto real event columns (inviteSubject / inviteMessage, which the email
 * sender already reads); the rest live inside the concept JSON so no schema
 * migration is required and older events keep rendering.
 */
export interface ThemeCopy {
  eyebrow: string;
  dateLine: string;
  timeLine: string;
  locationLine: string;
  rsvpLine: string;
}

/**
 * A curated theme selection, persisted inside `inviteDesignConceptJson`
 * alongside the legacy concept fields. Every field is optional on read so a
 * concept saved before this feature (or by the AI path) still parses.
 */
export interface ThemeSelection {
  themeId: string;
  artworkUrl: string;
  artworkThumbUrl: string;
  paletteVariantId: string;
  placementId: string;
  overlay: OverlayTreatment;
  copy: ThemeCopy;
  /**
   * Curated postage. Optional because invites saved before postage existed have
   * no id stored; getPostageStamp resolves those to the theme's default.
   */
  postageStampId?: string;
}

/** An InviteDesignConcept that also carries a curated theme selection. */
export type ThemedInviteConcept = InviteDesignConcept & { theme?: ThemeSelection };

export function defaultThemeCopy(theme: LaunchTheme): ThemeCopy {
  return {
    eyebrow: theme.sample.eyebrow,
    dateLine: theme.sample.dateLine,
    timeLine: theme.sample.timeLine,
    locationLine: theme.sample.locationLine,
    rsvpLine: theme.sample.rsvpLine,
  };
}

/**
 * Copy seeded from the host's real event so a freshly applied theme reads as
 * their invitation immediately. Sample dates, venues, times and RSVP
 * deadlines are never allowed onto a real event — missing facts stay blank.
 */
export function themeCopyForEvent(
  theme: LaunchTheme,
  event: { eventDate?: string; eventTime?: string; location?: string; hostNames?: string; rsvpDeadline?: string },
): ThemeCopy {
  const eventDate = event.eventDate?.trim() ?? "";
  const requestedDeadline = event.rsvpDeadline?.trim() ?? "";
  const parsedEvent = parseEventDate(eventDate);
  const parsedDeadline = parseEventDate(requestedDeadline);
  const manualDeadlineIsSafe =
    requestedDeadline.length > 0 && (!parsedEvent || !parsedDeadline || parsedDeadline.getTime() < parsedEvent.getTime());
  const rsvpDeadline = manualDeadlineIsSafe ? requestedDeadline : suggestRsvpDeadline(eventDate) ?? "";

  return {
    eyebrow: event.hostNames?.trim() ? `Hosted by ${event.hostNames.trim()}` : "Please join us",
    dateLine: eventDate,
    timeLine: event.eventTime?.trim() ?? "",
    locationLine: event.location?.trim() ?? "",
    rsvpLine: rsvpDeadline ? `Kindly reply by ${rsvpDeadline}` : "",
  };
}

function isThemeCopy(value: unknown): value is ThemeCopy {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.eyebrow === "string" &&
    typeof v.dateLine === "string" &&
    typeof v.timeLine === "string" &&
    typeof v.locationLine === "string" &&
    typeof v.rsvpLine === "string"
  );
}

function curatedThemeById(themeId: string): LaunchTheme | undefined {
  return isLaunchThemeId(themeId) ? getLaunchTheme(themeId) : undefined;
}

/**
 * Reads a validated theme selection off a concept, or null if there isn't one.
 *
 * `resolveTheme` exists so a caller holding a theme that is not in the curated
 * catalogue — a generated one, rebuilt from a stored snapshot — can still read
 * its selection. Omitted, only the eight curated themes resolve, which is the
 * behaviour every existing caller relies on.
 */
export function readThemeSelection(
  concept: unknown,
  resolveTheme: (themeId: string) => LaunchTheme | undefined = curatedThemeById,
): ThemeSelection | null {
  if (!concept || typeof concept !== "object") return null;
  const raw = (concept as { theme?: unknown }).theme;
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Record<string, unknown>;
  const theme = typeof t.themeId === "string" ? resolveTheme(t.themeId) : undefined;
  if (!theme) return null;
  return {
    themeId: theme.id,
    artworkUrl: typeof t.artworkUrl === "string" && t.artworkUrl ? t.artworkUrl : theme.artwork.fullUrl,
    artworkThumbUrl:
      typeof t.artworkThumbUrl === "string" && t.artworkThumbUrl ? t.artworkThumbUrl : theme.artwork.thumbUrl,
    paletteVariantId: getPaletteVariant(theme, t.paletteVariantId as string | undefined).id,
    placementId: getPlacement(theme, t.placementId as string | undefined).id,
    overlay: getOverlay(theme, t.overlay),
    postageStampId: getPostageStamp(theme, t.postageStampId as string | undefined).id,
    copy: isThemeCopy(t.copy) ? t.copy : defaultThemeCopy(theme),
  };
}

/**
 * Builds the complete concept payload for a theme. This is the whole of
 * "applying a theme" — a pure function, no network, no image model.
 */
export function buildThemedConcept(
  theme: LaunchTheme,
  options: {
    paletteVariantId?: string;
    placementId?: string;
    overlay?: OverlayTreatment;
    fontPairingId?: string;
    copy?: ThemeCopy;
    postageStampId?: string;
  } = {},
): ThemedInviteConcept {
  const palette = getPaletteVariant(theme, options.paletteVariantId);
  const placement = getPlacement(theme, options.placementId);
  const postage = getPostageStamp(theme, options.postageStampId);
  return {
    conceptName: theme.name,
    description: theme.tagline,
    paletteColors: paletteVariantColors(palette),
    fontPairingId: getFontPairingIdFor(theme, options.fontPairingId),
    borderStyle: theme.borderStyle,
    layoutStyle: theme.layoutStyle,
    illustrationPrompt: theme.description,
    styleLaneId: theme.styleLaneId,
    theme: {
      themeId: theme.id,
      artworkUrl: theme.artwork.fullUrl,
      artworkThumbUrl: theme.artwork.thumbUrl,
      paletteVariantId: palette.id,
      placementId: placement.id,
      overlay: getOverlay(theme, options.overlay ?? theme.defaultOverlay),
      copy: options.copy ?? defaultThemeCopy(theme),
      postageStampId: postage.id,
    },
  };
}

/** The default envelope selection for a theme (first option of each group). */
export function defaultEnvelopeForTheme(theme: LaunchTheme) {
  return {
    envelopeColor: theme.envelope.papers[0].color,
    envelopeLinerPattern: theme.envelope.liners[0].pattern,
    linerColor: theme.envelope.liners[0].color,
    stampStyle: theme.envelope.seals[0].style,
    stampColor: theme.envelope.seals[0].color,
  };
}

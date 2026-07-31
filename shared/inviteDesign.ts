// Shared design vocabulary for "Invitation Intelligence": given a free-text
// theme prompt, the AI proposes several complete design concepts (palette +
// font pairing + border + layout + a bounded illustration) that get applied
// consistently across the invite composer, the public RSVP page, and the
// post-RSVP thank-you card.
//
// This is a larger, AI-facing font set than client/src/lib/inviteStyles.ts
// (the smaller, manually-browsable list a host clicks through by hand) — but
// every id here still maps to a font already preloaded in client/index.html,
// so the AI can never pick a font that fails to render.
//
// Kept framework-agnostic (plain objects, no React types) so this file can
// be imported by both the Express server and the React client.

export interface FontPairing {
  id: string;
  label: string;
  headingFontFamily: string;
  bodyFontFamily: string;
  headingWeight?: number;
  headingStyle?: "italic" | "normal";
  headingLetterSpacing?: string;
}

// The original AI-facing set. Kept so concepts stored before the curated
// theme launch keep resolving to the pairing they were saved with.
const LEGACY_FONT_PAIRINGS: FontPairing[] = [
  {
    id: "editorial-serif",
    label: "Editorial Serif",
    headingFontFamily: "'Playfair Display', serif",
    bodyFontFamily: "'Lora', serif",
    headingWeight: 600,
  },
  {
    id: "modern-sans",
    label: "Modern Sans",
    headingFontFamily: "'Poppins', sans-serif",
    bodyFontFamily: "'Inter', sans-serif",
    headingWeight: 700,
  },
  {
    id: "playful-rounded",
    label: "Playful Rounded",
    headingFontFamily: "'Baloo 2', sans-serif",
    bodyFontFamily: "'DM Sans', sans-serif",
    headingWeight: 700,
  },
  {
    id: "flowing-script",
    label: "Flowing Script",
    headingFontFamily: "'Dancing Script', cursive",
    bodyFontFamily: "'Libre Baskerville', serif",
    headingWeight: 700,
  },
  {
    id: "bold-editorial",
    label: "Bold Editorial",
    headingFontFamily: "'Anton', sans-serif",
    bodyFontFamily: "'Montserrat', sans-serif",
    headingLetterSpacing: "0.01em",
  },
  {
    id: "rustic-handwritten",
    label: "Rustic Handwritten",
    headingFontFamily: "'Architects Daughter', cursive",
    bodyFontFamily: "'Merriweather', serif",
    headingWeight: 400,
  },
  {
    id: "minimal-geometric",
    label: "Minimal Geometric",
    headingFontFamily: "'Space Grotesk', sans-serif",
    bodyFontFamily: "'Plus Jakarta Sans', sans-serif",
    headingWeight: 600,
  },
  {
    id: "classic-formal",
    label: "Classic Formal",
    headingFontFamily: "'Source Serif 4', serif",
    bodyFontFamily: "'Open Sans', sans-serif",
    headingWeight: 600,
  },
  {
    id: "warm-friendly",
    label: "Warm Friendly",
    headingFontFamily: "'Outfit', sans-serif",
    bodyFontFamily: "'Inter', sans-serif",
    headingWeight: 600,
  },
];

// Curated stationery pairings used by the launch themes in shared/themeCatalog.ts.
// Unlike the legacy set above, every family here is actually loaded by
// client/index.html, so these render as designed instead of falling back to a
// system face.
export const CURATED_FONT_PAIRINGS: FontPairing[] = [
  {
    id: "garden-editorial-type",
    label: "Garamond Editorial",
    headingFontFamily: "'Cormorant Garamond', Georgia, serif",
    bodyFontFamily: "'Jost', 'Lato', sans-serif",
    headingWeight: 600,
    headingLetterSpacing: "0.01em",
  },
  {
    id: "romantic-italic",
    label: "Romantic Italic",
    headingFontFamily: "'Cormorant Garamond', Georgia, serif",
    bodyFontFamily: "'Lato', sans-serif",
    headingWeight: 500,
    headingStyle: "italic",
  },
  {
    id: "deco-luxe",
    label: "Deco Luxe",
    headingFontFamily: "'Cinzel', Georgia, serif",
    bodyFontFamily: "'Jost', sans-serif",
    headingWeight: 600,
    headingLetterSpacing: "0.16em",
  },
  {
    id: "deco-poiret",
    label: "Poiret Deco",
    headingFontFamily: "'Poiret One', 'Jost', sans-serif",
    bodyFontFamily: "'Jost', sans-serif",
    headingWeight: 400,
    headingLetterSpacing: "0.2em",
  },
  {
    id: "neon-display",
    label: "Arena Display",
    headingFontFamily: "'Bebas Neue', 'Space Grotesk', sans-serif",
    bodyFontFamily: "'Space Grotesk', sans-serif",
    headingWeight: 400,
    headingLetterSpacing: "0.06em",
  },
  {
    id: "tech-grotesk",
    label: "Tech Grotesk",
    headingFontFamily: "'Space Grotesk', sans-serif",
    bodyFontFamily: "'Space Grotesk', sans-serif",
    headingWeight: 700,
    headingLetterSpacing: "0.02em",
  },
  {
    id: "poolside-geometric",
    label: "Poolside Geometric",
    headingFontFamily: "'Jost', sans-serif",
    bodyFontFamily: "'Lato', sans-serif",
    headingWeight: 500,
    headingLetterSpacing: "0.22em",
  },
  {
    id: "storybook-garamond",
    label: "Storybook Garamond",
    headingFontFamily: "'EB Garamond', Georgia, serif",
    bodyFontFamily: "'Jost', sans-serif",
    headingWeight: 500,
    headingStyle: "italic",
  },
  {
    id: "quiet-garamond",
    label: "Quiet Garamond",
    headingFontFamily: "'EB Garamond', Georgia, serif",
    bodyFontFamily: "'Lato', sans-serif",
    headingWeight: 600,
    headingLetterSpacing: "0.04em",
  },
  {
    id: "museum-slab",
    label: "Museum Slab",
    headingFontFamily: "'Bitter', Georgia, serif",
    bodyFontFamily: "'Jost', sans-serif",
    headingWeight: 600,
    headingLetterSpacing: "0.03em",
  },
  {
    id: "disco-display",
    label: "Disco Display",
    headingFontFamily: "'Abril Fatface', Georgia, serif",
    bodyFontFamily: "'Jost', sans-serif",
    headingWeight: 400,
  },
  {
    id: "playfair-classic",
    label: "Playfair Classic",
    headingFontFamily: "'Playfair Display', Georgia, serif",
    bodyFontFamily: "'Lato', sans-serif",
    headingWeight: 600,
  },
];

export const FONT_PAIRINGS: FontPairing[] = [...LEGACY_FONT_PAIRINGS, ...CURATED_FONT_PAIRINGS];

export function getFontPairing(id: string): FontPairing {
  return FONT_PAIRINGS.find((f) => f.id === id) || FONT_PAIRINGS[0];
}

export const BORDER_STYLES = ["none", "thin-frame", "double-frame", "dashed-frame", "corner-flourish"] as const;
export type BorderStyle = (typeof BORDER_STYLES)[number];

// "banner": the illustration runs full-width across the top, like a photo.
// "backdrop": the illustration sits behind the text as a soft, low-opacity
// full-bleed watermark — for concepts that read better as texture than as a
// standalone photo-style image.
// "split": left/right split — illustration on one side, text panel on the other.
// "centered": small centered illustration with generous margins around it.
// "full-bleed": illustration fills the entire card, text overlaid on top.
export const LAYOUT_STYLES = ["banner", "backdrop", "split", "centered", "full-bleed"] as const;
export type LayoutStyle = (typeof LAYOUT_STYLES)[number];

// ── Creative Direction Matrix: Style Lanes ──────────────────────────────
//
// Each of the 4 generated concepts is assigned to a DIFFERENT style lane so
// that concepts are structurally diverse, not just four variations of the same
// mood. Each lane carries its own palette logic, illustration medium,
// composition rules, and typography mood — this is what makes the output feel
// like it came from four different designers rather than one.

export interface StyleLane {
  id: string;
  label: string;
  /** Short description shown in the vibe picker UI */
  description: string;
  /** Illustration mediums this lane uses (the LLM picks one) */
  illustrationMediums: string[];
  /** Palette mood guidance for the LLM */
  paletteMood: string;
  /** Typography mood guidance */
  typographyMood: string;
  /** Composition guidance for the LLM */
  compositionGuidance: string;
  /** Layout styles most natural for this lane */
  preferredLayouts: LayoutStyle[];
  /** What to avoid in this lane */
  avoid: string;
  /** Specific subject guidance: what subjects produce premium results, and what literal interpretations to NEVER use */
  subjectGuidance: string;
}

export const STYLE_LANES: StyleLane[] = [
  {
    id: "editorial-premium",
    label: "Editorial Premium",
    description: "Elegant, refined, magazine-quality with generous white space",
    illustrationMediums: ["watercolor", "editorial illustration", "fine line art", "botanical illustration"],
    paletteMood: "Muted, sophisticated — think dusty rose, sage, charcoal, gold. Restrained 3-4 color palette.",
    typographyMood: "Elegant serif headings, refined body text. High contrast between heading and body weight.",
    compositionGuidance: "Generous negative space (40%+). Single elegant focal subject. Asymmetric or off-center balance.",
    preferredLayouts: ["centered", "banner", "split"],
    avoid: "Cartoon characters, bright primary colors, cluttered layouts, clipart aesthetics",
    subjectGuidance: "Choose ONE elegant botanical or abstract subject: a single flower stem, a sprig of olive branch, a pressed flower, an abstract watercolor wash, a single feather, or a minimalist botanical line drawing. NEVER use literal theme objects (no birthday cakes, no balloons, no farm animals). The subject should feel like fine art, not decoration.",
  },
  {
    id: "playful-illustrated",
    label: "Playful Illustrated",
    description: "Bright, fun, character-driven with bold colors",
    illustrationMediums: ["flat vector illustration", "cartoon illustration", "character illustration", "sticker art"],
    paletteMood: "Bright, saturated, joyful — think coral, teal, sunshine yellow, sky blue. 4-5 vibrant colors.",
    typographyMood: "Rounded, friendly heading fonts. Casual, approachable body text.",
    compositionGuidance: "Centered focal character or scene. Energetic, fills the frame. Confetti or scattered elements OK.",
    preferredLayouts: ["banner", "full-bleed", "centered"],
    avoid: "Muted or monochrome palettes, overly formal layouts, photorealistic illustration",
    subjectGuidance: "Choose ONE cheerful abstract or geometric subject: scattered confetti shapes, a bunting/garland pattern, abstract balloons as geometric shapes, a festive crown, or a stylized party hat. Keep it modern and design-forward, NOT literal. Avoid realistic animals, realistic cakes, or any subject that looks like clipart.",
  },
  {
    id: "bold-graphic",
    label: "Bold Graphic",
    description: "Strong geometric shapes, high contrast, modern and striking",
    illustrationMediums: ["flat graphic design", "geometric illustration", "typographic art", "abstract geometric"],
    paletteMood: "High-contrast — black/white with one or two bold accents (red, electric blue, gold). Limited palette.",
    typographyMood: "Bold condensed or geometric sans-serif. Large heading scale. Tight letter spacing.",
    compositionGuidance: "Strong geometric grid. Diagonal or asymmetrical composition. Bold negative space as a design element.",
    preferredLayouts: ["split", "full-bleed", "banner"],
    avoid: "Soft pastels, hand-drawn styles, decorative flourishes, muted tones",
    subjectGuidance: "Choose ONE bold abstract or geometric subject: geometric shapes (triangles, circles, arches), a bold typographic element, an abstract sunburst, or a modern architectural silhouette. NEVER use literal objects (no cakes, no animals, no balloons). The subject should feel like modern graphic design, not illustration.",
  },
  {
    id: "storybook-whimsical",
    label: "Storybook Whimsical",
    description: "Warm, handcrafted, fairy-tale charm with layered textures",
    illustrationMediums: ["watercolor", "gouache", "colored pencil", "papercut illustration"],
    paletteMood: "Warm, cozy — think terracotta, buttercream, sage, soft lavender. Warm undertones.",
    typographyMood: "Handwritten or script headings. Warm, readable serif body text.",
    compositionGuidance: "Layered panels or vignette style. Soft edges, organic shapes. Storybook illustration feel.",
    preferredLayouts: ["banner", "centered", "split"],
    avoid: "Hard geometric shapes, high-contrast palettes, sterile minimalism, flat vector art",
    subjectGuidance: "Choose ONE dreamy, atmospheric subject: a watercolor landscape (rolling hills, a meadow, a garden scene), a whimsical tree with hanging leaves, a crescent moon with stars, or a soft floral wreath. The subject should feel like a children's book illustration — soft, warm, and magical. NEVER use cartoon animals, literal party objects, or anything that looks like clipart.",
  },
  {
    id: "minimal-modern",
    label: "Minimal Modern",
    description: "Clean, contemporary, lots of breathing room with a single accent",
    illustrationMediums: ["minimal line art", "abstract geometric", "single-element botanical", "monoline illustration"],
    paletteMood: "Monochromatic or duo-tone — white/off-white with one accent (navy, emerald, or blush). Extremely restrained.",
    typographyMood: "Clean geometric sans-serif. Medium weight. Generous letter spacing.",
    compositionGuidance: "Maximum negative space (50%+). Single small accent element. Rule-of-thirds composition.",
    preferredLayouts: ["centered", "split", "backdrop"],
    avoid: "Busy illustrations, multiple colors, decorative borders, ornate fonts, cluttered layouts",
    subjectGuidance: "Choose ONE ultra-minimal subject: a single continuous-line drawing (one flower, one leaf, one abstract shape), a single geometric accent, or a small abstract mark. The subject should be small and surrounded by generous white space. NEVER use literal objects, busy scenes, or anything that fills more than 20% of the frame.",
  },
  {
    id: "handcrafted-rustic",
    label: "Handcrafted Rustic",
    description: "Earthy, organic, cozy with natural textures",
    illustrationMediums: ["linocut", "papercut", "woodcut", "hand-drawn illustration"],
    paletteMood: "Earthy — kraft brown, forest green, mustard, cream. Natural, grounded tones.",
    typographyMood: "Rustic handwritten or stamp-like headings. Warm serif body text.",
    compositionGuidance: "Organic framing, imperfect edges. Texture-forward. Cozy, filled composition with warm border treatment.",
    preferredLayouts: ["banner", "centered", "backdrop"],
    avoid: "Glossy digital look, bright neon colors, sterile minimalism, photorealistic illustration",
    subjectGuidance: "Choose ONE elegant natural subject: a wildflower bouquet, a eucalyptus sprig, a pressed flower, a cotton branch, a wheat stalk, a botanical wreath, or a textured kraft paper background with organic edges. NEVER use farm animals (no roosters, pigs, cows, chickens), barns, tractors, or any literal farm objects. The subject should feel like artisan stationery, not a farm themed birthday party.",
  },
];

export function getStyleLane(id: string): StyleLane | undefined {
  return STYLE_LANES.find((s) => s.id === id);
}

export function isStyleLaneId(id: string): boolean {
  return STYLE_LANES.some((s) => s.id === id);
}

export interface ArtDirection {
  /** The illustration medium (e.g. "watercolor", "flat vector", "linocut") */
  illustrationMedium: string;
  /** Primary subject of the illustration */
  subjectFocus: string;
  /** Composition type (e.g. "centered focal", "full-bleed", "asymmetric") */
  compositionType: string;
  /** Negative space ratio guidance (e.g. "40%+", "minimal") */
  negativeSpace: string;
  /** Color treatment guidance */
  colorTreatment: string;
  /** Texture or finish (e.g. "smooth", "grain", "paper", "foil") */
  texture: string;
  /** What to avoid in the illustration */
  avoidList: string;
}

export interface InviteDesignConcept {
  conceptName: string;
  description: string;
  /** Exactly 4 hex colors. paletteColors[0] is the primary accent (headings), paletteColors[1] the secondary accent (borders). */
  paletteColors: string[];
  fontPairingId: string;
  borderStyle: BorderStyle;
  layoutStyle: LayoutStyle;
  /** Prompt used to generate the bounded, text-free decorative illustration — only rendered once a host applies this concept. */
  illustrationPrompt: string;
  /** The style lane this concept was generated in — ensures 4 concepts are structurally diverse.
   *  Optional for backward compatibility with older stored concepts. */
  styleLaneId?: string;
  /** Structured art direction for the image generator — gives the image model real design intent
   *  instead of just a loose text prompt. Optional for backward compatibility. */
  artDirection?: ArtDirection;
  /** Optional Event DNA hints (see shared/eventDna.ts): how this concept reads on a subset of
   *  the bipolar style axes, -1..1. Only present when the concept generator was asked for it;
   *  never required, so older stored concepts without this field stay valid. */
  dnaHints?: Partial<Record<import("./eventDna").DnaAxis, number>>;
}

export function isValidInviteDesignConcept(value: unknown): value is InviteDesignConcept {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.conceptName === "string" &&
    typeof v.description === "string" &&
    Array.isArray(v.paletteColors) &&
    v.paletteColors.length === 4 &&
    v.paletteColors.every((c) => typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c)) &&
    typeof v.fontPairingId === "string" &&
    FONT_PAIRINGS.some((f) => f.id === v.fontPairingId) &&
    typeof v.borderStyle === "string" &&
    (BORDER_STYLES as readonly string[]).includes(v.borderStyle) &&
    typeof v.layoutStyle === "string" &&
    (LAYOUT_STYLES as readonly string[]).includes(v.layoutStyle) &&
    typeof v.illustrationPrompt === "string"
  );
}

export function parseInviteDesignConcept(raw: string): InviteDesignConcept | null {
  try {
    const parsed = JSON.parse(raw || "null");
    return isValidInviteDesignConcept(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Inline style object for the invite/thank-you-card heading text. */
export function conceptHeadingStyle(concept: InviteDesignConcept): Record<string, string | number> {
  const font = getFontPairing(concept.fontPairingId);
  const style: Record<string, string | number> = { fontFamily: font.headingFontFamily };
  if (font.headingWeight) style.fontWeight = font.headingWeight;
  if (font.headingStyle) style.fontStyle = font.headingStyle;
  if (font.headingLetterSpacing) style.letterSpacing = font.headingLetterSpacing;
  if (concept.paletteColors?.[0]) style.color = concept.paletteColors[0];
  return style;
}

/** Inline style object for the invite/thank-you-card body text. */
export function conceptBodyStyle(concept: InviteDesignConcept): Record<string, string | number> {
  const font = getFontPairing(concept.fontPairingId);
  return { fontFamily: font.bodyFontFamily };
}

/**
 * Inline style object (border/radius) for a frame treatment in a given accent.
 * `unit` scales the frame with its surface, so the same treatment reads
 * correctly on a 180px gallery thumbnail and a 640px preview.
 */
export function borderStyleCss(style: BorderStyle, accent: string, unit = 1): Record<string, string> {
  switch (style) {
    case "thin-frame":
      return { border: `${1.5 * unit}px solid ${accent}` };
    case "double-frame":
      return { border: `${4 * unit}px double ${accent}` };
    case "dashed-frame":
      return { border: `${2 * unit}px dashed ${accent}` };
    case "corner-flourish":
      return { border: `${1.5 * unit}px solid ${accent}`, borderRadius: `${20 * unit}px` };
    default:
      return {};
  }
}

/** Inline style object (border/radius) for the surface the concept is applied to. */
export function conceptBorderStyle(concept: InviteDesignConcept): Record<string, string> {
  const accent = concept.paletteColors?.[1] || concept.paletteColors?.[0] || "#94a3b8";
  return borderStyleCss(concept.borderStyle, accent);
}

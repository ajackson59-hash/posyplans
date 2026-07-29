import type { CSSProperties } from "react";

// Curated font pairings and accent colors hosts can apply to their invite
// text (the subject/message shown on the dashboard preview and the public
// RSVP page). This is intentionally a small, opinionated set rather than a
// full design canvas — enough to make an invite feel personal without
// overwhelming choices. Font families are all pre-loaded in client/index.html.

export interface InviteFontOption {
  id: string;
  label: string;
  description: string;
  /** Applied to the invite subject line. */
  headingFontFamily: string;
  /** Applied to the invite message body. */
  bodyFontFamily: string;
  /** Extra weight/style tweaks for the heading, applied as inline styles. */
  headingStyle?: { fontWeight?: number; fontStyle?: "italic" | "normal"; letterSpacing?: string };
}

export const INVITE_FONT_OPTIONS: InviteFontOption[] = [
  {
    id: "classic-serif",
    label: "Classic Serif",
    description: "Timeless and elegant — the app's default invite look.",
    headingFontFamily: "'Playfair Display', serif",
    bodyFontFamily: "'Lora', serif",
    headingStyle: { fontWeight: 600 },
  },
  {
    id: "modern-sans",
    label: "Modern Sans",
    description: "Bold and confident, in the spirit of today's most popular invite apps.",
    headingFontFamily: "'Poppins', sans-serif",
    bodyFontFamily: "'Inter', sans-serif",
    headingStyle: { fontWeight: 700 },
  },
  {
    id: "playful-rounded",
    label: "Playful Rounded",
    description: "Friendly and upbeat — great for kids' parties and casual get-togethers.",
    headingFontFamily: "'Baloo 2', sans-serif",
    bodyFontFamily: "'DM Sans', sans-serif",
    headingStyle: { fontWeight: 700 },
  },
  {
    id: "elegant-script",
    label: "Elegant Script",
    description: "A flowing script headline paired with a refined serif body.",
    headingFontFamily: "'Dancing Script', cursive",
    bodyFontFamily: "'Libre Baskerville', serif",
    headingStyle: { fontWeight: 700 },
  },
  {
    id: "bold-display",
    label: "Bold Display",
    description: "High-impact, editorial typography for a statement invite.",
    headingFontFamily: "'Anton', sans-serif",
    bodyFontFamily: "'Montserrat', sans-serif",
    headingStyle: { letterSpacing: "0.01em" },
  },
];

export const DEFAULT_INVITE_FONT_ID = "classic-serif";

export function getInviteFontOption(id: string): InviteFontOption {
  return INVITE_FONT_OPTIONS.find((f) => f.id === id) || INVITE_FONT_OPTIONS[0];
}

export interface InviteAccentColor {
  id: string;
  label: string;
  hex: string;
}

// A small curated set. Hosts can also leave this unset to auto-derive an
// accent from their theme's generated palette (see resolveInviteAccentColor).
export const INVITE_ACCENT_COLORS: InviteAccentColor[] = [
  { id: "rose", label: "Rose", hex: "#b8577a" },
  { id: "amber", label: "Amber", hex: "#c17f2c" },
  { id: "forest", label: "Forest", hex: "#3f7355" },
  { id: "ocean", label: "Ocean", hex: "#2b6f8f" },
  { id: "plum", label: "Plum", hex: "#7a4f8f" },
  { id: "slate", label: "Slate", hex: "#4b5563" },
];

/**
 * Resolves the accent color to actually render: an explicit host choice,
 * otherwise the first color from the event's generated theme palette,
 * otherwise undefined (caller should fall back to default text color).
 */
export function resolveInviteAccentColor(inviteAccentColor: string, paletteColors: string[]): string | undefined {
  if (inviteAccentColor) return inviteAccentColor;
  if (paletteColors.length > 0) return paletteColors[0];
  return undefined;
}

/** Inline style object for the invite subject line. */
export function getInviteHeadingStyle(fontId: string, accentColor?: string): CSSProperties {
  const font = getInviteFontOption(fontId);
  return {
    fontFamily: font.headingFontFamily,
    color: accentColor || undefined,
    ...font.headingStyle,
  };
}

/** Inline style object for the invite message body. */
export function getInviteBodyStyle(fontId: string): CSSProperties {
  const font = getInviteFontOption(fontId);
  return {
    fontFamily: font.bodyFontFamily,
  };
}

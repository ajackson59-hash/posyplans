// Deterministic semantic-palette normalization for AI-first concepts.
//
// A concept declares named colour roles; the ThemeInvitation renderer paints
// from a positional PaletteVariant. This maps one onto the other and enforces
// a WCAG floor per role, repairing failures from the concept's OWN declared
// colours so a repair can never introduce a hue outside the brief's family.
//
// It never edits artwork and never rewrites a creative field.

import type { PaletteVariant } from "./themeCatalog";
import type { SemanticPalette } from "./aiFirstInvite";

/* ── WCAG 2.x ─────────────────────────────────────────────────────────── */

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function rgbOf(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function luminance(hex: string): number {
  const [r, g, b] = rgbOf(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const [lo, hi] = [luminance(a), luminance(b)].sort((p, q) => p - q);
  return (hi + 0.05) / (lo + 0.05);
}

function rgbDistance(a: string, b: string): number {
  const [r1, g1, b1] = rgbOf(a);
  const [r2, g2, b2] = rgbOf(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
}

/* ── Floors, per how the renderer actually uses each slot ────────────── */

export const ROLE_MINIMUM_CONTRAST = {
  /** The display headline — large text. */
  headlineColor: 3.0,
  /** Date / time / location / host note — body text. */
  bodyColor: 4.5,
  /** Eyebrow, divider and the RSVP cue — small caps text. It is ALSO the
   *  card frame, which only needs 1.6:1; the stricter text floor governs. */
  accentColor: 4.5,
} as const;

/** Non-text UI floor for the card frame, checked separately for reporting. */
export const FRAME_MINIMUM_CONTRAST = 1.6;

export type NormalizableRole = keyof typeof ROLE_MINIMUM_CONTRAST;

export interface RoleFix {
  role: NormalizableRole;
  before: string;
  after: string;
  beforeRatio: number;
  afterRatio: number;
  required: number;
  changed: boolean;
  reason: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Repairs one role against the text surface. The candidate pool is the
 * concept's own declared colours first, nearest-in-RGB wins, ties broken on
 * the hex string so the result is stable across runs. Black/white are a last
 * resort only when nothing the concept declared clears the floor.
 */
export function normalizeRole(role: NormalizableRole, palette: SemanticPalette): RoleFix {
  const surface = palette.textSurface;
  const before = palette[role];
  const required = ROLE_MINIMUM_CONTRAST[role];
  const beforeRatio = contrastRatio(before, surface);

  if (beforeRatio >= required) {
    return {
      role,
      before,
      after: before,
      beforeRatio: round2(beforeRatio),
      afterRatio: round2(beforeRatio),
      required,
      changed: false,
      reason: `passes: ${beforeRatio.toFixed(2)}:1 >= ${required}:1 against textSurface`,
    };
  }

  const own = Array.from(new Set(Object.values(palette).map((h) => h.toUpperCase()))).filter(
    (h) => h !== before.toUpperCase(),
  );
  const viable = own
    .filter((h) => contrastRatio(h, surface) >= required)
    .sort((a, b) => rgbDistance(a, before) - rgbDistance(b, before) || a.localeCompare(b));

  if (viable.length > 0) {
    const after = viable[0];
    return {
      role,
      before,
      after,
      beforeRatio: round2(beforeRatio),
      afterRatio: round2(contrastRatio(after, surface)),
      required,
      changed: true,
      reason: `fails at ${beforeRatio.toFixed(2)}:1 (needs ${required}:1); replaced with the nearest colour in the concept's own palette that clears the floor`,
    };
  }

  const after = luminance(surface) > 0.5 ? "#000000" : "#FFFFFF";
  return {
    role,
    before,
    after,
    beforeRatio: round2(beforeRatio),
    afterRatio: round2(contrastRatio(after, surface)),
    required,
    changed: true,
    reason: `fails at ${beforeRatio.toFixed(2)}:1 (needs ${required}:1) and no colour the concept declared clears the floor; fell back to role-safe ${after}`,
  };
}

export interface NormalizedPalette {
  /** Renderer-ready. Drop-in for any curated theme's PaletteVariant. */
  variant: PaletteVariant;
  fixes: RoleFix[];
  /** The card frame is painted from `accent`; reported for the audit trail. */
  frameContrast: number;
  framePasses: boolean;
}

export function normalizeSemanticPalette(palette: SemanticPalette): NormalizedPalette {
  const fixes = (Object.keys(ROLE_MINIMUM_CONTRAST) as NormalizableRole[]).map((role) =>
    normalizeRole(role, palette),
  );
  const [ink, body, accent] = [
    fixes.find((f) => f.role === "headlineColor")!.after,
    fixes.find((f) => f.role === "bodyColor")!.after,
    fixes.find((f) => f.role === "accentColor")!.after,
  ];
  const frameContrast = contrastRatio(accent, palette.textSurface);

  return {
    variant: {
      id: "ai-semantic",
      label: "Custom",
      ink,
      accent,
      surface: palette.textSurface,
      body,
    },
    fixes,
    frameContrast: round2(frameContrast),
    framePasses: frameContrast >= FRAME_MINIMUM_CONTRAST,
  };
}

/**
 * Detail visibility guard (requirement: "no invisible details"). A colour that
 * lands within a hair of the surface is not a subtle choice, it is a missing
 * element.
 */
export const INVISIBLE_CONTRAST_CEILING = 1.15;

export function hasInvisibleDetail(palette: SemanticPalette): boolean {
  return (["headlineColor", "bodyColor", "accentColor"] as const).some(
    (role) => contrastRatio(palette[role], palette.textSurface) < INVISIBLE_CONTRAST_CEILING,
  );
}

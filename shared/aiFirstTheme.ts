// Turns a validated AI-first concept into a LaunchTheme the EXISTING
// ThemeInvitation renderer can draw with no changes.
//
// This is why the AI path and the studio path stay one renderer: an AI concept
// is not a second kind of card, it is a LaunchTheme whose artwork happens to
// have been generated. Everything the renderer needs that a concept does not
// carry — curated text placements, the envelope bundle, sample copy, motif
// opacity/scale, artFocus — is inherited untouched from the curated theme the
// concept named in `baseThemeId`.
//
// The eight curated themes are never mutated; `{ ...base }` copies.

import {
  getLaunchTheme,
  type LaunchTheme,
  type OverlayTreatment,
  type PaletteVariant,
} from "./themeCatalog";
import type { AiFirstConcept, ResolvedAiConcept } from "./aiFirstInvite";
import { normalizeSemanticPalette } from "./aiFirstPalette";
import type { LayoutStyle } from "./inviteDesign";

/** Prefix that marks a theme id as generated rather than curated. */
export const AI_THEME_ID_PREFIX = "ai-";

export function isAiThemeId(id: string): boolean {
  return id.startsWith(AI_THEME_ID_PREFIX);
}

export interface BuiltAiTheme {
  theme: LaunchTheme;
  palette: PaletteVariant;
}

export function buildAiFirstTheme(
  concept: AiFirstConcept,
  options: {
    /** Stable id for this concept within its event. */
    themeId: string;
    artwork: { url: string; width: number; height: number };
    overlay: OverlayTreatment;
    /** Set only when the layout validator rescued the artwork opacity. */
    layoutStyle?: LayoutStyle;
  },
): BuiltAiTheme {
  const base = getLaunchTheme(concept.baseThemeId);
  if (!base) throw new Error(`buildAiFirstTheme: unknown baseThemeId "${concept.baseThemeId}"`);

  const { variant } = normalizeSemanticPalette(concept.semanticPalette);
  const layoutStyle = options.layoutStyle ?? concept.layoutStyle;

  const theme: LaunchTheme = {
    ...base,
    id: options.themeId,
    name: concept.conceptName,
    tagline: concept.description,
    description: concept.description,
    artwork: {
      fullUrl: options.artwork.url,
      thumbUrl: options.artwork.url,
      alt: concept.description,
      width: options.artwork.width,
      height: options.artwork.height,
    },
    layoutStyle,
    borderStyle: concept.borderStyle,
    styleLaneId: concept.styleLaneId,
    fontPairingIds: [concept.fontPairingId, ...base.fontPairingIds.filter((id) => id !== concept.fontPairingId)],
    palettes: [variant, ...base.palettes],
    texture: { style: concept.texture.style, intensity: concept.texture.intensity },
    divider: concept.dividerStyle,
    art: { ...base.art, id: concept.motif.id, placement: concept.motif.placement },
    defaultOverlay: options.overlay,
    overlayOptions: Array.from(new Set([options.overlay, ...base.overlayOptions])),
  };

  return { theme, palette: variant };
}

/** Builds the theme for a concept the pipeline has already resolved. */
export function themeForResolvedConcept(resolved: ResolvedAiConcept, themeId: string): BuiltAiTheme {
  return buildAiFirstTheme(resolved.concept, {
    themeId,
    artwork: { url: resolved.illustrationUrl, width: 1024, height: 1024 },
    overlay: resolved.overlay,
  });
}

/* ── Persistence ─────────────────────────────────────────────────────── */

/**
 * What has to be stored so an applied AI card can be redrawn later.
 *
 * A synthetic theme id is not in LAUNCH_THEMES, so `getLaunchTheme` cannot
 * resolve it on the next page load. Rather than register generated themes in
 * the curated catalogue — which would leak AI cards into the studio grid —
 * the concept itself is stored alongside the applied concept and the theme is
 * rebuilt from it. Additive: a stored concept without this key is a curated
 * or legacy concept and behaves exactly as before.
 */
export interface AiFirstSnapshot {
  concept: AiFirstConcept;
  previewId: string;
  assetHash: string;
  artworkUrl: string;
  /** Present only when the layout validator rescued a focal subject. */
  artworkOpacity?: number;
  source: "ai-generated" | "adapted-studio-direction";
}

export const AI_FIRST_CONCEPT_KEY = "aiFirst" as const;

export function readAiFirstSnapshot(concept: unknown): AiFirstSnapshot | null {
  if (!concept || typeof concept !== "object") return null;
  const snapshot = (concept as Record<string, unknown>)[AI_FIRST_CONCEPT_KEY];
  if (!snapshot || typeof snapshot !== "object") return null;
  const s = snapshot as Partial<AiFirstSnapshot>;
  if (!s.concept || typeof s.artworkUrl !== "string" || typeof s.previewId !== "string") return null;
  return s as AiFirstSnapshot;
}

/** Rebuilds the renderer's theme from a stored snapshot. */
export function themeFromSnapshot(snapshot: AiFirstSnapshot): BuiltAiTheme {
  return buildAiFirstTheme(snapshot.concept, {
    themeId: `${AI_THEME_ID_PREFIX}${snapshot.previewId}`,
    artwork: { url: snapshot.artworkUrl, width: 1024, height: 1024 },
    overlay: snapshot.concept.minOverlay,
  });
}

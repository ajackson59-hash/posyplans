// The fourth-card guarantee.
//
// A direction that fails its retry cannot be shown and cannot be dropped —
// the host was promised four. So it is replaced by a curated studio theme
// adapted to the brief: real artwork that already passed a human art
// director, restyled with the failed concept's palette and typography so it
// still reads as part of the set rather than an obvious patch.
//
// The substitution is recorded as `source: "adapted-studio-direction"`
// rather than hidden, because a silent swap would make the quality gate's
// own numbers unreadable.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { LAUNCH_THEMES, type LaunchTheme } from "@shared/themeCatalog";
import { STYLE_LANES } from "@shared/inviteDesign";
import { contrastRatio } from "@shared/aiFirstPalette";
import type { AiFirstConcept } from "@shared/aiFirstInvite";
import type { EventBrief } from "./brief";

/** Occasion words that map a brief onto the themes' own occasion tags. */
function occasionsFor(brief: EventBrief): string[] {
  const text = `${brief.eventType} ${brief.eventName} ${brief.milestone}`.toLowerCase();
  const out: string[] = [];
  if (/birthday/.test(text)) out.push("birthday");
  if (/wedding|engage|shower|bridal/.test(text)) out.push("wedding", "shower");
  if (/baby/.test(text)) out.push("baby");
  if (/graduat/.test(text)) out.push("graduation");
  if (/holiday|christmas|new year/.test(text)) out.push("holiday");
  if (/dinner|anniversary|retirement|corporate/.test(text)) out.push("dinner", "milestone");
  return out;
}

function laneDistance(a: string, b: string): number {
  if (a === b) return 0;
  const ia = STYLE_LANES.findIndex((l) => l.id === a);
  const ib = STYLE_LANES.findIndex((l) => l.id === b);
  if (ia < 0 || ib < 0) return STYLE_LANES.length;
  return Math.abs(ia - ib);
}

/** Perceptual-ish distance: contrast against a mid grey stands in for tone. */
function paletteDistance(theme: LaunchTheme, concept: AiFirstConcept): number {
  const variant = theme.palettes[0];
  const pairs: [string, string][] = [
    [variant.ink, concept.semanticPalette.headlineColor],
    [variant.accent, concept.semanticPalette.accentColor],
    [variant.surface, concept.semanticPalette.textSurface],
  ];
  return pairs.reduce((sum, [a, b]) => sum + Math.abs(contrastRatio(a, "#808080") - contrastRatio(b, "#808080")), 0);
}

export interface AdaptedDirection {
  theme: LaunchTheme;
  /** The failed concept restyled onto the curated theme's artwork. */
  concept: AiFirstConcept;
  reason: string;
}

export interface AdaptFallbackInput {
  concept: AiFirstConcept;
  brief: EventBrief;
  /** Theme ids already used by directions in this run, so the four differ. */
  usedThemeIds: string[];
  reason: string;
}

/**
 * Picks the curated theme nearest the failed concept and rebuilds the concept
 * around it. The theme's own layout, artwork and placement win — that is the
 * part that is known good. The concept keeps its name, description, palette
 * and font pairing so the card still answers the brief.
 */
export function adaptStudioDirection(input: AdaptFallbackInput): AdaptedDirection {
  const occasions = occasionsFor(input.brief);
  const candidates = LAUNCH_THEMES.filter((t) => !input.usedThemeIds.includes(t.id));
  const pool = candidates.length > 0 ? candidates : LAUNCH_THEMES;

  const scored = pool
    .map((theme) => ({
      theme,
      score:
        laneDistance(theme.styleLaneId, input.concept.styleLaneId) * 2 +
        paletteDistance(theme, input.concept) +
        (occasions.length > 0 && occasions.some((o) => theme.occasions.includes(o as never)) ? 0 : 4),
    }))
    .sort((a, b) => a.score - b.score || a.theme.id.localeCompare(b.theme.id));

  const theme = scored[0].theme;

  return {
    theme,
    reason: input.reason,
    concept: {
      ...input.concept,
      baseThemeId: theme.id,
      placementId: theme.placements[0].id,
      layoutStyle: theme.layoutStyle,
      borderStyle: theme.borderStyle,
      styleLaneId: theme.styleLaneId,
      dividerStyle: theme.divider,
      texture: { style: theme.texture.style, intensity: theme.texture.intensity },
      motif: { id: theme.art.id, placement: theme.art.placement },
      minOverlay: theme.defaultOverlay,
    },
  };
}

/* ── The substituted artwork's own bytes ─────────────────────────────── */

/**
 * Roots a studio asset can live under: the built server serves `dist/public`,
 * the dev server serves `client/public`.
 */
const STATIC_ROOTS = [
  process.env.POSY_STATIC_ROOT,
  path.resolve(process.cwd(), "dist", "public"),
  path.resolve(process.cwd(), "client", "public"),
].filter((root): root is string => Boolean(root));

/**
 * Reads the curated artwork a substituted direction actually displays.
 *
 * A fallback still has to be applicable, and apply verifies bytes by hash —
 * so the substitution needs real bytes in the preview store, not a synthetic
 * id. These are static assets that ship with the build, so this is a disk
 * read and never an image-provider call.
 */
export async function loadStudioArtwork(theme: LaunchTheme): Promise<Buffer> {
  const relative = theme.artwork.fullUrl.replace(/^\/+/, "");
  for (const root of STATIC_ROOTS) {
    try {
      return await readFile(path.join(root, relative));
    } catch {
      continue;
    }
  }
  throw new Error(`studio artwork missing for theme "${theme.id}" (${theme.artwork.fullUrl})`);
}

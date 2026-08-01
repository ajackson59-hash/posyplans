// Layout compatibility for AI-first concepts.
//
// Runs twice: once BEFORE generation (on the concept alone, so an incompatible
// pairing is repaired before a paid image exists) and once BEFORE composition
// (with the decoded artwork's measured salience, so a bad crop is caught
// before a customer sees it).
//
// It never alters the eight curated studio templates. When a concept and a
// layout cannot live together, the repair is one of exactly two narrowly
// scoped moves: raise the artwork opacity for THIS concept only, or move the
// concept to a different layout.

import type { LayoutStyle } from "./inviteDesign";
import type { AiFirstConcept, SafeTypographyRegion } from "./aiFirstInvite";
import type { OverlayTreatment } from "./themeCatalog";
import { LAYOUT_FRAMES, objectCoverSourceRect, type Frame } from "./inviteLayout";

export interface LayoutIssue {
  code:
    | "backdrop-erases-focal-subject"
    | "full-bleed-crop-unsafe"
    | "split-art-not-panel-shaped"
    | "banner-internal-mat"
    | "busy-scatter-without-quiet-region"
    | "overlay-obscures-artwork"
    | "safe-region-outside-type-area";
  message: string;
  /** How the pipeline may fix it without touching the studio templates. */
  repair: "raise-artwork-opacity" | "change-layout" | "strengthen-overlay" | "regenerate";
}

export interface LayoutRepair {
  layoutStyle: LayoutStyle;
  overlay: OverlayTreatment;
  /** Only set when the repair was an opacity rescue. */
  artworkOpacity?: number;
  issues: LayoutIssue[];
  /** True when nothing had to change. */
  clean: boolean;
}

/**
 * Compositions that put a single subject at the centre of attention. A
 * `backdrop` renders artwork at 30%, which erases exactly this kind of art —
 * the "focal buckle washed to nothing" defect.
 */
const FOCAL_COMPOSITION = /\b(focal|single|centred|centered|portrait|subject|hero|silhouette|emblem|crest|motif)\b/i;

/** Compositions that read as texture and survive being dropped to 30%. */
const FIELD_COMPOSITION = /\b(scatter|scattered|field|pattern|repeat|allover|all-over|texture|wash|tile)\b/i;

/** Artwork opacity a rescued backdrop is raised to: readable, still recessive. */
export const BACKDROP_RESCUE_OPACITY = 0.62;

/** Overlay strength ordering — the gate may strengthen, never weaken. */
const OVERLAY_STRENGTH: Record<OverlayTreatment, number> = { none: 0, veil: 1, gradient: 2, plate: 3 };

export function strongerOverlay(a: OverlayTreatment, b: OverlayTreatment): OverlayTreatment {
  return OVERLAY_STRENGTH[a] >= OVERLAY_STRENGTH[b] ? a : b;
}

/**
 * Approximate share of the card an overlay treatment covers. `plate` is a
 * defined panel behind the type; `veil` and `gradient` wash wider but are
 * partially transparent. Used for the "overlay cannot obscure most art" rule.
 */
export const OVERLAY_COVERAGE: Record<OverlayTreatment, number> = {
  none: 0,
  veil: 0.28,
  gradient: 0.34,
  plate: 0.4,
};

export const MAX_OVERLAY_COVERAGE = 0.4;

/** Where each safe-typography region sits on the 3:4 canvas. */
const REGION_BOX: Record<SafeTypographyRegion, Frame> = {
  "upper-third": { top: 0, left: 0, width: 100, height: 34 },
  center: { top: 33, left: 0, width: 100, height: 34 },
  "lower-third": { top: 66, left: 0, width: 100, height: 34 },
  "left-panel": { top: 0, left: 0, width: 46, height: 100 },
  "right-panel": { top: 0, left: 54, width: 46, height: 100 },
};

function overlaps(a: Frame, b: Frame): number {
  const x = Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left));
  const y = Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));
  return x * y;
}

/* ── Pass 1: before generation ───────────────────────────────────────── */

/**
 * Validates the concept's own declarations against the layout it chose. No
 * image exists yet, so this reasons about the declared composition — which is
 * enough to catch the pairings that are wrong by construction.
 */
export function validateLayoutBeforeGeneration(concept: AiFirstConcept): LayoutRepair {
  const issues: LayoutIssue[] = [];
  let layoutStyle = concept.layoutStyle;
  let overlay = concept.minOverlay;
  let artworkOpacity: number | undefined;

  const composition = `${concept.art.composition} ${concept.art.prompt}`;
  const isFocal = FOCAL_COMPOSITION.test(composition) && !FIELD_COMPOSITION.test(composition);
  const isField = FIELD_COMPOSITION.test(composition);

  // A backdrop at 30% erases a primary focal subject.
  if (layoutStyle === "backdrop" && isFocal) {
    issues.push({
      code: "backdrop-erases-focal-subject",
      message:
        "backdrop renders artwork at 30% opacity, which would wash out this concept's primary focal subject",
      repair: "raise-artwork-opacity",
    });
    artworkOpacity = BACKDROP_RESCUE_OPACITY;
  }

  // Split art must be authored for a tall 40%-wide panel, not a wide scene.
  if (layoutStyle === "split" && /\b(wide|panoramic|landscape|horizon|banner)\b/i.test(composition)) {
    issues.push({
      code: "split-art-not-panel-shaped",
      message: "split renders artwork into a tall 40%-wide panel; this composition is authored wide",
      repair: "change-layout",
    });
    layoutStyle = "banner";
  }

  // A banner's artwork already sits inside a framed card; art that draws its
  // own mat produces the nested-border defect.
  if (layoutStyle === "banner" && /\b(mat|matted|paper margin|border|frame|inset panel)\b/i.test(composition)) {
    issues.push({
      code: "banner-internal-mat",
      message: "banner artwork must not draw its own mat or frame — the renderer already frames the card",
      repair: "regenerate",
    });
  }

  // Busy all-over art needs somewhere quiet for the words to live.
  if (isField && overlay === "none") {
    issues.push({
      code: "busy-scatter-without-quiet-region",
      message: "an all-over composition needs at least a restrained local veil behind the type",
      repair: "strengthen-overlay",
    });
    overlay = strongerOverlay(overlay, "veil");
  }

  // Overlay must not swallow the artwork it sits on.
  if (OVERLAY_COVERAGE[overlay] > MAX_OVERLAY_COVERAGE) {
    issues.push({
      code: "overlay-obscures-artwork",
      message: `overlay "${overlay}" covers more than ${Math.round(MAX_OVERLAY_COVERAGE * 100)}% of the card`,
      repair: "strengthen-overlay",
    });
    overlay = "veil";
  }

  // The declared quiet region must actually intersect where type is set.
  const typeFrame = LAYOUT_FRAMES[layoutStyle].type;
  if (overlaps(REGION_BOX[concept.safeTypographyRegion], typeFrame) <= 0) {
    issues.push({
      code: "safe-region-outside-type-area",
      message: `safeTypographyRegion "${concept.safeTypographyRegion}" does not overlap the ${layoutStyle} type area`,
      repair: "strengthen-overlay",
    });
    overlay = strongerOverlay(overlay, "plate");
  }

  return { layoutStyle, overlay, artworkOpacity, issues, clean: issues.length === 0 };
}

/* ── Pass 2: before composition ──────────────────────────────────────── */

/** A high-variance region of the decoded artwork, in 0-1 source fractions. */
export interface SalientRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CropSafetyResult {
  /** Largest share of any single salient region that the crop removes. */
  worstCroppedFraction: number;
  safe: boolean;
  issues: LayoutIssue[];
}

/** Above this share of a salient region lost to the crop, the art is clipped. */
export const MAX_SALIENT_CROP_FRACTION = 0.25;

/**
 * Replays the renderer's `object-fit: cover` crop for a layout and reports how
 * much of the artwork's salient content it destroys. This is the check that
 * catches clipped motifs and unsafe full-bleed crops before a customer sees
 * them, and it costs nothing.
 */
export function evaluateCropSafety(
  layoutStyle: LayoutStyle,
  artwork: { width: number; height: number },
  salientRegions: SalientRegion[],
  objectPosition: { x: number; y: number } = { x: 0.5, y: 0.5 },
): CropSafetyResult {
  const frame = LAYOUT_FRAMES[layoutStyle].art;
  // The art box on a 3:4 card, in card units — width% by height%*(4/3).
  const destination = { width: frame.width, height: frame.height * (4 / 3) };
  const visible = objectCoverSourceRect(artwork, destination, objectPosition);

  let worst = 0;
  for (const region of salientRegions) {
    const area = region.width * region.height;
    if (area <= 0) continue;
    const overlapW = Math.max(
      0,
      Math.min(region.x + region.width, visible.x + visible.width) - Math.max(region.x, visible.x),
    );
    const overlapH = Math.max(
      0,
      Math.min(region.y + region.height, visible.y + visible.height) - Math.max(region.y, visible.y),
    );
    const cropped = 1 - (overlapW * overlapH) / area;
    if (cropped > worst) worst = cropped;
  }

  const safe = worst <= MAX_SALIENT_CROP_FRACTION;
  return {
    worstCroppedFraction: Math.round(worst * 1000) / 1000,
    safe,
    issues: safe
      ? []
      : [
          {
            code: "full-bleed-crop-unsafe",
            message: `the ${layoutStyle} crop removes ${Math.round(worst * 100)}% of a salient region (limit ${Math.round(
              MAX_SALIENT_CROP_FRACTION * 100,
            )}%)`,
            repair: "change-layout",
          },
        ],
  };
}

/**
 * Post-opacity visibility of the artwork's focal region against the card
 * surface. Below this the subject has effectively been erased — the
 * "focal subject washed out by backdrop" defect, measured rather than guessed.
 */
export const MIN_FOCAL_VISIBILITY_RATIO = 1.3;

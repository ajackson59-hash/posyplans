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
import { getLaunchTheme, getPlacement, type OverlayTreatment } from "./themeCatalog";
import {
  LAYOUT_FRAMES,
  objectCoverSourceRect,
  projectPlacement,
  withinSafeArea,
  type Frame,
} from "./inviteLayout";

export interface LayoutIssue {
  code:
    | "backdrop-erases-focal-subject"
    | "full-bleed-crop-unsafe"
    | "split-art-not-panel-shaped"
    | "banner-internal-mat"
    | "busy-scatter-without-quiet-region"
    | "art-behind-type-needs-local-surface"
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

/**
 * Evidence that the provider explicitly asked the artwork to draw the card's
 * presentation edge. A bare `frame`, `framing`, `mat`, or `border` is not
 * enough: construction art legitimately contains timber frames and scaffold
 * framing, yoga art contains mats, and scene descriptions use camera framing.
 * The old single-word test rejected those valid subjects before image spend.
 */
const BANNER_INTERNAL_MAT =
  /\b(?:paper margins?|inset panels?|printed borders?|decorative borders?|ornamental borders?|card frames?|artwork frames?|image frames?|framed cards?|framed artwork|matted artwork|(?:border|frame) around (?:the )?(?:artwork|image|illustration|scene|composition|banner)|(?:artwork|image|illustration|scene|composition|banner) (?:inside|within) (?:an? |the )?(?:printed |painted |decorative |ornamental |thin |double |solid |paper )?(?:mat|border|frame|inset panel)|inside (?:an? |the )?(?:printed |painted |decorative |ornamental |thin |double |solid |paper )?(?:mat|border|frame|inset panel))\b/i;

/** Artwork opacity a rescued backdrop is raised to: readable, still recessive. */
export const BACKDROP_RESCUE_OPACITY = 0.62;

/** Type-protection ordering — the gate may strengthen, never weaken. */
const OVERLAY_STRENGTH: Record<OverlayTreatment, number> = { none: 0, gradient: 1, veil: 2, plate: 3 };

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

/**
 * A coarse safe-region label is only meaningful when it covers most of the
 * actual inherited placement. The former `> 0` intersection test let a
 * centred 40%-tall type box pass as "upper-third" because two percentage
 * points happened to touch — exactly how the canary put type over a child.
 */
export const MIN_SAFE_TYPE_PLACEMENT_COVERAGE = 0.6;

function overlaps(a: Frame, b: Frame): number {
  const x = Math.max(0, Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left));
  const y = Math.max(0, Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top));
  return x * y;
}

/** The exact box the shared renderer reserves for this concept's live type. */
export function typePlacementFrame(
  concept: AiFirstConcept,
  layoutStyle: LayoutStyle = concept.layoutStyle,
): Frame {
  const theme = getLaunchTheme(concept.baseThemeId);
  if (!theme) return withinSafeArea(LAYOUT_FRAMES[layoutStyle].type);
  const placement = getPlacement(theme, concept.placementId);
  return withinSafeArea(projectPlacement(placement.box, LAYOUT_FRAMES[layoutStyle].type));
}

/** Share of the selected type placement covered by the promised quiet region. */
export function safeTypographyPlacementCoverage(
  concept: AiFirstConcept,
  layoutStyle: LayoutStyle = concept.layoutStyle,
): number {
  const typeBox = typePlacementFrame(concept, layoutStyle);
  const area = typeBox.width * typeBox.height;
  if (area <= 0) return 0;
  return overlaps(REGION_BOX[concept.safeTypographyRegion], typeBox) / area;
}

/**
 * `safeTypographyRegion` is ultimately renderer geometry, not creative prose.
 * Preserve a provider choice when it is genuinely compatible; otherwise
 * derive the highest-coverage region from the exact inherited placement.
 * This removes a stochastic correction loop without weakening the gate.
 */
export function canonicalSafeTypographyRegion(
  concept: AiFirstConcept,
  layoutStyle: LayoutStyle = concept.layoutStyle,
): SafeTypographyRegion {
  if (safeTypographyPlacementCoverage(concept, layoutStyle) >= MIN_SAFE_TYPE_PLACEMENT_COVERAGE) {
    return concept.safeTypographyRegion;
  }

  return (Object.keys(REGION_BOX) as SafeTypographyRegion[]).reduce((best, candidate) => {
    const bestCoverage = safeTypographyPlacementCoverage({ ...concept, safeTypographyRegion: best }, layoutStyle);
    const candidateCoverage = safeTypographyPlacementCoverage(
      { ...concept, safeTypographyRegion: candidate },
      layoutStyle,
    );
    return candidateCoverage > bestCoverage ? candidate : best;
  }, concept.safeTypographyRegion);
}

export interface CanonicalTypeGeometry {
  placementId: string;
  safeTypographyRegion: SafeTypographyRegion;
}

/**
 * Some legal theme placements straddle two coarse quiet-region labels, so no
 * label can cover the required 60% even after the best region is selected.
 * When that happens, choose the highest-coverage placement/region pair from
 * the same curated theme. The renderer already supports every candidate in
 * this menu; this changes no global template and removes another stochastic
 * text-correction loop from server-owned geometry.
 */
export function canonicalTypeGeometry(
  concept: AiFirstConcept,
  layoutStyle: LayoutStyle = concept.layoutStyle,
): CanonicalTypeGeometry {
  const safeTypographyRegion = canonicalSafeTypographyRegion(concept, layoutStyle);
  const canonicalRegionConcept = { ...concept, safeTypographyRegion };
  if (safeTypographyPlacementCoverage(canonicalRegionConcept, layoutStyle) >= MIN_SAFE_TYPE_PLACEMENT_COVERAGE) {
    return { placementId: concept.placementId, safeTypographyRegion };
  }

  const theme = getLaunchTheme(concept.baseThemeId);
  if (!theme) return { placementId: concept.placementId, safeTypographyRegion };

  let best = {
    placementId: concept.placementId,
    safeTypographyRegion,
    coverage: safeTypographyPlacementCoverage(canonicalRegionConcept, layoutStyle),
  };
  for (const placement of theme.placements) {
    for (const region of Object.keys(REGION_BOX) as SafeTypographyRegion[]) {
      const coverage = safeTypographyPlacementCoverage(
        { ...concept, placementId: placement.id, safeTypographyRegion: region },
        layoutStyle,
      );
      if (coverage > best.coverage) best = { placementId: placement.id, safeTypographyRegion: region, coverage };
    }
  }
  return { placementId: best.placementId, safeTypographyRegion: best.safeTypographyRegion };
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
  if (layoutStyle === "banner" && BANNER_INTERNAL_MAT.test(composition)) {
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

  // A cinematic narrative is intentionally busy: people, hero objects and
  // party activity can move between otherwise valid generations. A local
  // surface makes the words readable but still hides the artwork underneath
  // it — the production canary preserved every face yet covered the trio's
  // torsos and weapons with the type plate. Keep narrative art and live type
  // in disjoint renderer-owned frames instead. This repair runs before image
  // generation, so the provider receives the banner's 16:9 aspect ratio and
  // no paid portrait is later cropped into a landscape strip.
  if (layoutStyle === "full-bleed" && concept.focalStrategy === "narrative-scene") {
    issues.push({
      code: "art-behind-type-needs-local-surface",
      message: "a narrative scene must keep artwork and live type in separate frames",
      repair: "change-layout",
    });
    layoutStyle = "banner";
  }

  // Full-card artwork sits directly behind live type. A top-fading gradient
  // does not protect centred or lower detail lines, and `none` protects
  // nothing. Require a local surface whose opacity is stable across the
  // complete type block. Banner/split/centred layouts keep type off the art.
  if ((layoutStyle === "full-bleed" || layoutStyle === "backdrop") && (overlay === "none" || overlay === "gradient")) {
    issues.push({
      code: "art-behind-type-needs-local-surface",
      message: `${layoutStyle} artwork behind live type requires a local veil or plate`,
      repair: "strengthen-overlay",
    });
    overlay = "veil";
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

  // The declared quiet region must materially cover the selected inherited
  // placement — a one-pixel touch is not evidence that live type is safe.
  const safeCoverage = safeTypographyPlacementCoverage(concept, layoutStyle);
  if (safeCoverage < MIN_SAFE_TYPE_PLACEMENT_COVERAGE) {
    issues.push({
      code: "safe-region-outside-type-area",
      message:
        `safeTypographyRegion "${concept.safeTypographyRegion}" covers only ${Math.round(safeCoverage * 100)}% ` +
        `of placement "${concept.placementId}" in the ${layoutStyle} layout ` +
        `(minimum ${Math.round(MIN_SAFE_TYPE_PLACEMENT_COVERAGE * 100)}%)`,
      repair: "regenerate",
    });
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
 * A high-detail region that already bleeds across a generated edge can be
 * framing texture rather than a bounded focal motif. The image model is
 * explicitly required to paint through every edge, so rejecting stage trim,
 * sky, foliage or confetti there would contradict the full-bleed contract.
 * For a shallow cover crop, semantic vision is the right place to distinguish
 * decoration from a face or hero object; deep layout crops remain blocked here.
 */
const MIN_DECORATIVE_EDGE_BLEED_SPAN = 0.75;
const MAX_SHALLOW_CROP_AXIS_LOSS = 0.15;

function isDecorativeEdgeBleed(region: SalientRegion, visible: SalientRegion): boolean {
  const epsilon = 0.001;
  const touchesTop = region.y <= epsilon;
  const touchesBottom = region.y + region.height >= 1 - epsilon;
  const touchesLeft = region.x <= epsilon;
  const touchesRight = region.x + region.width >= 1 - epsilon;
  const topOrBottomIsCropped = visible.y > epsilon || visible.y + visible.height < 1 - epsilon;
  const leftOrRightIsCropped = visible.x > epsilon || visible.x + visible.width < 1 - epsilon;
  const shallowVerticalCrop = 1 - visible.height <= MAX_SHALLOW_CROP_AXIS_LOSS;
  const shallowHorizontalCrop = 1 - visible.width <= MAX_SHALLOW_CROP_AXIS_LOSS;

  return (
    (topOrBottomIsCropped &&
      (touchesTop || touchesBottom) &&
      (shallowVerticalCrop || region.width >= MIN_DECORATIVE_EDGE_BLEED_SPAN)) ||
    (leftOrRightIsCropped &&
      (touchesLeft || touchesRight) &&
      (shallowHorizontalCrop || region.height >= MIN_DECORATIVE_EDGE_BLEED_SPAN))
  );
}

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
    if (isDecorativeEdgeBleed(region, visible)) continue;
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

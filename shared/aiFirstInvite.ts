// The AI-first invitation concept: the smallest object a model can emit that
// the production renderer can compose without a human touching it.
//
// Every field here is consumed by something real — the ThemeInvitation
// renderer, the layout-compatibility validator, the semantic palette
// normalizer, or the artwork prompt builder. Nothing is emitted for the
// benefit of a report. In particular the model is NOT asked for:
//   - a requiredElementTrace  (the server owns REQUIRED/PREFERRED/EXCLUDED
//     classification and audits against its own list)
//   - contrast ratios it computed  (the server measures real composited
//     contrast; a model's arithmetic is not evidence)
//   - rationales or overlay coverage estimates  (server-measured geometry)
//   - colour roles the renderer has no slot for  (envelope/liner are derived
//     from the base theme, borderColor is the frame and comes from `accent`)
//
// Framework-agnostic so the Express server, the React client and the tests
// can all import it.

import { z } from "zod";
import {
  ART_PLACEMENTS,
  DIVIDER_STYLES,
  OVERLAY_TREATMENTS,
  TEXTURE_STYLES,
  THEME_ART_IDS,
  getLaunchTheme,
  LAUNCH_THEMES,
} from "./themeCatalog";
import { BORDER_STYLES, FONT_PAIRINGS, LAYOUT_STYLES, STYLE_LANES } from "./inviteDesign";
import { LAYOUT_FRAMES } from "./inviteLayout";
import { typePlacementFrame } from "./aiFirstLayout";
import { DNA_AXES, type DnaAxis } from "./eventDna";

/* ── Safe typography regions ─────────────────────────────────────────── */

// Where on the 3:4 canvas the artwork must stay quiet enough to set type on.
// These are regions of the *card*, matched against the concept's chosen
// placement box by the layout validator.
export const SAFE_TYPOGRAPHY_REGIONS = [
  "upper-third",
  "center",
  "lower-third",
  "left-panel",
  "right-panel",
] as const;
export type SafeTypographyRegion = (typeof SAFE_TYPOGRAPHY_REGIONS)[number];

/* ── Whole-set creative direction ───────────────────────────────────── */

// These are intentionally broad art-direction strategies rather than event-
// specific subjects. A construction party, garden dinner, or space birthday
// can each be interpreted through all four without turning the set into four
// treatments of the same hero object.
export const FOCAL_STRATEGIES = [
  "narrative-scene",
  "iconic-detail",
  "graphic-world",
  "tactile-still-life",
] as const;
export type FocalStrategy = (typeof FOCAL_STRATEGIES)[number];

export const VISUAL_MOODS = [
  "cinematic-narrative",
  "sculptural-editorial",
  "graphic-modernist",
  "tactile-artisanal",
] as const;
export type VisualMood = (typeof VISUAL_MOODS)[number];

/* ── The schema ──────────────────────────────────────────────────────── */

const HEX = /^#[0-9a-fA-F]{6}$/;
const hex = z.string().regex(HEX, "must be a 6-digit hex colour");

/**
 * The four colour roles the ThemeInvitation renderer actually paints with.
 * They map 1:1 onto its PaletteVariant contract:
 *   textSurface   -> surface : the overlay/plate the type sits on
 *   headlineColor -> ink     : the display headline
 *   bodyColor     -> body    : date / time / location / host note
 *   accentColor   -> accent  : eyebrow, divider rule, RSVP cue AND the card frame
 *
 * There is deliberately no `borderColor`: the renderer derives the frame from
 * `accent`, so a separate slot would be a value the model sets and nothing
 * reads. The frame is still contrast-validated — against `accentColor`.
 */
export const semanticPaletteSchema = z.object({
  textSurface: hex,
  headlineColor: hex,
  bodyColor: hex,
  accentColor: hex,
});
export type SemanticPalette = z.infer<typeof semanticPaletteSchema>;

export const artDirectionSchema = z.object({
  /** e.g. "watercolor", "linocut", "flat vector illustration". */
  medium: z.string().min(3).max(60),
  /** e.g. "single off-centre focal subject", "full-bleed scattered field". */
  composition: z.string().min(3).max(120),
  /**
   * The art-only image prompt. The server appends the canvas-edge and
   * no-text guardrails, so the model must not spend tokens restating them.
   */
  prompt: z.string().min(40).max(1200),
});
export type AiArtDirection = z.infer<typeof artDirectionSchema>;

const dnaHintsSchema = z
  .object(
    Object.fromEntries(DNA_AXES.map((a) => [a.key, z.number().min(-1).max(1).optional()])) as Record<
      DnaAxis,
      z.ZodOptional<z.ZodNumber>
    >,
  )
  .partial();

export const aiFirstConceptSchema = z.object({
  conceptName: z.string().min(2).max(60),
  /** One sentence a host reads on the card. Not a design rationale. */
  description: z.string().min(10).max(220),

  /**
   * Required for newly generated quartets and audited before artwork spend.
   * Optional at the storage boundary so previews saved before this field was
   * introduced remain readable and applicable.
   */
  focalStrategy: z.enum(FOCAL_STRATEGIES).optional(),
  visualMood: z.enum(VISUAL_MOODS).optional(),

  styleLaneId: z.string().refine((v) => STYLE_LANES.some((l) => l.id === v), "unknown styleLaneId"),
  layoutStyle: z.enum(LAYOUT_STYLES),
  borderStyle: z.enum(BORDER_STYLES),
  fontPairingId: z.string().refine((v) => FONT_PAIRINGS.some((f) => f.id === v), "unknown fontPairingId"),

  /** The curated theme this concept inherits its uncustomised furniture from. */
  baseThemeId: z.string().refine((v) => LAUNCH_THEMES.some((t) => t.id === v), "unknown baseThemeId"),
  /** Must be a placement the base theme actually ships. Cross-checked below. */
  placementId: z.string().min(1),

  texture: z.object({
    style: z.enum(TEXTURE_STYLES),
    intensity: z.number().min(0).max(1),
  }),
  dividerStyle: z.enum(DIVIDER_STYLES),
  motif: z.object({
    id: z.enum(THEME_ART_IDS),
    placement: z.enum(ART_PLACEMENTS),
  }),

  semanticPalette: semanticPaletteSchema,
  art: artDirectionSchema,

  safeTypographyRegion: z.enum(SAFE_TYPOGRAPHY_REGIONS),
  /** The least overlay that keeps type legible. The gate may strengthen it. */
  minOverlay: z.enum(OVERLAY_TREATMENTS),

  /** Only the axes the brief actually carried. Optional throughout. */
  dnaHints: dnaHintsSchema.optional(),
});

export type AiFirstConcept = z.infer<typeof aiFirstConceptSchema>;

/* ── Recoverable drift ───────────────────────────────────────────────── */

/**
 * Free-text fields, with the cap read off the schema so the two can never
 * disagree. An overrun here is cosmetic — the concept still renders.
 */
const TEXT_CAPS: [path: readonly string[], max: number][] = [
  [["conceptName"], aiFirstConceptSchema.shape.conceptName.maxLength!],
  [["description"], aiFirstConceptSchema.shape.description.maxLength!],
  [["art", "medium"], artDirectionSchema.shape.medium.maxLength!],
  [["art", "composition"], artDirectionSchema.shape.composition.maxLength!],
  [["art", "prompt"], artDirectionSchema.shape.prompt.maxLength!],
];

/** Trims at a word boundary so a shortened sentence still reads as one. */
function clampText(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:—–-]+$/, "");
}

/**
 * Repairs the two kinds of drift that do not affect what gets rendered, and
 * says what it repaired. Everything else — an unknown identifier, a malformed
 * hex, a layout that does not exist — stays a hard failure, because those
 * cannot be composed at all.
 *
 * This exists because the alternative is worse: discarding an otherwise
 * excellent direction over a 240-character description spends a real image
 * budget on a studio fallback the host did not ask for.
 */
function normalizeConceptDraft(value: unknown): { value: unknown; notes: string[] } {
  if (typeof value !== "object" || value === null) return { value, notes: [] };
  const draft = structuredClone(value) as Record<string, any>;
  const notes: string[] = [];

  for (const [path, max] of TEXT_CAPS) {
    const parent = path.length === 1 ? draft : draft[path[0]];
    const key = path[path.length - 1];
    const text = parent?.[key];
    if (typeof text !== "string" || text.length <= max) continue;
    parent[key] = clampText(text, max);
    notes.push(`${path.join(".")} trimmed from ${text.length} to ${max} characters`);
  }

  // dnaHints is an optional hint bag. A value the renderer cannot read is
  // worth dropping, not worth failing a whole direction over.
  const hints = draft.dnaHints;
  if (typeof hints === "object" && hints !== null) {
    for (const [key, hint] of Object.entries(hints)) {
      if (typeof hint === "number" && Number.isFinite(hint) && hint >= -1 && hint <= 1) continue;
      delete (hints as Record<string, unknown>)[key];
      notes.push(`dnaHints.${key} dropped — ${JSON.stringify(hint)} is not a number in [-1, 1]`);
    }
  }

  return { value: draft, notes };
}

/**
 * Full validation: the zod shape plus the cross-field constraint zod cannot
 * express — `placementId` must exist on the chosen `baseThemeId`.
 */
export function parseAiFirstConcept(
  value: unknown,
): { ok: true; concept: AiFirstConcept; normalized: string[] } | { ok: false; errors: string[] } {
  const draft = normalizeConceptDraft(value);
  const parsed = aiFirstConceptSchema.safeParse(draft.value);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`) };
  }
  const theme = getLaunchTheme(parsed.data.baseThemeId);
  if (!theme) return { ok: false, errors: [`baseThemeId: unknown theme ${parsed.data.baseThemeId}`] };
  if (!theme.placements.some((p) => p.id === parsed.data.placementId)) {
    return {
      ok: false,
      errors: [
        `placementId: "${parsed.data.placementId}" is not a placement of "${theme.id}" ` +
          `(valid: ${theme.placements.map((p) => p.id).join(", ")})`,
      ],
    };
  }
  return { ok: true, concept: parsed.data, normalized: draft.notes };
}

/* ── Where a concept came from ───────────────────────────────────────── */

export const CONCEPT_SOURCES = ["ai-generated", "adapted-studio-direction"] as const;
export type ConceptSource = (typeof CONCEPT_SOURCES)[number];

/** A concept that has cleared the gate and is safe to show a customer. */
export interface ResolvedAiConcept {
  concept: AiFirstConcept;
  source: ConceptSource;
  /** Content-addressed preview identity — see server/aiFirst/previewStore.ts. */
  previewId: string;
  assetHash: string;
  illustrationUrl: string;
  /** Overlay actually applied; >= the concept's declared minimum. */
  overlay: (typeof OVERLAY_TREATMENTS)[number];
  /**
   * Narrowly scoped artwork opacity override. Only set when the layout
   * validator had to rescue a focal subject from a washed-out backdrop; the
   * eight curated themes are never affected.
   */
  artworkOpacity?: number;
}

/* ── Concept fingerprint ─────────────────────────────────────────────── */

/**
 * Bump only when the acceptance contract becomes stricter. The version is
 * part of the image cache key so artwork accepted by an older, weaker gate
 * can never skip the current checks; restyles remain free within a version.
 */
export const AI_FIRST_QUALITY_GATE_VERSION = 3;

/**
 * A stable hash over exactly the fields that change the generated *image*.
 * Two concepts with the same fingerprint must produce the same artwork, so
 * this is the idempotency key that stops a retry storm or a double-submitted
 * form from being billed twice.
 *
 * Deliberately excludes conceptName, description, palette, fonts, border,
 * texture and divider: those restyle the card without changing a pixel of the
 * artwork. Placement geometry is included because the image prompt now keeps
 * the exact live-type box quiet; moving that box can change the image.
 */
export function conceptImageFingerprintInput(concept: AiFirstConcept): string {
  const imageFields = [
    concept.art.medium.trim().toLowerCase(),
    concept.art.composition.trim().toLowerCase(),
    concept.art.prompt.trim(),
    concept.layoutStyle,
    concept.styleLaneId,
    concept.baseThemeId,
    concept.placementId,
    concept.safeTypographyRegion,
  ];
  // Preserve the exact pre-quartet fingerprint shape for previews already in
  // storage within this quality-gate version. Focal metadata remains
  // conditional so adding the quartet fields alone does not invalidate art.
  return JSON.stringify(
    concept.focalStrategy && concept.visualMood
      ? [AI_FIRST_QUALITY_GATE_VERSION, concept.focalStrategy, concept.visualMood, ...imageFields]
      : [AI_FIRST_QUALITY_GATE_VERSION, ...imageFields],
  );
}

/** Aspect ratio the artwork is generated at, from the layout it composes into. */
export function aspectRatioForLayout(layout: AiFirstConcept["layoutStyle"]): "16:9" | "1:1" | "9:16" {
  if (layout === "banner") return "16:9";
  // split's art panel is 40% wide by the full card height, so square artwork
  // loses most of its width to the cover crop.
  if (layout === "full-bleed" || layout === "backdrop" || layout === "split") return "9:16";
  return "1:1";
}

/* ── The artwork-edge guardrail ──────────────────────────────────────── */

/**
 * Appended verbatim to every artwork prompt. Printed paper margins inside the
 * generated image were the single most common visible defect: the renderer
 * already draws the card's frame, so a second one inside the art reads as a
 * mistake. Frames belong only to the live renderer.
 */
export const ARTWORK_EDGE_REQUIREMENT =
  "Artwork extends fully to every canvas edge. No paper margin, mat, card border, printed frame or blank perimeter.";

/** Appended after the edge requirement — the artwork must carry no lettering. */
export const ARTWORK_TEXT_REQUIREMENT = "No text, no letters, no words, no numbers, no logos, no watermarks.";

/**
 * Below this visible share of an axis, the model is told where the crop lands.
 * Keep this just below 1: even the portrait provider size loses 11% of its
 * height in a 3:4 full-card frame, which is enough to clip a deliberate edge
 * detail despite looking like a nearly exact aspect-ratio match.
 */
const FRAMING_ADVICE_THRESHOLD = 0.999;

/**
 * The share of the generated image each axis keeps once the renderer's
 * `object-fit: cover` crop has run for this layout. `split` shows a tall 40%
 * panel and `centered` a wide inset, so both discard a great deal; asking for
 * a composition the crop then destroys is how salient motifs get clipped.
 */
export function visibleFractionForLayout(layout: AiFirstConcept["layoutStyle"]): { x: number; y: number } {
  const frame = LAYOUT_FRAMES[layout].art;
  const destination = frame.width / (frame.height * (4 / 3));
  const source = EXPECTED_SOURCE_ASPECT[aspectRatioForLayout(layout)];
  return destination > source
    ? { x: 1, y: source / destination }
    : { x: destination / source, y: 1 };
}

const EXPECTED_SOURCE_ASPECT: Record<"16:9" | "1:1" | "9:16", number> = {
  "16:9": 1536 / 1024,
  "1:1": 1,
  "9:16": 1024 / 1536,
};

/**
 * Tells the model where the crop lands, so it composes for the region the card
 * actually shows rather than for the full canvas.
 */
export function safeFramingRequirement(layout: AiFirstConcept["layoutStyle"]): string {
  const visible = visibleFractionForLayout(layout);
  const clauses: string[] = [];
  if (visible.x < FRAMING_ADVICE_THRESHOLD) {
    clauses.push(`the central ${Math.round(visible.x * 100)}% of the width`);
  }
  if (visible.y < FRAMING_ADVICE_THRESHOLD) {
    clauses.push(`the central ${Math.round(visible.y * 100)}% of the height`);
  }
  if (clauses.length === 0) return "";
  return (
    `Compose so the subject, every important detail, AND the scene's background (sky, ground, walls, ` +
    `horizon — anything that reads as part of the setting, not just the foreground subject) all sit ` +
    `within ${clauses.join(" and ")} — the rest is cropped away and must be treated as disposable bleed, ` +
    `not essential scene content. Do not paint a horizon, sky-to-ground transition or floor line right at ` +
    `the canvas edge; keep it inside the safe zone with room to spare. The canvas must still be fully ` +
    `painted edge-to-edge with no blank margin — only the placement of meaningful content within it is ` +
    `constrained.`
  );
}

/**
 * Full-card artwork is the only case where generated pixels sit behind live
 * type. Give the image model the renderer's exact box rather than a vague
 * "upper third" label. Layouts with separate art/type panels need no such
 * instruction because their pixels never sit under the words.
 */
export function typographySafetyRequirement(concept: AiFirstConcept): string {
  if (concept.layoutStyle !== "full-bleed" && concept.layoutStyle !== "backdrop") return "";
  const frame = typePlacementFrame(concept);
  const left = Math.round(frame.left);
  const right = Math.round(frame.left + frame.width);
  const top = Math.round(frame.top);
  const bottom = Math.round(frame.top + frame.height);
  return (
    `Reserve the rectangle from ${left}% to ${right}% of canvas width and ${top}% to ${bottom}% of canvas height ` +
    `as a visually quiet typography zone. Keep every face, person, hero object, required subject and high-contrast ` +
    `detail entirely outside this box; only low-detail background texture may pass through it. ` +
    `This exact box overrides any conflicting quiet-region wording earlier in the brief.`
  );
}

export function buildArtworkPrompt(concept: AiFirstConcept): string {
  return [
    `${concept.art.medium} illustration.`,
    `${concept.art.composition}.`,
    concept.art.prompt.trim().replace(/\s+$/, ""),
    safeFramingRequirement(concept.layoutStyle),
    typographySafetyRequirement(concept),
    ARTWORK_EDGE_REQUIREMENT,
    ARTWORK_TEXT_REQUIREMENT,
  ]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

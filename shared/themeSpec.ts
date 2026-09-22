// Posy ThemeSpec — host request → buildable, rights-clean theme specification
// ─────────────────────────────────────────────────────────────────────────
// A ThemeSpec is the single intermediate representation between "whatever the
// host typed" and "something Posy can render". It exists so that one uniform
// path serves both a named-property request ("Moana birthday") and an original
// direction ("moody art-deco 40th"), with no branch that dead-ends.
//
// Two invariants carry the design:
//
//  1. A ThemeSpec contains ONLY unprotected vocabulary — palette, setting,
//     motifs, medium, mood. Protected names are recorded in `protectedTerms`
//     for the owner's own analytics and are NEVER forwarded to an image
//     provider. `assertProviderSafe` enforces that deterministically.
//
//  2. Every field resolves into the existing `themeCatalog` grammar, so a spec
//     is renderable with zero image generation. The AI artwork layer is an
//     optional enhancement over this floor, never a dependency.
//
// Framework-agnostic (plain data + zod) so server, client and tests can import it.

import { z } from "zod";
import {
  ART_PLACEMENTS,
  OVERLAY_TREATMENTS,
  TEXTURE_STYLES,
  THEME_ART_IDS,
  THEME_OCCASIONS,
  THEME_STYLES,
  DIVIDER_STYLES,
} from "./themeCatalog";

/* ── Subject policy ──────────────────────────────────────────────────── */

/**
 * How (or whether) a character/person may appear in generated artwork.
 * - "none"              : scene and motifs only. The default, and the only
 *                         policy used for a request that referenced a
 *                         protected property.
 * - "original-character": an original, non-derivative figure may appear
 *                         (e.g. "a child astronaut"), described generically.
 * - "host-reference"    : the host supplied their own reference image; likeness
 *                         is best-effort and the rights question is theirs.
 */
export const SUBJECT_POLICIES = ["none", "original-character", "host-reference"] as const;
export type SubjectPolicy = (typeof SUBJECT_POLICIES)[number];

/* ── Medium ──────────────────────────────────────────────────────────── */

/**
 * Supported artistic treatments. This list is deliberately closed: each entry
 * needs a human-approved style exemplar and a calibrated pixel "fingerprint"
 * envelope before artwork claiming that medium can be accepted automatically.
 * An unsupported medium is not a failure — it resolves to the nearest
 * supported one and the request still renders.
 */
export const ARTWORK_MEDIUMS = [
  "gouache",
  "watercolor",
  "flat-vector",
  "line-art",
  "oil-painting",
  "block-print",
  "colored-pencil",
  "cut-paper",
  "photographic",
  "lacquer-inlay",
] as const;
export type ArtworkMedium = (typeof ARTWORK_MEDIUMS)[number];

export const AGE_REGISTERS = ["young-child", "child", "teen", "adult"] as const;
export type AgeRegister = (typeof AGE_REGISTERS)[number];

/* ── Schema ──────────────────────────────────────────────────────────── */

const HEX = /^#[0-9a-fA-F]{6}$/;
const hex = z.string().regex(HEX, "expected a #rrggbb hex colour");

/** Semantic palette, matching `PaletteVariant`'s roles so it renders directly. */
export const themeSpecPaletteSchema = z.object({
  /** Headline / primary display type. */
  ink: hex,
  /** Rules, eyebrow, RSVP cue. */
  accent: hex,
  /** Overlay + plate surface. */
  surface: hex,
  /** Body copy. */
  body: hex,
});
export type ThemeSpecPalette = z.infer<typeof themeSpecPaletteSchema>;

export const themeSpecSchema = z.object({
  /**
   * Stable, human-readable identity for this *aesthetic* — not for the host's
   * wording. Every phrasing of the same request must converge here, because
   * this is the reuse key: the first approved render for a slug serves every
   * later host who lands on it. Lowercase kebab-case, no protected names.
   */
  canonicalSlug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).min(3).max(60),

  /** Customer-facing name. Must also be free of protected names. */
  displayName: z.string().min(2).max(48),

  /* Renderable floor — maps straight onto themeCatalog. */
  themeStyle: z.enum(THEME_STYLES),
  occasion: z.enum(THEME_OCCASIONS),
  palette: themeSpecPaletteSchema,
  artId: z.enum(THEME_ART_IDS),
  artPlacement: z.enum(ART_PLACEMENTS),
  textureStyle: z.enum(TEXTURE_STYLES),
  dividerStyle: z.enum(DIVIDER_STYLES),
  overlayTreatment: z.enum(OVERLAY_TREATMENTS),

  /**
   * The motif this theme actually wants, in free text, even when the library
   * cannot draw it yet (e.g. "hibiscus-and-palm"). `artId` always holds the
   * nearest *available* motif so the spec stays renderable; this field is the
   * backlog signal. Aggregated across real requests it ranks exactly which
   * motifs are worth drawing next.
   */
  motifIdeal: z.string().min(2).max(60),

  /* Optional AI artwork layer — descriptive, unprotected. */
  setting: z.string().min(8).max(300),
  motifs: z.array(z.string().min(2).max(40)).min(1).max(8),
  medium: z.enum(ARTWORK_MEDIUMS),
  mood: z.string().min(3).max(120),
  ageRegister: z.enum(AGE_REGISTERS),
  subjectPolicy: z.enum(SUBJECT_POLICIES),

  /**
   * Protected names detected in the host's request. Retained for the owner's
   * analytics and for routing decisions only. `assertProviderSafe` guarantees
   * these never reach an image provider.
   */
  protectedTerms: z.array(z.string().min(1).max(60)).max(12),

  /** Resolver's own confidence that the spec captures the request, 0-1. */
  confidence: z.number().min(0).max(1),
});

export type ThemeSpec = z.infer<typeof themeSpecSchema>;

/* ── Canonical slug ──────────────────────────────────────────────────── */

export function canonicalizeSlug(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

/* ── Provider-safety egress gate ─────────────────────────────────────── */

export interface ProviderSafetyViolation {
  /** The protected term that appeared. */
  term: string;
  /** Which field carried it. */
  field: string;
}

/**
 * Fields that can reach an image provider. `protectedTerms` is deliberately
 * excluded — it is owner-private analytics, not prompt input.
 */
const PROVIDER_VISIBLE_FIELDS = [
  "canonicalSlug",
  "displayName",
  "setting",
  "motifIdeal",
  "mood",
] as const;

function tokenize(value: string): string[] {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/**
 * Token-boundary containment check.
 *
 * Matching is done on token sequences rather than on a collapsed string.
 * Collapsing separators first looks stricter but is actually wrong: it lets a
 * needle span word boundaries, so "glitter-era-stage" spuriously "contains"
 * the term "Eras". That would block a clean spec for no reason.
 *
 * A term matches when either:
 *  - its token sequence appears consecutively ("paw patrol", "paw-patrol",
 *    and "Elsa's palace" -> tokens [elsa, s]), or
 *  - its fully concatenated form appears as one whole token ("PawPatrol").
 *
 * Terms of 2 characters or fewer are ignored; they cannot be distinguished
 * from ordinary words reliably enough to gate on.
 */
function mentions(haystack: string, term: string): boolean {
  const needle = tokenize(term);
  if (needle.length === 0) return false;
  const joined = needle.join("");
  if (joined.length <= 2) return false;

  const tokens = tokenize(haystack);
  if (tokens.includes(joined)) return true;

  for (let start = 0; start + needle.length <= tokens.length; start += 1) {
    let matched = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (tokens[start + offset] !== needle[offset]) { matched = false; break; }
    }
    if (matched) return true;
  }
  return false;
}

/**
 * Every protected term that leaked into a provider-visible field.
 * Empty array means the spec is safe to send.
 */
export function providerSafetyViolations(spec: ThemeSpec): ProviderSafetyViolation[] {
  const violations: ProviderSafetyViolation[] = [];
  for (const term of spec.protectedTerms) {
    for (const field of PROVIDER_VISIBLE_FIELDS) {
      if (mentions(String(spec[field]), term)) violations.push({ term, field });
    }
    for (let index = 0; index < spec.motifs.length; index += 1) {
      if (mentions(spec.motifs[index], term)) violations.push({ term, field: `motifs[${index}]` });
    }
  }
  return violations;
}

/**
 * Hard gate. Throws rather than sanitising, because silently editing a prompt
 * would hide a resolver defect — and the deterministic floor can always serve
 * this request instead. Call immediately before any provider dispatch.
 */
export function assertProviderSafe(spec: ThemeSpec): void {
  const violations = providerSafetyViolations(spec);
  if (violations.length === 0) return;
  const detail = violations.map((v) => `${v.term} in ${v.field}`).join("; ");
  throw new Error(`ThemeSpec is not provider-safe: ${detail}`);
}

/**
 * A request that named a protected property must never also request a
 * character rendering. This is a policy invariant, not a heuristic.
 */
export function subjectPolicyIsConsistent(spec: ThemeSpec): boolean {
  if (spec.protectedTerms.length === 0) return true;
  return spec.subjectPolicy !== "original-character";
}

/* ── Prompt construction ─────────────────────────────────────────────── */

/**
 * The artwork prompt. Built only from unprotected spec fields, so the provider
 * never sees a property name — which removes the moderation-refusal failure
 * mode observed on Frozen at both providers, not merely reduces it.
 *
 * Callers MUST call `assertProviderSafe` first.
 */
export function artworkPromptForSpec(spec: ThemeSpec): string {
  const subject =
    spec.subjectPolicy === "none"
      ? "No people or characters. Scene, setting and decorative motifs only."
      : spec.subjectPolicy === "original-character"
        ? "Original, non-derivative figures only, described generically."
        : "Use the supplied host reference image for the figure.";
  return [
    `${spec.medium} illustration. ${spec.mood}.`,
    `Setting: ${spec.setting}`,
    `Motifs: ${spec.motifs.join(", ")}.`,
    `Palette: ${spec.palette.ink}, ${spec.palette.accent}, ${spec.palette.surface}, ${spec.palette.body}.`,
    subject,
    "Full-bleed artwork. No lettering, text, numerals, signage or logos anywhere.",
  ].join("\n");
}

// ThemeSpec resolver — free-form host text → buildable, rights-clean spec.
// ─────────────────────────────────────────────────────────────────────────
// This is the upgraded output end of the existing named-theme classification.
// `detectNamedCreativeReference` already answers "what property did the host
// name?" reliably. That answer alone routes toward drawing a protected
// character, which is the step both image providers refuse and the step that
// carries commercial exposure.
//
// The resolver answers a different question: "what does this request look
// like, in vocabulary nobody owns?" One cached Haiku call, structured output,
// no retries, then deterministic post-processing that enforces the invariants
// rather than trusting the model to honour them.

import Anthropic from "@anthropic-ai/sdk";
import {
  ART_PLACEMENTS,
  DIVIDER_STYLES,
  OVERLAY_TREATMENTS,
  TEXTURE_STYLES,
  THEME_ART_IDS,
  THEME_OCCASIONS,
  THEME_STYLES,
} from "@shared/themeCatalog";
import { contrastRatio } from "@shared/aiFirstPalette";
import {
  AGE_REGISTERS,
  ARTWORK_MEDIUMS,
  SUBJECT_POLICIES,
  canonicalizeSlug,
  themeSpecSchema,
  type ThemeSpec,
} from "@shared/themeSpec";

export const THEME_SPEC_RESOLVER_MODEL = "claude-haiku-4-5-20251001";

/** Minimum headline-on-surface contrast. Matches the renderer's own floor. */
export const MIN_INK_CONTRAST = 4.5;

export const THEME_SPEC_RESOLVER_SYSTEM = `You translate a party host's free-form request into a Posy ThemeSpec: a design specification built ONLY from vocabulary that no company owns.

Your single most important rule: never carry a protected name, character, logo or distinctive character design into any design field. Instead, express what that property *looks and feels like* using its underlying public vocabulary — real cultural aesthetics, colours, settings, motifs, materials, mood.

Worked examples of the translation you must perform:
- "Moana" -> Polynesian voyaging aesthetic: turquoise ocean, coral sunset, warm sand, outrigger canoe, woven sail, hibiscus, plumeria, palm fronds, tapa-cloth border. Disney owns a character design; Polynesian culture is public.
- "Frozen" -> Nordic winter aesthetic: ice palace, pale blue and silver, snowflake filigree, frosted pine, aurora.
- "Encanto" -> Colombian folk aesthetic: saturated tropical brights, embroidered florals, terracotta, arched courtyard, butterflies.
- "Bluey" -> sunny Australian suburban backyard: cerulean and warm orange, clothesline, gum trees, balloons, paw-print motif. Use NO dog character.
- "Spider-Man" -> bold comic-panel aesthetic: crimson and navy, halftone dots, web-line geometry, city skyline. Use NO costumed figure.

Record every protected name you recognised in protectedTerms. That field is private owner analytics and is never sent to an image provider. It must NOT appear in canonicalSlug, displayName, setting, motifIdeal, mood or motifs.

Some protected titles are also ordinary English words ("Frozen", "Cars", "Brave", "Wicked", "Up"). The egress gate is deliberately literal and will block the word itself, so avoid that exact surface form in every design field and use a synonym instead: "frozen fjord" -> "ice-bound fjord", "brave knight" -> "valiant knight". There is always a synonym; this costs the design nothing.

canonicalSlug is the reuse key: it names the AESTHETIC, not the host's phrasing, so that every phrasing of the same request converges on one slug. "Moana birthday", "Moana party for my 3 year old" and "island Moana theme" must all yield island-voyage-sunset. Lowercase kebab-case.

artId must be the nearest motif the library can already draw, from the allowed list. motifIdeal is free text naming the motif this theme actually wants even when unavailable (e.g. "hibiscus-and-palm"); it is a backlog signal, so be specific and do not just echo artId.

palette carries four semantic roles: ink is headline type, accent is rules and cues, surface is the overlay the type sits on, body is body copy. ink and body must read clearly against surface — aim for strong contrast, and never pick a mid-tone ink on a mid-tone surface.

subjectPolicy must be "none" whenever protectedTerms is non-empty. Use "original-character" only for a generic figure in an entirely original request.

An unfamiliar or strange request is never a failure. Translate it confidently into the closest coherent aesthetic and lower confidence instead.`;

const THEME_SPEC_RESOLVER_FORMAT = {
  type: "json_schema" as const,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      canonicalSlug: { type: "string" },
      displayName: { type: "string" },
      themeStyle: { type: "string", enum: [...THEME_STYLES] },
      occasion: { type: "string", enum: [...THEME_OCCASIONS] },
      palette: {
        type: "object",
        additionalProperties: false,
        properties: {
          ink: { type: "string" },
          accent: { type: "string" },
          surface: { type: "string" },
          body: { type: "string" },
        },
        required: ["ink", "accent", "surface", "body"],
      },
      artId: { type: "string", enum: [...THEME_ART_IDS] },
      artPlacement: { type: "string", enum: [...ART_PLACEMENTS] },
      textureStyle: { type: "string", enum: [...TEXTURE_STYLES] },
      dividerStyle: { type: "string", enum: [...DIVIDER_STYLES] },
      overlayTreatment: { type: "string", enum: [...OVERLAY_TREATMENTS] },
      motifIdeal: { type: "string" },
      setting: { type: "string" },
      motifs: { type: "array", items: { type: "string" } },
      medium: { type: "string", enum: [...ARTWORK_MEDIUMS] },
      mood: { type: "string" },
      ageRegister: { type: "string", enum: [...AGE_REGISTERS] },
      subjectPolicy: { type: "string", enum: [...SUBJECT_POLICIES] },
      protectedTerms: { type: "array", items: { type: "string" } },
      confidence: { type: "number" },
    },
    required: [
      "canonicalSlug", "displayName", "themeStyle", "occasion", "palette",
      "artId", "artPlacement", "textureStyle", "dividerStyle", "overlayTreatment",
      "motifIdeal", "setting", "motifs", "medium", "mood", "ageRegister",
      "subjectPolicy", "protectedTerms", "confidence",
    ],
  },
};

export interface ThemeSpecResolverDependencies {
  client?: Anthropic;
  signal?: AbortSignal;
}

/* ── Deterministic repairs ───────────────────────────────────────────── */

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function shiftHex(hex: string, amount: number): string {
  const n = hex.replace("#", "");
  const parts = [0, 2, 4].map((i) => clampChannel(parseInt(n.slice(i, i + 2), 16) + amount));
  return `#${parts.map((p) => p.toString(16).padStart(2, "0")).join("")}`;
}

/**
 * Walk a role colour away from the surface until it reads. Deterministic and
 * bounded: the resolver's taste is preserved where it is already legible, and
 * a mid-tone-on-mid-tone choice is repaired rather than rejected. A request
 * must never fail for a contrast reason the software can fix itself.
 */
export function ensureLegible(role: string, surface: string, minimum = MIN_INK_CONTRAST): string {
  if (contrastRatio(role, surface) >= minimum) return role;
  const surfaceIsLight = contrastRatio(surface, "#000000") > contrastRatio(surface, "#ffffff");
  const direction = surfaceIsLight ? -12 : 12;
  let candidate = role;
  for (let step = 0; step < 21; step += 1) {
    candidate = shiftHex(candidate, direction);
    if (contrastRatio(candidate, surface) >= minimum) return candidate;
  }
  return surfaceIsLight ? "#111111" : "#f5f5f5";
}

/**
 * Enforce the spec's invariants in code rather than trusting the model:
 * canonical slug form, the protected-property subject-policy rule, and
 * palette legibility. Returns a spec that is safe to render.
 */
export function normalizeThemeSpec(spec: ThemeSpec): ThemeSpec {
  const surface = spec.palette.surface;
  return {
    ...spec,
    canonicalSlug: canonicalizeSlug(spec.canonicalSlug),
    subjectPolicy: spec.protectedTerms.length > 0 && spec.subjectPolicy === "original-character"
      ? "none"
      : spec.subjectPolicy,
    palette: {
      ...spec.palette,
      ink: ensureLegible(spec.palette.ink, surface),
      body: ensureLegible(spec.palette.body, surface),
    },
  };
}

/* ── Resolver ────────────────────────────────────────────────────────── */

export interface ThemeSpecResolution {
  spec: ThemeSpec;
  durationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
}

function extractJsonObject(raw: string): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * One physical request, no SDK retries, structured output. Throws on an
 * incomplete or invalid classification — an unavailable resolver must not be
 * mistaken for "this host wanted a plain card", and the caller can always fall
 * back to the deterministic catalog floor.
 */
export async function resolveThemeSpec(
  hostText: string,
  dependencies: ThemeSpecResolverDependencies = {},
): Promise<ThemeSpecResolution> {
  const text = hostText.trim();
  if (!text) throw new Error("Cannot resolve a ThemeSpec from empty host text");

  const client = dependencies.client
    ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const startedAt = Date.now();
  const response = await client.messages.create(
    {
      model: THEME_SPEC_RESOLVER_MODEL,
      max_tokens: 1200,
      system: THEME_SPEC_RESOLVER_SYSTEM,
      output_config: { format: THEME_SPEC_RESOLVER_FORMAT },
      messages: [{ role: "user", content: text }],
    },
    { signal: dependencies.signal, maxRetries: 0 },
  );

  if (response.stop_reason === "max_tokens" || response.stop_reason === "refusal") {
    throw new Error(`ThemeSpec resolution did not complete (${response.stop_reason})`);
  }

  const raw = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  const parsed = themeSpecSchema.safeParse(extractJsonObject(raw));
  if (!parsed.success) {
    throw new Error(`ThemeSpec resolution returned an invalid spec: ${parsed.error.message}`);
  }

  return {
    spec: normalizeThemeSpec(parsed.data),
    durationMs: Date.now() - startedAt,
    inputTokens: response.usage?.input_tokens ?? null,
    outputTokens: response.usage?.output_tokens ?? null,
  };
}

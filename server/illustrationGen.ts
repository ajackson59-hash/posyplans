import type { InviteDesignConcept, ArtDirection } from "@shared/inviteDesign";
import Anthropic from "@anthropic-ai/sdk";

// Generates the bounded, text-free decorative illustration for an applied
// Invitation Intelligence design concept, by calling OpenAI's image
// generation API directly over HTTPS. Requires OPENAI_API_KEY to be set in
// the environment (Vercel production env vars). This intentionally does not
// use the OpenAI SDK — a plain fetch() keeps the dependency footprint small
// and avoids any SDK version drift, since this is a single, simple request.

// Builds a rich, professional image generation prompt from the concept's
// artDirection + illustrationPrompt. This gives the image model real design
// intent instead of a loose text summary.
//
// The prompt is structured as a professional art brief with quality modifiers
// that steer the image model toward premium, clean illustration — not
// generic clipart or muddy AI art.
export function buildIllustrationPrompt(concept: InviteDesignConcept): string {
  const ad = concept.artDirection;
  if (!ad) {
    // Backward compatibility: fall back to the raw illustrationPrompt
    return concept.illustrationPrompt;
  }

  // Professional quality modifiers that apply to ALL illustrations
  const QUALITY_MODIFIERS = "professional illustration, high quality, elegant, sophisticated, premium stationery quality, clean composition, intentional design, print-ready decorative illustration, not AI-looking, no clipart, no stock photo look, no amateur art, no watermark, no fake text, no stock icon";

  // Style reference per illustration medium — gives the image model a
  // recognizable quality benchmark to aim for.
  const STYLE_REFERENCES: Record<string, string> = {
    watercolor: "in the style of fine editorial watercolor illustration",
    "editorial illustration": "in the style of high-end magazine editorial illustration",
    "fine line art": "in the style of delicate botanical line art",
    "botanical illustration": "in the style of vintage botanical scientific illustration",
    "flat vector illustration": "in the style of modern flat design illustration",
    "cartoon illustration": "in the style of polished character illustration",
    "character illustration": "in the style of polished character illustration",
    "sticker art": "in the style of modern sticker design",
    "flat graphic design": "in the style of bold contemporary graphic design",
    "geometric illustration": "in the style of modern geometric art",
    "typographic art": "in the style of abstract typographic art",
    "abstract geometric": "in the style of modern abstract geometric art",
    "minimal line art": "in the style of elegant minimal line illustration",
    "single-element botanical": "in the style of minimal botanical illustration",
    "monoline illustration": "in the style of clean monoline illustration",
    gouache: "in the style of warm gouache storybook illustration",
    "colored pencil": "in the style of textured colored pencil illustration",
    "papercut illustration": "in the style of layered papercut art",
    linocut: "in the style of bold linocut print",
    papercut: "in the style of layered papercut art",
    woodcut: "in the style of traditional woodcut print",
    "hand-drawn illustration": "in the style of warm hand-drawn illustration",
  };

  const styleRef = STYLE_REFERENCES[ad.illustrationMedium.toLowerCase()] || "in the style of professional illustration";

  // Build the prompt as a flowing art brief, not a field concatenation
  const parts = [
    `${ad.illustrationMedium} illustration`,
    ad.subjectFocus,
    `${ad.compositionType}`,
    `with ${ad.negativeSpace} negative space`,
    `${ad.colorTreatment}`,
    `${ad.texture}`,
    styleRef,
    QUALITY_MODIFIERS,
    concept.illustrationPrompt, // includes the "no text" guardrail from the LLM
    ad.avoidList,
  ].filter(Boolean);

  return parts.join(". ");
}

export async function generateInviteIllustration(
  concept: InviteDesignConcept,
  aspectRatio: "16:9" | "1:1" | "9:16",
  quality: "high" | "medium" | "low" = "high",
): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured — illustration generation is unavailable.");
  }

  // gpt-image-1 accepts these exact size strings. Portrait (1024x1536) is
  // used for "full-bleed" layouts where the illustration fills a vertical card.
  const size =
    aspectRatio === "16:9" ? "1536x1024" : aspectRatio === "9:16" ? "1024x1536" : "1024x1024";

  const prompt = buildIllustrationPrompt(concept);

  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-image-1",
      prompt,
      size,
      quality,
      n: 1,
      // Request opaque background so the PNG has a proper (non-transparent)
      // alpha channel. Without this, gpt-image-1 can return PNGs with
      // alpha=0 everywhere, making the illustration invisible on the page
      // even though the RGB data is present.
      background: "opaque",
    }),
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`OpenAI image generation failed (${response.status}): ${errorBody.slice(0, 500)}`);
  }

  const data = (await response.json()) as { data?: Array<{ b64_json?: string }> };
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) {
    throw new Error("OpenAI image generation returned no image data");
  }

  return `data:image/png;base64,${b64}`;
}

// ── Art Quality Gate ───────────────────────────────────────────────────
//
// After generating an illustration, uses Claude's vision capability to evaluate
// the artwork against 4 criteria: no garbled text, composition clarity, premium
// feel, and theme fit. If the illustration scores poorly, it auto-regenerates
// once with a tightened prompt. This catches the most common AI art failures
// (illegible text artifacts, muddy composition, generic clipart look) before
// the host sees them.

const ART_CRITIC_SYSTEM = `You are an art director evaluating AI-generated party invitation illustrations. You will be shown an image and asked to score it. Be strict but fair — these illustrations appear on invitations that hosts send to their guests.

Evaluate on 4 criteria, each 1-5:
1. text_free: No garbled text, letters, numbers, or fake writing in the image. Score 1 if any text-like artifacts appear, 5 if completely text-free.
2. composition: Is the composition clear, balanced, and intentional? Score 1 for muddy or cluttered composition, 5 for clear, well-balanced layout.
3. premium_feel: Does this look like premium, professional illustration — not cheap clipart? Score 1 for generic/clipart-like, 5 for premium quality.
4. theme_fit: Does the illustration match the ORIGINAL HOST BRIEF as well as the described concept? Score 1 for irrelevant, 5 for perfect match. When an original host brief is supplied, it is authoritative: if the generated concept drifted, grade against the host brief, not the weaker concept. A generic category resemblance is not enough for a named show, film, game, character universe or cultural reference. Missing a defining requested character, setting or activity—or replacing the requested scene with abstract symbols—must score 2 or lower.

Respond as STRICT JSON only: {"text_free": N, "composition": N, "premium_feel": N, "theme_fit": N, "overall": N, "issues": "brief description of any problems, or 'none'"}
The overall score should be the average of the 4 criteria.`;

export interface ArtQualityScore {
  text_free: number;
  composition: number;
  premium_feel: number;
  theme_fit: number;
  overall: number;
  issues: string;
}

async function evaluateIllustrationQuality(
  imageDataUrl: string,
  concept: InviteDesignConcept,
  sourceBrief?: string,
): Promise<ArtQualityScore> {
  const client = new Anthropic();
  const laneLabel = concept.styleLaneId ?? "unknown";
  const authoritativeBrief = sourceBrief
    ? ` Original host brief (authoritative): ${sourceBrief}`
    : "";
  const prompt = `Evaluate this invitation illustration for a "${concept.conceptName}" concept in the "${laneLabel}" style lane. The illustration should depict: ${concept.illustrationPrompt}.${authoritativeBrief}`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 300,
    system: ART_CRITIC_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/png", data: imageDataUrl.split(",")[1] },
          },
          { type: "text", text: prompt },
        ],
      },
    ],
  });

  const block = message.content.find((c) => c.type === "text");
  const raw = block && "text" in block ? block.text : "";
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return { text_free: 3, composition: 3, premium_feel: 3, theme_fit: 3, overall: 3, issues: "evaluation failed" };
  }
  try {
    return JSON.parse(jsonMatch[0]) as ArtQualityScore;
  } catch {
    return { text_free: 3, composition: 3, premium_feel: 3, theme_fit: 3, overall: 3, issues: "evaluation failed" };
  }
}

// Minimum quality threshold — if overall score is below this, regenerate.
const QUALITY_THRESHOLD = 3.0;
// Critical: if text artifacts are detected (score <= 2), always regenerate.
const TEXT_FAILURE_THRESHOLD = 2;
// Theme fidelity is independently launch-critical. A polished image can score
// well overall while still collapsing a named reference into a generic category
// (for example, a specific unicorn world becoming simply "a unicorn").
const THEME_FIDELITY_FAILURE_THRESHOLD = 3;

/**
 * Builds a tightened illustration prompt by appending the art critic's
 * specific issues as stronger negative/positive constraints. Instead of
 * regenerating with the exact same prompt and hoping for variance, this
 * addresses the exact failure the critic identified.
 */
export function tightenIllustrationPrompt(originalPrompt: string, score: ArtQualityScore): string {
  const fixes: string[] = [];

  if (score.text_free <= TEXT_FAILURE_THRESHOLD) {
    fixes.push("absolutely no text, no letters, no numbers, no fake writing, no garbled characters anywhere in the image");
  }
  if (score.composition <= 3) {
    fixes.push("clean balanced composition with clear focal point, generous negative space, no cluttered or muddy layout");
  }
  if (score.premium_feel <= 3) {
    fixes.push("premium professional stationery illustration quality, polished and refined, not generic clipart or stock icon look, sophisticated color palette");
  }
  if (score.theme_fit <= THEME_FIDELITY_FAILURE_THRESHOLD) {
    fixes.push("closely match the specifically requested concept rather than a generic category; carry the distinctive visual cues, world-building, palette, atmosphere, motifs, and character/world signals described by the concept so a fan would immediately understand the intended reference");
  }

  // If the critic didn't flag anything specific (edge case), add general polish
  if (fixes.length === 0) {
    fixes.push("refined professional illustration with cleaner composition and higher polish");
  }

  // The critic often identifies the exact missing character, setting cue, or
  // accidental text. Preserve those concrete findings instead of retrying with
  // only a generic “be more faithful” instruction.
  const specificIssues = score.issues?.trim()
    ? `ART DIRECTOR'S SPECIFIC CORRECTIONS: ${score.issues.trim().slice(0, 800)}`
    : "";

  return `${originalPrompt}. CRITICAL IMPROVEMENTS: ${fixes.join(". ")}${specificIssues ? `. ${specificIssues}` : ""}`;
}

export interface IllustrationQualityOptions {
  /** Original intake wording; authoritative when a concept or image drifts. */
  sourceBrief?: string;
  /** Conversion previews use medium for speed; paid artwork remains high by default. */
  generationQuality?: "high" | "medium" | "low";
  /** Reject the final image rather than exposing unchecked or off-brief artwork. */
  requireFinalApproval?: boolean;
}

function qualityFailed(score: ArtQualityScore, strict: boolean): boolean {
  const baselineFailure =
    score.text_free <= TEXT_FAILURE_THRESHOLD
    || score.overall < QUALITY_THRESHOLD
    || score.theme_fit <= THEME_FIDELITY_FAILURE_THRESHOLD;
  if (!strict) return baselineFailure;
  return baselineFailure
    || score.overall < 3.6
    || score.theme_fit < 4
    || score.composition < 3
    || score.premium_feel < 3;
}

export async function generateInviteIllustrationWithQualityGate(
  concept: InviteDesignConcept,
  aspectRatio: "16:9" | "1:1" | "9:16",
  options: IllustrationQualityOptions = {},
): Promise<string> {
  const generationQuality = options.generationQuality ?? "high";
  const strict = options.requireFinalApproval === true;
  let illustrationUrl = await generateInviteIllustration(
    concept,
    aspectRatio,
    generationQuality,
  );

  try {
    let score = await evaluateIllustrationQuality(
      illustrationUrl,
      concept,
      options.sourceBrief,
    );

    if (qualityFailed(score, strict)) {
      console.log(`[quality-gate] Illustration scored ${score.overall.toFixed(1)} / theme ${score.theme_fit} (${score.issues}). Regenerating with tightened prompt...`);
      const tightenedConcept: InviteDesignConcept = {
        ...concept,
        illustrationPrompt: `${tightenIllustrationPrompt(concept.illustrationPrompt, score)}. ORIGINAL HOST BRIEF REMAINS AUTHORITATIVE: ${options.sourceBrief || concept.description}. Show the literal requested people, characters, setting and activities as the main scene; never substitute an abstract accessory, bow tie, dots, color blocking or palette-only shorthand.`,
      };
      illustrationUrl = await generateInviteIllustration(
        tightenedConcept,
        aspectRatio,
        generationQuality,
      );

      if (strict) {
        score = await evaluateIllustrationQuality(
          illustrationUrl,
          tightenedConcept,
          options.sourceBrief,
        );
        if (qualityFailed(score, true)) {
          console.error(`[quality-gate] Final preview artwork rejected: overall ${score.overall.toFixed(1)}, theme ${score.theme_fit} (${score.issues})`);
          throw new Error("Generated preview artwork did not faithfully match the host brief");
        }
      }
    }
  } catch (err) {
    if (strict) throw err;
    // Existing paid/legacy callers preserve their graceful-degradation
    // behavior if the optional critic is unavailable.
    console.error("[quality-gate] Evaluation failed, using first generation:", err);
  }

  return illustrationUrl;
}

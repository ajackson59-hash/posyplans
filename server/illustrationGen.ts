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
  const QUALITY_MODIFIERS = "professional illustration, high quality, clean composition, intentional design, no clipart, no stock photo look";

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
      quality: "high",
      n: 1,
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
4. theme_fit: Does the illustration match the described concept? Score 1 for irrelevant, 5 for perfect match.

Respond as STRICT JSON only: {"text_free": N, "composition": N, "premium_feel": N, "theme_fit": N, "overall": N, "issues": "brief description of any problems, or 'none'"}
The overall score should be the average of the 4 criteria.`;

interface ArtQualityScore {
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
): Promise<ArtQualityScore> {
  const client = new Anthropic();
  const laneLabel = concept.styleLaneId ?? "unknown";
  const prompt = `Evaluate this invitation illustration for a "${concept.conceptName}" concept in the "${laneLabel}" style lane. The illustration should depict: ${concept.illustrationPrompt}`;

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

export async function generateInviteIllustrationWithQualityGate(
  concept: InviteDesignConcept,
  aspectRatio: "16:9" | "1:1" | "9:16",
): Promise<string> {
  // First generation
  let illustrationUrl = await generateInviteIllustration(concept, aspectRatio);

  // Evaluate quality
  try {
    const score = await evaluateIllustrationQuality(illustrationUrl, concept);
    const hasTextArtifacts = score.text_free <= TEXT_FAILURE_THRESHOLD;
    const belowThreshold = score.overall < QUALITY_THRESHOLD;

    if (hasTextArtifacts || belowThreshold) {
      console.log(`[quality-gate] Illustration scored ${score.overall.toFixed(1)} (${score.issues}). Regenerating...`);
      // Regenerate once with the same prompt (the image model has randomness)
      illustrationUrl = await generateInviteIllustration(concept, aspectRatio);

      // Optionally evaluate the second attempt too — but to keep costs reasonable,
      // we accept the second generation regardless. One regeneration is enough.
    }
  } catch (err) {
    // If the quality evaluation fails (e.g., API error), use the first generation.
    // Better to show something than nothing.
    console.error("[quality-gate] Evaluation failed, using first generation:", err);
  }

  return illustrationUrl;
}

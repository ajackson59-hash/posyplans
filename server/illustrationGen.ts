import type { InviteDesignConcept, ArtDirection } from "@shared/inviteDesign";

// Generates the bounded, text-free decorative illustration for an applied
// Invitation Intelligence design concept, by calling OpenAI's image
// generation API directly over HTTPS. Requires OPENAI_API_KEY to be set in
// the environment (Vercel production env vars). This intentionally does not
// use the OpenAI SDK — a plain fetch() keeps the dependency footprint small
// and avoids any SDK version drift, since this is a single, simple request.

// Builds a rich, structured image generation prompt from the concept's
// artDirection + illustrationPrompt. This gives the image model real design
// intent instead of a loose text summary.
export function buildIllustrationPrompt(concept: InviteDesignConcept): string {
  const ad = concept.artDirection;
  if (!ad) {
    // Backward compatibility: fall back to the raw illustrationPrompt
    return concept.illustrationPrompt;
  }

  const parts = [
    `${ad.illustrationMedium} illustration`,
    ad.subjectFocus,
    `Composition: ${ad.compositionType}`,
    `Negative space: ${ad.negativeSpace}`,
    `Color treatment: ${ad.colorTreatment}`,
    `Texture: ${ad.texture}`,
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

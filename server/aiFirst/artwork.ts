// Artwork generation for the AI-first pipeline.
//
// Same provider and endpoint shape as illustrationGen.ts, over a plain fetch.
// The server selects a supported image model explicitly and records it with
// the result. What differs from the older path is the input: this path
// already holds a finished art brief plus the two guardrails the server
// appends verbatim, so there is no prompt assembly to do here and no
// InviteDesignConcept to route through.
//
// Returns raw bytes as well as the data URI, because the quality gate reads
// pixels and the preview store hashes bytes. Re-decoding a base64 string in
// three places would be the same work done three times.

export type ArtworkModel = "gpt-image-1" | "gpt-image-2";
export type ArtworkQuality = "high" | "medium" | "low";
export type ArtworkAspectRatio = "16:9" | "1:1" | "9:16";
export type ArtworkSize = "1536x1024" | "1024x1024" | "1024x1536";

export interface ArtworkRequest {
  prompt: string;
  aspectRatio: ArtworkAspectRatio;
  model?: ArtworkModel;
  quality?: ArtworkQuality;
  signal?: AbortSignal;
}

export interface ArtworkResult {
  bytes: Buffer;
  dataUrl: string;
  durationMs: number;
}

const SIZE_FOR_ASPECT: Record<ArtworkAspectRatio, ArtworkSize> = {
  "16:9": "1536x1024",
  "1:1": "1024x1024",
  "9:16": "1024x1536",
};

/** OpenAI image output pricing, in USD micros, effective 2026-08-03. */
const IMAGE_COST_USD_MICROS: Record<ArtworkModel, Record<ArtworkQuality, Record<ArtworkSize, number>>> = {
  "gpt-image-1": {
    low: { "1024x1024": 11_000, "1024x1536": 16_000, "1536x1024": 16_000 },
    medium: { "1024x1024": 42_000, "1024x1536": 63_000, "1536x1024": 63_000 },
    high: { "1024x1024": 167_000, "1024x1536": 250_000, "1536x1024": 250_000 },
  },
  "gpt-image-2": {
    low: { "1024x1024": 6_000, "1024x1536": 5_000, "1536x1024": 5_000 },
    medium: { "1024x1024": 53_000, "1024x1536": 41_000, "1536x1024": 41_000 },
    high: { "1024x1024": 211_000, "1024x1536": 165_000, "1536x1024": 165_000 },
  },
};

export function sizeForAspect(aspectRatio: ArtworkAspectRatio): ArtworkSize {
  return SIZE_FOR_ASPECT[aspectRatio];
}

export function estimateImageCostUsdMicros(
  model: ArtworkModel,
  quality: ArtworkQuality,
  size: ArtworkSize,
): number {
  return IMAGE_COST_USD_MICROS[model][quality][size];
}

export type ArtworkGenerator = (request: ArtworkRequest) => Promise<ArtworkResult>;

export async function generateArtwork(request: ArtworkRequest): Promise<ArtworkResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured — illustration generation is unavailable.");
  }
  const started = Date.now();
  const model = request.model ?? "gpt-image-1";

  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      prompt: request.prompt,
      size: sizeForAspect(request.aspectRatio),
      quality: request.quality ?? "high",
      n: 1,
      // Without this an image model can return a fully transparent alpha
      // channel, which composites to an invisible card.
      background: "opaque",
    }),
    signal: request.signal,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`${model} request failed (${response.status}): ${body.slice(0, 300)}`);
  }

  const data = (await response.json()) as { data?: { b64_json?: string }[] };
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error(`${model} returned no image data`);

  return {
    bytes: Buffer.from(b64, "base64"),
    dataUrl: `data:image/png;base64,${b64}`,
    durationMs: Date.now() - started,
  };
}

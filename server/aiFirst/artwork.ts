// Artwork generation for the AI-first pipeline.
//
// Same provider, same model, same endpoint shape as illustrationGen.ts —
// gpt-image-1 over a plain fetch. What differs is the input: this path
// already holds a finished art brief plus the two guardrails the server
// appends verbatim, so there is no prompt assembly to do here and no
// InviteDesignConcept to route through.
//
// Returns raw bytes as well as the data URI, because the quality gate reads
// pixels and the preview store hashes bytes. Re-decoding a base64 string in
// three places would be the same work done three times.

export interface ArtworkRequest {
  prompt: string;
  aspectRatio: "16:9" | "1:1" | "9:16";
  quality?: "high" | "medium" | "low";
  signal?: AbortSignal;
}

export interface ArtworkResult {
  bytes: Buffer;
  dataUrl: string;
  durationMs: number;
}

const SIZE_FOR_ASPECT: Record<ArtworkRequest["aspectRatio"], string> = {
  "16:9": "1536x1024",
  "1:1": "1024x1024",
  "9:16": "1024x1536",
};

export type ArtworkGenerator = (request: ArtworkRequest) => Promise<ArtworkResult>;

export async function generateArtwork(request: ArtworkRequest): Promise<ArtworkResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured — illustration generation is unavailable.");
  }
  const started = Date.now();

  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-image-1",
      prompt: request.prompt,
      size: SIZE_FOR_ASPECT[request.aspectRatio],
      quality: request.quality ?? "high",
      n: 1,
      // Without this gpt-image-1 can return a fully transparent alpha
      // channel, which composites to an invisible card.
      background: "opaque",
    }),
    signal: request.signal,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`gpt-image-1 request failed (${response.status}): ${body.slice(0, 300)}`);
  }

  const data = (await response.json()) as { data?: { b64_json?: string }[] };
  const b64 = data.data?.[0]?.b64_json;
  if (!b64) throw new Error("gpt-image-1 returned no image data");

  return {
    bytes: Buffer.from(b64, "base64"),
    dataUrl: `data:image/png;base64,${b64}`,
    durationMs: Date.now() - started,
  };
}

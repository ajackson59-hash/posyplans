// Direct Gemini Interactions API adapter. One dispatch, no fallback, no retries.
// Contract: https://ai.google.dev/api/interactions-api (verified 2026-09-09).
import { createHash } from "node:crypto";
import { decode as decodeJpeg } from "jpeg-js";
import { decodePng, encodePng, readPngSize } from "./png";
import {
  GOOGLE_ARTWORK_MODEL, ArtworkProviderError, ArtworkNormalizationError, sizeForAspect,
  type ArtworkRequest, type ArtworkResult,
} from "./artwork";

type GoogleUsage = NonNullable<NonNullable<ArtworkResult["telemetry"]>["google"]>["usage"];
function usageEvidence(value: unknown): GoogleUsage {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const result: NonNullable<GoogleUsage> = {};
  const count = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
  for (const key of ["total_input_tokens", "total_output_tokens", "total_thought_tokens",
    "total_cached_tokens", "total_tool_use_tokens", "total_tokens"]) {
    if (count(source[key])) result[key] = source[key];
  }
  for (const key of ["input_tokens_by_modality", "output_tokens_by_modality"]) {
    const items = source[key];
    if (Array.isArray(items) && items.every(v => v && ["text", "image", "audio", "video"].includes(v.modality) && count(v.tokens))) {
      result[key] = items.map(v => ({ modality: v.modality, tokens: v.tokens }));
    }
  }
  return Object.keys(result).length ? result : null;
}

export function googleArtworkConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY?.trim());
}

export async function generateGoogleArtwork(request: ArtworkRequest): Promise<ArtworkResult> {
  if (request.model !== GOOGLE_ARTWORK_MODEL) throw new Error("Unsupported Google artwork model");
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) throw new Error("GEMINI_API_KEY is not configured");
  if (request.maxTransientRetries === 1) throw new Error("Google artwork does not permit retries");
  if ((request.referenceImages?.length ?? 0) > 14) throw new Error("Too many Google image references");
  request.signal?.throwIfAborted();
  const signal = request.signal ?? AbortSignal.timeout(120_000);
  const size = sizeForAspect(request.aspectRatio, GOOGLE_ARTWORK_MODEL);
  const started = Date.now();
  const safeIdentifier = (value: unknown): string | null =>
    typeof value === "string" && /^[A-Za-z0-9_.:-]{1,200}$/.test(value) ? value : null;
  const failure = (status: number, code: string | null, requestId: string | null) => new ArtworkProviderError({
    model: GOOGLE_ARTWORK_MODEL, quality: request.quality ?? "medium", size,
    status, code, type: "google_image_error", requestId,
    moderationStage: "unknown", moderationCategories: [], outputFormat: request.outputFormat ?? "jpeg",
    operation: request.referenceImages?.length ? "edit" : "request", providerRequestCount: 1,
    providerDurationMs: Date.now() - started, promptSha256: createHash("sha256").update(request.prompt).digest("hex"),
  });
  let response: Response;
  try {
    response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey }, signal,
      body: JSON.stringify({
        model: GOOGLE_ARTWORK_MODEL,
        input: [{ type: "text", text: request.prompt }, ...(request.referenceImages ?? []).map(ref => ({
          type: "image", mime_type: ref.mimeType, data: ref.bytes.toString("base64"),
        }))],
        response_format: { type: "image", mime_type: request.outputFormat === "png" ? "image/png" : "image/jpeg",
          aspect_ratio: request.aspectRatio, image_size: "1K" },
        // Posy retains its own approved source for subsequent edits.
        store: false, stream: false,
      }),
    });
  } catch {
    throw failure(0, signal.aborted ? "request_aborted" : "transport_error", null);
  }
  const requestId = safeIdentifier(response.headers.get("x-request-id"));
  let body: any;
  try { body = await response.json(); } catch { throw failure(response.status, "invalid_json", requestId); }
  if (!response.ok) throw failure(response.status, safeIdentifier(body?.error?.status) ?? "http_error", requestId);
  // Only final model output counts. Thought summaries may contain unbilled
  // intermediate images and must never become the customer source.
  const images = Array.isArray(body.steps) ? body.steps
    .filter((step: any) => step?.type === "model_output" && Array.isArray(step.content))
    .flatMap((step: any) => step.content).filter((part: any) => part?.type === "image") : [];
  if (body.status !== "completed" || images.length !== 1 || typeof images[0].data !== "string") {
    throw failure(response.status, body.status !== "completed" ? "interaction_not_completed" : "missing_single_image", requestId);
  }
  const output = images[0];
  if (!["image/jpeg", "image/png"].includes(output.mime_type) || output.data.length > 24_000_000 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(output.data)) throw failure(response.status, "invalid_image_payload", requestId);
  const raw = Buffer.from(output.data, "base64");
  const normalizationStarted = Date.now();
  const telemetry: NonNullable<ArtworkResult["telemetry"]> = {
    outputFormat: output.mime_type === "image/jpeg" ? "jpeg" : "png", providerRequestCount: 1,
    providerDurationMs: normalizationStarted - started, normalizationDurationMs: 0,
    google: { model: GOOGLE_ARTWORK_MODEL, interactionId: safeIdentifier(body.id), imageSize: "1K",
      aspectRatio: request.aspectRatio, size, usage: usageEvidence(body.usage) },
  };
  let bytes: Buffer;
  try {
    const [width, height] = size.split("x").map(Number);
    if (output.mime_type === "image/png") {
      const header = readPngSize(raw);
      if (header?.width !== width || header.height !== height) throw new Error("Unexpected PNG dimensions");
    }
    const decoded = output.mime_type === "image/jpeg"
      ? decodeJpeg(raw, { useTArray: true, formatAsRGBA: false, tolerantDecoding: false, maxResolutionInMP: 2, maxMemoryUsageInMB: 64 })
      : decodePng(raw);
    if (decoded.width !== width || decoded.height !== height) throw new Error("Unexpected image dimensions");
    bytes = output.mime_type === "image/png" ? raw : encodePng({ width, height, rgb: (decoded as ReturnType<typeof decodeJpeg>).data });
  } catch {
    telemetry.normalizationDurationMs = Date.now() - normalizationStarted;
    throw new ArtworkNormalizationError("Google image normalization failed", {
      bytes: raw, dataUrl: `data:${output.mime_type};base64,${output.data}`, durationMs: Date.now() - started, telemetry,
    });
  }
  telemetry.normalizationDurationMs = Date.now() - normalizationStarted;
  return { bytes, dataUrl: `data:image/png;base64,${bytes.toString("base64")}`, durationMs: Date.now() - started, telemetry };
}

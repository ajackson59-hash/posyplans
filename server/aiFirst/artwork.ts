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

import { decode as decodeJpeg } from "jpeg-js";
import { createHash } from "node:crypto";
import { encodePng } from "./png";

export type ArtworkModel = "gpt-image-1" | "gpt-image-1.5" | "gpt-image-2";
/** Current quality-first default for text-only generation. */
export const DEFAULT_ARTWORK_MODEL: ArtworkModel = "gpt-image-2";
/**
 * Reference-led edits use the model whose live image-edits API accepts the
 * explicit high input-fidelity control. GPT Image 2 remains the default for
 * non-reference generation.
 */
export const REFERENCE_ARTWORK_MODEL: ArtworkModel = "gpt-image-1.5";
export type ArtworkQuality = "high" | "medium" | "low";
export type ArtworkAspectRatio = "16:9" | "1:1" | "9:16";
export type ArtworkSize = "1536x1024" | "1024x1024" | "1024x1536";
export type ArtworkReferenceMimeType = "image/png" | "image/jpeg" | "image/webp";
export type ArtworkInputFidelity = "high" | "low";

export interface ArtworkReferenceImage {
  bytes: Buffer;
  mimeType: ArtworkReferenceMimeType;
  filename?: string;
}

export interface ArtworkRequest {
  prompt: string;
  aspectRatio: ArtworkAspectRatio;
  model?: ArtworkModel;
  quality?: ArtworkQuality;
  /** Provider transport only; returned bytes are always full-resolution PNG. */
  outputFormat?: "png" | "jpeg";
  /**
   * High-fidelity visual references for named characters or entertainment
   * worlds. When present, the provider's image-edits endpoint generates a new
   * composition from these pixels rather than reducing them to text alone.
   */
  referenceImages?: ArtworkReferenceImage[];
  /**
   * Fidelity of an image-edit request to the supplied source pixels. Callers
   * must choose this explicitly because provider support differs by model.
   */
  inputFidelity?: ArtworkInputFidelity;
  signal?: AbortSignal;
  /** Preview budgets count provider requests, including transient HTTP failures. */
  maxTransientRetries?: 0 | 1;
}

export interface ArtworkResult {
  bytes: Buffer;
  dataUrl: string;
  durationMs: number;
  telemetry?: {
    outputFormat: "png" | "jpeg";
    providerRequestCount: number;
    providerDurationMs: number;
    normalizationDurationMs: number;
  };
}

/** Keep an unreviewable provider response available to private attempt retention. */
export class ArtworkNormalizationError extends Error {
  readonly result!: ArtworkResult;
  constructor(message: string, result: ArtworkResult) {
    super(message);
    this.name = "ArtworkNormalizationError";
    // Logging the error must not dump private image bytes or its data URL.
    Object.defineProperty(this, "result", { value: result });
  }
}

export interface ArtworkProviderDiagnostics {
  status: number;
  code: string | null;
  type: string | null;
  requestId: string | null;
  moderationStage: "input" | "output" | "unknown";
  moderationCategories: string[];
  model: ArtworkModel;
  quality: ArtworkQuality;
  size: ArtworkSize;
  outputFormat: "png" | "jpeg";
  operation: "edit" | "request";
  providerRequestCount: number;
  providerDurationMs: number;
  promptSha256: string;
}

/** Provider messages can echo private prompts. Retain identifiers and coarse
 * diagnostics, never the raw response body, prompt, credentials or image data. */
export class ArtworkProviderError extends Error {
  constructor(readonly diagnostics: ArtworkProviderDiagnostics) {
    super(`${diagnostics.model} ${diagnostics.operation} failed (${diagnostics.status}): ${diagnostics.code ?? diagnostics.type ?? "provider_error"}${diagnostics.requestId ? `; request ${diagnostics.requestId}` : ""}`);
    this.name = "ArtworkProviderError";
  }
}

function providerFailure(
  response: Response, body: string, request: ArtworkRequest,
  context: Pick<ArtworkProviderDiagnostics, "model" | "quality" | "size" | "operation" | "providerRequestCount" | "providerDurationMs">,
): ArtworkProviderError {
  let error: Record<string, any> = {};
  try {
    const parsed = JSON.parse(body);
    if (parsed?.error && typeof parsed.error === "object") error = parsed.error;
  } catch { /* Non-JSON provider failures still have HTTP and request identity. */ }
  const identifier = (value: unknown): string | null =>
    typeof value === "string" && /^[a-z][a-z0-9_]{0,79}$/.test(value) ? value : null;
  const requestId = [response.headers.get("x-request-id"), error.request_id,
    typeof error.message === "string" ? error.message.match(/\breq_[a-zA-Z0-9]{8,128}\b/)?.[0] : null,
  ].find((value) => typeof value === "string" && /^req_[a-zA-Z0-9]{8,128}$/.test(value)) ?? null;
  const details = error.moderation_details;
  const stage = details?.moderation_stage;
  const allowedCategories = new Set(["harassment", "self-harm", "sexual", "violence"]);
  return new ArtworkProviderError({
    ...context, status: response.status, code: identifier(error.code), type: identifier(error.type), requestId,
    moderationStage: stage === "input" || stage === "output" ? stage : "unknown",
    moderationCategories: Array.isArray(details?.categories)
      ? Array.from(new Set<string>(details.categories.filter((value: unknown): value is string => typeof value === "string" && allowedCategories.has(value)))) : [],
    outputFormat: request.outputFormat ?? "png",
    promptSha256: createHash("sha256").update(request.prompt).digest("hex"),
  });
}

const SIZE_FOR_ASPECT: Record<ArtworkAspectRatio, ArtworkSize> = {
  "16:9": "1536x1024",
  "1:1": "1024x1024",
  "9:16": "1024x1536",
};

/** OpenAI image-output pricing, in USD micros. Input tokens are additional. */
const IMAGE_COST_USD_MICROS: Record<ArtworkModel, Record<ArtworkQuality, Record<ArtworkSize, number>>> = {
  "gpt-image-1": {
    low: { "1024x1024": 11_000, "1024x1536": 16_000, "1536x1024": 16_000 },
    medium: { "1024x1024": 42_000, "1024x1536": 63_000, "1536x1024": 63_000 },
    high: { "1024x1024": 167_000, "1024x1536": 250_000, "1536x1024": 250_000 },
  },
  "gpt-image-1.5": {
    low: { "1024x1024": 9_000, "1024x1536": 13_000, "1536x1024": 13_000 },
    medium: { "1024x1024": 34_000, "1024x1536": 50_000, "1536x1024": 50_000 },
    high: { "1024x1024": 133_000, "1024x1536": 200_000, "1536x1024": 200_000 },
  },
  "gpt-image-2": {
    low: { "1024x1024": 6_000, "1024x1536": 5_000, "1536x1024": 5_000 },
    medium: { "1024x1024": 53_000, "1024x1536": 41_000, "1536x1024": 41_000 },
    high: { "1024x1024": 211_000, "1024x1536": 165_000, "1536x1024": 165_000 },
  },
};

const TRANSIENT_STATUS_CODES = new Set([429, 500, 502, 503, 504]);
const MAX_TRANSIENT_RETRIES = 1;
const MAX_RETRY_DELAY_MS = 30_000;
const DEFAULT_RETRY_DELAY_MS = 1_500;

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

function imageEditBody(
  request: ArtworkRequest,
  model: ArtworkModel,
  size: ArtworkSize,
  quality: ArtworkQuality,
): FormData {
  const form = new FormData();
  form.append("model", model);
  form.append("prompt", request.prompt);
  form.append("size", size);
  form.append("quality", quality);
  form.append("n", "1");
  form.append("background", "opaque");
  form.append("output_format", request.outputFormat ?? "png");
  if (request.outputFormat === "jpeg") form.append("output_compression", "100");
  if (request.inputFidelity) {
    form.append("input_fidelity", request.inputFidelity);
  }

  for (let index = 0; index < (request.referenceImages ?? []).length; index += 1) {
    const reference = request.referenceImages![index];
    const extension = reference.mimeType === "image/jpeg"
      ? "jpg"
      : reference.mimeType.split("/")[1];
    const blob = new Blob([new Uint8Array(reference.bytes)], { type: reference.mimeType });
    form.append("image[]", blob, reference.filename || `reference-${index + 1}.${extension}`);
  }

  return form;
}

function requestInit(
  request: ArtworkRequest,
  apiKey: string,
  model: ArtworkModel,
  quality: ArtworkQuality,
  size: ArtworkSize,
  usesReferenceImages: boolean,
): RequestInit {
  return usesReferenceImages
    ? {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        // FormData must be rebuilt for a retry because a request body is
        // single-use once fetch begins consuming it.
        body: imageEditBody(request, model, size, quality),
        signal: request.signal,
      }
    : {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          prompt: request.prompt,
          size,
          quality,
          n: 1,
          // Without this an image model can return a fully transparent alpha
          // channel, which composites to an invisible card.
          background: "opaque",
          output_format: request.outputFormat ?? "png",
          ...(request.outputFormat === "jpeg" ? { output_compression: 100 } : {}),
        }),
        signal: request.signal,
      };
}

function retryDelayMs(response: Response, body: string): number {
  const retryAfter = response.headers.get("retry-after")?.trim();
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(MAX_RETRY_DELAY_MS, Math.ceil(seconds * 1000));
    }
    const timestamp = Date.parse(retryAfter);
    if (Number.isFinite(timestamp)) {
      return Math.min(MAX_RETRY_DELAY_MS, Math.max(0, timestamp - Date.now()));
    }
  }

  const bodyDelay = /try again in\s+([0-9]+(?:\.[0-9]+)?)s/i.exec(body);
  if (bodyDelay) {
    return Math.min(MAX_RETRY_DELAY_MS, Math.ceil(Number(bodyDelay[1]) * 1000));
  }
  return DEFAULT_RETRY_DELAY_MS;
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("Artwork generation was cancelled.");
}

async function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw abortError(signal);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal ? abortError(signal) : new Error("Artwork generation was cancelled."));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export async function generateArtwork(request: ArtworkRequest): Promise<ArtworkResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not configured — illustration generation is unavailable.");
  }
  const started = Date.now();
  const model = request.model ?? DEFAULT_ARTWORK_MODEL;
  const quality = request.quality ?? "high";
  const size = sizeForAspect(request.aspectRatio);
  const usesReferenceImages = (request.referenceImages?.length ?? 0) > 0;
  const endpoint = usesReferenceImages
    ? "https://api.openai.com/v1/images/edits"
    : "https://api.openai.com/v1/images/generations";
  const operation = usesReferenceImages ? "edit" : "request";

  const maxRetries = request.maxTransientRetries ?? MAX_TRANSIENT_RETRIES;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const response = await fetch(
      endpoint,
      requestInit(request, apiKey, model, quality, size, usesReferenceImages),
    );

    if (response.ok) {
      const data = (await response.json()) as { data?: { b64_json?: string }[] };
      const b64 = data.data?.[0]?.b64_json;
      if (!b64) throw new Error(`${model} returned no image data`);

      const providerDurationMs = Date.now() - started;
      const normalizationStarted = Date.now();
      const outputFormat = request.outputFormat ?? "png";
      let bytes = Buffer.from(b64, "base64");
      if (outputFormat === "jpeg") {
        try {
          // Decode once, without resizing or another lossy encoding. The existing
          // PNG review/store paths now see precisely these decoded source pixels.
          // Bound allocation and reject malformed or unexpectedly sized output.
          const decoded = decodeJpeg(bytes, {
            useTArray: true, formatAsRGBA: false, tolerantDecoding: false,
            maxResolutionInMP: 2, maxMemoryUsageInMB: 64,
          });
          const [width, height] = size.split("x").map(Number);
          if (decoded.width !== width || decoded.height !== height) {
            throw new Error(`${model} returned unexpected JPEG dimensions: ${decoded.width}x${decoded.height}; expected ${size}`);
          }
          bytes = encodePng({ width, height, rgb: decoded.data });
        } catch (error) {
          throw new ArtworkNormalizationError(
            `JPEG normalization failed: ${error instanceof Error ? error.message : String(error)}`,
            {
              bytes, dataUrl: `data:image/jpeg;base64,${b64}`, durationMs: Date.now() - started,
              telemetry: { outputFormat, providerRequestCount: attempt + 1, providerDurationMs,
                normalizationDurationMs: Date.now() - normalizationStarted },
            },
          );
        }
      }

      return {
        bytes,
        dataUrl: `data:image/png;base64,${bytes.toString("base64")}`,
        durationMs: Date.now() - started,
        telemetry: {
          outputFormat, providerRequestCount: attempt + 1, providerDurationMs,
          normalizationDurationMs: Date.now() - normalizationStarted,
        },
      };
    }

    const body = await response.text().catch(() => "");
    const failure = providerFailure(response, body, request, {
      model, quality, size, operation, providerRequestCount: attempt + 1,
      providerDurationMs: Date.now() - started,
    });
    console.warn("[ai-first-artwork] provider failure", JSON.stringify(failure.diagnostics));
    const isGenerationRejection = failure.diagnostics.type === "image_generation_user_error"
      || failure.diagnostics.code === "moderation_block" || failure.diagnostics.code === "moderation_blocked";
    if (attempt < maxRetries && TRANSIENT_STATUS_CODES.has(response.status) && !isGenerationRejection) {
      const delayMs = retryDelayMs(response, body);
      console.warn(`[ai-first-artwork] ${model} ${operation} returned ${response.status}; retrying once in ${delayMs}ms`);
      await waitForRetry(delayMs, request.signal);
      continue;
    }

    throw failure;
  }

  throw new Error(`${model} ${operation} failed without a response`);
}

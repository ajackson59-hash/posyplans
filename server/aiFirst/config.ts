import { TARGET_DIRECTION_COUNT } from "@shared/aiFirstStream";
import { DEFAULT_ARTWORK_MODEL, type ArtworkModel } from "./artwork";

export const AI_FIRST_DIRECTION_LIMIT_ENV = "POSY_AI_FIRST_DIRECTION_LIMIT";
export const AI_FIRST_IMAGE_MODEL_ENV = "POSY_AI_FIRST_IMAGE_MODEL";

const SUPPORTED_ARTWORK_MODELS = new Set<ArtworkModel>(["gpt-image-1", "gpt-image-2"]);

/**
 * Preview can deliberately request a smaller proof without changing the
 * four-direction product default. Invalid values fail closed to the normal
 * product count rather than accidentally widening spend.
 */
export function readAiFirstDirectionLimit(env: Record<string, string | undefined>): number {
  const parsed = Number(env[AI_FIRST_DIRECTION_LIMIT_ENV]);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= TARGET_DIRECTION_COUNT
    ? parsed
    : TARGET_DIRECTION_COUNT;
}

/**
 * Model selection is server-owned and auditable. An unsupported configured
 * value is an operator error, not permission to silently spend on a fallback.
 */
export function readAiFirstArtworkModel(env: Record<string, string | undefined>): ArtworkModel {
  const configured = env[AI_FIRST_IMAGE_MODEL_ENV]?.trim() || DEFAULT_ARTWORK_MODEL;
  if (!SUPPORTED_ARTWORK_MODELS.has(configured as ArtworkModel)) {
    throw new Error(
      `${AI_FIRST_IMAGE_MODEL_ENV} must be one of: ${Array.from(SUPPORTED_ARTWORK_MODELS).join(", ")}.`,
    );
  }
  return configured as ArtworkModel;
}

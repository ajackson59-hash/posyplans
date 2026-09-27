import { createHash } from 'node:crypto';
import type { ArtworkRequest } from './aiFirst/artwork';

// Separate durable envelopes. Neither installation nor deployment grants spend.
// These are request ceilings, not provider-account dollar caps.
export const IMAGE_SPEND_POLICY = 'launch-preview-image-v1';
export const PRODUCTION_IMAGE_SPEND_POLICY = 'launch-production-image-v1';
export const imageSpendUuid = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function imageSpendGuardEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.VERCEL_ENV === 'production'
    || (env.VERCEL_ENV === 'preview' && env.VERCEL_GIT_COMMIT_REF === 'codex/launch-blockers');
}
export function imageSpendPolicyId(env: NodeJS.ProcessEnv = process.env) {
  if (env.VERCEL_ENV === 'production') return PRODUCTION_IMAGE_SPEND_POLICY;
  return imageSpendGuardEnabled(env) ? IMAGE_SPEND_POLICY : undefined;
}
export function imageSpendDispatchEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.VERCEL_ENV !== 'production' || env.POSY_PRODUCTION_ARTWORK_GENERATION === 'true';
}
/** Bounded concurrent reservations; invalid configuration closes new work. */
export function productionImageConcurrency(env: NodeJS.ProcessEnv = process.env) {
  const raw = env.POSY_PRODUCTION_IMAGE_CONCURRENCY ?? '1';
  return /^[1-8]$/.test(raw) ? Number(raw) : 0;
}
export class ImageSpendGuardError extends Error {
  constructor(readonly code: 'blocked' | 'duplicate' | 'unavailable') {
    super('Artwork creation is paused. Your saved images are still available.');
    this.name = 'ImageSpendGuardError';
  }
}

/** Match the complete normalized provider input, including the exact reference
 * pixels and their order. No prompt, pixels or credentials enter the ledger. */
export function imageSpendFingerprint(request: ArtworkRequest): string {
  const model = request.model ?? 'gpt-image-2';
  const refs = request.referenceImages ?? [];
  return createHash('sha256').update(JSON.stringify({
    model, prompt: request.prompt, aspectRatio: request.aspectRatio,
    quality: request.quality ?? (model === 'gemini-3.1-flash-image' ? 'medium' : 'high'),
    outputFormat: request.outputFormat ?? (model === 'gemini-3.1-flash-image' ? 'jpeg' : 'png'), maxTransientRetries: request.maxTransientRetries,
    inputFidelity: refs.length && model !== 'gpt-image-2' ? request.inputFidelity ?? null : null,
    references: refs.map((ref, index) => ({
      sha256: createHash('sha256').update(ref.bytes).digest('hex'), mimeType: ref.mimeType,
      filename: ref.filename || `reference-${index + 1}.${ref.mimeType === 'image/jpeg' ? 'jpg' : ref.mimeType.split('/')[1]}`,
    })),
  })).digest('hex');
}

/** Every image adapter calls this immediately before its physical HTTP call.
 * No permit is available to legacy/staff/research paths in guarded deployments.
 * A reserved permit is consumed once; it is never renewed on timeout/reload. */
export async function authorizeImageDispatch(request: ArtworkRequest): Promise<void> {
  if (!imageSpendGuardEnabled()) return;
  if (!imageSpendDispatchEnabled() || !imageSpendUuid(request.imageSpendPermit) || !imageSpendUuid(request.imageSpendExecution)
    || request.maxTransientRetries !== 0) throw new ImageSpendGuardError('blocked');
  request.signal?.throwIfAborted();
  try {
    const { DbImageSpendStore } = await import('./imageSpendStore');
    await new DbImageSpendStore().claimDispatch(request);
  } catch (error) {
    if (error instanceof ImageSpendGuardError) throw error;
    throw new ImageSpendGuardError('unavailable');
  }
}

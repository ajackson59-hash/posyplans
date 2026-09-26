import { createHash } from 'node:crypto';
import type { ArtworkRequest } from './aiFirst/artwork';

// One durable envelope across events, browsers and deployments of this branch.
// This is a request ceiling for guarded Preview code, not an account dollar cap.
export const IMAGE_SPEND_POLICY = 'launch-preview-image-v1';
export const imageSpendUuid = (value: unknown): value is string => typeof value === 'string'
  && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function imageSpendGuardEnabled(env: NodeJS.ProcessEnv = process.env) {
  return env.VERCEL_ENV === 'preview' && env.VERCEL_GIT_COMMIT_REF === 'codex/launch-blockers';
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
 * No permit is available to legacy/staff/research paths in this closed cohort.
 * A reserved permit is consumed once; it is never renewed on timeout/reload. */
export async function authorizeImageDispatch(request: ArtworkRequest): Promise<void> {
  if (!imageSpendGuardEnabled()) return;
  if (!imageSpendUuid(request.imageSpendPermit) || !imageSpendUuid(request.imageSpendExecution)
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

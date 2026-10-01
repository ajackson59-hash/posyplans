import { createHash, randomUUID } from 'node:crypto';
import { decode } from 'jpeg-js';
import type { Event } from '@shared/schema';
import { boxDownsampleRgb, encodePng } from './aiFirst/png';
import recoveryTemplate from './assets/customerArtworkRecovery.json';
import { CUSTOMER_ARTWORK_UPLOAD_LIMIT, CustomerArtworkError, customerArtworkBriefHash, sessionBelongsTo,
  type CustomerArtworkSession, type CustomerArtworkStore } from './customerArtwork';

export const MAX_CUSTOMER_UPLOAD_BYTES = 2_500_000;
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** Browser converts JPG/PNG to a bounded JPEG. No URL fetching, EXIF retention,
 * SVG, animated content, provider dispatch, or implicit selection/application. */
export async function uploadCustomerArtwork(event: Event, row: CustomerArtworkSession,
  input: { version: number; briefHash: string; requestKey: string; dataUrl: string }, store: CustomerArtworkStore, templateId?: 'elegant-neutral') {
  if (!sessionBelongsTo(row, event)) throw new CustomerArtworkError('This artwork is not available.', 404);
  const prefix = 'data:image/jpeg;base64,';
  const data = input.dataUrl.slice(prefix.length);
  if (!input.dataUrl.startsWith(prefix) || data.length > Math.ceil(MAX_CUSTOMER_UPLOAD_BYTES / 3) * 4
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data))
    throw new CustomerArtworkError('Choose a JPG or PNG image using the upload control.', 400);
  const bytes = Buffer.from(data, 'base64');
  if (!bytes.length || bytes.length > MAX_CUSTOMER_UPLOAD_BYTES) throw new CustomerArtworkError('Choose a smaller image.', 400);
  const inputHash = hash(bytes);
  if (templateId && inputHash !== recoveryTemplate.sourceSha256) throw new CustomerArtworkError('This ready-made design is unavailable.', 503);
  const previous = row.uploads?.find(u => u.requestKey === input.requestKey);
  if (previous) {
    if (previous.inputHash !== inputHash || previous.briefHash !== input.briefHash || previous.templateId !== templateId)
      throw new CustomerArtworkError('That upload request was already used. Refresh your saved artwork.');
    return row;
  }
  if (input.version !== row.version || input.briefHash !== customerArtworkBriefHash(event))
    throw new CustomerArtworkError('Your artwork details changed. Refresh before uploading.');
  if (event.draftStatus === 'generating' || row.attempts.some(a => a.status === 'running'))
    throw new CustomerArtworkError('Wait for the current request to finish before uploading.');
  if ((row.uploads?.length ?? 0) >= CUSTOMER_ARTWORK_UPLOAD_LIMIT)
    throw new CustomerArtworkError('Your saved upload limit is reached. Keep a saved image or contact support.', 429);
  let image: Buffer;
  try {
    const decoded = decode(bytes, { useTArray: true, formatAsRGBA: false, tolerantDecoding: false,
      maxResolutionInMP: 4, maxMemoryUsageInMB: 64 });
    if (Math.min(decoded.width, decoded.height) < 512 || (!templateId && Math.max(decoded.width, decoded.height) > 1536))
      throw new Error('dimensions');
    image = encodePng(boxDownsampleRgb({ width: decoded.width, height: decoded.height, rgb: decoded.data }, 1536), 'sub');
    if (image.length > 4_000_000) throw new Error('size');
  } catch { throw new CustomerArtworkError('Choose a clear JPG or PNG with both sides at least 512 pixels. Try a less detailed file if it is too large.', 400); }
  const next: CustomerArtworkSession = { ...row, version: row.version + 1, uploads: [...(row.uploads ?? []), {
    id: randomUUID(), requestKey: input.requestKey, briefHash: input.briefHash, operation: templateId ? 'template' : 'upload', templateId, status: 'ready',
    uploadedAt: Date.now(), inputHash, imageBase64: image.toString('base64'), imageHash: hash(image),
  }] };
  if (!await store.compareAndSet(next, row.version)) throw new CustomerArtworkError('Your artwork changed. Refresh before uploading again.');
  return next;
}

export const useRecoveryTemplate = (event: Event, row: CustomerArtworkSession,
  input: { version: number; briefHash: string; requestKey: string; templateId: 'elegant-neutral' }, store: CustomerArtworkStore) =>
  uploadCustomerArtwork(event, row, { ...input, dataUrl: `data:image/jpeg;base64,${recoveryTemplate.jpegBase64}` }, store, input.templateId);

import type { Event } from '@shared/schema';
import { DbHumanArtworkReviewStore } from './humanArtworkReviewStore';
import { humanReviewEventEnabled, humanArtworkBriefHash, isCurrentHumanApproval } from './humanArtworkReview';

export async function approvedHumanArtwork(event: Event): Promise<string | null> {
  if (!humanReviewEventEnabled(event)) return null;
  const row = await new DbHumanArtworkReviewStore().current(event.id, humanArtworkBriefHash(event));
  return isCurrentHumanApproval(row, event) ? `data:image/png;base64,${row.imageBase64}` : null;
}

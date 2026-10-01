import type { Event } from '@shared/schema';
import { customerArtworkEventEnabled, isKeptCustomerArtwork, selectedCustomerArtwork } from './customerArtwork';
import { DbCustomerArtworkStore } from './customerArtworkStore';

/** Owner-selected pixels, never rebranded as a staff/critic quality approval. */
export async function keptCustomerArtwork(event: Event) {
  if (!customerArtworkEventEnabled(event)) return null;
  return selectedCustomerArtwork(await new DbCustomerArtworkStore().get(event.id), event);
}

export async function appliedCustomerArtworkIsKept(event: Event, value: string) {
  return isKeptCustomerArtwork(await new DbCustomerArtworkStore().get(event.id), event, value);
}

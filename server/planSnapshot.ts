import { createHash } from 'node:crypto';
import type { PlanSnapshot } from '@shared/planRegeneration';
import type { Event } from '@shared/schema';

export function snapshotEvent(e: Event): PlanSnapshot['event'] {
  return { id: e.id, eventIdentity: e.eventIdentity, eventName: e.eventName, eventType: e.eventType,
    eventDate: e.eventDate, estimatedGuestCount: e.estimatedGuestCount, vibeDescription: e.vibeDescription,
    themeName: e.themeName, budgetCeiling: e.budgetCeiling, budgetTotal: e.budgetTotal,
    location: e.location, hostNames: e.hostNames, draftStatus: e.draftStatus };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]),
  );
  return value;
}

/** Include every editable plan value, and inputs that would make a candidate stale.
 * Ignore publication/payment metadata and RSVP activity: none is overwritten by apply. */
export function planFingerprint(snapshot: PlanSnapshot): string {
  const e = snapshot.event;
  const byId = <T extends { id: number }>(rows: T[]) => [...rows].sort((a, b) => a.id - b.id);
  const content = {
    resolvedGuestCount: snapshot.resolvedGuestCount,
    event: { eventIdentity: e.eventIdentity, eventName: e.eventName, eventType: e.eventType,
      eventDate: e.eventDate, estimatedGuestCount: e.estimatedGuestCount, vibeDescription: e.vibeDescription,
      themeName: e.themeName, budgetCeiling: e.budgetCeiling, budgetTotal: e.budgetTotal,
      location: e.location, hostNames: e.hostNames },
    budgetItems: byId(snapshot.budgetItems), menuItems: byId(snapshot.menuItems),
    shoppingItems: byId(snapshot.shoppingItems), timelineItems: byId(snapshot.timelineItems),
  };
  return createHash('sha256').update(JSON.stringify(canonical(content))).digest('hex');
}

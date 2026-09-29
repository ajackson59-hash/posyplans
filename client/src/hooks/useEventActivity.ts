import { useEffect, useRef } from 'react';
import { API_BASE } from '@/lib/queryClient';

export const EVENT_ACTIVITY_THROTTLE_MS = 60_000;

/** No heartbeat timer: open background tabs and dashboard polling do not count.
 * A visit is observed when the event first becomes visible; further records
 * require real pointer/key interaction or returning to the visible tab. */
export function useEventActivity(ownerToken: string | undefined, ready: boolean): void {
  const last = useRef<{ owner: string; at: number } | null>(null);
  useEffect(() => {
    if (!ready || !ownerToken) return;
    function record() {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      const previous = last.current;
      if (previous && previous.owner === ownerToken && now - previous.at < EVENT_ACTIVITY_THROTTLE_MS) return;
      // Throttle failures too. Never replay a plan/image/payment action to
      // repair activity telemetry, and never retry on an interval.
      last.current = { owner: ownerToken!, at: now };
      void Promise.resolve().then(() => fetch(`${API_BASE}/api/events/owner/${encodeURIComponent(ownerToken!)}/activity`, {
        method: 'POST', credentials: 'same-origin',
      })).catch(() => {});
    }
    function interacted(event: Event) { if (event.isTrusted) record(); }
    record();
    document.addEventListener('visibilitychange', record);
    document.addEventListener('pointerdown', interacted, { passive: true });
    document.addEventListener('keydown', interacted);
    return () => {
      document.removeEventListener('visibilitychange', record);
      document.removeEventListener('pointerdown', interacted);
      document.removeEventListener('keydown', interacted);
    };
  }, [ownerToken, ready]);
}

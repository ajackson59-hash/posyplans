import { StrictMode } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EVENT_ACTIVITY_THROTTLE_MS, useEventActivity } from '@/hooks/useEventActivity';

let visible = 'visible';
const fetcher = vi.fn(async () => ({ ok: true }));
function Harness({ owner = 'owner-a', ready = true }) { useEventActivity(owner, ready); return null; }
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-29T00:00:00Z'));
  visible = 'visible'; fetcher.mockClear();
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visible as DocumentVisibilityState);
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });
const flush = async () => { await act(async () => {}); };
describe('event activity without background keepalive', () => {
  it('records one actual visible visit across StrictMode effects and polling rerenders', async () => {
    const view = render(<StrictMode><Harness /></StrictMode>); await flush();
    expect(fetcher).toHaveBeenCalledExactlyOnceWith('/api/events/owner/owner-a/activity', { method: 'POST', credentials: 'same-origin' });
    await act(async () => { vi.advanceTimersByTime(86_400_000); });
    view.rerender(<StrictMode><Harness /></StrictMode>); await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('does not record an unconfirmed event or hidden page', async () => {
    visible = 'hidden'; const view = render(<Harness ready={false} />); await flush();
    view.rerender(<Harness ready />); await flush(); expect(fetcher).not.toHaveBeenCalled();
    visible = 'visible'; document.dispatchEvent(new Event('visibilitychange')); await flush();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('throttles real input and ignores synthetic events or elapsed time alone', async () => {
    const listen = vi.spyOn(document, 'addEventListener'); render(<Harness />); await flush();
    const handler = listen.mock.calls.find(([name]) => name === 'pointerdown')![1] as EventListener;
    handler({ isTrusted: true } as Event); await flush(); expect(fetcher).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(EVENT_ACTIVITY_THROTTLE_MS);
    handler({ isTrusted: false } as Event); await flush(); expect(fetcher).toHaveBeenCalledTimes(1);
    handler({ isTrusted: true } as Event); await flush(); expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it('does not retry a failed visit or an action automatically', async () => {
    fetcher.mockRejectedValueOnce(new Error('offline')); render(<Harness />); await flush();
    vi.advanceTimersByTime(86_400_000); await flush(); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('records a different event separately and cleans up listeners', async () => {
    const view = render(<Harness />); await flush(); view.rerender(<Harness owner='owner-b' />); await flush();
    expect(fetcher).toHaveBeenCalledTimes(2); view.unmount();
    vi.advanceTimersByTime(EVENT_ACTIVITY_THROTTLE_MS); document.dispatchEvent(new Event('visibilitychange')); await flush();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

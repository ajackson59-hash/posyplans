import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AIDemoShowcase from '@/components/AIDemoShowcase';

let visibleRatio: number;
let onVisibility: IntersectionObserverCallback;
function showDemo(ratio: number) {
  act(() => onVisibility([{ isIntersecting: ratio > 0, intersectionRatio: ratio } as IntersectionObserverEntry], {} as IntersectionObserver));
}
beforeEach(() => {
  visibleRatio = 1;
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback: IntersectionObserverCallback) { onVisibility = callback; }
    observe() { onVisibility([{ isIntersecting: visibleRatio > 0, intersectionRatio: visibleRatio } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
    disconnect() {}
  });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('compact product story', () => {
  it('waits until half the demo is visible before starting automatically', () => {
    visibleRatio = 0;
    render(<AIDemoShowcase autoPlay />);
    act(() => vi.advanceTimersByTime(20000));
    expect(screen.getByRole('button', { name: 'Watch Posy in action' })).toBeTruthy();
    expect(screen.getByRole('img').getAttribute('src')).toBe('/demo/garden-warmer.webp');
    expect(screen.getByRole('link', { name: 'Plan my event' }).getAttribute('href')).toBe('/intake');
    showDemo(0.2);
    act(() => vi.advanceTimersByTime(20000));
    expect(screen.getByRole('button', { name: 'Watch Posy in action' })).toBeTruthy();
    showDemo(0.5);
    expect(screen.getByRole('button', { name: 'Pause walkthrough' })).toBeTruthy();
    act(() => vi.advanceTimersByTime(3500));
    expect(screen.getByRole('button', { name: 'Step 2: The reveal' }).getAttribute('aria-current')).toBe('step');
  });
  it('stops offscreen, resumes on return, and preserves an intentional pause', () => {
    render(<AIDemoShowcase autoPlay />);
    act(() => vi.advanceTimersByTime(3500));
    showDemo(0);
    act(() => vi.advanceTimersByTime(20000));
    expect(screen.getByRole('button', { name: 'Step 2: The reveal' }).getAttribute('aria-current')).toBe('step');
    showDemo(1);
    act(() => vi.advanceTimersByTime(4000));
    expect(screen.getByRole('button', { name: 'Step 3: Make it yours' }).getAttribute('aria-current')).toBe('step');
    fireEvent.click(screen.getByRole('button', { name: 'Pause walkthrough' }));
    showDemo(0); showDemo(1);
    act(() => vi.advanceTimersByTime(20000));
    expect(screen.getByRole('button', { name: 'Play walkthrough' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Step 3: Make it yours' }).getAttribute('aria-current')).toBe('step');
  });
  it('pauses while the browser tab is hidden and resumes without skipping scenes', () => {
    render(<AIDemoShowcase autoPlay />);
    act(() => vi.advanceTimersByTime(3500));
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
    fireEvent(document, new Event('visibilitychange'));
    act(() => vi.advanceTimersByTime(20000));
    expect(screen.getByRole('button', { name: 'Step 2: The reveal' }).getAttribute('aria-current')).toBe('step');
    hidden.mockReturnValue(false);
    fireEvent(document, new Event('visibilitychange'));
    act(() => vi.advanceTimersByTime(4000));
    expect(screen.getByRole('button', { name: 'Step 3: Make it yours' }).getAttribute('aria-current')).toBe('step');
    hidden.mockRestore();
  });
  it('offers manual playback when viewport observation is unavailable', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    render(<AIDemoShowcase autoPlay />);
    act(() => vi.advanceTimersByTime(20000));
    fireEvent.click(screen.getByRole('button', { name: 'Watch Posy in action' }));
    act(() => vi.advanceTimersByTime(3500));
    expect(screen.getByRole('button', { name: 'Step 2: The reveal' }).getAttribute('aria-current')).toBe('step');
  });
  it('shows the idea, reveals the image, and visibly applies an edit without API calls', () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    render(<AIDemoShowcase bare />);
    fireEvent.click(screen.getByRole('button', { name: 'Play walkthrough' }));
    act(() => vi.advanceTimersByTime(3500));
    expect(screen.getByRole('img').getAttribute('src')).toBe('/demo/garden-original.webp');
    act(() => vi.advanceTimersByTime(4000));
    expect(screen.getByRole('button', { name: 'Step 3: Make it yours' }).getAttribute('aria-current')).toBe('step');
    expect(screen.getByRole('img').getAttribute('src')).toBe('/demo/garden-original.webp');
    act(() => vi.advanceTimersByTime(2100));
    expect(screen.getByRole('img').getAttribute('src')).toBe('/demo/garden-warmer.webp');
    fireEvent.click(screen.getByRole('button', { name: 'Before', exact: true }));
    act(() => vi.advanceTimersByTime(18000));
    expect(screen.getByRole('img').getAttribute('src')).toBe('/demo/garden-original.webp');
    expect(screen.getByRole('button', { name: 'Play walkthrough' })).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('pauses and resumes at the same point, finishes in 18 seconds, and replays on request', () => {
    render(<AIDemoShowcase bare autoPlay />);
    act(() => vi.advanceTimersByTime(3500));
    fireEvent.click(screen.getByRole('button', { name: 'Pause walkthrough' }));
    act(() => vi.advanceTimersByTime(10000));
    expect(screen.getByRole('button', { name: 'Step 2: The reveal' }).getAttribute('aria-current')).toBe('step');
    fireEvent.click(screen.getByRole('button', { name: 'Play walkthrough' }));
    act(() => vi.advanceTimersByTime(14450));
    expect(screen.getByRole('button', { name: 'Pause walkthrough' })).toBeTruthy();
    act(() => vi.advanceTimersByTime(50));
    expect(screen.getByRole('button', { name: 'Replay walkthrough' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Let’s plan your event' }).getAttribute('href')).toBe('/intake');
    fireEvent.click(screen.getByRole('button', { name: 'Replay walkthrough' }));
    expect(screen.getByRole('button', { name: 'Step 1: Your idea' }).getAttribute('aria-current')).toBe('step');
  });
  it('respects reduced motion and keeps all four scenes directly reachable', () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList);
    render(<AIDemoShowcase bare autoPlay />);
    act(() => vi.advanceTimersByTime(60000));
    expect(screen.getByRole('button', { name: 'Play walkthrough' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Step 1: Your idea' }).getAttribute('aria-current')).toBe('step');
    fireEvent.click(screen.getByRole('button', { name: 'Step 3: Make it yours' }));
    expect(screen.getByRole('img').getAttribute('src')).toBe('/demo/garden-warmer.webp');
    fireEvent.click(screen.getByRole('button', { name: 'Step 4: Your plan' }));
    expect(screen.getByText('Schedule')).toBeTruthy();
    expect(screen.getByText('Your budget')).toBeTruthy();
  });
  it('discloses the example and payment requirement in every placement', () => {
    const ui = render(<AIDemoShowcase />);
    expect(document.querySelector('#see-posy-build')).not.toBeNull();
    expect(screen.getByText(/Example, sped up. Free preview when available; paid plan for edits and planning/)).toBeTruthy();
    ui.rerender(<AIDemoShowcase bare />);
    expect(document.querySelector('#see-posy-build')).toBeNull();
    expect(screen.getByText(/Image limits apply/)).toBeTruthy();
  });
});

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AIDemoShowcase from '@/components/AIDemoShowcase';

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('public product walkthrough', () => {
  it('lets the visitor pause, skip and compare saved images without an API request', () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    render(<AIDemoShowcase bare />);
    fireEvent.click(screen.getByRole('button', { name: 'Play walkthrough' }));
    act(() => vi.advanceTimersByTime(8000));
    expect(screen.getByTestId('demo-step-heading').textContent).toContain('come to life');
    fireEvent.click(screen.getByRole('button', { name: 'Pause walkthrough' }));
    act(() => vi.advanceTimersByTime(16000));
    expect(screen.getByTestId('demo-step-label').textContent).toBe('2 of 6 · Preview');
    fireEvent.click(screen.getByRole('button', { name: 'Step 5: Refine' }));
    expect(screen.getByRole('img').getAttribute('src')).toBe('/demo/garden-warmer.webp');
    fireEvent.click(screen.getByRole('button', { name: 'Original' }));
    expect(screen.getByRole('img').getAttribute('src')).toBe('/demo/garden-original.webp');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('respects reduced motion while keeping every chapter reachable', () => {
    vi.mocked(window.matchMedia).mockReturnValue({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList);
    render(<AIDemoShowcase bare autoPlay />);
    act(() => vi.advanceTimersByTime(60000));
    expect(screen.getByTestId('demo-step-label').textContent).toBe('1 of 6 · Describe');
    fireEvent.click(screen.getByRole('button', { name: 'Step 3: Unlock' }));
    expect(screen.getByText('The full plan and further artwork requests require an unlock.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Next step' }));
    expect(screen.getByTestId('demo-step-label').textContent).toBe('4 of 6 · Plan');
  });
  it('finishes without looping and replays only on request', () => {
    render(<AIDemoShowcase bare autoPlay />);
    for (let i = 0; i < 6; i++) act(() => vi.advanceTimersByTime(8000));
    expect(screen.getByRole('button', { name: 'Next step' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: 'Replay walkthrough' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Replay walkthrough' }));
    expect(screen.getByTestId('demo-step-label').textContent).toBe('1 of 6 · Describe');
  });
  it('keeps the same start link and discloses the example when embedded or standalone', () => {
    const ui = render(<AIDemoShowcase />);
    expect(document.querySelector('#see-posy-build')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Start your event' }).getAttribute('href')).toBe('/intake');
    expect(screen.getByText(/Illustrative walkthrough with actual Posy-generated artwork/)).toBeTruthy();
    ui.rerender(<AIDemoShowcase bare />);
    expect(document.querySelector('#see-posy-build')).toBeNull();
    expect(screen.getByRole('link', { name: 'Start your event' }).getAttribute('href')).toBe('/intake');
  });
});

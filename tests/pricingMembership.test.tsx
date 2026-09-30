import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
const request = vi.hoisted(() => vi.fn());
vi.mock('@/lib/queryClient', () => ({ apiRequestJson: request }));
vi.mock('@/components/AIDemoShowcase', () => ({ default: () => null }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
const Pricing = (await import('@/pages/Pricing')).default;
let client: QueryClient;
beforeEach(() => {
  request.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, queryFn: async () => ({ configured: true }) } } });
});
afterEach(() => { cleanup(); client.clear(); window.history.replaceState({}, '', '/'); });
function show(path: string) {
  window.history.replaceState({}, '', path);
  render(<QueryClientProvider client={client}><Pricing /></QueryClientProvider>);
}
describe('Plus checkout needs an event', () => {
  it('routes standalone visitors to intake and existing members to recovery without a purchase form', async () => {
    show('/pricing');
    await screen.findByTestId('plus-start-event-first');
    expect(screen.queryByTestId('button-subscribe-plus')).toBeNull();
    expect(screen.getByRole('link', { name: 'Start an event' }).getAttribute('href')).toBe('/intake');
    expect(screen.getByRole('link', { name: 'Find your paid event' }).getAttribute('href')).toBe('/recover');
    expect(request).not.toHaveBeenCalled();
  });
  it('keeps checkout available for an existing event without automatically starting it', async () => {
    show('/pricing?returnToken=synthetic-owner');
    await screen.findByTestId('button-subscribe-plus');
    expect(screen.queryByTestId('plus-start-event-first')).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });
});

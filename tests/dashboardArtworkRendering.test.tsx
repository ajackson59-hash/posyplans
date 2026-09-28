import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Route, Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { buildThemedConcept, LAUNCH_THEMES } from '@shared/themeCatalog';
import type { EventRecord } from '@/lib/types';
import { TooltipProvider } from '@/components/ui/tooltip';

const request = vi.fn(async () => ({}));
vi.mock('@/lib/queryClient', () => ({ apiRequest: request, apiRequestJson: request }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
const { default: Dashboard } = await import('@/pages/Dashboard');

beforeEach(() => {
  localStorage.setItem('pp_dashboard_tab:artwork-fixture', 'guests');
  Element.prototype.scrollIntoView = vi.fn();
  request.mockClear();
});
afterEach(() => { cleanup(); localStorage.clear(); });

it.each(['banner', 'full-bleed', 'split', 'centered', 'backdrop'] as const)(
  'shows the applied saved image and copy in the dashboard despite a previous %s layout', async layoutStyle => {
    const concept = { ...buildThemedConcept(LAUNCH_THEMES[0]), layoutStyle };
    const event = { id: 99901, ownerToken: 'artwork-fixture', shareSlug: 'fixture-share',
      eventName: 'Synthetic artwork check', eventType: 'Celebration', eventDate: '', location: '', hostNames: '',
      themeName: 'Saved style', paletteColors: '[]', inviteSubject: 'Saved headline', inviteMessage: 'Saved invitation wording',
      inviteArtworkUrl: '/selected-portrait.png', inviteIllustrationUrl: '/older-illustration.png',
      inviteRenderMode: 'customer-artwork', inviteDesignConceptJson: JSON.stringify(concept),
      inviteFontFamily: '', inviteAccentColor: '', inviteStatus: 'draft', rsvpRestriction: 'plus_one', rsvpDeadline: '',
      venueName: '', venueAddress: '', venueContactName: '', venueContactPhone: '', venueCapacity: null,
      budgetTotal: null, estimatedGuestCount: 8, budgetCeiling: null, vibeDescription: '', eventIdentity: '',
      draftStatus: 'none', draftStage: null, capturedEmail: null, emailCapturedAt: null, createdAt: 0,
    } satisfies EventRecord;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false,
      queryFn: async ({ queryKey }) => queryKey[0] === '/api/events/owner/artwork-fixture' ? { event, guests: [] } : null,
    } } });
    const { hook } = memoryLocation({ path: '/dashboard/artwork-fixture' });
    render(<QueryClientProvider client={client}><TooltipProvider><Router hook={hook}>
      <Route path="/dashboard/:ownerToken" component={Dashboard} />
    </Router></TooltipProvider></QueryClientProvider>);
    const image = await screen.findByTestId('img-invite-artwork');
    expect(image.getAttribute('src')).toBe('/selected-portrait.png');
    expect(image.className).toContain('h-auto');
    expect(image.className).not.toMatch(/object-cover|aspect-|rounded-full/);
    expect(screen.queryByTestId('card-invite-concept-display')).toBeNull();
    expect(within(image.parentElement!).getByText('Saved invitation wording').style.fontFamily).toBeTruthy();
    expect(request.mock.calls.every(([method]) => method === 'GET')).toBe(true);
    client.clear();
  },
);

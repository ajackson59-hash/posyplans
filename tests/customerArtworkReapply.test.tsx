import { beforeEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { CustomerArtworkView } from '@shared/customerArtwork';

const request = vi.fn();
vi.mock('@/lib/queryClient', () => ({ apiRequestJson: request }));
vi.mock('@/components/CustomerArtworkPreview', () => ({ default: () => <div>Retained image</div> }));
const { default: CustomerArtworkDesigner } = await import('@/components/CustomerArtworkDesigner');
const artwork = { version: 3, briefHash: 'saved-brief', selectedId: 'saved-candidate', appliedId: 'saved-candidate',
  selectedHash: 'saved-image-hash', canContinue: true } as CustomerArtworkView;
const refresh = vi.fn(async () => undefined);
function show(usesSavedArtworkLayout: boolean) {
  const client = new QueryClient();
  render(<QueryClientProvider client={client}><CustomerArtworkDesigner ownerToken="synthetic-owner"
    artwork={artwork} usesSavedArtworkLayout={usesSavedArtworkLayout} refresh={refresh} /></QueryClientProvider>);
}
beforeEach(() => { request.mockReset(); refresh.mockClear(); });

it('lets an older invitation reapply the same kept pixels through the verified reuse route', async () => {
  request.mockResolvedValue({ reusedExistingArtwork: true });
  show(false);
  const apply = screen.getByRole('button', { name: 'Use kept image on my invitation' }) as HTMLButtonElement;
  expect(apply.disabled).toBe(false);
  fireEvent.click(apply);
  await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
  expect(request.mock.calls).toEqual([['POST', '/api/events/owner/synthetic-owner/invite/use-prepayment-preview', {
    version: 3, briefHash: 'saved-brief', candidateId: 'saved-candidate', imageHash: 'saved-image-hash',
  }]]);
});

it('keeps reapply disabled after both the pixels and the saved-artwork layout are applied', () => {
  show(true);
  expect((screen.getByRole('button', { name: 'Your invitation uses the kept image' }) as HTMLButtonElement).disabled).toBe(true);
  expect(request).not.toHaveBeenCalled();
});

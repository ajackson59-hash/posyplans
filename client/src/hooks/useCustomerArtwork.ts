import { useQuery } from '@tanstack/react-query';
import type { CustomerArtworkView } from '@shared/customerArtwork';
import { apiRequestJson } from '@/lib/queryClient';

export function useCustomerArtwork(ownerToken: string) {
  return useQuery({
    queryKey: ['prepayment-preview-readiness', ownerToken],
    queryFn: () => apiRequestJson<{ customerArtwork?: CustomerArtworkView; generationState?: string; pollAfterMs?: number }>(
      'GET', `/api/events/owner/${ownerToken}/prepayment-preview/readiness`),
    enabled: !!ownerToken, retry: false, refetchOnWindowFocus: true, refetchOnReconnect: true,
    refetchInterval: query => query.state.data?.customerArtwork?.state === 'generating' ? 2500 : false,
  });
}

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CustomerArtworkView } from '@shared/customerArtwork';
import { apiRequestJson } from '@/lib/queryClient';
import CustomerArtworkPreview from './CustomerArtworkPreview';
import { Button } from './ui/button';

export default function CustomerArtworkDesigner({ ownerToken, artwork, usesSavedArtworkLayout, refresh }: {
  ownerToken: string; artwork: CustomerArtworkView; usesSavedArtworkLayout: boolean; refresh: () => Promise<unknown>;
}) {
  const client = useQueryClient();
  const apply = useMutation({
    mutationFn: () => apiRequestJson('POST', `/api/events/owner/${ownerToken}/invite/use-prepayment-preview`, {
      version: artwork.version, briefHash: artwork.briefHash, candidateId: artwork.selectedId, imageHash: artwork.selectedHash,
    }),
    retry: false,
    onSettled: async () => {
      // Resolves an uncertain response by reading; never repeats the write.
      await Promise.allSettled([refresh(), client.invalidateQueries({ queryKey: [`/api/events/owner/${ownerToken}`] })]);
    },
  });
  // A pre-fix event can already store these pixels but still use a legacy crop.
  // Reapplying upgrades its display setting without generating another image.
  const applied = !!artwork.selectedId && artwork.selectedId === artwork.appliedId && usesSavedArtworkLayout;
  return <div className="rounded-xl border border-border">
    <CustomerArtworkPreview ownerToken={ownerToken} artwork={artwork} refresh={refresh} paid />
    <div className="space-y-2 border-t border-border p-5">
      <Button type="button" className="w-full" disabled={!artwork.canContinue || applied || apply.isPending} onClick={() => apply.mutate()}>
        {apply.isPending ? 'Saving your invitation…' : applied ? 'Your invitation uses the kept image' : 'Use kept image on my invitation'}
      </Button>
      <p className="text-sm text-muted-foreground">This updates the image on your invitation. Your wording and styling stay saved.</p>
      {apply.isError && !applied ? <p role="alert" className="text-sm">We could not confirm the change. Refresh the saved status before trying again.</p> : null}
    </div>
  </div>;
}

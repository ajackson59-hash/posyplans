import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { CustomerArtworkView } from '@shared/customerArtwork';
import { apiRequestJson } from '@/lib/queryClient';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Check } from 'lucide-react';

export default function CustomerArtworkPreview({ ownerToken, artwork, refresh, paid = false }: {
  ownerToken: string; artwork: CustomerArtworkView; refresh: () => Promise<unknown>; paid?: boolean;
}) {
  const client = useQueryClient();
  const [displayedId, setDisplayedId] = useState<string | null>(() => artwork.selectedId ?? artwork.candidates.at(-1)?.id ?? null);
  const [loadedHash, setLoadedHash] = useState<string | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const [imageRefresh, setImageRefresh] = useState(0);
  const [correction, setCorrection] = useState('');
  const [message, setMessage] = useState('');
  const busy = useRef(false);
  const panel = useRef<HTMLDivElement>(null);
  const latest = artwork.candidates.at(-1);
  const previousLatest = useRef<string | undefined>(artwork.candidates.at(-1)?.id);
  useEffect(() => {
    if (latest?.id !== previousLatest.current) {
      previousLatest.current = latest?.id;
      setDisplayedId(latest?.id ?? null);
      if (latest) panel.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
    }
  }, [latest?.id]);
  const displayed = artwork.candidates.find(c => c.id === displayedId) ?? latest;
  useEffect(() => { setLoadedHash(null); setImageFailed(false); }, [displayed?.imageHash]);
  const saveView = (value: CustomerArtworkView) => {
    client.setQueryData(['prepayment-preview-readiness', ownerToken], (old: any) => ({ ...old,
      customerArtwork: value, checkoutAllowed: value.canContinue,
      generationState: value.state === 'generating' ? 'generating' : value.candidates.length ? 'ready' : 'idle',
      kind: value.candidates.length ? 'customer-artwork' : 'none', ready: value.candidates.length > 0,
      pollAfterMs: value.state === 'generating' ? 2500 : null,
    }));
  };
  const action = useMutation({
    mutationFn: ({ path, body }: { path: string; body: unknown }) => apiRequestJson<CustomerArtworkView>('POST', `/api/events/owner/${ownerToken}/artwork/${path}`, body),
    retry: false,
    onSuccess: (value, { path }) => { saveView(value); setMessage(path === 'select' ? 'Your image is saved. You can continue when you’re ready.' : 'Your change is underway. Your previous image is saved.'); if (path === 'revise') setCorrection(''); },
    onError: async (error: Error) => {
      // An uncertain POST is followed by GET only. The server's saved state
      // tells us what happened; neither the mutation nor provider is retried.
      setMessage('We lost the response. Checking your saved artwork before another request…');
      try { const value = await apiRequestJson<CustomerArtworkView>('GET', `/api/events/owner/${ownerToken}/artwork`); saveView(value);
        setMessage(value.state === 'generating' ? 'Your change is still underway. No new request was sent.' : `${error.message} Your saved status has been refreshed. No request was repeated.`); }
      catch { setMessage('We could not reconnect. Refresh the saved status before making another request.'); }
    },
    onSettled: () => { busy.current = false; },
  });
  const submit = (path: 'select' | 'revise') => {
    if (!displayed || busy.current || artwork.state === 'generating' || loadedHash !== displayed.imageHash) return;
    busy.current = true; setMessage('');
    action.mutate({ path, body: path === 'select'
      ? { version: artwork.version, briefHash: artwork.briefHash, candidateId: displayed.id, imageHash: displayed.imageHash }
      : { requestKey: crypto.randomUUID(), version: artwork.version, briefHash: artwork.briefHash,
        baseCandidateId: displayed.id, imageHash: displayed.imageHash, correction: correction.trim() } });
  };
  const pending = action.isPending || artwork.state === 'generating';
  const selected = displayed?.id === artwork.selectedId;
  const canRevise = !!displayed && artwork.generationEnabled && artwork.requestsRemaining > 0 && !pending && loadedHash === displayed.imageHash;
  return <div ref={panel} className="space-y-5 p-5" data-testid="customer-artwork-preview">
    <div>
      <h2 className="font-serif text-xl font-semibold">Your invitation artwork</h2>
      <p className="mt-1 text-sm text-muted-foreground">Keep the image you love, or tell Posy what to change.</p>
    </div>
    {displayed ? <div className="space-y-3">
      <img key={`${displayed.imageHash}:${imageRefresh}`} src={displayed.assetUrl} alt="Your invitation artwork draft" className="block w-full h-auto rounded-lg"
        data-testid="customer-artwork-image" onLoad={() => { setLoadedHash(displayed.imageHash); setImageFailed(false); }} onError={() => { setLoadedHash(null); setImageFailed(true); }} />
      {imageFailed ? <p role="alert" className="text-sm">The image could not load. Refresh its saved status before keeping or revising it.</p> : null}
      {displayed.correction ? <details className="text-sm"><summary className="cursor-pointer">Change requested for this version</summary><p className="mt-2 whitespace-pre-wrap">{displayed.correction}</p></details> : null}
      {artwork.candidates.length > 1 ? <div className="flex flex-wrap gap-2" aria-label="Saved artwork versions">
        {artwork.candidates.map((c, i) => <Button key={c.id} type="button" size="sm" variant={displayed.id === c.id ? 'default' : 'outline'}
          aria-pressed={displayed.id === c.id} onClick={() => setDisplayedId(c.id)} disabled={action.isPending}>
          {i === 0 ? 'Original' : `Revision ${i}`}{c.id === artwork.selectedId ? ' · Kept' : ''}
        </Button>)}
      </div> : null}
      <Button type="button" className="w-full" onClick={() => submit('select')} disabled={pending || selected || loadedHash !== displayed.imageHash}>
        {selected ? <><Check className="mr-2 h-4 w-4" /> Image kept</> : 'Keep this image'}
      </Button>
      {artwork.selectedId && !selected ? <p className="text-sm text-muted-foreground">Your previously kept image remains selected. Keep this version if you want to use it instead.</p> : null}
    </div> : null}
    {artwork.state === 'generating' ? <p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 shrink-0 animate-spin" />Creating your artwork. You can return to this page; your request is saved.</p> : null}
    {artwork.state === 'empty' || artwork.state === 'brief-changed' ? <p className="text-sm text-muted-foreground">
      {paid ? <a className="text-primary underline" href={`/draft-generating/${ownerToken}`}>Create a preview from your saved request</a>
        : artwork.state === 'brief-changed' ? 'Your artwork details changed. Create a preview from the updated request below.' : 'Your complete request is saved. Enter your email below to create your preview.'}
    </p> : null}
    {artwork.state === 'failed' || artwork.state === 'interrupted' ? <div role="alert" className="space-y-2 text-sm">
      <p>We couldn’t complete the last artwork request. Your saved images are still available to keep. No automatic retry was made.</p>
      <a className="text-primary underline" href={`mailto:hello@posyplans.com?subject=${encodeURIComponent(`Artwork help ${artwork.supportReference ?? ''}`)}`}>Get help with this request</a>
      <p className="text-xs text-muted-foreground">Reference: {artwork.supportReference}</p>
    </div> : null}
    {displayed && artwork.generationEnabled && artwork.requestsRemaining > 0 ? <form className="space-y-3" onSubmit={e => { e.preventDefault(); if (canRevise && correction.trim().length >= 5) submit('revise'); }}>
      <Label htmlFor="artwork-correction">What would you like to change?</Label>
      <Textarea id="artwork-correction" value={correction} onChange={e => setCorrection(e.target.value)} maxLength={2000} disabled={pending}
        placeholder="Describe the detail to change and what you would like to keep." />
      <p className="text-sm text-muted-foreground">Posy will edit this saved image using your complete request. Your previous versions stay available.</p>
      <Button type="submit" variant="outline" className="w-full" disabled={!canRevise || correction.trim().length < 5}>Make this change</Button>
    </form> : null}
    {!artwork.generationEnabled && !artwork.supportReference ? <p role="status" className="text-sm">New artwork requests are temporarily unavailable. You can still keep a saved image.</p> : null}
    <p className="text-sm text-muted-foreground">{artwork.requestsRemaining > 0 ? `${artwork.requestsRemaining} artwork ${artwork.requestsRemaining === 1 ? 'request' : 'requests'} remaining for this event.` : 'You’ve reached this event’s artwork limit. Keep a saved image or contact support.'}</p>
    <details className="text-sm"><summary className="cursor-pointer font-medium">Your saved request</summary><p className="mt-2 whitespace-pre-wrap">{artwork.savedBrief}</p></details>
    {message ? <p role="status" className="text-sm">{message}</p> : null}
    <Button type="button" variant="ghost" size="sm" disabled={action.isPending} onClick={async () => {
      setMessage('');
      try { await refresh(); if (imageFailed) { setLoadedHash(null); setImageFailed(false); setImageRefresh(n => n + 1); } }
      catch { setMessage('We could not reconnect. Your saved work is unchanged.'); }
    }}>Refresh saved status</Button>
  </div>;
}

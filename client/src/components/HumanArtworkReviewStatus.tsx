export type HumanReviewState = 'not-requested' | 'queued' | 'generating' | 'review' | 'approved' | 'rejected' | 'failed';
const titles: Record<HumanReviewState, string> = {
  'not-requested': 'Your artwork will be reviewed by a person',
  queued: 'Your artwork request is waiting for review',
  generating: 'Preparing your artwork for review',
  review: 'Your artwork is awaiting a human decision',
  approved: 'Your artwork has been approved',
  rejected: 'This artwork was not approved',
  failed: 'Your artwork needs attention',
};
export default function HumanArtworkReviewStatus({ state, brief }: { state: HumanReviewState; brief?: string }) {
  return <div className="px-6 py-6 text-left" role="status" data-testid="human-artwork-review-status">
    <p className="font-serif text-xl font-semibold text-foreground">{titles[state]}</p>
    <p className="mt-3 text-sm text-muted-foreground">
      {state === 'not-requested'
        ? 'Submit your saved brief below. A person must check the artwork before you can see it and continue to checkout.'
        : state === 'rejected' || state === 'failed'
          ? 'Your details are saved. The artwork needs staff attention before it can be released. Checkout remains closed; no automatic retry will run.'
          : 'Your details are saved. Return to this page to check progress. Checkout opens after artwork approval.'}
    </p>
    <p className="mt-3 text-xs text-muted-foreground">Review is not instant. Keep your private return link; this step does not send an email notification.</p>
    {brief ? <details className="mt-4 text-sm"><summary className="cursor-pointer font-medium text-primary">View your saved brief</summary><p className="mt-2 whitespace-pre-wrap text-muted-foreground">{brief}</p></details> : null}
  </div>;
}

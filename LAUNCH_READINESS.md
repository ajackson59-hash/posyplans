# Launch readiness — Preview closeout, 2026-09-05

Release status: **HOLD**. Green automated checks establish software contracts,
not superior generated artwork, payment settlement or message delivery.
PR #44 remains draft, unmerged and Preview-only. No Production changes.

## Changes in this closeout

- Reserve a generation job through one owner-scoped, budget-guarded database
  compare-and-set. Concurrent stale requests cannot schedule duplicate jobs.
  A missing reservation never becomes permission to spend.
- Require observed, located evidence before teaser scoring. Match every visual
  requirement by its exact server-owned label; do not recycle positional answers.
  Missing evidence, duplicate answers, malformed scores and truncated responses
  fail closed. The six 5/5 floors and binary checks remain unchanged.
- Preserve the complete critic verdict, token usage, generation timing and hash
  of the exact reviewed 560px teaser alongside original full-resolution artwork.
  Existing score-only records remain readable. Preparation/review exceptions
  also retain returned provider bytes for protected owner review.
- Disable hidden HTTP retries for preview image calls. Two initial requests and
  at most one eligible correction remain the named-preview limit per job.
- Keep API response bodies out of request logs, including owner URLs, email,
  guest details and image bytes. Retained evidence remains owner-scoped.
- Describe direction-card fallback honestly in the UI and announce progress to
  assistive technology. Do not promise immediate image completion.

These are shared customer-path corrections, not edits to a single QA image.
No database schema migration, package upgrade or scheduled paid canary is added.

## Evidence boundaries and release gates

| Area | Automated coverage | Live proof required before release |
| --- | --- | --- |
| Image quality | Exact teaser transform; high-quality named path; strict scores; complete requirements; retry bounds; private rejects; full-resolution reuse | Human inspection and strict acceptance on named-child, original-child and adult-event briefs, including crowded required details. Latest retained canary did not pass; no claim that the new reviewer is calibrated yet. |
| Speed/recovery | Immediate direction card; non-blocking background job; bounded timeout/abort; reload/readiness; duplicate submission | Measure first response and final artwork at mobile widths under realistic load. A roughly four-minute prior run is not a proven conversion-friendly experience. |
| Payment/access | Spark/Plus entitlement; currency; checkout handoff; paid image apply; email binding | Stripe test-mode checkout, signed webhook, duplicate webhook, return/reload and correct unlock. No real purchase required. |
| Delivery/RSVP | Email recovery; token-scoped guest routes; RSVP rendering; startup failure recovery | Controlled test recipient receives invitation and recovery link; guest RSVP round trip persists. No real guests or unsolicited messages. |
| Privacy/security | Owner-scoped evidence; no public rejected assets; response-log hygiene; protected Preview | Confirm deployed protection, secret availability without exposing values, and no owner URLs in logs. Audit access revocation and retention policy before broad rollout. |
| Cost/operations | Atomic per-event reservation and bounded image requests; image-output estimate labels | Verify account-wide abuse/rate controls, usage alerts, provider quotas, support/fallback ownership and rollback procedure. Per-event limits alone do not cap an attacker creating many events. |
| Commercial readiness | Existing checkout amounts covered by tests | Confirm product copy, rights to commercial named-theme assets, support/refund process, privacy terms and approved launch scope with the owner. |

## Cost reporting

The previous $0.495 figure estimates three GPT Image 2 high portrait **image
outputs only**. It is not an all-in cap. A source-edit correction has a different
estimate; image input and critic token charges are additional. Review-format
repair may make a second bounded critic call. Do not represent these estimates
as a guaranteed invoice total.

## Safe next validation

Use the exact newly verified Preview SHA. Inspect retained evidence before any
new generation. A further live benchmark must have an explicit request/cost
budget and preserve rejected evidence; do not add build-time or self-modifying
canaries. Do not promote a rejected image or lower the score floors to obtain
a green result. Merge/Production promotion is a separate owner decision after
the live release gates pass.

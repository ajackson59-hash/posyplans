# Customer artwork flow — Priority 1

Implements the September 23 handoff: customers create, keep, or revise saved
artwork without routine staff approval. This is Preview work, not a release
or a claim that the multi-theme quality, payment, or delivery gates passed.

## Continuity boundaries

- Existing events retain their current flow. A server-owned
  `customer_artwork_enabled` flag enrolls newly created events only on the
  `codex/launch-blockers` Vercel Preview branch. Production never enrolls.
- Event 69's approved bird image, archived original, and review history remain
  unchanged. Existing staff review scopes take precedence.
- `POSY_CUSTOMER_ARTWORK_FLOW=false` stops enrollment. Already enrolled events
  retain their saved flow rather than falling back into legacy generation.
- Image spending requires `POSY_CUSTOMER_ARTWORK_GENERATION=true` separately.
  This switch defaults off. No prior paid experiment allowance is reused.
- An optional `POSY_CUSTOMER_ARTWORK_EVENT_IDS` list plus the explicit flow
  switch can enroll specified existing Preview events for controlled tests.
  Never include an active human-review event or reuse a closed paid allowance.

## Customer behavior

The normal pre-payment page displays the retained image at its native aspect
ratio. The customer keeps it or describes a change. Revisions use the selected
saved source, the complete contemporaneous brief, and correction history from
that source's ancestry. Returning to the original does not inherit edits from
a discarded branch. The original and revisions remain selectable.

A durable compare-and-set claim precedes the single provider dispatch. There
are at most four image requests per event across all briefs, no automatic image
retries, and no image calls from GET, refresh, reconnect, selection, or reuse.
Provider usage, request count, duration, source, delivered pixels, and hashes
are retained privately. Unknown outcomes remain unknown. A stale running claim
becomes interrupted after three minutes; reading it never dispatches another
job. A late original result can still be saved. Failed/unknown jobs stop new
requests while allowing the customer to keep an existing image and contact
support using the saved request ID.

Checkout and planning require a current kept image and no running revision.
A new revision never silently changes the kept choice. Planning reuses its
exact pixels without another concept/image request and preserves the selected
theme and palette. The paid dashboard exposes the same version controls and an
explicit action to apply the kept image to the invitation. Wording and styling
remain editable; a previously applied image remains available while another
private draft or changed artwork brief is considered.

Copy and logistics edits do not discard artwork. Changes to the visual brief,
theme, colors, occasion type or milestone require a new current choice, without
resetting the event's request budget. Customer selection is never represented
as staff approval or automated quality certification.

## Persistence and rollout

Apply `20260923174419_customer_artwork_sessions.sql` to the Preview database
before deploying this code. It adds the server-owned enrollment flag (false for
all existing rows) and a private, RLS-enabled session table with no anon or
authenticated grants. The event key enforces one lifetime session; SQL version
checks arbitrate concurrent requests. No existing event is reset or migrated
into the new artwork flow. Rollback is to the preceding Preview commit; keep
the additive table and data for recovery. Production requires its own reviewed
migration and release gate.

## Verification and remaining gates

Automated tests exercise concurrent claims, replay, unknown outcome recovery,
full-brief source edits, independent revision branches, failed edits, stale
choices, four-request bounds across brief changes, owner isolation, no-spend
reads, selection/checkout/planner gates, exact paid reuse, styling preservation,
and the real pre-payment React controls. The local fixture uses synthetic
pixels and injected providers only; it is not shipped by the app and proves no
artwork quality.

The next priority remains live end-to-end artwork quality across ordinary,
named, unusual and known-failure requests. That needs a new explicit paid test
budget. Measure first-image quality, correction success, browser-visible total
time and all-in cost. Then verify fresh payment/Plus, invitation/guest RSVP/
recovery/mobile, and finally the release gates. Nothing in these mechanics
checks closes those later priorities.

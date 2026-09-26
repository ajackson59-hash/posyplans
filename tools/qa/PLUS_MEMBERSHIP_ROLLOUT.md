# Exact Plus membership binding — Preview rollout

The prior email-capture route granted Plus after typing a subscriber's address.
The deployed repair treats contact email separately from paid authority. Two
server-only tables hold exact Stripe subscription state and payment-proven event
bindings. No client role has table access. Spark unlocks remain event-specific.

## Deployment stop

Do not deploy enforcement before preserving existing proven paid access.
The 2026-09-26 read-only Preview inventory found one usable legacy membership,
one with customer/subscription IDs, one matching-contact event, zero matching
Spark-unlocked events and zero matching ready plans. These counts are not proof
that the matching event owns that subscription. Production was not inventoried.

The migration is `20260926022655_verified_plus_memberships.sql`; it has no
automatic backfill. It was applied only to Preview `zniggkeyyohniqrccblm` on
26 September 2026. The separate PostgreSQL suite is included in CI. Production
still needs its own inventory, proven backfill, verification and release.

## Narrow historical Preview exception

`tools/qa/backfill-preview-event66-plus.sql` was applied only to Preview after
the new tables were installed, before enabling the repaired access gate. The
immutable Library checkout report version 6 explicitly records settled monthly
Plus for synthetic Event 66 via Stripe confirmation HTTP 200 at 01:56:36 UTC on
16 September. Server analytics row 1 at 1789523797268 records that subscription's
single subscribed transition. The current subscription fingerprint matches it;
the one existing membership and original event/artwork/no-model guard are still
present. Together this independently recorded history identifies this original
purchase; an email match alone would not.

The SQL aborts on any exact identity, timestamp, status, inventory, artwork or
analytics drift. It inserts only that original subscription and Event 66 binding
idempotently, retaining existing source/contact/plan rows. `observed_at` stays at
the legacy last update, not now. Stripe's original creation timestamp is unknown
and is deliberately NULL; the next trusted reconciliation of that exact
subscription fills it. No different subscription may replace an unknown-age
historical binding until its actual creation time is reconciled. This limited
exception does not establish current live Stripe status or authorize a general
historical email-based backfill.

## Safe backfill

1. With the existing configured Stripe server client, retrieve each retained
   subscription by its stored Stripe ID, expanding `latest_invoice`. This is a
   read-only request. Do not use `/api/checkout/confirm`: it also mutates contact,
   sends email and sends analytics events.
2. Confirm the retrieved customer ID matches the retained membership, Posy's
   `metadata.plan` is `plus`, and the current price is the configured monthly or
   annual product. An active membership requires a paid latest invoice with
   zero amount remaining; a legacy trial needs a future trial end. Record exact
   current status, customer/subscription IDs, Stripe creation time and read time.
3. Resolve only the event named by trusted `metadata.returnToken`. If absent,
   inspect the settled Checkout Session's server-created metadata. A typed email
   match never substitutes for this evidence. Do not send owner tokens to logs
   or reports. Keep invoice details private; report sanitized counts and hashes.
4. After migration approval/application, invoke `reconcilePlusMembership` with
   the verified facts and original event ID. It writes the exact subscription
   and event binding atomically, without emails, analytics or provider work.
   Use source `subscription` and a private reconciliation source ID. Verify the
   resulting event access and unchanged Spark/artwork/contact/plan records.
5. Report original bindings, unresolved secondary events and standalone Plus
   purchases separately. Do not enforce a gate that silently strands unresolved
   paid users. Preserve existing content; never infer proof from legacy email
   association, create a free entitlement, or ask a paid member to buy again.

## Current limitations

- Existing recovery only sends event owner links; it does not create a new
  membership authentication session. Preview now provides the separate inbox
  verification flow described below; other environments retain recovery/help.
- New-event reuse and prior standalone Plus access use this verification flow.
  Actual inbox receipt and live-account acceptance remain release gates.
  New standalone Plus purchases are refused before any
  Stripe/email/write action; Pricing directs visitors to start an event first.
  Previously settled standalone purchases record their exact subscription but
  explicitly require recovery, never claiming event access. A source owner token is not silently promoted to a
  broader membership credential by this repair.
- Cancellation updates only its exact subscription even when billing email is
  missing/changed or the legacy email row now points to another subscription.
- Contact edits neither confer nor detach a payment-proven membership.
- Rollback to email-authority code reintroduces the bypass. Keep the additive
  membership records and settle active work before any application rollback.

## Verification

Route tests cover typed-email denial, retained access after contact correction,
Spark/abandoned checkout denial, exact monthly/annual settlement, foreign
customer rejection, standalone same-email isolation, unrelated product denial
and cancellation despite changed email. UI tests verify recovery guidance does
not dispatch messages or generation. The separate disposable-PG suite covers
same-email event isolation, idempotency/concurrency, exact cancellation,
stale observations, changed identity, rollback and client-role denials.

## Billing inbox verification — Preview only

`plusLinkRoutes`, `plusMembershipProof`, and `plusLinkStore` implement an
explicit eight-digit code flow on `codex/launch-blockers` in Vercel Preview.
Apply `20260926031348_plus_email_verifications.sql` before the application.
It adds private challenge/rate tables and one binding-source value; it does not
alter existing customer, event, artwork or subscription data. Production is
deliberately disabled and has not been migrated for this flow.

The event owner requests a code for their billing email. A fresh read through
the existing Stripe client verifies the exact customer, configured Plus price,
environment, paid invoice, or still-valid legacy trial. A legacy email record
is only an identity hint. Bounded customer/subscription discovery also handles
prior standalone purchases. Stripe's case-sensitive email lookup can miss
unusual historical casing; incomplete or uncertain results require support.
Reads have a two-second request timeout and a ten-second result deadline.
The SDK may retry an initial closed connection; there is no application retry.

Each code is random, expires after ten minutes, and is stored only as an HMAC
bound to its challenge, recipient, event, subscription and customer. The HMAC
key derives from the existing Stripe secret under a separate domain; key
rotation invalidates outstanding codes. The raw code is only in the explicit
email and browser input, never logs, URLs or browser storage. New requests are
limited by durable event and recipient counters (3/hour each), IP (12/hour),
global (60/hour), and a 60-second cooldown. Each challenge permits five guesses.
Hourly ceilings are fixed buckets; cooldown serialization spans boundaries.

Requests return the same neutral response before provider lookup. Replaying a
request UUID does not send again. The existing sender uses a challenge-specific
idempotency key and ten-second timeout. Uncertain delivery, missing provider ID
or lost worker remains unredeemable; only a new explicit bounded request can
try again. Provider acceptance is not evidence of inbox receipt.

Redeeming the code rechecks exact current billing facts outside the database
transaction, then atomically consumes the code and binds only this event. A
newer/equal cancellation, conflicting binding, superseded code, wrong event,
expired code or lost execution claim cannot grant access. Existing verified
bindings survive contact edits. An unchecked recovery option lets the user
explicitly save this verified inbox as the event contact only if that field is
empty; the conditional write commits with the binding. Existing contact is
never replaced. No checkout confirmation, purchase, analytics, automatic
recovery email or plan generation occurs in this linking operation.

The saved `email_verification` binding requires a subsequent explicit Build or
Try again action to start/resume a first plan. Both browser and server enforce
this after reload or another-tab return. An existing running plan is polled;
ready plans retain the separate reviewed regeneration path.

Verification uses mocked provider/email/browser tests and disposable PostgreSQL
concurrency/permissions tests. Hosted checks must not request a real code or
start a plan without the corresponding authorization. The paid artwork policy
remains paused and its counters are not reset. No new provider or secret is
required. Retention cleanup for private challenge recipients/rate records has
not been scheduled; include this in the broader privacy/retention launch gate.

Keep the new private tables on rollback. An older application may lack the
explicit-start safeguard, so pause/drain work before rollback and do not treat
the older build as equivalent protection. Never roll back to email-only access.

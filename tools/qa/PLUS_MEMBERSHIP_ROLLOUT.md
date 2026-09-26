# Exact Plus membership binding — Preview rollout

The prior email-capture route grants Plus after typing a subscriber's address.
The prepared fix treats contact email separately from paid authority. Two new
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
  membership authentication session. The prepared UI directs existing members
  to their paid event/recovery and support, with no automatic message.
- New-event reuse and standalone Plus access need an explicit proof mechanism
  before public launch. New standalone Plus purchases are refused before any
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

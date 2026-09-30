# Production release preparation — 27 September 2026

**Prepared, not released. No Production database, configuration, billing or
deployment mutation is authorized by this document.** The owner authorized
readiness review and implementation with Production and new image spending off.
Existing accepted artwork, saved-image/recovery/navigation, monthly Plus,
annual billing/cancellation and label checks remain closed.

## Observed live baseline

- Vercel project `prj_nUcsJFNct3taci0trmbHaOXiCJv2`, team
  `team_Lz7XQdyv2z4AJWlRuImDNrWC`; `posyplans.com` resolves to Production
  `dpl_JDVZRMLpPEbfoP6LREzQxdZKikAi`, source
  `db829a1353340eab3444cd9efc14c6779c46159e`. Main still matches it.
- Database `jvioxjetpqafkbwqihto`: 78 events; 2 Spark-unlocked; 11 ready/partial
  plans; 1 saved-artwork event; 1 event marked generating, created about 66 days
  ago. That old status is not proof of a currently running worker. Do not restart
  or delete it automatically.
- Legacy entitlements: 2 `plus_active`, 2 `plus_trial` (neither currently
  unexpired), 3 `spark`. All 4 Plus rows retain customer/subscription IDs.
  These are database statuses, not freshly verified Stripe payment facts.
- 41 events match those Plus contact emails. Email equality does not establish
  ownership of a subscription. Do not bind all 41 or ask anyone to purchase again.
- All 14 public tables have RLS enabled and no anon/authenticated SELECT grants.
  Zero duplicate non-null legacy artwork idempotency keys were found.
- Before any change, event snapshot `b411d4dfdc5ecc56e6f984842ea70283`;
  legacy entitlement snapshot `bb01d8034259a8be7125635964810efa`.
  These hashes identify this observation, not a backup. Capture a restorable
  backup and a fresh snapshot at the actual release window.

## Configuration findings, values kept masked

Production project variables contain DATABASE_URL, STRIPE_SECRET_KEY, all three
price IDs, RESEND_API_KEY, RESEND_FROM_EMAIL, OPENAI_API_KEY, ANTHROPIC_API_KEY and
GEMINI_API_KEY. No shared variables are linked. Production STRIPE_WEBHOOK_SECRET
and PUBLIC_APP_ORIGIN are absent. RESEND_REPLY_TO_EMAIL is Preview-only; the new
code defaults reply-to to hello@posyplans.com. Production also has GA4, Meta Pixel,
Meta CAPI and Cloudflare analytics variables: retain the consent/policy review.

The current live checkout-config GET returns only `configured:true`; it cannot
prove live mode, current prices or webhook readiness. The live email-config GET
returns 404 because the older application lacks that route. No email was sent.
No secret was revealed, copied, rotated or changed. Presence is not proof of a
working provider credential or verified sender domain.

**Before billing release:** verify the current live Stripe products/prices and
exact existing subscriptions read-only; register/check the live webhook endpoint
`https://posyplans.com/api/stripe/webhook`, its required events and signing secret.
Do not reuse Sandbox secrets or redo the passed purchase/cancellation tests.
Stripe is not exposed as a connected API here; the earlier stopped Google login
must not be retried to work around that limitation.

## Implemented controls

| Control | Default | Behavior |
| --- | --- | --- |
| POSY_PRODUCTION_ARTWORK_FLOW | off | Enrolls new events only when exactly true; Preview ID lists never enroll Production events. |
| POSY_PRODUCTION_ARTWORK_GENERATION | off | Blocks Production at both request reservation and the physical provider boundary; every legacy adapter is covered too. |
| POSY_PRODUCTION_ARTWORK_REQUEST_LIMIT | 4 | Configurable per-event lifetime AI allowance, including the first preview and image edits. Accepts integers 1–100; malformed values stop new requests. Independent of Preview evaluation envelopes and shared spending limits. |
| POSY_PRODUCTION_IMAGE_CONCURRENCY | 1 | Accepts integers 1–8; malformed values close new requests. Counts reserved and dispatched work atomically under the policy lock. |
| POSY_PRODUCTION_PLUS_LINK | off | Enables the same tested payment-proof and one-time inbox-code flow only when exactly true. |
| PUBLIC_APP_ORIGIN | unset | Set https://posyplans.com for custom-domain same-origin Plus verification. |
| launch-production-image-v1 | paused, zero limits | Separate durable policy; no Preview counter, allowance, exception or failed request is imported. |

Previously enrolled events retain their saved workspace, selection and images
when enrollment or generation is disabled. Valid late completions remain
persistable after shutdown; duplicate workers cannot overwrite the winner.
New generation requires both an explicit environment opt-in and a separately
approved, unpaused database allowance. Per-event lifetime requests default to four;
an explicitly configured six permits one first image plus five image edits per
event, while the shared policy can still stop requests earlier. Subscription
renewal does not reset an event's allowance. Invitation wording changes do not
consume image requests. No allowance change is enabled by this source update.
Requests retain the same model, quality, full brief, source pixels and zero
automatic retries; this patch does not fix provider refusals.

Unknown outcomes retain their reservations and pause the affected environment's
policy. Production does not accept Preview continuation exceptions. This is a
conservative initial release: one unknown result can pause new images for other
customers, while saved artwork and recovery remain usable. It is not an
unattended high-volume launch design or a provider-account dollar cap. Concurrency
tests prove transaction behavior, not provider throughput or image quality.

## Exact additive schema plan

`tools/release/production-release-manifest.json` pins the ordered files and
SHA256 hashes. None have been applied to Production in this work.

1. Legacy artwork idempotency index (only after confirming duplicate count zero).
2. Private human artwork reviews (feature remains Preview-only).
3. Customer artwork sessions plus `events.customer_artwork_enabled=false`.
4. Private staged plan regenerations.
5. Private image policy/permit tables (Preview policy installs paused at zero).
6. Exact Plus membership and event bindings; no email-based backfill.
7. Private Plus verification challenges/rate limits.
8. Private image reconciliation audit.
9. Private bounded-continuation machinery; creates no exception or spend.
10. Separate Production image policy, paused at zero; conflict never resets it.

Do not blindly run `db push`: Production history contains differently timestamped
equivalent August migrations plus Production-only recovery-index/http-extension
entries. The selected ten files are the missing objects needed by this candidate.
Recheck actual columns, constraints, indexes and history immediately before apply;
stop on drift. Run the first migration under a write-blocking lock on the legacy
attempt table and abort if duplicates exist, so its historical deduplication
clause cannot erase newly observed keys. Apply through reviewed migrations with
history recorded; do not reset or rewrite existing migration history.

All new private tables retain RLS and revoked public/anon/authenticated grants.
Verify grants and defaults after application. No Preview tokens, event rows,
synthetic payments, retained images or spend records belong in this migration.
Existing events remain unenrolled until an explicit per-event migration is
reviewed; do not flip every old event into the new workflow.

## Paid-access preservation before application release

Use `tools/qa/PLUS_MEMBERSHIP_ROLLOUT.md` and the read-only inventory SQL in
`tools/release/production-preservation-inventory.sql`.

For each of the four legacy Plus identities, read the exact subscription and
latest invoice using the existing Production Stripe client. Verify environment,
customer, configured price, current status, paid invoice/trial and original
server-created checkout/subscription event metadata. Keep credentials, inboxes,
subscription IDs and owner tokens private. A current contact match is insufficient.

Prepare each exact `reconcilePlusMembership` input privately, with trusted source
and original event. Run it only in the separately approved migration window,
after the new tables exist and before serving the enforcement code. Account for
secondary events and standalone purchases via proven inbox linking or an
explicit preservation decision. If identity is unresolved, stop the release;
never silently remove paid access or grant it from typed email. Recheck the two
Spark unlocks and existing saved artwork/plan rows unchanged.

The raw event-row checksum changes when the new default-false column is added.
Compare the original column projection or per-field values after migration,
not the full-row checksum alone. Contact, artwork, payment IDs and plan rows must
not change as an incidental effect of schema installation.

## Release sequence and stop points

1. Close provider-refusal scope (case 15869610, Frozen75/Moana80), retention and
   deletion implementation, required business filing, exact paid-access mapping,
   and live billing/email configuration. Nothing here accepts a reduced image
   promise or resolves the provider case. Naming remains Posy; no personal-name
   question is reopened.
2. Review exact candidate commit, green normal and disposable-PostgreSQL CI,
   pinned migrations, protected-member mappings, first-window request/create/edit
   limits and concurrency, monitoring owner, backup and shutdown procedure.
   No nonzero Production allowance is selected or approved by this document.
3. Obtain explicit Production release authorization. Quiesce new work and
   identify/drain actual workers. Apply reviewed additive migrations and exact
   proven bindings; verify invariants before deploying application enforcement.
4. Build with Production configuration, initially with generation disabled and
   the durable policy paused. Do not simply promote an artifact built with
   Preview environment values. Verify health, saved private/public images,
   membership access, email configuration and same-origin behavior without
   new purchases, emails or model calls.
5. Only within the approved release window, enable the approved enrollment/link
   switches and bounded spending policy. Any live canary is a separate exact
   request budget, not permission to retry Frozen75/Moana80 or run a broad suite.
6. Monitor provider errors, unknown outcomes, request counters/capacity, webhook
   failures, membership denials and email delivery. Use private diagnostic records;
   no raw prompts, provider bodies, recipient addresses or owner links in logs.

## Shutdown and rollback

- Pause `launch-production-image-v1` in the database first. Every physical image
  dispatch rechecks this row, including already-deployed workers. Preserve every
  counter and request; pausing does not cancel an HTTP request already sent.
- Disable Production generation and new enrollment. Saved enrolled workspaces
  stay available. Let dispatched workers persist their results; investigate
  uncertain outcomes without retries or refunds to request counters.
- Disable new Plus linking if necessary; preserve existing exact bindings and
  the additive schema. Do not drop tables, revert migrations or delete artwork.
- The observed old Production build lacks the new authority/dispatch protections.
  It is an inventory baseline, **not an approved application rollback target**.
  Prefer a fix-forward or a separately verified compatible build retaining these
  protections. Do not restore email-only membership authority.

## Verification

Focused offline route/provider checks, TypeScript, build and the GitHub CI suites
are required for this patch. PostgreSQL tests exercise isolated policies,
concurrent reservation ceilings, one-use dispatch, paused defaults, missing-policy
denial, unknown outcomes, and completion after shutdown using synthetic data and
forbidden provider HTTP. Exact results and Preview deployment are recorded in the
current launch report after CI completes. No Production action is a test here.

# Reviewed event retention operations

These are private operator tools, not application routes, a scheduled purge, or a claim of complete personal-data erasure. They have not been run against live data. No policy wording is changed here.

The default `report` command is read-only. It lists event IDs, last recorded activity and dates only, with no names, emails, tokens or artwork. Eligibility uses PostgreSQL calendar arithmetic: `last_activity_at + interval '12 months'`, in UTC. An event without server activity has **unknown history** and never automatically becomes eligible from its creation date. Review the list monthly and record outcomes in the restricted retention operations log. Appointment of that operator and actual recurring review remain operational requirements.

`plan` is also read-only. It inventories all known event content, produces a SHA-256 scope fingerprint and lists holds. Plans expire after 15 minutes. Any change to event content, activity, related accounting, known schema or counts invalidates the reviewed fingerprint. The database supplies hashes, so plan files do not contain event content. Treat event IDs and hashes as restricted operational records, not anonymous public data.

## Commands

Use a private operator connection whose rights include every listed table and audit-table reads. No fallback to the application's `DATABASE_URL` exists. Supply `POSY_RETENTION_DATABASE_URL` securely in the operator environment and `POSY_RETENTION_EXPECTED_HOST` separately. Do not put credentials in command history, screenshots, reports or chat. Hosted TLS certificate verification is required.

```sh
node tools/retention/cli.mjs report
node tools/retention/cli.mjs plan --event=123 --basis=verified_request > reviewed-plan.json
# Alternatively: --basis=inactivity (known activity must be at least 12 calendar months old)
node tools/retention/cli.mjs execute --plan=reviewed-plan.json --approval=approval.json --receipt=receipt.json
```

Only `execute` can mutate data. It requires a reviewed plan and an approval file containing all of:

```json
{
  "execute": true,
  "databaseHost": "exact-approved-host",
  "eventId": 123,
  "basis": "verified_request",
  "fingerprint": "exact-fingerprint-from-reviewed-plan",
  "requestId": "opaque_request_123",
  "requesterVerifiedForWholeEvent": true,
  "maintenanceReference": "opaque_maintenance_123",
  "maintenanceActive": true,
  "allWritersDrained": true,
  "legacyWorkersCannotResume": true,
  "residualScopesReviewed": true,
  "backupDeletionLedgerPrepared": true
}
```

For inactivity, set `basis` to `inactivity` and `inactivityReviewApproved` to true. Do not assert requester verification in place of verifying ownership through a trusted existing mechanism. Public invitation access or an unverified typed email is not sufficient. This tool supports a whole event only; guest-only and whole-account requests need a separate scoped process.

## Operator procedure

1. Verify request authority and scope, or review the known inactivity cutoff. Record an opaque request ID and ownership verification privately. Review holds, external assets, copies and limited billing/security retention before execution.
2. Establish an approved maintenance window covering all application/worker paths. Stop new requests, checkout fulfillment writes, email workers, planning and artwork activity. Verify running jobs have drained against the actual configured maximum runtime and observable work. Confirm queued/old workers cannot resume after deletion. Image switches alone are insufficient. A stale `generating` value alone does not prove a worker is active or drained.
3. **Legacy child tables lack foreign keys.** SQL locks stabilize data during the transaction but cannot stop an old worker inserting a child after commit. The approval flags are operator attestations, not automated checks of Vercel or providers. If a verified pause/drain and no-late-writes condition cannot be established, stop. No claim of an application-wide write fence is made.
4. Prepare a restricted deletion ledger **outside ordinary database restore scope** before execution, with request ID, exact event ID, intended action and pending status. Store no guest list, artwork, prompts or tokens there. Ensure it survives a restore. A crash after database commit but before receipt persistence must be reconciled using that pending record, not by assuming rollback.
5. Generate a fresh plan while maintenance remains active. Review counts, exact event ID, residuals and fingerprint. Complete approval separately; the tool does not verify human identity or automatically approve deletion.
6. Execute one event. All known content and shared tables receive `SHARE ROW EXCLUSIVE` locks, so this operation briefly blocks their writes. Lock acquisition is bounded at 5 seconds; each statement at 30 seconds. These are **not** an overall transaction deadline. Any failure rolls back; do not automatically retry it.
7. Confirm the returned committed receipt, absence of scoped content, and old host/guest/share/recovery paths no longer expose that event before normal traffic resumes. An event-row deletion removes its stored tokens, but this SQL test alone does not validate running HTTP paths or browser caches. Archive the minimal receipt in the external ledger and finish external-copy review before telling a requester what was erased.
8. Restore procedure: keep the application paused; replay/review the external deletion ledger against the restored database before normal access. Apply this same fingerprint/hold/drain procedure. Missing events mean no event content remains, not that every provider copy is gone. Keep the ledger through the verified backup retention horizon and minimize it afterward according to its limited purpose.

## What is removed and preserved

The transaction explicitly deletes scoped guests, budget/menu/shopping/timeline items, master-plan generation history, saved/rejected/original previews and attempts, generation runs and credentials, human reviews, customer-artwork payloads, all plan-regeneration snapshots, inbox-verification challenges, the exact event-to-Plus binding and retention activity, then the event itself. It never relies solely on foreign-key cascades. Changes to unrelated events and known shared records abort the transaction.

Ordinary image-spend rows survive with only their event reference set to null by the existing foreign key. Their request IDs, status, usage, calls and policy counters remain unchanged. Events 75 and 80 and any event linked to immutable reconciliation/continuation evidence (including preserved snapshots or allowed-event lists) stop **before deletion**. Reserved, dispatched, unknown or reconciled image requests also stop for separate review. No audit triggers are disabled. These exceptions require a separately reviewed redaction/tombstone solution; the tool does not resolve them.

Legacy `ai_first_image_ledger` rows are preserved unchanged because they enforce contact-based cost caps and idempotency. They include email, event ID, concept fingerprint, preview/reuse references and cost facts, **not image bytes or prompt text** in the reviewed schema. The retained contact/identifiers require a documented limited retention purpose, access restriction and review/expiry decision; preservation is not permission for indefinite retention.

Shared subscriptions, email entitlements, rate buckets, analytics and theme cache remain unchanged. Analytics JSON and cache text can retain personal details; they are expressly **outstanding scoped-review items**, not declared anonymous or erased. Deleting one event does not authorize cancellation, refunds, deletion of another event, removal of a shared IP bucket, or resetting spend controls.

Provider logs/records, support evidence, external asset URLs/CDN objects, hosting logs, backups, browser history and guest downloads are outside this executor. Inventory actual matching external objects and use authorized provider controls separately. A completed receipt means **event database content deleted with stated residual scopes**, not universal or complete erasure.

## Verification

The isolated test suite applies repository migrations to an in-memory PostgreSQL runtime and uses only synthetic records. It verifies ordinary content removal; untouched unrelated events/shared subscriptions/counters; stale-plan rejection; hold failures with complete rollback; calendar cutoff and missing-history handling; required maintenance attestations; and rejection of unknown event storage. It never connects to the environment's application database or image providers.

Set `POSY_RETENTION_PGLITE_MODULE` to an installed, pinned PGlite module entry, then run:

```sh
node --test tools/retention/retention.test.mjs
```

The suite fails explicitly when the disposable runtime is absent. No native multi-connection worker race or hosted provider deletion is claimed by this single-connection runtime test. PostgreSQL lock behavior: https://www.postgresql.org/docs/17/sql-lock.html .

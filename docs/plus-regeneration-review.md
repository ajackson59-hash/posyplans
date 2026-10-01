# Plus plan regeneration

A completed plan previously returned 409 even for an active Plus host. The new Dashboard action creates an isolated version of the event summary, budget, menu, shopping list and timeline. The host reviews it before deliberately replacing those sections. Failed or interrupted work leaves the existing plan and customer edits intact.

## State and safety boundaries

- New generation requires current Plus entitlement. Applying or discarding already-created work remains available to its owner after entitlement expires.
- The owner-token routes are private and uncached. Candidate responses exclude snapshots, payment/contact data and credentials.
- One unresolved operation per event and a unique event/request key prevent duplicate dispatch. Reloads read saved state; retries of an uncertain request reuse its key.
- Candidate stages are durable. Interrupted work becomes failed after ten minutes without a checkpoint; it is never automatically resent. The host must dismiss it and deliberately request a new version.
- Application locks the event, compares the full planning fingerprint, archives the previous plan, replaces the four section tables and marks the operation applied in one transaction. Repeated application does not append content.
- The fingerprint includes the effective guest count used for generation. Plan and guest mutations acquire the same parent-event lock, preventing an edit from slipping between comparison and replacement.
- Replacement updates only `eventIdentity` and the four planning sections. It preserves artwork selection, invitation styling/publication, guest records and access tokens. The previous plan archive is server-side; a customer restore interface is outside this change.

## First-plan recovery

The initial planner now obtains a durable execution claim under the same event lock. Concurrent requests receive the same generation without starting another worker. Each stage's content and resume checkpoint commit atomically.

Every production worker receives a monotonically increasing claim timestamp. It checks that exact claim and its ten-minute deadline before provider dispatch, stage publication, failure updates and completion. An expired worker cannot change a newer run. Polling can mark an interrupted claim failed, but cannot dispatch work. Ordinary page loads send `resumeInterrupted: false`; only the explicit retry action sends `true`. Completed stages remain saved, and an unknown provider outcome is never automatically resent.

## Database and rollout prerequisites

The only new DDL is `supabase/migrations/20260925042025_staged_plan_regenerations.sql`. It creates private `public.plan_regenerations` with foreign-key, idempotency, unresolved-operation and state constraints, RLS, and revoked client-role grants. It does not modify existing rows or apply the repository's historical baseline.

The existing ledger is `public.master_planner_generations`, using its existing `reserved_at` timestamp as the execution claim. Its text `state` column must accept `running`. Existing tables are `events`, `guests`, `budget_items`, `menu_items`, `shopping_list_items`, and `timeline_items`. The server database role needs the existing read/write privileges and event-row locking, plus access to the new private table.

Before rollout, verify the additive migration against the exact target schema and test transactions with the actual PostgreSQL driver. Verify concurrent reservation, idempotent apply, rollback after insertion failure, edit/headcount conflicts, and rejection of expired worker writes. The default regression suite exercises production store code through a deterministic transaction adapter; those tests do not establish PostgreSQL lock behavior or deployed RLS.

## Isolated PostgreSQL verification

`npm run test:postgres` is a separate, explicitly enabled integration suite using the real PostgreSQL driver. It targets a disposable local database named `posy_integration`; never give it a Preview or Production connection string. The test schema and rows are fixtures, and the suite creates or removes them. Use a dedicated database with no customer data and the local test credentials below. Provider credentials are deliberately invalid; integration tests must not send AI requests.

With a disposable PostgreSQL 16 instance running on `127.0.0.1:5432`, run:

```sh
POSY_POSTGRES_INTEGRATION=1 \
POSY_POSTGRES_INTEGRATION_URL='postgres://posy_integration:local-only-test@127.0.0.1:5432/posy_integration' \
DATABASE_URL='postgres://posy_integration:local-only-test@127.0.0.1:5432/posy_integration' \
ANTHROPIC_API_KEY=forbidden-in-integration \
OPENAI_API_KEY=forbidden-in-integration \
npm run test:postgres
```

The `PostgreSQL transaction verification` job in `.github/workflows/verify.yml` provisions its own `postgres:16.15-bookworm` service, waits for database health, and runs this command with a ten-minute job limit. It uses only repository read permission and local service credentials. The existing pull-request trigger runs it when the open launch PR receives another commit; no duplicate push trigger is added for that branch. The existing launch-QA push trigger and its email-health check retain their original branch and Preview alias.

Use the **PostgreSQL transaction verification** job for the exact commit as execution evidence; local collection and type checks are not proof of a passing database run. No local PostgreSQL server or Docker daemon was available during development. A passing integration run will establish behavior against that isolated PostgreSQL instance; checking the exact target schema and hosted role configuration remains a rollout prerequisite.

## Deployment boundary

Old deployments do not understand the new execution fences. Allow existing first-plan workers from earlier code to finish before exposing the new claim behavior; use isolated Preview fixtures for acceptance. The configured Vercel function duration remains 300 seconds. `waitUntil` extends request work within that limit; it is not a durable job queue.

The integration suite applies DDL only to its disposable local database. It does not apply hosted migrations, deploy the application, send messages, purchase anything, or make paid provider requests.

For an application rollback, retain the additive `plan_regenerations` table and its saved candidates/archives. Drain active initial-generation and regeneration workers before switching versions, because older application code lacks these execution fences. Rollback must not reset artwork evaluation allowances or reopen exhausted image requests.

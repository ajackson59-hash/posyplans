# Preview image request guard

The `launch-preview-image-v1` policy is a durable request envelope for
`VERCEL_ENV=preview` and `VERCEL_GIT_COMMIT_REF=codex/launch-blockers`.
It is not a provider-account dollar cap. Other branches, older deployments,
missing scope variables, and text/classifier/critic requests are outside it.

Every physical image transport checks a server-issued, single-use permit.
The customer session claim and lifetime counters commit in one transaction.
Only one unresolved request can exist across events. A fresh execution ID
fences completion to the worker that won dispatch. No automatic retry,
timeout refund, expiration, deployment reset, or browser reset is allowed.
Unknown billing or a failed image pauses the policy; an abandoned reservation
also blocks new work. Saved image reads, selection, and paid reuse remain usable.

Schema installation creates a paused policy with zero limits. Preview history
must be reconciled separately from retained server evidence. The existing
cohort has four physical calls (two creates, two edits), including the failed
Event 75 call with unknown billing. Imported images with zero new provider
calls do not consume this cohort again. Reconciliation must retain the pause.

Pause the policy before changing limits or reconciling an unresolved request.
Inspect existing permits and retained provider evidence first. Never delete a
permit or reset counters to make work available. Increasing an allowance or
reopening paid generation requires the corresponding user authorization.
No code path currently exposes policy management to customers or reviewers.

An administrator can record reviewed provider-export accounting separately from
provider usage. The additive reconciliation migration introduces the distinct
`reconciled` ledger state and an append-only `image_spend_reconciliations` audit.
It grants no runtime or Data API access to the audit table. Audit insertion and
the exact `unknown` → `reconciled` transition must commit together under a paused
policy, with the original ledger fields, session payload and policy unchanged.
Usage remains SQL NULL, the physical call remains counted, and failed artwork
stays failed. The full exported day's cost is not an attributed request charge.
The audit includes source hashes, export date, as-of date, contextual evidence,
reason, original policy/permit snapshots and the saved-session checksum.

The fixed [Event75 operator transaction](sql/reconcile-event75-image-accounting.sql)
is separate from migrations and application code. It accepts only the reviewed
four-call cohort, exact Event75 permit/session and matching Event74 usage. It
records that the supplied exports show no additional failed-request billing as
of review; it does not claim Event75 cost zero or a final invoice guarantee.
Run only after independently validating the source hashes and account scope.
The transaction remains paused and is idempotent only while that exact evidence
still matches. Its audit and reconciled permit cannot be edited or deleted;
this also prevents deleting the linked event/policy while evidence is retained.
No replay, automatic unpause, retry of Event75, counter reset or limit increase
is part of reconciliation. Every future `unknown` request still blocks work.
The existing `historical` state continues to mean imported retained usage;
it is never used to relabel an unknown request as successful or measured.

Before deploying, run type checks, normal regression tests and the disposable
PostgreSQL suite. Verify the exact Preview branch/deployment identity, policy
pause, counters, unresolved records, and unchanged saved-session hashes.
Hosted checks must not invoke an image, critic, classifier, planner, purchase,
or message solely to demonstrate this guard.

Rollback to code before this guard removes provider-boundary enforcement.
Keep the existing Preview generation controls closed and retain the additive
tables and all ledger evidence. Do not describe an old deployment as protected
by this policy. Production enablement needs its own reviewed scope and release.

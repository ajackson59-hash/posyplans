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

Before deploying, run type checks, normal regression tests and the disposable
PostgreSQL suite. Verify the exact Preview branch/deployment identity, policy
pause, counters, unresolved records, and unchanged saved-session hashes.
Hosted checks must not invoke an image, critic, classifier, planner, purchase,
or message solely to demonstrate this guard.

Rollback to code before this guard removes provider-boundary enforcement.
Keep the existing Preview generation controls closed and retain the additive
tables and all ledger evidence. Do not describe an old deployment as protected
by this policy. Production enablement needs its own reviewed scope and release.

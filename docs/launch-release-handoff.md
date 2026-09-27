# Posy launch handoff — 27 September 2026

This is the current, finite release handoff. Older QA runbooks describe past
experiments and do not reopen completed customer checks or authorize new spend.

Update after the owner's 16:51 EDT instruction: Production controls have been
prepared with separate opt-ins and a paused zero-allowance policy. Read-only live
inventory found missing schemas, four legacy Plus identities requiring exact
payment provenance, and a missing Production Stripe webhook secret. The exact
inventory, additive migration manifest, configuration and shutdown sequence are
in `production-release-readiness.md`. No Production change has been made.

## Completed and preserved

- Accepted artwork: construction, Blippi/Meekah, KPop, garden photography,
  flat geometry and lacquer inlay. The geometry spacing edit remains technically
  partial and was accepted with that limitation. Do not request approval again.
- Real-inbox event recovery, saved content after refresh, invitation navigation,
  monthly Plus linking, annual Plus billing and cancellation are completed.
  The latter two were reaffirmed by the user on September 27 at 15:51 EDT.
- Spark-to-Plus checkout label correction is user-completed. Do not repeat it.

## Image issue that is not yet resolved

Frozen/Event75 and Moana/Event80 returned output-moderation errors before any
image bytes. OpenAI case 15869610 is already escalated. No request-level reason,
corrective action or billing decision has been supplied. Do not infer copyright
or a prohibited prompt from the output-stage marker. No automatic retry, prompt
workaround, provider substitution or new paid qualification is authorized here.

The September 27 fix retains a bounded, credential-redacted provider response
privately for future support investigations, with its original hash and size.
Diagnostics now distinguish absent, empty, invalid and filtered categories.
This cannot reconstruct discarded responses for75/80 or fix their refusal.
It changes neither request prompts nor model, image quality, moderation settings,
spending limits or billing status. The successful six cases are qualification
evidence for those cases, not a general guarantee for every prompt.

The next image decision depends on provider clarification or an explicitly
accepted limited launch with the already-tested recovery path. A fallback is
not a repaired generator. Do not silently choose a reduced launch promise.

## Production handoff requirements

1. **Enable the tested workflow deliberately.** `customerArtworkRolloutEnabled`
   and `customerArtworkEventEnabled` now support a separate, default-off
   Production rollout. Preview flags and event IDs cannot enable it. Apply the
   reviewed schemas and protect existing paid access before deployment; enable
   only in the separately authorized release window.
2. **Provision an approved Production request budget.** The durable policy and
   `imageSpendGuardEnabled` now includes Production, where every adapter fails
   closed unless explicitly enabled with a valid Production permit. Do not reuse the exhausted
   Preview allowance, reset its counters or remove the pause. Production needs
   its own reviewed limits, failure handling and provider-boundary enforcement.
   Production has bounded concurrent reservations; unknown outcomes still pause
   new work. Database concurrency tests are not provider capacity qualification.
3. **Reconcile migrations and existing memberships before enforcement.** Use
   `tools/qa/PLUS_MEMBERSHIP_ROLLOUT.md` for the evidence-bound preservation
   requirements. Inventory the target schema and paid bindings read-only, prepare
   the exact additive migration/backfill plan and rollback, then obtain the
   separate Production release authorization. Never copy Preview customer tokens,
   event fixtures or synthetic membership bindings into Production.
4. **Close actual policy facts.** Public pages now use hello@posyplans.com,
   disclose the integrated providers, distinguish image limits from full-plan
   regeneration, and omit internal authoring notes. `legal-publication-review.md`
   records the owner's decision to display Posy for now and the unresolved
   retention-process question. Registration is not yet completed; the owner
   intends to register after launch. Do not repeat the displayed-name question
   or treat this copy choice as a legal determination about registration timing.
   Removing draft UI is not legal approval or proof of an operational deletion
   process. Do not enable optional marketing/SMS merely to complete a checklist.

## Verification for this change

84 focused tests across six suites passed: provider diagnostics, real customer
refusal route, saved customer artwork flow, source-image editing, JPEG transport,
and durable provider-permit enforcement. Tests use synthetic responses; no paid
provider is called. TypeScript and the client/server build passed. Exact remote
commit, hosted Preview and CI evidence are recorded in the current launch report.

The read-only Preview audit confirms the private session table has RLS and no
anon/authenticated SELECT grants. The policy remains paused at13 calls/7 creates/
6 edits. No migration or operational data was changed by this patch. Old failed
attempts are preserved. No Production deployment or new support message occurred.

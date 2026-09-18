# Human artwork review — Preview implementation, 2026-09-17

This is an explicitly staffed release workflow. It does not establish automatic visual judgment, a 90-second delivery promise, or production launch readiness. The compact reviewer study remains closed; none of its candidates become human approvals.

## Activation boundary

All four conditions must hold: `VERCEL_ENV=preview`, `VERCEL_GIT_COMMIT_REF=codex/launch-blockers`, `POSY_HUMAN_ARTWORK_REVIEW=true`, and an event ID in `POSY_HUMAN_ARTWORK_REVIEW_EVENT_IDS`. Production cannot enable this implementation. Enroll only fresh test events until the full workflow is verified.

Set these variables in Vercel **Preview, branch `codex/launch-blockers` only**, then redeploy that branch:

| Variable | Value |
| --- | --- |
| `POSY_HUMAN_ARTWORK_REVIEW` | `true` |
| `POSY_HUMAN_ARTWORK_REVIEW_EVENT_IDS` | Explicit comma-separated fresh test event IDs; never historical research events |
| `POSY_ARTWORK_REVIEWER_KEY` | A new random secret, at least 32 characters; never commit or put it in a URL |
| `POSY_ARTWORK_REVIEWER_ID` | The actual operator identity for audit history |
| `POSY_HUMAN_ARTWORK_GENERATION` | Leave unset or `false` throughout unpaid verification |

The migration `20260917224730_human_artwork_reviews.sql` was applied only to Preview database `zniggkeyyohniqrccblm`. The filename matches its recorded remote migration version. RLS is enabled; `anon` and `authenticated` have no table access. The security advisor's informational "RLS enabled, no policies" finding is intentional for this server-only table. Production has no new migration.

## Customer and staff flow

1. Host submits a saved brief and email. This only queues a request; it sends no email and makes no provider call. Duplicate submissions reuse the same request.
2. Staff opens `/artwork-review`, enters the separate reviewer key, and sees the complete saved brief. The key stays in tab memory, not URLs or browser storage.
3. Paid generation is a separate, disabled-by-default capability. When separately authorized and enabled, staff explicitly requests one candidate. An atomic claim prevents a second dispatch; no automatic critic, repair, retry, or replacement runs.
4. The source and exact delivery PNG are retained privately. A failed or interrupted generation stays failed/claimed and requires investigation; never reset it just to retry a potentially billed request.
5. Staff inspects the actual hash-verified image at phone and native size, checks the full brief, independently verifies unfamiliar identities, checks medium and finish, and leaves a note. Approval requires all five checks. No model can approve.
6. Only current approval opens this event's checkout and planning. Existing Plus access does not skip the review. General account-level Plus purchases without an event remain separate.
7. Paid reuse and the planner use the same approved PNG. The planner preserves the reviewed theme and palette. Changing the saved brief invalidates approval, checkout, reuse, and image delivery for owners and guests.

8. After rejection, staff can describe the required corrections and select **Queue correction — no charge**. This preserves the rejected source, exact delivery PNG, generation/billing evidence and decision history. It clears the active candidate and queues a replacement without calling a provider. The customer sees that the artwork is waiting for correction; checkout stays closed. The saved brief does not need to change.
9. If paid generation is separately authorized and enabled, staff must explicitly select **Generate one candidate (paid)** again. The full saved brief and all prior rejection/correction notes feed a new candidate; this is new generation, not editing the old pixels. Prior rejected images remain available privately for comparison. Approval checks, note and full-size inspection reset for the new candidate. An archived image cannot be approved or delivered.
10. Preview permits at most three corrections for the same saved brief. Stale/duplicate correction requests cannot dispatch or overwrite each other. A failed/interrupted generation remains failed/claimed with its billing uncertainty retained; the correction action does not unlock a retry. Do not reset rows, change the brief just to evade the limit, or retry an unknown provider outcome.

Staff turnaround, staffing, escalation after repeated rejection or generation failure, and customer notification/service commitments must still be resolved before offering this as a live service.

## Verification

Tests cover staff authentication, private pixels, no-spend submission/correction, duplicate dispatch/correction, terminal failure, retained image/billing history, correction limits, fresh approval checks, image/brief/version binding, competing decisions, paid reuse, exact owner/guest bytes, stale-brief revocation, legacy bypass paths, production/off/unenrolled isolation, planning reuse, and customer waiting states. Staff page DOM tests exercise the real inline script with synthetic responses, including archive comparison and fresh full-size inspection; they are not rendered-browser or image-quality evaluations. Archived pixels and provider data are removed from both database queue-list results and staff JSON.

For local interface inspection, run from the repository:

```sh
DATABASE_URL=postgres://synthetic/unused node --import tsx tools/qa/human-review-fixture.ts
```

Open `http://127.0.0.1:4173/artwork-review` and `/draft-generating/synthetic-human-review`. The fixture's openly documented test-only key is `synthetic-fixture-not-a-real-secret-12345`. All data is in memory, the candidate is three procedural color bands, and no database, image provider, checkout, or messaging operation is available. The fixture refuses Production/Vercel execution. Never use this key or fixture in a deployed environment.

## Remaining before activation or launch

### Deployed synthetic check — 18 September 2026

The owner approved a fresh procedural three-color-band fixture through the real Preview staff page. Database readback confirmed all five checks, the operator identity, and unchanged image/brief binding. The customer page then displayed the approved image, confirmed by the owner's screenshot and an authenticated browser inspection.

A guarded temporary change to that synthetic event's brief hid its old approved artwork and returned the customer page to the review-required state. The original brief was restored immediately; the image returned and the approval history stayed unchanged. All 61 pre-existing event rows retained their baseline digest. No provider, payment or email call was made. Direct API-document navigation was blocked by the browser client, so this check does not claim a deployed raw-asset HTTP status.

This exposed the globally mounted legacy “Skip preview” shortcut still appearing during human review. The paywall now explicitly permits that shortcut only after successful readiness confirms a legacy optional-preview flow. The shortcut observes that decision and rechecks it before a click can dispatch. Regression coverage mounts the actual shortcut beside the paywall, including unresolved readiness, pending/rejected states, and a legacy-to-human transition. Legacy checkout still skips generation when eligible.

These results establish the tested synthetic approval/display and changed-brief behavior, not generated-artwork quality, a fresh generation lifecycle, rejected-candidate recovery, paid reuse, or guest delivery.

### Correction implementation — 18 September 2026

Rejected-candidate recovery is now implemented in the existing Preview-only workflow. Automated server and staff-page tests cover rejection → free correction queue → separately claimed synthetic generation → new review → exact approved replacement delivery. These tests use procedural images or stubbed bytes; no provider is called. The existing deployed event67 approval is preserved as the customer-display baseline. Staff correction actions still need a live authenticated check before this can be described as a fully verified deployed rejection lifecycle. No reviewer credential has been copied into tests, URLs or source.

- Branch-scoped Preview configuration and synthetic staff approval/customer display are verified. Check the exact new Preview after each code deployment; keep the existing synthetic approval as its baseline.
- Complete the remaining live rejection, paid reuse and guest-delivery checks. The synthetic approval/display and changed-brief checks above do not cover those paths.
- Keep paid generation disabled until a specific paid candidate is authorized. Synthetic checks are not evidence of visual quality.
- Resolve the operational limitations above. Production rollout and full payment/RSVP/email/invitation verification remain separate gates.
- Do not reopen compact-review-final-20260917-v1 or any older closed research allowance.

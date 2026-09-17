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

Rejected candidates are terminal in this first implementation. There is no replacement/revision desk yet. Staff turnaround, staffing, handling rejected candidates, and customer notification/service commitments must be resolved before offering this as a live service. Do not ask a customer to edit their brief merely to unlock another attempt.

## Verification

Tests cover staff authentication, private pixels, no-spend submission, duplicate dispatch, terminal failure, complete approval checks, image/brief/version binding, competing decisions, paid reuse, exact owner/guest bytes, stale-brief revocation, legacy bypass paths, production/off/unenrolled isolation, planning reuse, and customer waiting states. The staff page DOM test checks its real inline script with synthetic responses; it is not a rendered-browser or image-quality evaluation.

For local interface inspection, run from the repository:

```sh
DATABASE_URL=postgres://synthetic/unused node --import tsx tools/qa/human-review-fixture.ts
```

Open `http://127.0.0.1:4173/artwork-review` and `/draft-generating/synthetic-human-review`. The fixture's openly documented test-only key is `synthetic-fixture-not-a-real-secret-12345`. All data is in memory, the candidate is three procedural color bands, and no database, image provider, checkout, or messaging operation is available. The fixture refuses Production/Vercel execution. Never use this key or fixture in a deployed environment.

## Remaining before activation or launch

- Configure branch-scoped Preview settings through an authenticated Vercel session and redeploy.
- Inspect a fresh Preview event and staff portal in a real browser; verify approval/rejection, customer refresh, exact applied pixels, and guest delivery on the deployed build.
- Keep paid generation disabled until a specific paid candidate is authorized. Synthetic checks are not evidence of visual quality.
- Resolve the operational limitations above. Production rollout and full payment/RSVP/email/invitation verification remain separate gates.
- Do not reopen compact-review-final-20260917-v1 or any older closed research allowance.

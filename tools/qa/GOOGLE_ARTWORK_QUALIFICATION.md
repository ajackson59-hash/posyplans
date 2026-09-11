# Google artwork qualification — 9 September 2026

## Billing-activated test — 11 September 2026

**Result:** event 51 made one Google image request (HTTP 400 after 8,856 ms),
one correct Haiku cast classification and zero critics/retries. No image was
returned. Retained records 233–240 and the consumed event remain intact.
The customer saw a direction card, whose 11,244.7 ms decode is not successful
artwork delivery. Original Frozen host words were preserved in the request.

The request shape matches Google's documented Interactions request fields.
The precise cause of the 400 remains unknown: the adapter incorrectly read
`error.status` while the Interactions API specifies string `error.code`.
The adapter now reads the documented code and preserves a bounded,
credential-redacted error explanation only in owner-private evaluation
records. The explanation is non-enumerable on the error and is never included
in ordinary diagnostics/logs. The fix cannot recover the discarded historical
message and has no live image-success result yet. No further request ran.

Error schema checked 2026-09-11:
https://ai.google.dev/static/api/interactions.openapi.json

A single follow-up diagnostic uses fresh event 52 and dataset
`google-customer-artwork-diagnostic-20260911` after the error-capture fix.
This is the second image request in the billing-activated testing round,
explicitly disclosed before execution. It retains the unchanged Frozen brief,
one render/one review/one classifier maximum, and zero automatic retries.
Events 50 and 51 remain consumed. Stop after this diagnostic and report the
actual returned result; do not infer a cause from synthetic offline fixtures.

The configured-key test on event 50 returned Google HTTP 429 without an image.
It made one image dispatch and one Haiku classification, with no critic or
retry. Preserve those records and the consumed fixture.

The user subsequently confirmed billing activation and explicitly approved a
new test. Fresh draft event **51**, dataset
`google-customer-artwork-billing-20260911`, case `-02`, selects Google only in
Preview. Its Frozen brief and hash are unchanged. One image, at most one critic
and one classifier, no retries. Each case has independent durable claims; no
old fixture is reset. Inspect this result before expanding the evaluation.

The original setup notes below are dated history. Google key presence is now
confirmed; account billing activation is user-reported, with actual image
access still to be tested. Production remains unchanged.

## Original setup history

The user requested a live test of Google's Nano Banana 2 after the GPT Image 2
customer cohort stopped on Frozen. This is a fresh test, not a reopened GPT run.
No Google quality or delivery-time result exists at this commit. The first
customer submission on Preview `f2e096f` returned the customer error state;
readback confirmed zero preview reservations and zero retained paid stages.
An automatic approval review rejected a proposed diagnostic POST because it
could dispatch an additional paid render. That diagnostic POST did not run.
The owner-private readiness GET now exposes configuration-presence flags only
for this isolated fixture, allowing diagnosis without another submission.

## Configuration

- Direct Gemini Interactions API, `gemini-3.1-flash-image`, native 9:16 at 1K
  (768 × 1376), JPEG transport normalized losslessly to PNG.
- Server-only `GEMINI_API_KEY`, Vercel **Preview**, branch `codex/launch-blockers`.
  Use a billing-enabled Google project with image-model access. No client key.
- Only isolated draft event 50 selects Google, only in Preview. Its unchanged
  Frozen host brief is case index 1 in `mediumFeasibilityCases.ts`, SHA-256
  `1e75209cceb271d1abd1cd8819bbee6b095ae4ed9fe1066b76ae78f7a45b2e3f`.
- Dataset `google-customer-artwork-20260909`, case `-02`. Owner token stays private.
- Ordinary customer button, one image request, at most one Sonnet 4.6 critic
  and one uncached Haiku classification. No retries, replacements, automatic
  provider fallback or quality-threshold changes. Stop and inspect this result
  before expanding to the other seven unchanged directions.
- The historical `medium` field describes the shared customer policy; Gemini
  does not receive an OpenAI quality parameter. Actual Gemini setting is `1K`.

## Evidence and pass criteria

Every paid stage is claimed and read back in owner-private attempt storage.
Final prompt, classification, provider-specific usage, full source, exact
560px reviewed teaser hash, critic verdict, and times are retained. Missing
usage remains unknown. The normal customer UI measures submission through
`image.decode()`. An unavailable or rejected result has no successful-artwork
delivery time. Agent review and eventual human judgment are separate.

The source and review pipeline are shared with customer previews. The adapter
also accepts source images for future refinements; live refinement behavior is
not yet qualified. Production defaults and the closed GPT fixtures are unchanged.

Google's listed 1K image output is 1,120 tokens × $60/M = $0.0672, plus input
at $0.50/M and text/thinking output at $3/M. The independent classifier/critic
are additional. This is an estimate, not an invoice or enforced spending cap.

Sources verified 2026-09-09:
- https://ai.google.dev/gemini-api/docs/image-generation
- https://ai.google.dev/api/interactions-api
- https://ai.google.dev/gemini-api/docs/pricing

Offline tests check REST response parsing (including ignoring thought images),
native pixel preservation, supplied references, credential and timeout guards,
no retry/fallback, exact teaser review, model provenance, and durable one-use
fixture claims. They do not prove artwork quality or a 90-second customer flow.

The existing release gate remains eight directions with at least 20 independent
trials each and at least 95% human-approved artwork delivered within 90 seconds
per direction. One successful Frozen test would only permit further screening.

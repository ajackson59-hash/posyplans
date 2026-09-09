# Google artwork qualification — 9 September 2026

The user requested a live test of Google's Nano Banana 2 after the GPT Image 2
customer cohort stopped on Frozen. This is a fresh test, not a reopened GPT run.
No Google quality or delivery-time result exists at this commit.

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

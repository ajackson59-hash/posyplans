# Current qualification status — 11 September 2026

Event 54 completed the ordinary customer flow automatically on `cf7fcac06ccbabc1beafb9d89ec77190137119b9`:
Google generation, deterministic validation, one Sonnet review, persistence and browser decode in **30,033.9 ms**.
No refresh, retained-image recovery, retry or alternate-provider dispatch. One Google image (8,394 ms including normalization),
one Haiku classification (1,545 ms), one Sonnet review (15,123 ms). CI Verify Posy #425 succeeded.
All six automated review dimensions scored 5/5. Agent inspection found the requested construction subjects,
bunting, garden and watercolor treatment; independent human approval remains pending.

- Unchanged construction host SHA: `008fe295df6ecfebdf3d065f56f08e66c112c506c44eb7aac5f9db5485dee1a9`.
- Actual final prompt SHA: `52ce7874ae029a30d65021d12719477ec7cba8036ee7f1f54f4bf9ccb9c4f667`; 6,131 characters; full host brief occurs once.
- Source SHA: `b5a4ceda85b089467e3b2294e4d90777eec13b046aac3ab52c503a40a400a3f3`.
- Exact reviewed and delivered PNG SHA: `c6d06c22a2fe9c31005ca900dcbac9e9df120d104d01272919c5ef20e82096ef`.
- Private retained records 259–268 include accepted record 267. Dataset `google-repaired-flow-20260911` is consumed.

This supersedes the historical no-success status below. Event 53 required manual recovery after fixing
hardcoded OpenAI dimensions; its recovery remains excluded from uninterrupted delivery results.
The shared repairs also remove invented keyword preferences and duplicate prompt requirements, preserve
the complete host brief, and show truthful customer failures. No critic threshold was lowered.

## Next bounded screening

After the user requested proceeding with the launch plan, six fresh synthetic draft fixtures were created
from the unchanged public benchmark briefs. Dataset `google-screening-20260911`, Preview branch
`codex/launch-blockers` only. Maximum six Google images, six Sonnet reviews and four Haiku classifications;
zero retries, replacements or alternate-provider dispatches. A $2 planning reserve is an estimate,
**not** a provider-enforced dollar cap. Inspect every result before the next case and close the cohort
on the first quality, classification, integrity, accounting, provider or 90-second delivery failure.

| Event | Original case | Direction |
| --- | --- | --- |
| 55 | 1 | Blippi/Meekah gouache |
| 56 | 3 | Rumi/Mira/Zoey anime |
| 57 | 4 | Moana/Maui stylized 3D |
| 58 | 6 | Exactly-six-place garden dinner photography |
| 59 | 7 | Abstract gallery vector |
| 60 | 8 | Moon-garden lacquer inlay |

The Frozen brief is held after event 52's explicit content-policy refusal. Trigger unknown;
no rewording, replay or provider hopping to evade the refusal. Account access is demonstrably working
for original construction artwork, so do not repeat billing setup as a proposed resolution.

One successful original direction does not qualify the provider universally. Ordinary customers still use
GPT Image 2; Google selection remains confined to these registered Preview fixtures. Retain all eight
release directions, at least 20 independent trials per direction, and at least 95% human-approved exact
artwork decoded within 90 seconds in each direction. Spark/Plus, recovery, paid source reuse, refinement,
invitation/RSVP, planner and operational launch gates remain open. Production is unchanged.

---

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

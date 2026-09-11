# Current decision: do not launch the Google configuration — 11 September 2026

Three live customer-flow tests ran in this session: one automatic construction
pass and two rejected Blippi/Meekah images. No automatic retries, alternate
providers, customer payments, emails, merge or Production deployment occurred.
Total: three Google images, three Sonnet critics, one Haiku classifier.

| Event | Execution commit | Result |
| --- | --- | --- |
| 54 | `cf7fcac06ccbabc1beafb9d89ec77190137119b9` | Watercolor construction delivered automatically in 30,033.9 ms; exact reviewed/displayed bytes match; human approval pending. |
| 55 | `be452a8c11fa24856e6f95268336f36ced778bda` | Named identities and scene passed; gouache substituted with digital cartoon treatment. Rejected, no approved delivery. |
| 61 | `248c940124998111a2c5dfa044dd202e6a6ead5d` | Stronger shared medium instructions did not produce a qualifying image. Visible excluded menu lettering; reviewer also rejected medium/finish. No approved delivery. |

Event 61 generated in 9,511 ms and received one 21,919 ms critic review. Retained
records 276–282, rejected artwork record 281. Source SHA
`265cfeed3a076ecbf7afde4a9835f67465bde8173cb9334195425c117195b565`;
exact reviewed teaser SHA `8acc50c91bb5fa446fab488e3fdf1efd32a2183194965673cd09e19bef16ee34`.
Both requested identities passed. Text-free 2/5, premium 3/5, fidelity 2/5;
other dimensions 5/5. The visible signage is a definite independent rejection
reason. Agent inspection finds some painterly texture in background surfaces,
so the critic's categorical assertion of no brushwork anywhere overstates the
evidence. Do not treat its detailed wording as independently validated truth.
The shared medium prompt change remains an unqualified hypothesis, not a proven fix.

The live failed transition also exposed stale duplicate email guidance. Fixed
`PaywallPreviewGuide` to follow the actual generating/failure elements rather
than wait for an image to load. The transition regression and customer browser
verification passed: failure shown, no artwork-ready claim, no duplicate email CTA.
CI Verify Posy #427 passed on the implementation above.

Events 56–60 are confirmed at zero preview attempts with no artwork; screening
is closed in code and its unused allowance is not transferable. Events 54,
55 and 61 are consumed. Do not reset/replay them or reopen older allowances.

The original Frozen request remains held after its separately retained policy
refusal; today's successful named-character responses do not explain that refusal.
A credentials-free diagnostic post and exact request body have been prepared
for owner review, not submitted. Google's official troubleshooting guide directs
API questions/bugs to its developer forum:
https://ai.google.dev/gemini-api/docs/troubleshooting#file-a-bug

**Remaining engineering decision:** text-only Google at these settings is not
qualified as Posy's universal image provider. Further evaluation should test a
materially different, specified rendering/conditioning approach and independently
check reviewer findings, rather than keep tweaking adjectives or sampling until
a pass. Preserve all eight briefs, per-direction repeated quality/90s gates,
Plus and all remaining product-release checks. Production and ordinary customer
provider selection are unchanged. No human-reviewed release benchmark exists.

---

# Screening stopped; shared medium-execution correction — 11 September 2026

The first screening case, event 55 (Blippi/Meekah), generated an image in 8,691 ms,
then failed its single 28,611 ms Sonnet review. Zero classifier calls or retries.
Records 269–275 retain the complete request and rejected pixels. Identities, scene,
composition and age appropriateness passed; gouache was replaced with smooth
cel/vector-style illustration. Premium finish and brief fidelity scored 2/5;
medium requiredPresent=false and purchase desire=false. Agent inspection agrees
with the medium mismatch. No approved artwork was delivered; fallback has no
successful artwork latency. The full original brief remained present.

The screening is now CLOSED. Events 56–60 are unrun; their unused allowance is
closed, not carried into another round. Frozen remains held separately.

The shared prompt previously listed several alternative treatments even when a
specific medium was selected. The correction removes those competing examples
and describes visible medium execution throughout characters, props and scenery.
Material hints depend on positive host selections, preserve explicit variations,
keep unfamiliar/mixed-media descriptions and do not import a named property's
usual rendering style. No critic thresholds, host details or provider filters change.
This is a testable prompt improvement, not an established causal explanation or
proof of quality before a new live result.

Fresh event 61, dataset `google-medium-execution-20260911`, uses the unchanged
Blippi/Meekah brief for one validation of that correction: one Google image,
one Sonnet critic, zero classifiers/retries/alternate providers. It does not
reset event 55 or reopen the six-case screening.

---

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

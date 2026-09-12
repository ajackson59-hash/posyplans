# Customer artwork evaluation — 9 September 2026

**Stopped at case 2. The current GPT Image 2 medium configuration does not
advance to the release benchmark. Artwork generation is not fixed.**

Execution: `93b107fa0d1c8c5629e0357d730c0e7f08fe9141`, Preview
https://posy-adnh9qf8n-poseplans.vercel.app, Verify Posy #414 passed.
Both submissions used the normal customer button and prepayment-preview route.
No retries, replacement samples, high sibling, external references, checkout,
email send, merge or Production change occurred.

| Case | Actual customer result | Interpretation |
| --- | --- | --- |
| 1: Blippi/Meekah gouache soft play | Exact reviewed artwork decoded in **82.2202s**; automated gate passed all six dimensions at 5/5. Source and delivered hashes verified. | One observed delivery under 90s. Agent observed the requested hosts, dancing, setting and details; **human quality/purchase approval remains pending**. |
| 2: Elsa/Anna Frozen snowy garden | Correct cast classified in 2.989s. Image provider returned HTTP 400 `moderation_blocked`, stage `output`, after **42.627s**. No image or critic call. Customer saw the fallback direction card. | Generation/provider delivery failed. Complete unchanged host brief reached the provider. A fallback card is not successful artwork. |
| 3–8 | Unrun under the agreed stop rule. | No quality, timing or reliability results may be inferred. |

The first render took 42.326s at the provider, 0.580s to normalize (42.905s
combined telemetry), and 30.572s for its single Sonnet review. Audit persistence
through the record preceding completion was 3.642s. The measured **82.2202s
includes** the audit, normal customer route, polling, transfer and image decode;
no private-study-page timer was substituted. Remaining time is not attributed
to a specific stage without evidence. The browser's performance clock measures
delivery; scratch and browser wall clocks differ by about two hours and are
not subtracted from each other.

## Retained evidence

- Case 1 full final prompt exactly matches the committed customer preflight.
- Case 1 source SHA-256: `06497230e29f57e2fabc95099fbe1eb3ba58f2f53e5e07ed59a4c573d2be7db9`.
- Case 1 exact reviewed/delivered 373×560 teaser SHA-256: `2d7c5da9009852b821431222c6c4bbbf76ab1049d78b225c1dce743c64bd262e`.
- Case 2 classifier returned subjects `["Elsa", "Anna"]`. No cast substitution occurred.
- Case 2 final prompt SHA-256: `5a41988d4efed22c0c78f072b66028275bfbd8e81963e51492a5e42d74df6aa2`.
- Case 2 provider request: `req_fee0273eda944dd8b5429eee1b0bcc7f`, type `image_generation_user_error`, empty moderation categories.
- Every case 2 retained row has no asset URL. No hidden/rejected Frozen image is available to inspect.

Private owner-scoped storage retains claims, final prompts, classification
responses, stage records, usage, verdicts and the first source image. Customer
screenshots, decoded-time observation, downloaded source/teaser and hash checks
are included in the private evidence package. Owner credentials are never
published in this repository.

## Allowance and cost

Used **2/8 image calls, 1/8 critic calls, 1/6 classifier calls**. No allowance is
transferred to retries, replacement samples or another model.

Case 1 usage estimate: image $0.051630, critic $0.032664, total $0.084294.
Case 2 classifier estimate: $0.000651. **Known usage-based estimate: $0.084945,
plus unknown billing for the blocked image request.** This is not a reconciled
invoice. Unknown blocked-request billing is not zero.

## Component decision

The Frozen failure is downstream of correct interpretation and upstream of
review. Changing the critic cannot make that missing image appear. The prior
separate study also received a Frozen output block; both records remain intact.
These observations do not establish a blanket ban on Frozen, nor explain the
provider's unpublished reason or justify bypassing moderation.

**Do not repeat this same configuration or describe prompt preservation as a
complete fix.** Select and qualify a different supported generator/configuration
under its normal policies before another cohort; keep the exact host briefs,
quality standard and 90s customer measurement. No alternative has yet been
verified or authorized for paid replacement trials. The current study remains
closed, the six unrun directions remain unknown, and human review of case 1
remains pending. The existing 8×20 release benchmark and other launch gates
remain required.

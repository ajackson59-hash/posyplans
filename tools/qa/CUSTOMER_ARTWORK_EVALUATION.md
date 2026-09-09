# Customer artwork evaluation — prepared 9 September 2026

Status: **fresh allowance approved by the owner; live execution being recorded**.
Approval: 8 GPT Image 2 medium requests, up to 8 Sonnet reviews and 6 Haiku
classifications, $2 planning reserve (not an enforced dollar cap), no retries
or replacements. Eight new private draft fixture events are registered.
Preview-only instrumentation preserves dispatch claims, full prompts, provider
usage and exact reviewed hashes in the existing owner-private attempt store.
Customer image timing starts at the normal button submission and ends after
the image element's decode promise; ordinary polling and transfer are included.
Customer implementation: `c66b9c49d83e5ff95dfc61cbf426c788f7d79e6e`.
Preview: https://posy-ek3l5jue3-poseplans.vercel.app

## Decision this evaluation must make

Determine whether the current single-medium-render customer configuration is
worth advancing to the release benchmark. This is an eight-case screening
evaluation, not a 95% reliability claim and not proof of arbitrary prompts.
The generator, reviewer and delivery pipeline receive separate outcomes; a
fallback card never counts as successful artwork.

Existing decisions remain in force:

- One prior high render took 113.546 seconds before review. It missed the
  target in that observation; it is not an established fallback for 90s delivery.
- The written-reference reviewer made 8/8 correct identity decisions on two
  official source images; the combined-reference arm made 6/8. Do not adopt the
  latter. This narrow control does not establish craft judgment across styles.
- The prior medium study stopped after two requests: one returned image, one
  Frozen output-moderation block. The other six cases remain unrun. Neither the
  84.829s private-study-page load nor an automated 5/5 score establishes human
  approval or real customer-flow delivery. No existing result is relabeled.

## Exact proposed cohort and allowance

The complete unchanged briefs and SHA-256 hashes are in
[CUSTOMER_ARTWORK_PREFLIGHT.json](CUSTOMER_ARTWORK_PREFLIGHT.json). The new IDs
identify a proposed cohort only; they confer no permission to spend or bypass
the stopped study's consumed claims. This proposal explicitly includes fresh
attempts for Blippi/Meekah and Frozen. Prior outcomes stay intact.

| Order | Direction | Medium | Classifier calls if uncached |
| --- | --- | --- | ---: |
| 1 | Blippi and Meekah / soft play | Gouache | 0 |
| 2 | Elsa and Anna / snowy garden | Cel shading | 1 |
| 3 | Rumi, Mira and Zoey / rooftop | Anime | 0 |
| 4 | Moana and Maui / beach | Stylized 3D | 1 |
| 5 | Original construction garden | Watercolor | 1 |
| 6 | Six-place garden dinner | Photography | 1 |
| 7 | Abstract gallery opening | Flat vector | 1 |
| 8 | Moon garden | Lacquer inlay | 1 |

Maximum: **8 GPT Image 2 medium images, 8 Sonnet 4.6 reviews, 6 Haiku 4.5
classifications**. One image and at most one critic request per submitted case.
No SDK retry, JSON repair, high sibling, automatic correction, replacement
image or repeated submission. No external reference downloads or extra reviews.
Planning reserve: **$2**, based on recent observed usage. This is not a
provider-enforced dollar cap or a reconciled invoice. Fixed call limits are the
spending boundary. Keep returned usage and unknown failed-request billing
separate; stop if the allowance would be exceeded or accounting is unavailable.

No purchase, payment, email, invitation send, merge or Production change is
included. Use eight isolated owner-private Preview fixture events. Do not
modify an existing customer's event or repurpose Event 41's consumed study.
Do not enable the old `FEASIBILITY_PAID_ENABLED` switch or reset its case IDs.

## Procedure after fresh paid authorization

1. Reconfirm the exact deployment and register its SHA, the eight proposed
   case IDs and their private fixture-event mappings before any submission.
   Allowlist only those eight cases. Preserve a per-case dispatch claim before
   the customer POST; an uncertain/crashed dispatch cannot be replayed.
2. Use the ordinary prepayment-preview customer route and the customer screen,
   with `quality-image` mode and the unchanged customer policy. Start timing
   at the same browser submission that triggers the route. Include background
   classification, image generation, normalization, review, persistence,
   polling, transfer and image decoding. A private study-page timer is not
   interchangeable with this measurement.
3. Retain source bytes, exact reviewed/delivered teaser hashes, final prompts,
   classification, provider request counts, verdicts, stage times and usage.
   Six preflight payloads contain hypothetical classification responses; their
   recorded prompt hashes are provisional, not expected live classifier output.
   A cast/brief mismatch stops before the image. Never rewrite the host brief
   or substitute an easier subject to force a result.
4. Inspect the actual delivered pixels independently of the automated verdict.
   Human review must cover requested subjects, details, exclusions, treatment,
   craft and willingness to purchase. Only an actual human judgment may populate
   the human fields. Prior Candidate B polish/purchase approval cannot approve
   any new image; an agent's visual assessment is labeled separately.
5. Stop at the first provider block/unavailability, uncertain dispatch, claim or
   retention failure, hash mismatch, known quality failure or delivery miss.
   Record why and leave the remaining registered cases unrun. An automated pass
   with pending human review remains pending, never a verified success.

## Fixed decisions — no open-ended prompt loop

| Observation | Decision |
| --- | --- |
| Full brief/cast lost before image dispatch | Fail interpretation/classification; repair that component before any image spend. |
| Returned image fails the brief or premium standard | Fail the render configuration for this screen; evaluate a different generator/configuration before another cohort. Do not lower the standard or replace the failed sample. |
| Good image rejected, or defective image approved | Fail reviewer calibration for that case. Change or replace the reviewer using the same retained pixels before spending on replacement artwork. |
| Correct approved image reaches the customer after 90 seconds | Fail delivery for this screen. Change the responsible latency component before another cohort. |
| Provider blocks output | Stop; retain diagnostics and unknown billing. It is a failed delivery, not evidence of a blanket theme ban or permission to bypass moderation. |
| Any human assessment missing | Outcome remains pending; no quality-success claim. |
| All eight independently approved images delivered within 90 seconds | Advance this configuration to the existing release benchmark. This screen alone does not authorize release. |

The release benchmark remains at least 20 independent trials for each of the
eight directions, at least 95% per-direction human-approved exact pixels loaded
within 90 seconds, with failures and missing results retained in the denominator.
Checkout/reuse/refinement and the other Plus/Find My Event/RSVP launch gates
remain separate required work.

## Completed preparation

`tests/customerArtworkEvaluation.test.ts` drives all eight briefs through the
actual Express customer route with in-memory event storage and replaced provider
boundaries. It checks the single-render policy, full host-text preservation,
classification request shape, six uncached classifier boundaries and duplicate
submission protection. All eight routes pass the offline rehearsal. It makes
zero image, critic, classifier, database or external network calls and records
no image-quality score or customer-browser timing.

Reproduce with:

```sh
POSY_WRITE_CUSTOMER_PREFLIGHT=1 ./node_modules/.bin/vitest run tests/customerArtworkEvaluation.test.ts
```

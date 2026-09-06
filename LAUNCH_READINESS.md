# Launch readiness — Preview closeout, 2026-09-06

Release status: **HOLD**. Green automated checks establish software contracts,
not superior generated artwork, payment settlement or message delivery.
PR #44 remains draft, unmerged and Preview-only. The owner redeployed the
existing Production commit `db829a1` during environment setup; that did not
publish PR #44. This work has not changed main or Production.

## Latest general-direction diagnostic evidence

The complete frozen briefs, request caps, results and remaining work are in
[PR #44](https://github.com/ajackson59-hash/posyplans/pull/44). Preserve failed
and missing cases; do not replace them with easier prompts or reset events.

- On `c8d0bb1`, vector Event 35 / attempt 136 and Blippi-Meekah Event 36 /
  attempts 137–138 passed all six 5/5 dimensions. Reviewed/delivered teaser
  hashes and protected full-resolution sources matched. Named first-approved
  publication took 132.655 seconds, failing the existing 90-second target.
- `76ab931` preserves render quality, dimensions and every review check while
  requesting maximum-quality JPEG transport and concise critic evidence.
  Decoded source pixels are normalized losslessly to PNG for exact teaser
  review and full-resolution retention. JPEG itself remains lossy; the actual
  decoded pixels must pass. Added request-count and processing-time evidence.
- Frozen Event 37 failed before image review: recognition exceeded its
  7.5-second deadline, then the old route incorrectly attempted one generic
  medium image request. The provider returned HTTP 400 `moderation_block`.
  No image or critic verdict exists. The two failures are observed separately;
  their causal relationship is unknown. No speed improvement is demonstrated.
- The follow-up correction stops image spending on unavailable recognition,
  aborts the classifier at its deadline, disables its hidden transport retries,
  and rejects incomplete answers without caching them as original themes.
  This protects every unfamiliar theme; it is not a successful live rerun or a
  resolution of the provider refusal. Local verification: 66 files / 782 tests,
  TypeScript and production bundles.
- The next recognition correction uses Haiku 4.5 with a compact JSON schema
  containing only `named`, `label` and every requested `subject`. It no longer
  asks the classifier to compose palettes or review prose. Each named subject
  receives its own identity requirement; the complete host direction and
  requested medium remain binding. The same abort deadline, no-retry budget
  and fail-closed routing remain in place. This is not a per-franchise allowlist.
- Provider failures retain HTTP status, request ID, code/type, optional coarse
  moderation stage/categories, request count, duration, render settings and a
  prompt hash. Raw provider messages and private prompts are not logged.
  Missing moderation details stay unknown; no cause is invented for Event 37.
  `image_generation_user_error` and moderation refusals cannot be retried even
  if returned with a transient HTTP status. This is diagnostic, not a claim
  that the previous provider refusal has been resolved.
- This correction passed TypeScript, 67 test files / 792 tests and production
  bundles locally. Live classifier speed, image acceptance and successful JPEG
  delivery still require the next exact Preview diagnostic.
- On exact Preview `0100788` (Verify #397), Moana/Maui Event 38 confirmed the
  general classifier completed in 3,113 ms with one Haiku request, 502 input
  tokens and 30 output tokens. The first-look POST returned 202 in 98 ms.
  The subsequent reference resolver returned no downloadable image, so the
  route stopped before image generation. The browser displayed the fallback
  by 17,394 ms; owner-scoped reads confirm zero image attempts. This is a failed
  artwork trial and a successful recognition measurement, not an image pass.
- The follow-up removes that unused download dependency from text-first
  customer generation. Existing curated identity facts and all general
  per-subject requirements remain in the prompt; external search/image
  availability is no longer an approval prerequisite for pixels the generator
  never used. No web research call is made by this customer path. Actual
  character recognition is still mandatory in the six-5/5 final teaser review.
  The reference resolver remains available for workflows that really use
  reference pixels. Host-uploaded reference boards are unaffected.
- Verification of that follow-up: TypeScript, 67 files / 794 tests and
  production bundles pass. Tests prove unavailable external image sites do not
  prevent general named routing, all required identity notes reach the high
  two-candidate path, and failed final reviews still remain private. These are
  software-contract checks; the repaired image path is not yet live-certified.

Paid diagnostics may resume on the verified correction, within the existing
untouched-case caps. Four of eight events were submitted, four image
requests attempted, and three critic verdicts completed (at most six physical
critic calls including possible earlier format repair). Moana added one
classifier request and one reference-search invocation, no image/critic calls.
The four untouched cases retain a combined cap of five image calls. Eight
calls remain under the overall twelve-image cap, but unused Frozen/Moana
image allowances do not authorize resubmissions or larger per-case caps.
Failed-request/classifier/search costs remain incompletely reconciled.
No checkout or email delivery occurred in this batch.

Reliable recognition, provider acceptance, cross-direction visual quality and
approved-image delivery within the existing target remain launch blockers.
The small diagnostic sample cannot establish the required reliability rate.

## Preserved September 5 closeout

- First-approved delivery: publish the first fully reviewed named-theme source
  immediately, while the sibling continues only for private review/evidence.
  The winning asset is stable; a later pass, rejection, error or timeout cannot
  replace it. Both exact 560px teaser bytes and paid full-resolution reuse are
  covered together through the real route/generator stack with simulated AI.
- Customer first looks explicitly disable the third serial correction. The
  background safety ceiling is now 150 seconds (previously 290), NOT a promise
  of successful artwork by then. The proposed target is at least 95% of
  supported requests receiving approved artwork within 90 seconds. It remains
  unproven; fallback completion never counts as successful artwork delivery.
- Completion is an atomic, owner/job/asset/brief-snapshot conditional update.
  An old timeout, changed brief, rotated owner or stale request cannot replace
  a newer image. It uses existing columns and an existing index; no migration.
- Mobile pageshow/visibility restoration refreshes readiness (GET only), with
  focus/reconnect recovery enabled. It never restarts generation or checkout.
- Added a PRIVATE design-led compositor prototype, not another prompt patch.
  It binds the complete brief; checks reviewed asset hashes, style, named-theme
  scope, ownership and provenance; fits layers without crop/distortion; rejects
  omitted, microscopic, transparent and obscured required details. All outputs
  remain explicitly UNREVIEWED and cannot enter the paid-reuse path.
- Reserve a generation job through one owner-scoped, budget-guarded database
  compare-and-set. Concurrent stale requests cannot schedule duplicate jobs.
  A missing reservation never becomes permission to spend.
- Require observed, located evidence before teaser scoring. Match every visual
  requirement by its exact server-owned label; do not recycle positional answers.
  Missing evidence, duplicate answers, malformed scores and truncated responses
  fail closed. The six 5/5 floors and binary checks remain unchanged.
- Preserve the complete critic verdict, token usage, generation timing and hash
  of the exact reviewed 560px teaser alongside original full-resolution artwork.
  Existing score-only records remain readable. Preparation/review exceptions
  also retain returned provider bytes for protected owner review.
- Disable hidden HTTP retries for preview image calls. Two initial requests
  are the named-preview limit per customer job. The existing correction helper
  survives only behind an explicit internal research opt-in; no customer route
  enables it and no automatic or build-time canary is added.
- Keep API response bodies out of request logs, including owner URLs, email,
  guest details and image bytes. Retained evidence remains owner-scoped.
- Describe direction-card fallback honestly in the UI and announce progress to
  assistive technology. Do not promise immediate image completion.

These are shared customer-path corrections, not edits to a single QA image.
No database schema migration, package upgrade or scheduled paid canary is added.

## Design-led prototype evidence and activation boundary

### General artwork scope (supersedes a construction-library launch strategy)

The product requirement is free-form artwork direction across original themes,
named characters/franchises (including Disney), adult events, and requested
media. A small scene catalog is not the solution or the acceptance boundary.
The construction source remains one private reference/test case and has no
automatic customer matching or activation.

`artDirection.ts` carries the current host direction verbatim through the
shared image constraints and vision critic. Recognized medium names provide
conservative hints; they are not a whitelist. Explicit unfamiliar treatment
labels also remain binding. Original host words and current-direction overrides
are retained so unspecified or unfamiliar styles are not replaced by a catalog.
No new classification/model request is added by this resolver.

For an explicit host treatment, the early small-file, uniform-band and uniform-
perimeter heuristics remain recorded but defer their visual meaning to the
mandatory critic. Those measurements can describe deliberate vector art or
negative space, not just corruption or a generated paper margin. Decoding,
blank-output, aspect, crop, text and layout checks remain blocking; no customer
image can pass without the normal vision verdict. A real compressed flat-PNG
fixture verifies that this path reaches vision and that a failed vision verdict
still stays private. This is a style-aware review change, not a numerical score
reduction.

Requested media take precedence over the first-look illustration defaults.
Both parallel candidates preserve that treatment while varying staging;
generic food/soft-play material rules cannot override explicit prominence or
medium choices. The paid concept quartet also retains a requested medium,
with structural variety preserved. Known medium substitutions fail its
zero-image preflight. Adult themes no longer categorically exclude requested
cartoon characters. The critic receives the same contract, audits an explicit
medium as a visible requirement, and judges premium craft within that medium.
All existing score floors, exact identity/count checks, source retention,
native-ratio delivery, request limits, first-approved publication and paywall
boundaries remain in force.

The engineering matrix includes Disney Frozen, Mickey/Minnie, Moana, Alice,
Unicorn Academy, KPop Demon Hunters, original construction, adult photography,
line art, abstract vector work, oil painting, stained glass, embroidery and
an unfamiliar lacquer-inlay treatment. Its pixels and critic responses are
synthetic: passing tests proves transport/rejection behavior, not visual quality.

**This generalizes intent handling, not a universal success or speed guarantee.**
No new paid generation or live benchmark accompanies this change. The latest
live construction source proof and earlier 132.186-second named first look
were measured before this change and cannot certify its output. Broad live
identity/style/brief-fidelity and end-to-end latency evidence is still required
before this can be called a final launch solution. Do not extrapolate the
construction source's approximately 6.4-second stored-image GET to fresh renders.

### Owner-approved art direction

Private source storage and review now use the existing owner-scoped artwork
attempt table, with its existing unique-key index. No new database, bucket,
public source URL, environment secret or schema migration is introduced.
The fixed construction manifest is the only accepted upload; original bytes
are checked on storage and retrieval. GET defaults to the exact 560px teaser;
full-resolution access requires the same event owner credential. Both are
private/no-store and only the launch-blockers Preview exposes these operations.

An explicit separate POST can request one critic review. A durable unique
claim is recorded BEFORE that request, globally per source hash, so parallel
requests, replays, other owners and worker crashes cannot automatically spend
again. A crash may leave an incomplete claim: this deliberately requires
operator investigation instead of assuming no spend occurred. The critic has
no SDK retry or JSON repair, with a 45-second deadline (60-second hard maximum).
Original source, claim and final verdict are retained separately. If retention
fails the route cannot report acceptance. No image generation is possible.

This is **source-profile QA**, using the committed construction-art requirements;
the owner event is only an access container and its customer brief/artwork is
not changed. Even a strict pass does not certify arbitrary customer briefs,
commercial reuse, or launch latency. Source records cannot be promoted through
the retained-image recheck route. Customer activation remains disabled.

The owner approved the construction gouache illustration's visual standard for
original children's themes. `sceneAssets/construction-gouache-v1/manifest.json`
records that precise scope and the original 1024×1536 master checksum. This
approval is **style-only**, not a named-theme, arbitrary-brief, commercial,
final-pixel or latency certification. The first source is one complete scene,
not independently reusable layers.

The private master is excluded from the published Git tree and public assets.
`prepareSceneStyleSource` preserves its original bytes and produces the exact
deterministic 373×560 teaser. CI verifies this contract with synthetic pixels;
`tools/qa/verifySceneStyleSource.ts` separately checks the actual approved
master, without provider calls. Private deployment storage must be configured
before activating source reuse. Do not expose the master to satisfy CI.

### Private review integration (current closeout)

`scenePreviewReview.ts` now connects the compositor to the existing deterministic
checks and strict teaser critic, with one explicitly confirmed critic request,
no hidden HTTP retries and no JSON repair for this research path. It snapshots
the complete brief, recipe and source bytes before awaiting anything; stale
briefs, owner mismatches and uncertified inputs fail before spending. A bounded
timeout/abort cannot become a late approval. The original composite, exact
560px hash, complete verdict, critic usage and composition provenance go to the
existing owner-scoped attempt store. A failed evidence write blocks acceptance.

The render method is `posy-scene-compositor-v1`, not a pretend OpenAI model.
Its zero new image-output charge explicitly excludes source-art creation and
critic charges. Existing text columns/JSON envelope are reused; no schema or
permission changes. The old retained-image recheck route explicitly refuses
to promote these private research records.

**No customer route imports the research reviewer. No artwork pack is enabled.
This integration is not a live latency improvement or an approved art library.**
The production first-look critic now disables SDK-level HTTP retries; its
existing one-time JSON-format repair and all score floors remain unchanged.

The compositor tests cover Blippi/Meekah soft play, Unicorn Academy winter,
KPop Demon Hunters, original construction and adult garden briefs. They use
plain engineering pixels, not approved art. Determinism and requirement
bookkeeping do NOT establish character recognition, aesthetics, commercial
rights or purchase desire. Asset certificates must come from a trusted registry;
they are provenance records, not licensing or visual-quality verification.

Before activating this rendering path:

1. Create and human-review coherent scene asset packs and recipes, with source
   rights recorded. Existing generic templates must not substitute for exact
   named characters or requested settings. Personal reference assets stay
   owner-scoped. No uncertified fallback into an adjacent theme.
2. Run the EXISTING strict gate on the FINAL composite's exact 560px transform,
   retaining both original source and complete evidence. No overlay, crop or
   later composition step may change those reviewed teaser pixels. The
   private reviewer implements this boundary, but deliberately has no customer
   activation route or paid-reuse marker yet.
3. Use the retained failures to calibrate the critic against human labels,
   including the false missing-glasses rejection. Do not lower the six 5/5
   floors, binary identity/milestone checks or purchase-desire requirement.
4. Repeatedly benchmark held-out briefs and crowded scenes under an explicit
   paid-call budget. Report every attempted request, approval/fallback outcome,
   first-approved elapsed time, p50/p95, human agreement and all-in cost per
   successful result. Do not exclude failures from the success-rate denominator
   or infer reliability from a single passing example.

### Retained live baseline and offline benchmark

QA event #34 on `4692dd00be30cef9bd942d480aa7e895e6cd554b` produced two high-quality
text-first candidates. Attempt 131 was rejected for premium finish (4/5);
attempt 132 received six 5/5 scores. The server logged first approved delivery
at **132,186 ms**. Accepted generation took 96,894 ms and its critic 34,265 ms.
The request handler itself took 88 ms; that is not image completion latency.
The served 373×560 teaser's SHA-256 exactly matched the retained critic hash;
the retained 1024×1536 source hash also matched. This was read-only evidence
retrieval; no third image or re-review was requested.

The sanitized baseline is `tools/qa/benchmarks/event34-baseline.json`. The
visual inspection was by an AI agent, not an independent human certification.
Recorded $0.33 covers image outputs only; all-in cost remains unknown. Final
job termination timing was not separately measured and remains null.
Two critic verdicts were retained, but the physical HTTP-request count was not
instrumented before hidden SDK retries were disabled; that count is also null.

`previewBenchmark.ts` and the offline CLI count all registered trials, including
missing results, errors, unsupported briefs and fast direction-card fallbacks.
They keep SHA/render-path/brief cohorts separate, require matching reviewed,
delivered and human-inspected hashes, and enforce request budgets. The proposed
observed gate requires five cases across named-child/original-child/adult,
at least 20 trials per case, and 95% quality-verified delivery within 90 seconds
**in every case**. It is an observed benchmark, not a statistical guarantee of
future reliability or a replacement for the other release gates. Fixture
results cannot qualify. Missing all-in charges remain unknown, not zero.

No repeated paid benchmark has been started. Its manifest must be registered
before spending and its total request/cost budget approved separately. The
single existing baseline correctly returns HOLD from the offline checker.

The current waitUntil job survives browser navigation, but is NOT a durable
retry queue that can guarantee completion after a worker crash. Saved status
and safe fallback recover without automatic extra spend. Stronger worker
durability, global abuse controls, payments, delivery, RSVP and support remain
separate release gates below. No claim of complete project readiness is made.

## Evidence boundaries and release gates

| Area | Automated coverage | Live proof required before release |
| --- | --- | --- |
| Image quality | Exact teaser transform; high-quality named path; strict scores; complete requirements; retry bounds; private rejects; full-resolution reuse | Event #34 has one automated pass and one private rejection. Human certification and repeated named-child, original-child and adult-event results, including crowded details, remain unproven. |
| Speed/recovery | Immediate direction card; non-blocking background job; bounded timeout/abort; reload/readiness; duplicate submission | Event #34 reached first approved delivery in 132.186 seconds, exceeding the proposed 90-second target. Measure mobile end-to-end latency under realistic load; the private compositor has no live speed proof yet. |
| Payment/access | Spark/Plus entitlement; currency; checkout handoff; paid image apply; email binding | Stripe test-mode checkout, signed webhook, duplicate webhook, return/reload and correct unlock. No real purchase required. |
| Delivery/RSVP | Email recovery; token-scoped guest routes; RSVP rendering; startup failure recovery | Controlled test recipient receives invitation and recovery link; guest RSVP round trip persists. No real guests or unsolicited messages. |
| Privacy/security | Owner-scoped evidence; no public rejected assets; response-log hygiene; protected Preview | Confirm deployed protection, secret availability without exposing values, and no owner URLs in logs. Audit access revocation and retention policy before broad rollout. |
| Cost/operations | Atomic per-event reservation and bounded image requests; image-output estimate labels | Verify account-wide abuse/rate controls, usage alerts, provider quotas, support/fallback ownership and rollback procedure. Per-event limits alone do not cap an attacker creating many events. |
| Commercial readiness | Existing checkout amounts covered by tests | Confirm product copy, rights to commercial named-theme assets, support/refund process, privacy terms and approved launch scope with the owner. |

## Cost reporting

The previous $0.495 figure estimates three GPT Image 2 high portrait **image
outputs only**. It is not an all-in cap. A source-edit correction has a different
estimate; image input and critic token charges are additional. Review-format
repair may make a second bounded critic call. Do not represent these estimates
as a guaranteed invoice total.

## Safe next validation

Use the exact newly verified Preview SHA. Inspect retained evidence before any
new generation. A further live benchmark must have an explicit request/cost
budget and preserve rejected evidence; do not add build-time or self-modifying
canaries. Do not promote a rejected image or lower the score floors to obtain
a green result. Merge/Production promotion is a separate owner decision after
the live release gates pass.

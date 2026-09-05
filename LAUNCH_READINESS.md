# Launch readiness — Preview closeout, 2026-09-05

Release status: **HOLD**. Green automated checks establish software contracts,
not superior generated artwork, payment settlement or message delivery.
PR #44 remains draft, unmerged and Preview-only. No Production changes.

## Changes in this closeout

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

### Owner-approved art direction

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

# Reference architecture evaluation — September 6, 2026

Release remains **HOLD**. This executes the owner's repeated approval of the
review-consistency work. It does not reopen consumed image budgets.

## Registered comparison

Dataset: `reference-review-ab-20260906-v1`. Exactly sixteen possible physical
Sonnet requests: four frozen identity controls × two repetitions × two arms.
No generated images, format repair, transport retry, new event, customer
activation, checkout, email or Production change. Owner Event 41 and Preview
branch `codex/launch-blockers` remain mandatory. Global durable claims are taken
before each dispatch and cannot be replayed after failure or redeployment.

Both arms use the **same current rubric v2**, exact candidate pixels, full mixed
media brief, model, descriptions, output schema and deadline. The pixels arm
adds both official, hash-verified Rumi and Zoey reference images, independently
labeled by Netflix. The text arm attaches neither. All sixteen cases validate
the same complete source pack before dispatch. Alternate arm order on the
second repetition. Expected answers and run IDs never enter the model request.
Only the candidate is scored; references cannot introduce cast, text, scenery
or medium requirements. Reference hashes and provenance are retained privately.

The fixed original and 560-pixel hashes are in [REVIEWER_CALIBRATION.md](REVIEWER_CALIBRATION.md).
Sources are downloaded once before the run; there is no live URL fetch inside
the reviewer and no arbitrary-reference URL API. Stop on provider unavailability,
billing refusal, claim/retention failure or hash mismatch. Preserve missing
results and all failures; do not replace them with new requests.

Working allowance: approximately **$0.60–$1.50** in standard token-rate charges;
reserve **$2** for the sixteen-request diagnostic. This is an estimate, not an
invoice or provider-enforced dollar cap. Fixed inputs, four-image maximum,
4 MB reference maximum and bounded output length prevent an open-ended bill.
Record actual returned input/output usage, request count, model time, HTTP time,
identity/checklist correctness, six scores, integrity, full verdict and SHA.

Success for this narrow diagnostic requires all eight attached-reference
identity/checklist answers correct, all four negative answers rejected and
consistent binary answers between repeats. Report the simultaneous baseline
separately. Even 8/8 is only a transfer/scope check: the same two official source
images appear as references and controls. It is not held-out generalization,
independent human premium-art approval, a fresh render or a delivery benchmark.
Do not claim a reference benefit if the text baseline performs equally well.

## Engineering change

The shared reviewer accepts bounded server-verified PNG references with explicit
identity or craft-example roles. Craft examples require an independently
recorded human assessment and medium; an AI observation cannot supply that
label. No assessed craft examples currently exist in this experiment. References
are optional and customer named generation retains its existing policy pending
evidence. Both serial and parallel preview review paths can receive verified
references. Invalid references fail before a model request.

[OpenAI's current guide](https://developers.openai.com/api/docs/guides/image-generation)
confirms GPT Image 2 can generate through image edits using references at automatic
high input fidelity. Its request builder now omits the unsupported explicit
`input_fidelity` field for that model, even if a caller supplies it. This removes
an API compatibility trap; it makes no claim about render speed or quality.
[Claude's vision guide](https://platform.claude.com/docs/en/build-with-claude/vision)
supports jointly analyzing labeled image blocks in one request.

## Rendering decision and next bounded experiment

Keep the original eight briefs: Blippi/Meekah, Frozen, Moana/Maui, KPop trio,
original vector, construction, photographic garden dinner and lacquer-inlay.
Freeze exact full host text and independent asset labels before any new spend.
Named cases compare text-only GPT Image 2 medium against reference-led GPT
Image 2 medium, one independent render per arm with the same original-resolution
portrait and identical verified-reference review. Both preserve all host details.
Canonical reference sourcing must happen before dispatch and be timed separately;
prewarmed timings cannot stand in for a first-use customer measurement. No
generated reject is used as an identity reference. Do not default to an older
model or require references for arbitrary original themes.

Original and adult media require independently assessed craft examples before a
reference-style comparison can be meaningful. The owner's visual pack must
record those labels without showing model tier or critic verdict first. Do not
invent positive examples, or call unlabeled artwork a calibrated standard.

The prior high image took 113.546 seconds before review, so that observed route
cannot meet the 90-second target. The prior medium image took 41.928 seconds,
leaving 48.072 seconds for review, persistence, network and browser load. This
identifies a candidate approach, not a proven solution. Adding references may
increase input cost and latency; measure the tradeoff.

Before the fresh rendering comparison, register new event/trial IDs, exact
brief/reference hashes, request counts, a concrete dollar allowance and a stop
rule. The consumed $5 extension does not fund it. The subsequent release gate
still requires **all eight directions, at least twenty trials each, ≥95% per
direction with independently approved exact pixels loaded in the browser within
90 seconds**. New scorecard rules enforce eight directions and explicit browser
load evidence; fast server approval alone cannot pass. Failed, missing and
unsupported results stay in the denominator; unknown all-in cost stays unknown.

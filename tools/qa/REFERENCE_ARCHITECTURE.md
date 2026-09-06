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

## Pre-run rendering proposal — suspended after this result

Keep the original eight briefs: Blippi/Meekah, Frozen, Moana/Maui, KPop trio,
original vector, construction, photographic garden dinner and lacquer-inlay.
Freeze exact full host text and independent asset labels before any new spend.
The pre-run proposal was to compare text-only GPT Image 2 medium against
reference-led GPT Image 2 medium, with one render per arm and identical
verified-reference review. The completed result below withdraws that reviewer
choice: it failed the registered minimum. No rendering experiment is authorized
by these sixteen consumed reviewer calls. Any later design must preserve the
same original resolution and all host details.
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


## Frozen live outcome and closeout

All sixteen registered requests completed on exact SHA
`206db2d14be875339de9681e0ceb63f966107ede`, Preview
https://posy-jyvf6j7ii-poseplans.vercel.app, after the owner explicitly approved
the two official image payloads, four fixed briefs, Posy Preview / Anthropic
destination, sixteen paid reviews and $2 reserve. The earlier automatic-review
block happened before dispatch; its record remains preserved. No claim was
reset and no failed judgment was replaced.

| Metric | Written context | Written context + reference pixels |
| --- | --- | --- |
| Identity/checklist correct | 8/8 | 6/8 |
| False acceptance of wrong identity | 0/4 | 0/4 |
| False rejection of correct identity | 0/4 | 2/4 |
| Structural integrity valid | 8/8 | 8/8 |
| Repeat pairs with identical scores/checklists/binary decisions | 4/4 | 3/4 |
| Full gate passes (not human quality labels) | 4/8 | 2/8 |
| Median critic time | 16.661 s | 16.491 s |
| Median observed HTTP time | 23.920 s | 23.616 s |
| Returned input / output tokens | 46,224 / 5,570 | 51,704 / 5,776 |
| Token-rate cost | $0.222222 | $0.241752 |

Craft, artifact and composition scores stayed at 5 across identical-pixel
identity swaps in both arms. Full-gate outcomes are not externally labeled
premium-art truth. Total **16 physical critics, zero images, zero retries**;
**97,928 input / 11,346 output tokens**, **$0.463974** at the recorded rates,
not reconciled provider invoices. Critic time is not generation-to-browser time.

| Fixed control | Result record | Correct identity | Critic ms | Full gate | Token-rate cost |
| --- | --- | --- | --- | --- | --- |
| rumi-matched-1-text | 168 | yes | 24,033 | pass | $0.027144 |
| rumi-matched-1-pixels | 170 | yes | 18,463 | pass | $0.029604 |
| rumi-matched-2-pixels | 172 | yes | 14,994 | pass | $0.029199 |
| rumi-matched-2-text | 174 | yes | 16,969 | pass | $0.026694 |
| rumi-mismatched-1-text | 176 | yes | 27,269 | fail | $0.028479 |
| rumi-mismatched-1-pixels | 178 | yes | 15,643 | fail | $0.029904 |
| rumi-mismatched-2-pixels | 180 | yes | 15,145 | fail | $0.029664 |
| rumi-mismatched-2-text | 182 | yes | 16,659 | fail | $0.028434 |
| zoey-matched-1-text | 184 | yes | 15,003 | pass | $0.027774 |
| zoey-matched-1-pixels | 186 | **no** | 17,002 | fail | $0.030504 |
| zoey-matched-2-pixels | 188 | **no** | 19,450 | fail | $0.032004 |
| zoey-matched-2-text | 190 | yes | 16,228 | pass | $0.027969 |
| zoey-mismatched-1-text | 192 | yes | 16,186 | fail | $0.027519 |
| zoey-mismatched-1-pixels | 194 | yes | 18,338 | fail | $0.030909 |
| zoey-mismatched-2-pixels | 196 | yes | 15,979 | fail | $0.029964 |
| zoey-mismatched-2-text | 198 | yes | 16,663 | fail | $0.028209 |

Both reference-arm Zoey positives (186 and 188) were false negatives. The
candidate is byte-identical to the correctly labeled Zoey reference. The model
acknowledged its dark hair and turquoise top but attributed those features to
Rumi, while describing the Zoey reference as pink/purple-haired in a white or
yellow jacket. The latter description also changed between repeats, and brief
fidelity moved from 1 to 2. The persisted reference hashes and labels are correct.
This is evidence of semantic reference-binding failure, not evidence of a source
swap. The exact internal model cause is unknown. Structural integrity passed
both reports because consistent output fields cannot certify visible facts.

Owner readback found all 32 new claim/result rows (167–198), each private,
rejected, with no preview ID and zero image requests. Client and retained full
verdicts, source/review/reference hashes, mode, rubric, SHA, counts and costs
reconcile exactly. All 26 earlier rows are unchanged. Original generated
attempts 141/142 were not re-reviewed or promoted. The diagnostic POST routes
are unregistered after completion; an application-level regression test checks
404 before owner/storage lookup. Old deployments share consumed durable keys.
Local closeout verification: TypeScript, 70 files / 870 tests, frontend and
Vercel function bundle passed.

### Decision and next evidence

**Do not adopt joint candidate-plus-reference scoring for customers.** It failed
the pre-registered 8/8 requirement and performed worse than the simultaneous
text baseline. The 0.171-second median difference is not a speed benefit in
this small experiment. Text v2 passes this narrow two-image control set only;
it has not established unseen-character, all-media or premium-art reliability.
No reviewer/prompt/model change or replacement paid run follows this result.

The next necessary input is independently recorded human quality assessment
of the retained artwork and representative examples in the requested media.
The visual pack provides exact pixels, a blind tier key and blank assessment
fields; agent or model opinion must not be filled in as the owner's assessment.
A future reviewer design must demonstrate correct reference-to-subject binding
and held-out positive/negative decisions before it is used to judge fresh image
quality. Keep that evidence distinct from craft and composition. Do not buy
another generic calibration batch without a registered hypothesis, held-out
labels, success threshold and a separately authorized request allowance.

The rendering blocker remains separate: the observed high render exceeded
90 seconds before review, while the medium render was 41.928 seconds with
premium quality unresolved. No new render timing or approved customer image
was produced here. Preserve the full eight-direction / twenty-trial / 95%-within-
90-seconds release gate, all earlier failed trials, and the open payment,
recovery, delivery and Plus requirements. Release remains HOLD.

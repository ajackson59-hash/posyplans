# Located review consistency — frozen protocol

Launch status: **HOLD**. Software integrity is not artistic ground truth.

## Change being tested

The prior critic sometimes described clean, balanced compositions while assigning 4/5, or used a wrong character to lower unrelated craft scores. Every new teaser review now reports a located observation, clear/defect/uncertain status and a server-owned criterion per dimension. Contradictory scores, missing observations, misplaced criteria and unresolved observations keep artwork private. Scores are never raised by the validator. Every normal teaser still requires six 5/5 scores plus the binary checks.

The shared rules cover free-form media and every theme. Flatness, photography, mixed media, stylization and intentional portrait framing are not inherently defects. Purchase failure has its own code; it no longer invents a premium-finish defect when the actual problem is fidelity. Invalid review evidence cannot trigger even the optional targeted correction path.

This validator checks structure and declared reasoning, not whether prose is true. A model can still mislabel an observation or hallucinate a defect. Fixed-image calibration and independent visual assessment remain necessary.

## Pre-registered live experiment

- Dataset: `located-review-controls-20260906-v1`.
- Model: `claude-sonnet-4-6`; rubric: `located-medium-review-v1`.
- Eight physical reviewer calls maximum: two repetitions each of Rumi matched, Rumi requested as Zoey, Zoey matched, Zoey requested as Rumi.
- Zero image generation, zero format repairs, zero SDK retries. 45-second per-call deadline. A timeout consumes its immutable claim.
- Same four original source controls and exact 560px transforms documented in [REVIEWER_CALIBRATION.md](./REVIEWER_CALIBRATION.md). Original images and full verdicts remain owner-private.
- Netflix's labeled source establishes **identity only**. It does not provide a gold label for Posy's premium-art or purchase-desire standard.
- Corrected fixture: the complete intentional photographic/animated diptych instruction is now the current visual override. Previously its short character-only override displaced the explicit medium in the shared art contract. This input correction and the new rubric are tested together; results cannot isolate their individual effects.
- Expected labels, dataset/case IDs, repetition numbers and prior results are excluded from model input. Both repetitions receive byte-identical requests. Source pairs change only the requested character; source pixels and reference descriptions stay fixed.
- Eight global server claims, fixed owner Event 41, fixed hashes, Preview branch only. No event activation or preview promotion, even if every score passes. Remove the registration after the run; retained records remain private and cannot be promoted through recheck.

## Measures and limits

1. Identity agreement: 8/8 expected; report false positives and false negatives separately.
2. Review integrity: all eight reports must satisfy the new evidence contract.
3. Repeat stability: compare six scores, binary identity, purchase and final pass for identical requests. Record every disagreement, not just the better result.
4. Dimension isolation: compare artifact, premium and composition scores when only requested identity changes. A separate visible defect is necessary for a deduction; no automatic score correction.
5. Medium fidelity: inspect whether mixed photographic/3D treatment or intentional portrait framing itself was penalized.
6. Report provider duration, token usage, physical request count and token-rate cost estimates. These are review timings, not fresh generation or customer end-to-end latency.

This narrow causal control is not the representative launch cohort. Original flat artwork, painting, photography, adult events, Disney and other named worlds still need independently assessed fixed examples and fresh customer-flow trials after reviewer calibration. No claim of reliability for all prompts or a measured false-rejection rate for premium artwork follows from eight identity controls.

## Remaining performance boundary

The retained high-quality KPop render took 113,546ms for generation/normalization before its critic. This change makes no claim to shorten that render. It adds no model call to the customer path and replaces repeated evidence prose with one structured observation per dimension. Review output and time must be measured live. The 90-second approved-image target remains unproven.

## Frozen results on `4201100965a7f34b149f76ca6624c0ac86d2ca04`

Exact Preview: https://posy-jrjy330zr-poseplans.vercel.app. Vercel READY; GitHub Verify #403 passed. Local TypeScript, 69 files / 853 tests, production build and function bundle passed before dispatch.

All eight calls completed on the unchanged deployment and rubric v1. All sixteen claim/result records remain owner-private, status rejected and without preview IDs, including the one internally passing control. No source was promoted or modified.

| Control | Result attempt | Identity control correct | Report integrity valid | Fidelity score | Internal full gate pass | Critic ms | Estimated USD |
| --- | --- | --- | --- | --- | --- | --- | --- |
| rumi-matched-1 | 152 | false | true | 3 | false | 29585 | 0.030393 |
| rumi-matched-2 | 154 | false | true | 3 | false | 19782 | 0.030228 |
| rumi-mismatched-1 | 156 | true | true | 1 | false | 25533 | 0.030018 |
| rumi-mismatched-2 | 158 | true | true | 1 | false | 20106 | 0.030123 |
| zoey-matched-1 | 160 | true | false | 5 | false | 20496 | 0.030393 |
| zoey-matched-2 | 162 | true | true | 5 | true | 16763 | 0.028608 |
| zoey-mismatched-1 | 164 | true | true | 1 | false | 20361 | 0.029763 |
| zoey-mismatched-2 | 166 | true | true | 1 | false | 17994 | 0.029418 |

- Identity agreement **6/8**: four deliberate swaps correctly failed; two correct Zoey controls passed identity; both correct Rumi controls failed identity. False positives 0/4; false negatives 2/4. This is not a reliable identity gate.
- Artifact, premium and composition scores were **5 in all eight reports**, unchanged when only the requested character changed. No medium/portrait-framing deduction occurred. These are consistent ratings on two source images, not independently certified premium-art accuracy or proof on all media.
- All six numeric scores repeated identically for each of the four case pairs. Identity and purchase booleans also repeated. However, **two of four checklist pairs changed**, and the Zoey matched pair changed the final gate decision. Numeric stability alone would conceal this failure.
- Report integrity **7/8**. Zoey matched #1 returned all 5s but no usable answer for the broad family identity row; the validator flagged `briefFidelity:binary-check-conflict`. Rumi #1 described uncertain identity while declaring a defect status; structural validation cannot determine the semantic truth of that prose.
- One full gate pass out of eight, on a reference control; it remains private research evidence. There is no generated-artwork launch pass in this experiment.
- Eight physical Sonnet calls, zero images, zero retries, 46,008 input / 6,728 output tokens; **$0.238944** at configured standard token rates, not invoice reconciliation.
- Critic time **16,763–29,585ms**, median **20,233.5ms**. Observed HTTP time **23,166–45,030ms** includes persistence, transport and runtime overhead; these components were not separately measured. No fresh image-generation timing was taken.

## Follow-up after the frozen run — rubric v2

The failures exposed another concrete scope interaction. The identity check received the entire mixed-media direction as its identity target, alongside both a broad family cast row and the exact named-character row. The reviewer then demanded a franchise identity for the deliberately unnamed photograph. These demands were absent from the host brief.

The follow-up uses the explicit `[VISIBLE NAMED IDENTITY]` targets for the identity check and states their requested roles/regions. Unnamed subjects do not inherit franchise-identity requirements. A broad named-cast fallback is omitted when exact named targets already exist; independent world/scene checks remain. The full host brief, every target, actual cast counts, exclusions, physical milestones and no-invented-celebrant rules remain binding. This is a general review-scope rule, not a Rumi exception. Original heroines and Disney targets use the same code.

Rubric v2 identifies this follow-up; the eight live results above belong to v1. **No paid review of v2 and no fresh artwork generation occurred.** A fresh fixed-control validation must precede the wider media/character customer-flow cohort; the eight consumed claims cannot be reused. The temporary calibration route is unregistered in the closeout.

Local follow-up verification: TypeScript, 69 files / 857 tests, production build and Vercel function bundle. See the exact final PR checks for deployed status. The target remains HOLD until live quality, reliable identity judgments and approved-image latency are established.

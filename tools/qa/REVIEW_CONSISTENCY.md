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

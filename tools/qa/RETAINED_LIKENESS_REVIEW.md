# Retained Meekah reference review — 12 September 2026

The user rejected the likeness in attempt293, confirmed the exact official
Meekah portrait and approved the next action: one review of this saved failed
image using the corrected reference handoff. This is a separately authorized
review-only calibration, not a retry of the closed generation experiment.

## Immutable inputs and budget

- Dataset `meekah-reference-review-20260912-v1`, owner event61.
- Candidate attempt293, source SHA
  `3ed9ff2d1da11a7a8553272b071b16c521519efa638649ffb3c0bda430f6cc9e`.
- Exact313×560 review SHA
  `7d16340d64c38bf1a24f218b5db3f5e59666d6b1e2ff3d57ce26e972f18181f0`.
- Confirmed official reference attempt289, SHA
  `347745ce1d75a4e5e8e7cacf20ca7fa693d4cb66c17d99f010e7c010113994b8`.
- Original synthetic host brief SHA
  `e4634856bdea506e3b711bef789c1c94b5f6ee578725b407753fe61959da19ad`.
- Maximum one `claude-sonnet-4-6` call; no format repairs or SDK retries.
  Zero image generation and classification calls. Timeout45 seconds.

Owner route: `POST /api/events/owner/:ownerToken/prepayment-preview/likeness-review`.
Strict body: `confirmOneVisionCall:true`, exact `expectedAssetHash` and
`expectedIdentityHash` above. Both images are already retained server-side;
the client sends no new images, URL, prompt, registration or expected answer.

## Calibration decision

Use the same original brief, named-reference guidance and real reviewer as the
previous test. The first image is the exact candidate; the second is the labeled
official identity reference. No change to the rubric, crop, resolution or
thresholds is included in this check. The user's rejection, expected negative
result and independent observations remain outside the model request.

Success requires complete accounting, returned reference provenance, an explicit
negative Meekah requirement and a negative named-identity check. A medium,
purchase or general-quality rejection alone does not demonstrate that the
reviewer detected the known likeness failure. Independently inspect the actual
evidence after the call; a vague negative is not proof of facial comparison.

The fixed global claim is persisted and read back before dispatch. Changed
inputs, wrong owner/branch/Production and unverifiable retention stop before
spend. Claim/result rows retain the exact existing source and reviewed hash;
all are calibration-only/rejected, with customer activation disabled. No event
mutation or allowance reset occurs. Timeout/unknown outcome requires read-only
inspection, never another POST. Actual state and outcome are the durable rows
for this dataset, not an editable protocol status label.

One negative example can expose or verify this failure mode; it does not prove
reviewer consistency, image-generation quality, or the complete launch gates.

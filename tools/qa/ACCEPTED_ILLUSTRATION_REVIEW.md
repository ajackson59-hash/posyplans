# Accepted illustration likeness review

One reference-only review of the owner's accepted Illustration 1. The owner said
“I like confirmed the best but 1 would pass as well,” then requested the next step.
The reference remains preferred, Illustration 1 passes likeness, and Illustration 2
is unrated. No full artwork approval follows from this label.

- Dataset: `meekah-accepted-illustration-20260914-v1`.
- Preview only, `codex/launch-blockers`, private synthetic event61 with its
  unchanged complete host brief. No customer activation or Production action.
- Candidate: full saved September 9 customer preview, 373x560 PNG, 580142 bytes,
  SHA `2d7c5da9009852b821431222c6c4bbbf76ab1049d78b225c1dce743c64bd262e`.
  Full original source provenance SHA
  `06497230e29f57e2fabc95099fbe1eb3ba58f2f53e5e07ed59a4c573d2be7db9`.
  The new private record stores the exact preview input, not the larger original.
- Reference: existing private record289, confirmed official Meekah portrait,
  SHA `347745ce1d75a4e5e8e7cacf20ca7fa693d4cb66c17d99f010e7c010113994b8`.
- Reviewer: unchanged `reference-only-likeness-v1`, `claude-sonnet-4-6`,
  1800 maximum output tokens, streaming, 45-second deadline, zero SDK retries.
- Hard request limits: one Anthropic review; zero image, classifier, combined
  artwork review, format repair, automatic retry or replacement requests.

The strict owner route `/api/events/owner/:ownerToken/prepayment-preview/accepted-illustration-review`
accepts only `confirmOneVisionCall:true`, fixed expectedAssetHash and
expectedIdentityHash, and bounded candidateBase64. The server verifies the actual
candidate hash, retained reference ownership/hash, synthetic context and exact
preview reproduction before claiming. It persists and reads back the candidate
under a globally unique claim before any paid dispatch. Failure or unknown outcome
does not allow rerun. No old claim or allowance is reused.

Expected result is match. Human preference/label and original event text remain
outside the reviewer input; it receives only the complete candidate/reference
pixels plus the unchanged generic comparison text and schema. Full artwork verdict
and scores remain null. Record the raw decision even if it disagrees with the user.

Before dispatch: verify the exact Preview deployment/project/branch/SHA and required
CI, unchanged event/reference, unclaimed dataset, and actual-SDK offline request
equivalence with the already-prepared candidate request. Never send the PDF face
crop in place of the full preview. After dispatch: audit one claim/result, retained
pixels, complete/partial usage and request count, private status and unchanged event.

This is a single illustration-tolerance check. The earlier scene293 mismatch and
same-portrait match are historical development evidence; do not rerun either.
A separately labeled harder facial mismatch with similar hair/outfit remains
missing. A positive result here cannot establish general identity sensitivity,
repeatability, medium/craft review, 90-second customer delivery or launch readiness.

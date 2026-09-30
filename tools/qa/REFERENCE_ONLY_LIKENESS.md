# Reference-only likeness check

The user said “proceed” after the completed combined-review pair failed to
distinguish the rejected likeness from the confirmed portrait. Implement a
reusable comparison whose input boundary accepts only candidate/reference PNG
pixels and transport options. No event, name, brief, concept, provenance text,
host requirement, expected answer or prior review is forwarded to the provider.
The model may recognize content in the pixels; this withholds textual priming,
not its learned knowledge. No full-artwork approval can result from this check.

Model remains claude-sonnet-4-6. Independent streamed requests, stable schema,
1800-token maximum,45-second deadline, no retry/repair. The new task locates the
counterpart then compares face, eyes/brows, nose/mouth and hair. Existing feature
coverage/visibility validation is reused. Raw response and timing are retained.
No combined artwork critic is called in this calibration. Candidate sizes and
all original pixels are unchanged; no new artwork, crop or enlargement is made.

| Case | Dataset | Fixed pixels |
| --- | --- | --- |
| mismatched | meekah-reference-only-20260914-v1-mismatched | Scene293, teaser313x560, reference289 |
| matched | meekah-reference-only-20260914-v1-matched | Portrait289, proportional560x555, reference289 |

All hashes/provenance are inherited from IDENTITY_FEATURE_COMPARISON.md. Event61
and original host brief remain guarded on the server but never enter the new
provider request. Owner-private Preview route:
`/api/events/owner/:ownerToken/prepayment-preview/reference-only-comparison/:caseId`.
Body accepts only confirmOneVisionCalltrue and exact fixed source/reference
hashes. No arbitrary prompt, pixels, expected answer or registration is accepted.

At most one call per case. Run the negative first after successful CI and exact
Preview verification. Stop if it is unavailable, ambiguous, invalid or still
matches: an incorrect negative gives no reason to spend on the positive. The
server permits the positive only after a complete, correct negative on the same
deployment/version/reference. Do not retry, reopen old claims or replace the
registration after a failed call. Independent requests never reveal the other
case or an expected distribution of answers.

Both results stay private/rejected, with artwork verdict/scoresnull and customer
activationdisabled. Only isolated likeness evidence is retained in the existing
customerEvaluation record. No customer-path integration, merge or Production
release is part of this calibration. A successful two-case pair is narrow proof
only; faithful illustrated positives and independent negatives, medium/craft
reliability and all original customer quality/latency/Plus gates remain required.

# Reference feature comparison and two retained controls

The user approved correcting the likeness comparison and validating it against
saved examples. This change applies to requested subjects with supplied identity
references, in the shared reviewer for invitation and teaser modes. It adds no
image generation and does not modify the original scene, reference or verdicts.

## Review contract

Each requested reference has its original numbered key. The reviewer reports
separate candidate/reference observations for facial proportions, eyes/brows,
nose/mouth and hair structure, plus a match/mismatch/unresolved assessment and
explanation per feature. Visibility and candidate location are explicit. It
must account for pose, expression and the requested medium without substituting
costume, colors or accessories for geometry. Unrequested reference subjects do
not become extra cast requirements. No reference-free request gains this schema.

The server derives the reference decision from those assessments. Missing fields,
uncertainty, mismatches and positive identity claims contradicted by the feature
findings cannot pass the artwork gate. Raw requiredPresent, teaser checks and
scores remain preserved for diagnosis; no scores are automatically raised or
lowered. A complete comparison can still be visually wrong: this validation
checks structure and contradictions, not semantic truth. Source pixels are not
cropped or changed, and no new review call is added. Output headroom increases
only for actual comparison targets, remaining capped at4000 tokens.

## Fixed live controls, one review each

Preview branch`codex/launch-blockers`, owner event61. Both use original synthetic
host brief SHA`e4634856bdea506e3b711bef789c1c94b5f6ee578725b407753fe61959da19ad`
and the same confirmed reference attempt289/hash
`347745ce1d75a4e5e8e7cacf20ca7fa693d4cb66c17d99f010e7c010113994b8`.

- `mismatched`: dataset`meekah-feature-comparison-20260912-v1-mismatched`.
  Candidate attempt293, source`3ed9ff2d1da11a7a8553272b071b16c521519efa638649ffb3c0bda430f6cc9e`,
  exact313×560 reviewer`7d16340d64c38bf1a24f218b5db3f5e59666d6b1e2ff3d57ce26e972f18181f0`.
  Human-rejected likeness. Expect a supported mismatch and consistent negative
  Meekah/identity checks; a medium-only rejection or uncertainty is insufficient.
- `matched`: dataset`meekah-feature-comparison-20260912-v1-matched`.
  Candidate is the confirmed official portrait itself, from attempt289.
  Exact560×555 reviewer`942f52abc84831a9a606df2036a7bbd1d0e600927adfe072e45f6e0833fbb3c6`.
  Expect Meekah feature match/present. This is a simple matching-identity control,
  not a human-approved gouache artwork. The same complete host brief remains;
  missing Blippi, scene and medium must still fail unrelated checks. A negative
  overall identity verdict is possible because other requested subjects are absent.

Route: `POST /api/events/owner/:ownerToken/prepayment-preview/feature-comparison/:caseId`.
Strict body: confirmOneVisionCalltrue and the exact source/reference hashes.
Images are read from retained owner-scoped records. Client cannot supply a new
registration, expected answer, source, reference or prompt. Expected labels and
user feedback remain outside both model requests.

Maximum two Sonnet calls total, one per fixed case, zero classifiers/images,
zero retries or format repairs. Execute mismatched then matched, stopping if a
provider, timeout, accounting or retention outcome is unavailable/unknown. A
semantic calibration miss does not skip the matching control, which tests
whether the method simply rejects everything. Existing claims stay closed.
New global claims persist before dispatch and cannot be reset by owner changes,
restarts, redeployments or duplicate requests. All rows remain private/rejected,
with customer activation disabled and the event unchanged. No full customer
latency, artwork quality or broad reviewer consistency claim follows from this pair.

## Actual execution and closure — 12 September 2026

The first control dispatched exactly once on42fb159473510a80aa626863c13aa3085bc1fc1a,
Verify Posy CI435 success, Preview posy-5b01kbyoo-poseplans.vercel.app.
Dataset mismatched retained claim296/result297. Anthropic returned400
invalid_request_error: the compiled grammar was too large. No visual response
or feature observations were returned. Critic469ms, stages477ms, HTTP8498ms;
requestCount1, usage zero fallback values (not a billing assertion). The reference
hash proves adapter attachment, not a completed model comparison. Event unchanged.

The registered unavailable/provider stop rule fired. The matching control was
NOT dispatched. Both v1 controls are CLOSED in code; no original claim was reset,
no retry or replacement registration was added, and no image was generated.

The initial response schema repeated a nested object for every feature and
reference. The v2 correction uses one flat array item schema shared across all
references/features. Every row supplies referenceKey, feature, candidateLocation,
candidateVisibility, referenceVisibility, separate observations, assessment and
explanation. Server validation requires exactly one complete row per registered
reference/feature pair and rejects unknown, missing or duplicate pairs. Visibility
is checked per feature. The resulting retained comparison groups these rows and
preserves the same identity consistency gates without changing scores or artwork.

This follows Anthropic's [schema complexity guidance](https://platform.claude.com/docs/en/build-with-claude/structured-outputs#schema-complexity-limits).
Simplifying the schema is a corrective implementation, NOT evidence that the
provider accepts it or that the reviewer detects the known likeness defect.
Token counting does not compile the schema. No additional live call was made.
Live schema acceptance and mismatched/matched semantic validation remain open,
as do medium/craft calibration and all original launch/Plus/customer-flow gates.

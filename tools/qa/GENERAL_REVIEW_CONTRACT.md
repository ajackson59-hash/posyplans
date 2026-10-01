# General artwork review contract repair

This repair addresses two defects observed in the closed 16 September 2026
current-resolution study: long requirement labels failed to bind to the server
checklist even when the reviewer recognized the subject, and requested-medium
mismatches were also used as craftsmanship deductions. The raw historical model
answers were not retained, so the precise label drift is unknown.

## Scope and behavior

- Both teaser and invitation reviewers use short server-owned requirement IDs,
  scoped to the exact retained request manifest. The full requirement prose stays
  in the request. There is no fuzzy matching, franchise allowlist or character
  exception.
- Missing, duplicate, unknown or incomplete answers invalidate the review. An
  unresolved answer is not reported to image correction as an observed missing
  subject. A reported absent subject still fails fidelity.
- Requested versus observed treatment has its own located assessment. Craft and
  layout require their own independent evidence basis. A brief-only deduction
  invalidates those assessments; the server never raises or rewrites the score.
- A genuine wrong character, wrong version, missing detail, wrong count, excluded
  content or substituted medium still fails. Good craftsmanship cannot offset it.
- Raw provider response text and stop reasons accompany the verdict for private
  review evidence, including malformed/truncated answers. They contain no request
  headers or credentials. Existing private study storage retains the verdict;
  this does not retrofit raw evidence into historical records or every legacy
  customer pipeline record.
- Identity-shape descriptions such as a character's hair or tail silhouette no
  longer accidentally commission silhouette art. Explicit silhouette art remains
  supported.

The shared behavior covers Disney, Netflix, other named properties, unfamiliar
references, nonhuman characters, original subjects and themes without characters.
Supplied reference descriptions and free-form host intent remain binding. These
changes do not confer visual recognition knowledge on the model or bypass a
provider's content restrictions.

## Verification

The initial 32 new contract regressions all failed before the repair. They use
explicit synthetic model packets, independent of the legacy fixture adapter, for
both review modes across Frozen/Elsa, KPop Demon Hunters/Rumi, Pikachu, Elmo, an
unfamiliar fictional franchise, a garden dinner, construction and abstract art.
Four further integration cases verify actual reported identity and medium
mismatches remain valid failing reviews while craft/layout can remain excellent.

Separate treatment tests cover known, mixed and unfamiliar media, contradictory
reports, unresolved evidence and genuinely independent execution defects. Older
provider fixtures were migrated to the new schema without weakening their quality,
retry, privacy or accounting assertions. The eight-trial feasibility test reuses
one computed expected image; all eight actual outputs are still checked and its
timeout is unchanged.

Final test, typecheck, build and deployment results are recorded in the external
continuation closeout after CI verifies the exact commit.

## Boundaries and next evidence

No paid provider call, new artwork, customer event mutation or Production rollout
is part of this repair. The two-call current-resolution study remains consumed
and closed. The draft launch-blockers PR stays unmerged.

The model, score floors and retry allowances are unchanged. Invitation reviews
now receive the same bounded response headroom formula as teasers, up to the
existing 4,000-token ceiling, to fit the additional structured evidence. Actual
cost, latency and truncation behavior require fresh bounded live measurement.

Passing these software checks proves contract handling, not visual accuracy. A
model can still attach an incorrect semantic rationale to a valid basis label.
Live cross-theme calibration must measure that risk, including accepted positive
controls and an independently labeled harder facial mismatch. Existing human
likeness/finish approvals remain positive; medium fidelity and full-artwork
approval are separate judgments.

The original launch target remains open: eight directions, at least 20 independent
trials per direction, with at least 95% human-approved artwork loaded within
90 seconds per direction. This repair alone does not establish launch readiness.

# Shared artwork pipeline repair — 8 September 2026

Owner direction: fix artwork generation as a whole. Additional saved samples
are not a substitute for correcting the customer pipeline. This pass changes
the shared engine and adds no paid image, critic or classifier requests.

## Reproduced defects and corrections

| Defect | Customer consequence | Correction |
| --- | --- | --- |
| Explicit host scene facts/exclusions were strengthened only for the teaser, with four-clause and 220-character limits. | The later invitation's binary review could omit details; later or long teaser directives lost their explicit checks. | One shared extractor feeds both briefs; complete clauses and later directives survive. Semicolons, contrast and negative directives no longer merge requested and excluded objects in the tested cases. Complete host wording remains authoritative. |
| A recognized theme replacement was reduced to catalog labels. | Requested medium, scene, cast details and exclusions disappeared from the replacement brief. | Preserve the complete replacement instruction or supplied inspiration description; family labels are only recognition hints. |
| Concept normalization shortened art.medium, art.composition and art.prompt. Event binding could also trim the end of a valid prompt. | Artwork-driving instructions vanished before image dispatch. | Only display labels/descriptions are shortened. Over-limit art fields fail before image spend. Server-added facts cannot truncate creative text; the existing text correction handles an incomplete concept. |
| The invitation prompt always appended “illustration,” and omitted supplied inspiration notes. | A requested photograph got conflicting medium language; the reviewer and generator received different reference context. | Preserve the declared medium and send the same supplied context as design data, with no claimed reference pixels or live lookup. |
| Preset construction variety removed named machines from three lanes. | An explicitly requested crane/truck could be replaced to satisfy the preset. | Host-requested machines survive binding and quartet review; unrequested repetitive concepts retain the existing diversity checks. |
| Reuse fingerprint covered concept fields but omitted the appended brief. | A changed exclusion or reference could reuse artwork approved under the old brief. | New pipeline saves/lookups include the complete appended contract. Unchanged font-only restyling still reuses artwork. Legacy assets remain addressable and applicable but cannot masquerade as approval of a new brief. |
| Invitation review used free-form requirement labels and a fixed 700-token response ceiling. | Expanded concrete checklists could be paraphrased or truncated. | Both review modes bind item labels to the exact server list. Invitation response headroom scales with the actual checklist, capped at 4,000 tokens. Missing items still fail regardless of numeric scores. |

## Verification

The first twelve new reproduction cases all failed against the previous code.
After the repairs, the full suite passes: **72 files / 900 tests** (including
18 new continuity cases), TypeScript, frontend build and Vercel function bundle.
Provider calls in these checks are fakes. This verifies software behavior,
not premium visual quality, identity judgment or customer delivery latency.
The existing passing reuse test still dispatches zero new images on its second
identical run. Teaser and invitation review tests both reject a missing sixth
host requirement even when the fake critic returns perfect numeric scores.

## Limits and unchanged boundaries

- No model switch, extra render, image retry, threshold reduction, approval
  relabeling or customer promotion. Paid feasibility execution remains disabled.
- Earlier study results and consumed claims remain frozen. Cases 1 and 2 cannot
  be replayed, and the six unrun cases are not evidence of either pass or failure.
- The Frozen provider output block and its unknown failed-request billing remain
  unresolved. This pass neither identifies the unseen content nor bypasses it.
- The possible Blippi shoe-logo miss remains an unconfirmed visual-review issue.
  More explicit checklists and structurally consistent JSON cannot certify the
  truth of a critic's visual judgment.
- Conservative language extraction is not a general natural-language solver.
  Full host text is retained; arbitrary contradictory refinements, unfamiliar
  identity recognition and visual quality across all media still need evidence.
- Stricter rejection of overlong art fields may require the existing bounded
  text-only correction; those fields are never shortened to force acceptance.
  No additional automatic correction or paid allowance is introduced.
- Production and the launch gate are unchanged. PR #44 remains draft/unmerged.
  The broader eight-direction, twenty-independent-trial, 95%-per-direction,
  human-approved exact-pixels-within-90-seconds customer-flow gate remains open.

Next evaluation must test these specific repairs through the customer pipeline.
Standalone study images cannot establish the invitation/refinement/reuse flows.
Do not restart paid execution under an old allowance or claim the generator is
fixed as a whole from these automated checks.

# Evidence-owned review decisions (v2)

Status: reviewer implemented; a separate pending, owner-private Preview research
route and bounded dispatcher are now prepared in `evidenceReviewStudy.ts` and
`evidenceReviewRegistration.json`. The registration remains **pending** and cannot
spend. No paid v2 execution or customer activation has occurred. The closed v1
study must not be rerun or migrated into v2. This is not a release-quality claim.

## The three corrections

| Failure mechanism | Change | Remaining empirical question |
| --- | --- | --- |
| Score/status and purchase/fact contradictions | Each check has one finding. No numeric score, aggregate `fullBrief`, purchase flag or overall verdict in the model schema. Code derives eligibility. Known server-generated whole-brief aggregates have coverage records, not extra model verdicts. | Can the model consistently make accurate individual observations? |
| Reviewer strengthens a host requirement | Every answer binds to a server check ID and exact source ID/quote; altered/unknown bindings are invalid. Only explicit supported numeric clauses become count rules. The model enumerates objects; code applies the operator. Unspecified scene-level quantities cannot create an executable per-character count. A secondary guard rejects policy assertions masquerading as pixel observations. | Qualitative interpretation and object recognition can still be wrong. Exact quotation and regex checks do not prove semantic truth. |
| Blind craft critic rejects intended layout | Image-only craft checks only artifact and finish. Composition is evaluated with the complete brief, preferred details, override, references and actual teaser/invitation surface. The prompt respects intentional negative space, close portraits, asymmetry and diptychs. | Fresh visual reviews must establish that the model actually uses the context correctly. |

The contract accepts neither stronger requirements nor weaker quality gates. Real
lettering, medium/identity mismatch, execution defects and honest uncertainty
remain non-passing. Invalid review, valid negative evidence and uncertainty are
distinct outcomes. A known violation is not concealed behind another check's
uncertainty.

## Scope and interpretation

- `server/aiFirst/separatedArtworkReview.ts` is the v2 preparation/validation entry.
- `legacySeparatedArtworkReview.ts` preserves the v1 packet/combination code.
  Both registered historical runners and the historical preparation script import
  that frozen version explicitly. Their old registrations and receipt hashes are
  unchanged. Existing customer paths are unchanged. The new owner-only
  `/prepayment-preview/evidence-review/:requestId` route is Preview-only, restricted
  to the registered owner event/branch, and cannot authorize itself from a request.
- Each component is bound to exact pixels, schema, request and model; missing,
  retried, truncated, stale or unaccounted receipts cannot pass.
- No score is elevated, no stored review is rewritten, and no historical answer
  is translated into a v2 approval. The 19 original replies remain private in the
  evaluation evidence. Public-code fixtures preserve their structural conditions
  and expected old validity/results, with narrative observations/locations replaced.
  They are explicitly labeled synthetic and are not original provider replies.
- Numeric compilation is intentionally conservative: whole clauses such as
  “Exactly three arches” or “At least two arches.” Negation, compound alternatives,
  per-person counts and embedded relationships stay qualitative **as written**;
  they are not silently dropped and no global quantity is guessed. These still
  need visual/semantic calibration. Plural nouns and party age do not manufacture
  exact thresholds.
- The prose guard is a secondary integrity check, not a hallucination detector.
  A false observation without a detected policy phrase may still be structurally
  valid. Likewise, a legitimate observation written as a policy claim will need a
  fresh review; it is not treated as evidence of bad artwork.
- Binding quotes to source prevents provenance/scope substitution, not every
  semantic error. Do not advertise this as universal character reliability.
- No hardcoded franchise, character or medium pass exceptions were added.

## Offline verification

`tests/evidenceArtworkReview.test.ts` covers structural regressions from all 19 retained replies, all 12 saved
brief profiles, no redundant verdict fields, invalid binding/scope/count attempts,
the microphone policy-claim failure pattern, explicit count enumeration/visibility, lettering
and execution negatives, composition-context routing, unknown styles, references,
transport binding and real SDK serialization with a **fake** transport.
Synthetic positive replies exercise code branches; they are not visual approvals.

Run `npm test` and `npm run check`. `npm run build` is also required in the normal
CI environment. One local environment denied tsx's IPC socket, so do not loosen
machine permissions to get a build result; retain that failure and the CI result
separately.

The provider schema uses flat arrays and the already-used constrained keyword
subset to avoid expanding one nested grammar per requirement. SDK wire tests do
not prove the provider will accept a new schema or the live model will obey the
semantic rules. [Anthropic structured-output documentation](https://platform.claude.com/docs/en/build-with-claude/structured-outputs).

## Next gate

The pending `evidence-review-20260917-v1` verification now freezes eight retained
images, twelve full briefs and twenty once-only requests (eight craft, twelve
fidelity). All twelve combined fingerprints match the previously prepared human
board. There is no reused v1 receipt. The maximum planning reserve is USD2.50;
individual packet reserves total USD1.7772 at 15,000 planned input tokens each and
their existing output caps. This is a planning reserve, not a provider invoice cap.
Sonnet 4.6 standard/global rates remain USD3/15 per million input/output tokens,
checked 17 September at https://platform.claude.com/docs/en/about-claude/pricing.

Old paid allowances are closed. No new calls are authorized by this implementation.
After explicit approval and exact-deployment preflight, review actual replies for all three regressions,
alongside genuine negative controls, before integrating v2 into customer paths.
Then test fresh generation quality and end-to-end delivery time. The eight
directions × twenty-plus trials and 95% human-approved under 90 seconds goal is
still unproven; unit tests cannot establish it.

The separate scheduler retains complete invalid model reports and continues
independent requests only when one physical call, accounting, exact request and
durable retention are known. It stops on unknown billing/outcome, input changes,
retention failure, cancellation, pricing mismatch or reserve overrun. No retry,
repair, generation or classifier is allowed. Every claim/result stays private,
calibration-only, rejected and without a preview ID. Closure is durable; budget
or call allowance cannot be reused. The model never receives human notes or labels.

# Fixed identity-review calibration — September 6, 2026

The owner instructed execution after the shared reference-context handoff was
deployed in `551349f`. This diagnostic has a maximum of four physical Sonnet
review requests, no format repair, no transport retry, and zero image requests.
It does not create an event, checkout, email, customer preview or Production
change. Event 41 supplies the existing owner-private evidence boundary.

The [official Netflix cast article](https://www.netflix.com/tudum/articles/kpop-demon-hunters-cast)
labels each selected diptych: an actor photograph on the left and that actor's
animated character on the right. These externally labeled images supply the
identity ground truth; no generated Posy candidate is treated as a known pass.
Both source diptychs were visually inspected before defining the controls.

| Case | Actual animated subject | Requested subject | Expected identity |
| --- | --- | --- | --- |
| rumi-matched | Rumi | Rumi | true |
| rumi-mismatched | Rumi | Zoey | false |
| zoey-matched | Zoey | Zoey | true |
| zoey-mismatched | Zoey | Rumi | false |

The pairings change only the requested subject. Source bytes, review pixels,
reference notes and review policy stay identical within each pair. Both
characters' descriptions reach every review. Expected answers, case IDs,
source hash labels and dataset IDs never enter the model request. The critic
must identify visible features; agreeing with a requested name is insufficient.

JPEG source dimensions are 1200x589. The source JPEG is decoded and normalized
losslessly to PNG, then the existing customer downsampler produces 560x275
review pixels without cropping, painting or replacing any content. JPEG's
original compression remains; this is transport normalization, not enhancement.
The original reference bytes remain private and are not committed to GitHub.

| Source | Original JPEG SHA-256 | Normalized PNG SHA-256 | Reviewed PNG SHA-256 |
| --- | --- | --- | --- |
| Rumi | `e354b44b4bef82b2950ec845fd4e73323abacd8ddefbae264f88442caad02655` | `534d23bee02f125a69eebcac35bf0c8c25b658195928a530853b42529ec6ddb5` | `d1250022eb248fe16bc22f4d99d1c0ead19b88fc5a79179d122347138babaa88` |
| Zoey | `458a6c18fa1c5e03d7fbd5e91bd75217c1e1144e6863bb14fb35eccf208149eb` | `206292495edee079a83a4614e70e114567d1a952fbe13bc416d397c06c3d7863` | `43f2f3cd39d23c8cad05357920e4fcc40023634d8130534e9a8aac6f1666f2e6` |

Frozen original URLs:

- [Rumi diptych](https://dnm.nflximg.net/api/v6/2DuQlx0fM4wd1nzqm5BFBi6ILa8/AAAAQeqUD1hv3hGIzj909JMahmNQgp34feHhmXQo-f6r2TcG1ZuPCfYTUg21b429cQWLTamM07XGVtjE1iBtuDloL3HqFl6Sf1L-FDjGBDh_YhvI7vstz6WPhcNjY-FgQB0Q3yTSvU3jITpVWbvQ6gOWcM96.jpg?r=58b)
- [Zoey diptych](https://dnm.nflximg.net/api/v6/2DuQlx0fM4wd1nzqm5BFBi6ILa8/AAAAQZ0h6Wkf_bESTyEp4Wc6dx4mQz644WwhL3IRh_OFva69k-cR_HI7WQr1FZxQfE0yrSw_TPSu5w3SDpzZAdEqpSmdcx_zq0I0kGkyYx82EuJZCclpF2LlBc35vwgRc_aQua0moKCcq_qQEfZLLu_4FFyM.jpg?r=658)

The ordinary strict teaser reviewer runs unchanged. Calibration success is
specifically the agreement of its binary identity check **and** exact named
must-have with the external identity label, with complete evidence and one
available response. Overall artwork acceptance is reported separately. These
editorial reference crops are not final customer invitations; text, cropping,
composition or purchase failures do not change their known character identity.
An identity pass does not certify the other five dimensions or the entire gate.

Each case requires the existing Event 41 owner token, Preview environment,
`codex/launch-blockers` branch, exact server-owned source/teaser hashes and an
explicit one-call confirmation. Global durable claims precede dispatch; a
restart, timeout, error, replay, alternate owner or redeployment cannot reset
them. Unknown cases and client-supplied labels/profiles/URLs are rejected. A
45-second abort bounds each call. Claims and final verdicts persist as separate
private `posy-review-calibration-v1` records. Every record stays rejected with
no preview ID and cannot enter retained-image promotion, even if the gate passes.
The test route is now unregistered after this one fixed run. Old deployment
copies retain the same four consumed durable keys and cannot buy more calls.

Run order: Rumi matched, Rumi mismatched, Zoey matched, Zoey mismatched.
Preserve all four outcomes; do not tune the reviewer between controls or reset
failed cases. Stop on unavailable provider/billing or integrity/retention failure.
Do not buy replacement calls for failures. Record source/deployment SHA, exact
hashes, complete verdict, request count, elapsed time and returned usage. Token
usage multiplied by standard prices is not invoice reconciliation.

This is a narrow identity calibration, not a repeated reliability benchmark,
independent human premium-art certification, a 90-second latency result, or
evidence that every possible prompt works. Customer generation and prior
Moana/KPop failures remain untouched. Launch stays on HOLD pending broader proof.

## Completed live run and resulting correction

Executed on exact `7a862fc2f6f088aff79b1bce85daca7d2df41a4c`, Preview
`dpl_7jxQ6ywm38EmvqhjY7GGX2WHK71X`, after Verify Posy #401 passed. All four
HTTP requests returned 200 with one available critic response each, no format
repair, no transport retry and zero image calls. Claims 143/145/147/149 and
results 144/146/148/150 persist under Event 41. Owner readback confirms all
eight records remain rejected with no preview ID. Original generated attempts
141/142 retain their previous rejected status; they were not reviewed again.

| Case | Result attempt | Identity answer | Correct against external label | Critic time | HTTP observed time | Input / output tokens | Token-rate cost |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Rumi matched | 144 | true | yes | 23,095 ms | 31,649 ms | 3,931 / 731 | $0.022758 |
| Rumi mismatched | 146 | false | yes | 26,880 ms | 33,101 ms | 3,931 / 821 | $0.024108 |
| Zoey matched | 148 | true | yes | 22,388 ms | 28,160 ms | 3,931 / 859 | $0.024678 |
| Zoey mismatched | 150 | false | yes | 18,903 ms | 25,835 ms | 3,931 / 764 | $0.023253 |

Identity agreement: **4/4**, including both false-positive controls. Combined
usage: 15,724 input / 3,175 output tokens, standard-rate arithmetic **$0.094797**.
These are token-derived amounts, not invoice reconciliation. None of the four
passed the full artwork gate. That separate outcome must not be replaced by
the successful identity metric.

The run exposed an upstream scope defect: all four prompts acquired mandatory
heroine-trio and supernatural-scene requirements through the subject-family
rules, although the profiles requested a single animated subject in a diptych.
The critic correctly found the requested identity in both positive cases, but
the unwanted extra requirements reduced brief scores and also affected other
scores. Some positive craft/composition evidence accompanied sub-5 scores;
the Zoey mismatch notes also incorrectly said the diptych was not requested.
Thus these controls do not establish calibration of the overall artistic gate.

The follow-up removes fixed cast sizes, forced weapons/stages and canned
Unicorn Academy winter/igloo scenes from the shared constraints and curated
requirements. Explicit KPop subjects get individual identity checks; Blippi
and Meekah are required individually only when positively requested. Complete
host scenes and exclusions remain authoritative. Direction-card cues prioritize
positively requested details over reference defaults. The older preview prompt
no longer inserts its old soft-play/children/ice-cream scene. Named reference
notes now explicitly distinguish descriptive identity facts from host scope;
the KPop descriptions use the inspected official cast images. Numeric floors,
binary checks, original-source retention and provider settings are unchanged.
No paid call has exercised this follow-up, and no latency gain is asserted.
Local TypeScript, 68 test files / 830 tests, production build and function
bundle pass. The broader general-art-direction suite remains green. Software
tests use synthetic fixtures and do not replace live or human visual evidence.

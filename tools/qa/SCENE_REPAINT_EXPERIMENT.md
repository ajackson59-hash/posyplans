# Retained scene repaint — 12 September 2026

Status: completed and closed. Automated quality rejection with an unresolved
visual-review disagreement. Preview research only; no customer activation.

## User feedback — 12 September 2026

On exact preview SHA `27f88575d373162d89efe9dd3584952747387d9ec914cfc6d1f1943d2f152b8f`,
the user said: **"I think this is an OK option, but more realistic and accurate
representation of Meekah would be ideal"**.

Record this as an acceptable style option with a likeness improvement requested.
It is not an excellent-quality label, complete sample approval, approval of every
gouache output or launch qualification. Do not keep asking whether the user wants
more brush texture; their stated priority is Meekah's realistic, accurate likeness.
Keep this feedback outside the original frozen host brief and original verdict.

The old Meekah rule listed curly hair and purple clothes. The retained critic
called identity accurate using those cues without facial evidence. The shared
brief now explicitly requires recognizable facial proportions, and generation
notes and reviewer instructions distinguish likeness from costume and medium.
They preserve a host-specified version and reject blending versions into a generic
composite. These are instruction changes, not validated image-quality improvements.

The [official About page](https://www.blippi.com/about) was checked and its labeled
Meekah portrait inspected. It shows a different facial structure and a gathered,
asymmetric curl arrangement with a yellow headband, compared with the generated
image's loose rounded hair silhouette. These are cues of that pictured version,
not universal requirements for every performer or host-specified version. Exact
official image URL:
`https://static.wixstatic.com/media/d70790_9f3656b5950649a0b97994a75c065b84~mv2.png`;
SHA-256 `9668d4330ec2611c5f2700f55144dcb40e9070f0ddd24e49b7c222d888220c19`.
Do not use the generated scene as the source of truth for Meekah's face. A future
likeness test should provide the verified official identity reference separately
from scene input, preserving the user's acceptable finish and all scene details.
No new generation or paid review was run for this feedback; the previous
one-edit/one-review registration stays closed.

The last text-only Google candidate preserved Blippi, Meekah and the requested
scene but added menu lettering and did not consistently deliver the requested
gouache treatment. A stronger text prompt did not qualify that result. This
experiment changes the input mechanism: the exact retained source is supplied
as visual scene context for a complete repaint in the unchanged host medium.

- Dataset: `google-retained-scene-repaint-20260912-v1`.
- Owner event 61, source attempt 281; source SHA-256
  `265cfeed3a076ecbf7afde4a9835f67465bde8173cb9334195425c117195b565`.
- Original host SHA-256
  `e4634856bdea506e3b711bef789c1c94b5f6ee578725b407753fe61959da19ad`.
- Maximum **one Google image edit and one existing Sonnet teaser review**.
  Zero classifier calls, retries, alternate providers or automatic publication.
- One atomic global claim survives timeouts, redeployments and concurrent calls.
  Source ownership, bytes, host brief, draft status and Preview branch are checked
  before dispatch. Each paid stage is retained and read back privately.
- Same 1K 9:16 JPEG transport, native PNG retention, exact 560px teaser transform
  and existing review thresholds. Reviewer receives the original host brief, not
  the previous verdict or an instruction to reward improvement.
- Every new row stays research-only/rejected, even if all automated gates pass.
  The original event preview and consumed customer allowance stay intact.

## Decision rule

Inspect the source and exact reviewed teaser independently. All original host
details, both identities, required medium and lettering exclusions must hold.
Report critic disagreements explicitly. One pass would support further testing
of a bounded two-stage flow, not establish universal reliability or launch quality.
A failure closes this experiment; do not sample until success.

This reused scene was generated in an earlier session. Its new edit/review time
is **not** an uninterrupted customer latency measurement. A future complete flow
would also incur the original image generation and review costs and time.

Frozen remains held separately after its provider refusal. Its diagnostic report
was received by Google's forum and was pending moderator approval at the last
confirmed check. This experiment neither changes that brief nor retries it.

## Provider contract

Google's [Interactions API](https://ai.google.dev/api/interactions-api) accepts text
and image content and lists `gemini-3.1-flash-image`. The existing adapter supplies
the retained image bytes directly, with `store=false`, `stream=false`, no custom
safety settings and no provider fallback. Input-image support does not establish
that the output will meet this host's visual standard.

## Observed result

Executed on `ea7049982a2eb615ce9fdb8a05763fb7d9347e54`, Preview deployment
`dpl_3CNgfMnrqA9q8dRbH3Sxv3GUjq6w`; required Verify Posy CI #429 succeeded.
One POST returned HTTP 200 after 39,672ms. Records 283–287 retained the exact
input and stages; final attempt 287 is rejected. The full event was unchanged
before/after. No second POST, regeneration, classifier or alternate provider.

- Exactly one Google image edit (10,116ms including normalization) and one
  unchanged Sonnet review (21,549ms). Experiment stage elapsed 32,720ms. These
  timings exclude the earlier source generation/review and do not prove a
  complete customer-flow latency.
- Google usage: 1,842 input tokens (1,584 text + 258 image), 1,511 output tokens
  (1,120 itemized as image; 391 not itemized by modality). Sonnet: 6,904 input,
  933 output. These are measured usage, not an invoice or a dollar cap.
- Output source 768x1376 SHA-256
  `f996272faa7870d529b62c798ce11af297e0e81581323082d966fe35505ffb29`.
  Exact reviewed teaser 313x560 SHA-256
  `27f88575d373162d89efe9dd3584952747387d9ec914cfc6d1f1943d2f152b8f`.
- Scores: text-free 5, artifact-free 5, premium finish 2, brief fidelity 3,
  composition 5, age appropriateness 5. Required named identities and scene
  elements passed. Medium and purchase checks failed. No exclusion was found.
- Independent agent inspection of source and exact teaser confirms removal
  of menu lettering and retention of Blippi, Meekah, bubbles, ball pit, foam
  play structures and ice-cream counter. Painted mark variation is visible in
  the ivory floor, blue walls, orange structures and purple foreground block.
  Strong character contours and simplified shading remain. This supports
  neither the critic's absolute claim of no painted qualities anywhere nor a
  claim that the requested gouache standard is consistently satisfied.
- The critic's premiumFinish generic-execution observation repeats its medium
  substitution objection without an independent craft flaw, contrary to the
  existing review instructions. `reviewIntegrity.valid=true` checks structure;
  it does not validate semantic truth. Do not relabel this result as approved,
  raise scores automatically or weaken the original fidelity requirement.

## Next engineering decision

No further generation under this registration. Use retained original control,
failed named scenes and this edit to establish a reviewed standard at the exact
customer resolution. Resolve medium judgments by named regions and separate
craft evidence from fidelity evidence before trusting another automated score.
A corrected reviewer needs independent retained examples and a human quality
standard; another prompt rewrite alone is not evidence of calibration. No new
critic call or reviewer change was made in this experiment.

Only after that disagreement is resolved should a separately bounded complete
customer construction-and-repaint flow be considered. It must include all stages
in timing/cost and then meet the unchanged independent per-direction launch
qualification and Plus/payment/reuse/recovery/RSVP/planner/operations gates.
Google forum moderation remains pending at the last confirmed check; it was not
rechecked or reposted in this experiment. Production and PR merge remain held.

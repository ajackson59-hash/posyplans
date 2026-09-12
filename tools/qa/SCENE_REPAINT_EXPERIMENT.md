# Retained scene repaint — 12 September 2026

Status: registered, unrun. Preview research only; no customer activation.

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

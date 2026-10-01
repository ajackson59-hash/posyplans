# Saved-artwork correction repair — 22 September 2026

The owner reaffirmed the product goal: tell Posy what you want and receive
matching artwork without routine founder review. ThemeSpec's generic-theme
substitutions are not adopted. This repair addresses one verified weakness:
the Preview correction workflow previously discarded the image input and
created another picture from text.

## Implemented behavior

- `server/aiFirst/artworkEdit.ts` builds a provider edit from the complete saved
  brief, latest correction, earlier notes and the latest rejected PNG. It is
  independent of the staff UI so a qualified automatic flow can reuse it.
- Prefer the original retained pixels only when their deterministic delivery
  transform matches the inspected image hash. Old records with no original may
  use their inspected PNG. Present-but-invalid originals never fall back.
- Keep the existing GPT Image 2 medium/JPEG transport, one image, zero transient
  retries and 150-second cancellation. The existing adapter selects `/images/edits`
  when pixels are supplied. There is no provider/model fallback or text-only
  retry if an edit fails. Initial creation remains text-only and unchanged.
- Verify the latest archive version and image hash against the correction
  history. The route additionally compares the complete retained brief to the
  current owner-scoped event without depending on JSON object key order.
- Retain operation, input hash, inspected image hash, source dimensions and
  candidate version with the claim, result and any terminal failure. Earlier
  rejected pixels and their decisions remain immutable.
- Reject missing/corrupt/mismatched inputs before scheduling or spending.
  Oversized prompts are rejected rather than truncated. The current adapter's
  portrait/square/landscape shapes are retained; unsupported shapes are rejected
  instead of silently cropped or stretched.
- Existing event enrollment, spend switch, authentication, durable claims,
  correction limits, approval binding and checkout protections remain intact.

## Verification and limits

Local focused verification: **5 files / 67 tests pass**, including the existing
staff page and planner contracts. Transport coverage uses the real adapter
with a synthetic HTTP response and inspects the multipart edit request: exact
source PNG, complete prompt, one image, current model and native portrait size.
It is not a live image generation. Tests also cover latest-image selection on
the second correction, competing dispatch, invalid archive/history/source,
database key reordering, unchanged private archives, terminal failure, no
automatic retry, and fresh approval bound to replacement bytes.

This is an image-conditioned edit, not a mask or a guarantee of unchanged
pixels elsewhere. It does not identify defects automatically, establish
first-image quality, validate unfamiliar character identity, solve medium
fidelity, or qualify launch latency. It does not add routine staff review as
the launch strategy. Existing review controls remain a private verification
boundary until the automatic product path is qualified.

No old research allowance is reopened. No stored human decision is fabricated
or rewritten. No paid call is necessary to deploy this repair. Live visual
evidence must separately establish correction success and regressions using
actual artwork, followed by the existing broader release criteria; software
test results cannot be counted as those visual passes.

Provider API contract consulted: https://developers.openai.com/api/reference/resources/images/methods/edit


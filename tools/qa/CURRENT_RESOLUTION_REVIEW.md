# Current-resolution full reviewer check — 2026-09-16

Fresh registration `current-resolution-gate-v1`, authorized by the user's “Proceed” after accepting Scene A's likeness and finish. Preview branch `codex/launch-blockers` only; owner research event61. This is the unchanged ordinary full artwork reviewer, not the separate reference-only likeness checker. Previous paid registrations remain closed.

## Fixed cases and order

1. `current-resolution-20260916-v1-lettering`: saved Google attempt281, source SHA256 `265cfeed3a076ecbf7afde4a9835f67465bde8173cb9334195425c117195b565`; detail-v1 reviewed SHA256 `dcfc60f28fea7d45a16918a9db1d8619deca90a708658596c55ad1127e6a8f21`. This has forbidden menu lettering. Success requires an available, internally valid rejection specifically for located lettering, with text score below 5. Inspect the retained observation against the actual lettering before proceeding.
2. Only after case 1 succeeds on the same deployment: `current-resolution-20260916-v1-accepted-scene-a`. Saved event55 Scene A, exact uploaded source SHA256 `47c3d7ee71ca21fedc624e6b10d8db5a5cead8d738bbf91027fbe58f752f241d`; reviewed SHA256 `8f6f8dce768cd36e09d872bd07dc52ad970abca772279fd807a0e6df05c0e105`. Human likeness and finish are accepted. No human approval is inferred for the medium specification, every scene requirement, purchase appeal, complete invitation or Production release. Report identity/finish agreement and full gate separately.

Both sources and reviewed images are 768 × 1376 with identical decoded pixels; detail-v1 reduces PNG file size without resizing these sources. The historical Scene A review saw 313 × 560 pixels. This experiment cannot isolate resolution as the cause of any changed verdict because other review changes occurred since that historical review.

## Budget and contract

- At most one ordinary `runVisionGate` request per case; at most two total. No image generation, paid classification, format repair or retries. Planning estimate about $0.15 total; retain actual tokens and code-estimated cost separately from invoiced cost.
- 45-second server deadline plus client-disconnect cancellation. A durable globally unique claim is written and verified before dispatch. A timeout or error consumes that case; do not retry even if the HTTP response is missing. Inspect durable records instead.
- Exact source/reviewed hashes, frozen fixture brief, and current context hash are checked before dispatch. Preflight performs no provider request and writes no claim.
- Same full prompt/schema/settings for both cases apart from candidate pixels. No human labels, case IDs, control outcome, identity reference image, streaming instrumentation, or expected answers enter the provider request.
- All retained source/result rows stay private, rejected, with no preview ID. No event, active preview, payment, production configuration, or customer route behavior is changed.
- A failed or unavailable lettering control closes the cohort without spending the positive. A successful positive does not prove broader reliability or solve the missing harder facial-mismatch control. Original 8 directions × 20+ trials and ≥95% human acceptance within 90 seconds remain the launch target.

## Endpoint

`POST /api/events/owner/:ownerToken/prepayment-preview/current-resolution-review/:caseId`

Case IDs are `lettering` and `accepted-scene-a`. Strict bodies use `mode: "preflight"` or `mode: "review"`, `expectedAssetHash`, and only for review `confirmOneVisionCall: true`. The accepted case additionally requires exact `candidateBase64`. Owner tokens and protected share URLs must not be copied into reports or committed files.

Close the registration in the continuation record after the bounded run. Keep raw verdicts, exact serialized offline request bodies, source/reviewed files, request hashes, deployment/CI identity, durable attempt IDs, usage, and before/after event hashes in the private evidence archive.

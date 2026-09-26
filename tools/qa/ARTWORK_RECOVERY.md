# Customer artwork recovery — Preview only

A failed image request must preserve the host's brief, original candidates and consumed call while offering a usable customer path. The owner may explicitly choose the existing, visually reviewed Elegant neutral design or upload their own JPG/PNG, inspect the saved pixels and explicitly keep them before checkout. This does not call an image provider, change a failed attempt, waive payment or mark the image as staff/AI approved.

## Upload contract

- Browser: JPG/PNG up to 10 MB, proportionally resized to at most 1536 px, no upscaling, JPEG at quality 95; transparency is composited over white. Both delivered sides must be at least 512 px.
- Server: strict JPEG data URL, maximum 2,500,000 decoded input bytes, bounded decode (4 MP / 64 MB), decode and re-encode to PNG to discard metadata/active content. No remote URLs or SVG accepted.
- Three retained recovery choices (uploads and ready-made designs combined) per event, separate from lifetime provider attempts. Owner token, brief hash, session version and idempotency key are required; compare-and-set handles concurrent uploads. A stale or malformed request cannot modify saved artwork.
- Uploads never replace a prior selection automatically. Existing Keep, exact-hash asset delivery, paid application, planner reuse and public invitation safeguards also apply to uploaded pixels. The ready-made asset is bundled from the existing checked-in JPEG, verified by source SHA256, normalized to PNG and distinctly labeled; it is never presented as a generated match to the host brief. Provider editing of recovery artwork is intentionally unavailable in this recovery path.
- Failed provider attempts stay unchanged. The screen distinguishes a saved request from an image available to keep. Upload recovery works during the existing generation hold.

## Bounded spending continuation

`image_spend_continuations` is separate from `image_spend_reconciliations`. An administrator can document a risk decision for one terminal output-moderation refusal with one confirmed provider call and no image or usage. The original ledger remains `unknown`, with null usage and the call consumed. No zero-charge assertion or refund is made.

The audit requires a paused policy, exact request/policy snapshots and a checksum of the failed attempt. It names at most three unrelated fresh events, expires within 24 hours, and allows at most six further requests (three creates/three edits) within existing lifetime ceilings. It records at least a $1 unknown-cost planning reserve within the already approved $5 planning reserve. These are planning amounts, not provider-enforced dollar caps or known charges.

The audit cannot unpause/reset a policy in the same transaction, cannot be changed/deleted/truncated, and has no client or service-role administration permission. Its insertion alone makes no provider request and authorizes no retry of the failed event. Each dispatch still needs the existing exact prompt/image fingerprint, single-use claim, event cap and separate policy reopening.

Only a matching, unexpired audit can let its named events proceed past that one unknown ledger row. Reserved/dispatched jobs, new failures, altered evidence, counter rollback, changed ceilings, expired audits and unrelated events still block. A second failure automatically pauses the policy again. Successful later operations do not clear the original unknown billing.

`tools/qa/sql/review-event80-bounded-continuation.sql` is the concrete administrator review for cases 06–08. It deliberately leaves spending paused. Review source/CI/migration and fresh case preflight before separately reopening one event. Current scopes, counters and the provider-support investigation must be retained in the final launch record.

## Verification required

Run upload route/UI, existing refusal/selection/planner tests; PostgreSQL tests must prove audit permissions, snapshot preservation, transaction atomicity, ceilings, expiry between reservation/dispatch and stop on a second failure. Live Preview verification uses a fresh private event and an existing original test image or the reviewed ready-made design, no image-provider call or checkout. Verify explicit keep/reload/hash and unchanged prior sessions/counters.

This supplies failure recovery, not qualification of unseen generated artwork, human approval, a Production release or an inbox/payment receipt. Production enablement remains a separate release gate.

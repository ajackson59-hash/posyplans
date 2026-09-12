# QA harnesses

## Offline first-look benchmark

Run without network access, credentials or paid provider calls:

```bash
node --import tsx tools/qa/summarizePreviewBenchmark.ts tools/qa/benchmarks/event34-baseline.json
```

Exit 0 means the observed artwork benchmark meets its requirements, 1 means
HOLD, and 2 means malformed evidence. The retained event-34 baseline should
return **1**, not success: it is one automated pass at 132.186 seconds, with
independent human review and all-in costs still unconfirmed.

The schema in `server/aiFirst/previewBenchmark.ts` is strict and excludes owner
tokens, images, URLs and email. Register every trial ID before a live run and
keep failed/missing trials. Do not mix commits, rendering architectures, briefs
or simulated/live evidence. Report approved-only p50/p95 separately from
terminal timing; a 50ms fallback is not a 50ms artwork success. Human labels
must refer to the exact delivered image, not a larger source or an AI verdict.

The five-case / twenty-trials-per-case minimum is an observed acceptance
sample, not a statistical guarantee or approval to spend on 100 requests.
Paid runs require a separate explicit budget. No build or CI step executes
paid canaries. See `LAUNCH_READINESS.md` for the remaining activation and
whole-product gates.

## `reliabilityFixtureHarness` (tests/aiFirstQaFixtureHarness.test.ts)

Fixture / non-provider QA surface for the PR #3 reliability repair. It
drives the real production `AiFirstInvitations` component and the real
`useAiFirstSession` hook — the same files the app ships — through four
scripted scenarios, with `fetch()` stubbed to replay hand-built SSE bodies.
**No model or image provider is ever called.** Run it with the rest of the
suite:

```
npx vitest run tests/aiFirstQaFixtureHarness.test.ts
```

Scenarios, each captured at a 1024px ("desktop") and a 390px ("mobile")
container width:

1. **Progress** — a run in flight, with the completed/fallback direction
   counts visible mid-stream.
2. **Failure** — an SSE body that ends with no `done` or `error` event
   (the exact defect this repair closes); the host sees a clear failure
   message, not silence.
3. **Recovery** — a fresh, successful run after that failure.
4. **Duplicate-click prevention** — the Generate button stays disabled
   because the server's durable status says a generation is already
   active for this event, independent of this component's own local
   `running` state (so it survives a reload or a second tab).

Output lands in `tools/qa/evidence/`:

- `*.html` — one static snapshot per (scenario × width), the real captured
  `innerHTML` from jsdom, viewable in any browser.
- `manifest.json` — what was captured and a reminder of the non-provider
  guarantee.
- `schematic-*.png` — a labeled schematic per scenario, laid out from the
  real captured text with Pillow.

### Why schematics and not screenshots

This sandbox's OS is not one Playwright ships a supported Chromium build
for (`npx playwright install chromium` fails with *"Playwright does not
support chromium on ubuntu26.04-x64"*), and no other headless browser
engine is available here. Rather than skip visual evidence, the exact text
the real component rendered is laid out in a labeled PNG so it can be
scanned quickly — clearly marked as a schematic of real output, not a
pixel-accurate browser screenshot. The `.html` snapshots alongside it are
literal captured markup and can be opened directly in a real browser to see
the actual styled layout.

## `experience` / `mockApi.mjs` / `board.tsx` / `rsvp.tsx`

Pre-existing harnesses from PR #1 for Playwright-based visual QA against a
mock API replaying recorded pipeline events. Unmodified by this repair.

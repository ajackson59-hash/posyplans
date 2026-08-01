// The whole pipeline, end to end, on the three verification briefs.
//
// The concepts are the real ones the live model produced (read back from
// concept-runs.json), and everything downstream of them is the real production
// code: the real layout validator, the real palette normalizer, the real
// Tier 1 checks running on real PNG bytes, the real preview store, the real
// ledger, the real fallback.
//
// Two seams are substituted, and only two:
//
//   1. gpt-image-1 — OPENAI_API_KEY is not present in this environment, so
//      artwork is synthesised deterministically. The bytes are real PNGs and
//      Tier 1 judges them for real; they are simply not the provider's pixels.
//   2. The Tier 2 critic — scripted, so a given direction can be made to fail
//      on demand. Real Tier 2 evidence comes from gate.ts, which runs the
//      actual critic against the four real gpt-image-1 images.
//
// Each brief is scripted to exercise a different failure path, because a run
// where everything passes proves nothing about what happens when it doesn't.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { runAiFirstPipeline } from "../../server/aiFirst/pipeline";
import { InMemoryUsageStore, MAX_ARTWORK_CONCURRENCY } from "../../server/aiFirst/usage";
import { InMemoryPreviewStore, applyPreview, assetHashOf } from "../../server/aiFirst/previewStore";
import { buildEventBrief } from "../../server/aiFirst/brief";
import type { AiFirstConcept } from "@shared/aiFirstInvite";
import type { PipelineEvent } from "@shared/aiFirstStream";
import { artworkForAspect, framedArtworkForAspect } from "../../tests/aiFirstFixtures";
import { BRIEFS } from "./briefs";

const OUT = process.argv[2] ?? "/home/user/workspace/posy-ai-first-implementation-review/evidence";
mkdirSync(OUT, { recursive: true });

const runs = JSON.parse(readFileSync(join(OUT, "concept-runs.json"), "utf8")) as {
  rows: { id: string; concepts: AiFirstConcept[] }[];
};
const conceptsFor = (id: string) => runs.rows.find((r) => r.id === id)!.concepts;

/* ── Scripted defects ────────────────────────────────────────────────── */

/**
 * What each brief is made to go wrong, so every branch of the gate appears in
 * the evidence rather than only the happy path.
 */
type Defect =
  | { kind: "tier1-twice"; direction: number }
  | { kind: "tier1-once"; direction: number }
  | { kind: "tier2-once"; direction: number };

const SCRIPT: Record<string, Defect> = {
  // Printed margin on both attempts: Tier 1 rejects twice, so the direction
  // must be replaced by an adapted studio direction.
  A: { kind: "tier1-twice", direction: 2 },
  // Printed margin on the first attempt only: one retry, then a pass.
  B: { kind: "tier1-once", direction: 1 },
  // Clean bytes, but the critic rejects the first attempt on premium finish.
  C: { kind: "tier2-once", direction: 3 },
};

const visionBody = (pass: boolean, required: string[]) => ({
  textLogoWatermarkFree: 5,
  artifactFree: pass ? 5 : 4,
  premiumFinish: pass ? 5 : 2,
  briefFidelity: pass ? 5 : 4,
  compositionQuality: pass ? 5 : 4,
  ageAppropriate: 5,
  requiredPresent: required.map((requirement) => ({ requirement, present: true })),
  excludedFound: [],
  notes: pass ? "" : "scripted rejection: finish reads mass-market rather than premium",
});

/* ── One brief ───────────────────────────────────────────────────────── */

interface RunResult {
  id: string;
  label: string;
  summary: unknown;
  peakConcurrency: number;
  imageCalls: number;
  directions: unknown[];
  progressMessages: string[];
  warnings: string[];
  ledger: unknown[];
}

async function runBrief(spec: (typeof BRIEFS)[number], store: InMemoryPreviewStore, usageStore: InMemoryUsageStore) {
  const brief = buildEventBrief({ event: spec.event, dna: spec.dna, guestCount: spec.guestCount });
  const concepts = conceptsFor(spec.id);
  const defect = SCRIPT[spec.id];

  // The pipeline assigns direction indexes in stream order, and the image
  // generator only sees a prompt — so the defect is keyed off the artwork
  // prompt of the concept it belongs to.
  const targetPrompt = concepts[defect.direction].art.prompt;
  // The critic never sees the artwork prompt — it is shown the image plus the
  // direction's name and the brief's requirements.
  const targetName = concepts[defect.direction].conceptName;

  const events: PipelineEvent[] = [];
  let imageCalls = 0;
  let inFlight = 0;
  let peakConcurrency = 0;
  const attemptsPerPrompt = new Map<string, number>();
  const visionAttemptsPerPrompt = new Map<string, number>();

  const client = {
    messages: {
      stream: async () =>
        (async function* () {
          for (const concept of concepts) {
            await new Promise((r) => setTimeout(r, 5));
            yield { type: "content_block_delta", delta: { type: "text_delta", text: `${JSON.stringify(concept)}\n` } };
          }
        })(),
      create: async (request: { messages: { content: unknown[] }[] }) => {
        // The critic is told which image it is looking at only through the
        // prompt text, so the script reads the same signal.
        const text = (request.messages[0].content as { type: string; text?: string }[])
          .filter((b) => b.type === "text")
          .map((b) => b.text ?? "")
          .join("");
        const isTarget = text.includes(targetName);
        const n = (visionAttemptsPerPrompt.get(isTarget ? "target" : "other") ?? 0) + 1;
        visionAttemptsPerPrompt.set(isTarget ? "target" : "other", n);
        const pass = !(defect.kind === "tier2-once" && isTarget && n === 1);
        return {
          content: [{ type: "text", text: JSON.stringify(visionBody(pass, brief.requirements.required)) }],
          usage: { input_tokens: 1_100, output_tokens: 160 },
        };
      },
    },
  } as unknown as Anthropic;

  const summary = await runAiFirstPipeline({
    eventId: spec.eventId,
    email: spec.email,
    brief,
    previewStore: store,
    usageStore,
    allowance: 40,
    sink: (event) => events.push(event),
    anthropic: client,
    // Real OCR ran against the four real gpt-image-1 images in gate.ts.
    // Running it on synthetic noise would measure the fixture, not the check.
    ocr: false,
    generateImage: async ({ prompt, aspectRatio }) => {
      imageCalls += 1;
      inFlight += 1;
      peakConcurrency = Math.max(peakConcurrency, inFlight);
      try {
        await new Promise((r) => setTimeout(r, 8));
        const isTarget = prompt.includes(targetPrompt.slice(0, 60));
        const attempt = (attemptsPerPrompt.get(prompt.slice(0, 60)) ?? 0) + 1;
        attemptsPerPrompt.set(prompt.slice(0, 60), attempt);
        const framed =
          isTarget &&
          ((defect.kind === "tier1-twice") || (defect.kind === "tier1-once" && attempt === 1));
        const bytes = framed ? framedArtworkForAspect(aspectRatio) : artworkForAspect(aspectRatio, spec.eventId * 31 + imageCalls);
        return {
          bytes,
          dataUrl: `data:image/png;base64,${bytes.toString("base64")}`,
          durationMs: 8,
        };
      } finally {
        inFlight -= 1;
      }
    },
  });

  const directions = events.filter((e) => e.type === "direction").map((e) => (e as any).direction);

  const result: RunResult = {
    id: spec.id,
    label: spec.label,
    summary,
    peakConcurrency,
    imageCalls,
    progressMessages: events.filter((e) => e.type === "progress").map((e) => (e as any).message),
    warnings: events.filter((e) => e.type === "warning").map((e) => (e as any).message),
    directions: directions.map((d) => ({
      index: d.index,
      conceptName: d.concept.conceptName,
      // The resolved concept — post layout repair and palette normalization —
      // so the QA board draws exactly what the pipeline decided.
      concept: d.concept,
      source: d.source,
      layoutStyle: d.concept.layoutStyle,
      overlay: d.overlay,
      artworkOpacity: d.artworkOpacity ?? null,
      previewId: d.previewId,
      assetHash: d.assetHash,
      reusedPreview: d.reusedPreview,
      msFromStart: d.msFromStart,
      // Preserved verbatim: every attempt, including the ones the gate threw
      // away, with the codes that threw them away.
      attempts: d.attempts,
    })),
    ledger: [],
  };
  return { result, directions };
}

/* ── Run all three, then reuse, then apply ───────────────────────────── */

const results: RunResult[] = [];
const store = new InMemoryPreviewStore();
const usageStore = new InMemoryUsageStore();
let firstDirectionOfA: any;

for (const spec of BRIEFS) {
  const { result, directions } = await runBrief(spec, store, usageStore);
  if (spec.id === "A") firstDirectionOfA = directions.find((d) => d.source === "ai-generated");
  results.push(result);
  const s = result.summary as any;
  process.stdout.write(
    `${spec.id}  directions=${s.directions} adapted=${s.adaptedDirections} billed=${s.billedImages} reused=${s.reusedImages} retries=${s.retries} peak=${result.peakConcurrency} cost=$${s.costUsd.toFixed(4)}\n`,
  );
  for (const w of result.warnings) process.stdout.write(`     warn: ${w}\n`);
}

/* Reuse: the same brief again against the same store must buy nothing. */
const reuseUsage = new InMemoryUsageStore();
const { result: reuseRun } = await runBrief(BRIEFS[0], store, reuseUsage);
const reuseSummary = reuseRun.summary as any;
process.stdout.write(
  `\nA (second run, same event)  billed=${reuseSummary.billedImages} reused=${reuseSummary.reusedImages} cost=$${reuseSummary.costUsd.toFixed(4)}\n`,
);

/* Apply: the exact-byte proof. */
const stored = await store.findByPreviewId(BRIEFS[0].eventId, firstDirectionOfA.previewId);
const storedBytes = Buffer.from(stored!.assetUrl.split(",")[1], "base64");
const applyProof = {
  previewId: stored!.previewId,
  conceptFingerprint: stored!.conceptFingerprint,
  assetHashAtSave: stored!.assetHash,
  sha256OfStoredBytes: createHash("sha256").update(storedBytes).digest("hex"),
  assetHashOfStoredBytes: assetHashOf(storedBytes),
  bytes: storedBytes.length,
  identical: assetHashOf(storedBytes) === stored!.assetHash,
  applyWithCorrectHash: await applyPreview(store, BRIEFS[0].eventId, stored!.previewId, stored!.assetHash),
  applyWithWrongHash: await applyPreview(store, BRIEFS[0].eventId, stored!.previewId, "0".repeat(64)),
  imageCallsDuringApply: 0,
  ledgerAfterApply: reuseUsage.all.filter((e) => e.billed).length,
};
process.stdout.write(
  `\napply: identical=${applyProof.identical} ok=${applyProof.applyWithCorrectHash.ok} promoted=${applyProof.applyWithCorrectHash.record?.promoted} wrongHash=${applyProof.applyWithWrongHash.failure}\n`,
);

/* The stored bytes, keyed by preview id, so the QA board renders the exact
   asset the gate approved rather than regenerating anything. */
const assetUrls: Record<string, string> = {};
for (const run of results) {
  for (const d of run.directions as { previewId: string }[]) {
    const record = await store.findByPreviewId(
      BRIEFS.find((b) => b.id === run.id)!.eventId,
      d.previewId,
    );
    if (record) assetUrls[d.previewId] = record.assetUrl;
  }
}

writeFileSync(
  join(OUT, "pipeline-runs.json"),
  JSON.stringify(
    {
      assetUrls,
      note:
        "Concepts are the real live model output. Layout, palette, Tier 1, preview store, ledger and fallback are production code. Artwork is synthesised (OPENAI_API_KEY absent) and Tier 2 is scripted; real Tier 2 evidence is in gate-runs.json.",
      maxArtworkConcurrency: MAX_ARTWORK_CONCURRENCY,
      runs: results,
      reuseRun: { summary: reuseSummary, directions: reuseRun.directions },
      applyProof,
      ledger: usageStore.all,
    },
    null,
    2,
  ),
);
process.stdout.write(`\nwrote pipeline-runs.json\n`);

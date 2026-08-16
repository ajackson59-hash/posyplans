// Live concept-generation evidence for the three verification briefs.
//
// Runs the real production concept path — the real system prompt, the real
// NDJSON stream parser, the real schema validator — against claude-sonnet-4-6
// and records what actually came back. Writes nothing but concepts, timings
// and token counts; no credential ever reaches the artifact.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { buildSystemPrompt, buildUserPrompt } from "../../server/aiFirst/prompt";
import { ConceptStreamParser } from "../../server/aiFirst/conceptStream";
import { buildEventBrief, type EventBrief } from "../../server/aiFirst/brief";
import { CONCEPT_MODEL } from "../../server/aiFirst/pipeline";
import { buildArtworkPrompt, aspectRatioForLayout } from "@shared/aiFirstInvite";
import type { Event } from "@shared/schema";
import { BRIEFS } from "./briefs";

const OUT = process.argv[2] ?? "/home/user/workspace/posy-ai-first-implementation-review/evidence";
mkdirSync(OUT, { recursive: true });

/** claude-sonnet-4-6 list pricing, USD per million tokens. */
const INPUT_USD_PER_MTOK = 3;
const OUTPUT_USD_PER_MTOK = 15;

interface Row {
  id: string;
  label: string;
  brief: EventBrief;
  userPrompt: string;
  raw: string;
  concepts: unknown[];
  rejections: unknown[];
  msToFirstConcept: number | null;
  msToEachConcept: number[];
  msTotal: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  diversity: Record<string, unknown>;
  artworkPrompts: { index: number; layoutStyle: string; aspectRatio: string; prompt: string }[];
}

async function runOne(spec: (typeof BRIEFS)[number]): Promise<Row> {
  const brief = buildEventBrief({
    event: spec.event as Event,
    dna: spec.dna,
    guestCount: spec.guestCount,
  });
  const system = buildSystemPrompt();
  const userPrompt = buildUserPrompt({ brief });
  const parser = new ConceptStreamParser();
  const client = new Anthropic();

  const started = Date.now();
  const msToEachConcept: number[] = [];
  let raw = "";
  let inputTokens = 0;
  let outputTokens = 0;

  const stream = await client.messages.stream({
    model: CONCEPT_MODEL,
    max_tokens: 4096,
    system,
    messages: [{ role: "user", content: userPrompt }],
  });

  for await (const event of stream as AsyncIterable<Record<string, any>>) {
    if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
      const text = event.delta.text as string;
      raw += text;
      for (const _line of parser.push(text)) msToEachConcept.push(Date.now() - started);
    }
    if (event.type === "message_start") inputTokens = event.message?.usage?.input_tokens ?? 0;
    if (event.type === "message_delta") outputTokens = event.usage?.output_tokens ?? outputTokens;
  }
  for (const _line of parser.flush()) msToEachConcept.push(Date.now() - started);

  const msTotal = Date.now() - started;
  // Re-parse the captured stream to recover the concept objects themselves.
  const replay = new ConceptStreamParser();
  const concepts = [...replay.push(raw), ...replay.flush()].map((l) => l.concept);

  const uniq = (values: string[]) => Array.from(new Set(values));
  const diversity = {
    media: uniq(concepts.map((c) => c.art.medium)),
    styleLanes: uniq(concepts.map((c) => c.styleLaneId)),
    layouts: uniq(concepts.map((c) => c.layoutStyle)),
    fontPairings: uniq(concepts.map((c) => c.fontPairingId)),
    baseThemes: uniq(concepts.map((c) => c.baseThemeId)),
    meetsFourMedia: uniq(concepts.map((c) => c.art.medium)).length >= 4,
    meetsFourLanes: uniq(concepts.map((c) => c.styleLaneId)).length >= 4,
    meetsThreeLayouts: uniq(concepts.map((c) => c.layoutStyle)).length >= 3,
    meetsFourFontPairings: uniq(concepts.map((c) => c.fontPairingId)).length >= 4,
  };

  return {
    id: spec.id,
    label: spec.label,
    brief,
    userPrompt,
    raw,
    concepts,
    rejections: replay.rejections,
    msToFirstConcept: msToEachConcept[0] ?? null,
    msToEachConcept,
    msTotal,
    inputTokens,
    outputTokens,
    costUsd: (inputTokens / 1e6) * INPUT_USD_PER_MTOK + (outputTokens / 1e6) * OUTPUT_USD_PER_MTOK,
    diversity,
    artworkPrompts: concepts.map((c, index) => ({
      index,
      layoutStyle: c.layoutStyle,
      aspectRatio: aspectRatioForLayout(c.layoutStyle),
      prompt: buildArtworkPrompt(c),
    })),
  };
}

const system = buildSystemPrompt();
writeFileSync(join(OUT, "concept-system-prompt.txt"), system);

const rows: Row[] = [];
for (const spec of BRIEFS) {
  process.stdout.write(`running ${spec.id} — ${spec.label}\n`);
  try {
    const row = await runOne(spec);
    rows.push(row);
    process.stdout.write(
      `  ${row.concepts.length} concepts · first at ${row.msToFirstConcept}ms · all at ${row.msTotal}ms · $${row.costUsd.toFixed(4)}\n`,
    );
  } catch (err) {
    process.stdout.write(`  FAILED: ${(err as Error).message}\n`);
  }
}

writeFileSync(join(OUT, "concept-runs.json"), JSON.stringify({ model: CONCEPT_MODEL, systemPromptChars: system.length, rows }, null, 2));
process.stdout.write(`\nwrote ${rows.length} runs to ${OUT}/concept-runs.json\n`);

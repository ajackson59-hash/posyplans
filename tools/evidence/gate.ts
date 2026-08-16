// The real gate, run against real inputs.
//
// Two halves, both live:
//   1. Every one of the 12 concepts the model actually produced, through the
//      real layout-compatibility validator and the real palette normalizer.
//   2. The four gpt-image-1 images from the prior approved proof, through the
//      real Tier 1 checks (including OCR) and the real Tier 2 vision critic.
//
// The second half is the point: those images shipped under the old overall>=3
// bar. This records what the new gate does with the same bytes.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { runTier1Checks, readPngSize } from "../../server/aiFirst/tier1";
import { runVisionGate, visionCostUsd } from "../../server/aiFirst/visionGate";
import { buildEventBrief } from "../../server/aiFirst/brief";
import { OVERLAY_COVERAGE, validateLayoutBeforeGeneration } from "@shared/aiFirstLayout";
import { normalizeSemanticPalette, hasInvisibleDetail, contrastRatio } from "@shared/aiFirstPalette";
import { aspectRatioForLayout, type AiFirstConcept } from "@shared/aiFirstInvite";
import type { Event } from "@shared/schema";
import { BRIEFS } from "./briefs";

const OUT = process.argv[2] ?? "/home/user/workspace/posy-ai-first-implementation-review/evidence";
const PROOF =
  "/home/user/workspace/projects/posy-lxbtlj8bT9SpVfQckyh1xw/files/AI_First_Invitation_Automated_Proof_2026-08-01";
mkdirSync(OUT, { recursive: true });

const runs = JSON.parse(readFileSync(join(OUT, "concept-runs.json"), "utf8")) as {
  rows: { id: string; label: string; concepts: AiFirstConcept[] }[];
};

/* ── 1. Layout + palette, on the 12 live concepts ────────────────────── */

const layoutRows = runs.rows.flatMap((row) =>
  row.concepts.map((concept, index) => {
    const repair = validateLayoutBeforeGeneration(concept);
    const palette = normalizeSemanticPalette(concept.semanticPalette);
    const after = (role: "headlineColor" | "bodyColor" | "accentColor") =>
      palette.fixes.find((f) => f.role === role)!.after;
    const surface = concept.semanticPalette.textSurface;
    return {
      brief: row.id,
      index,
      conceptName: concept.conceptName,
      layoutStyle: concept.layoutStyle,
      aspectRatio: aspectRatioForLayout(concept.layoutStyle),
      minOverlay: concept.minOverlay,
      safeTypographyRegion: concept.safeTypographyRegion,
      layoutIssues: repair.issues,
      layoutClean: repair.clean,
      resolvedLayout: repair.layoutStyle,
      resolvedOverlay: repair.overlay,
      artworkOpacity: repair.artworkOpacity ?? null,
      overlayCoverage: OVERLAY_COVERAGE[repair.overlay],
      paletteFixes: palette.fixes.filter((f) => f.changed),
      contrastBefore: {
        headline: contrastRatio(concept.semanticPalette.headlineColor, surface),
        body: contrastRatio(concept.semanticPalette.bodyColor, surface),
        accent: contrastRatio(concept.semanticPalette.accentColor, surface),
      },
      contrastAfter: {
        headline: contrastRatio(after("headlineColor"), surface),
        body: contrastRatio(after("bodyColor"), surface),
        accent: contrastRatio(after("accentColor"), surface),
        frame: palette.frameContrast,
      },
      framePasses: palette.framePasses,
      invisibleDetail: hasInvisibleDetail({
        textSurface: surface,
        headlineColor: after("headlineColor"),
        bodyColor: after("bodyColor"),
        accentColor: after("accentColor"),
      }),
    };
  }),
);

/* ── 2. Tier 1 + Tier 2, on the proof's real gpt-image-1 bytes ───────── */

// The proof's own commissioning brief, transcribed from its user payload, so
// briefFidelity is measured against what these images were actually asked for
// rather than against one of the three new verification briefs.
const proofBrief = buildEventBrief({
  event: {
    id: 0,
    eventName: "Modern Space-Cowgirl Fourth Birthday",
    eventType: "Birthday Party",
    themeName: "modern space-cowgirl",
    vibeDescription:
      "Modern space-cowgirl. Dusty rose, chrome silver, midnight navy and soft lilac. Disco planets, celestial stars, metallic fringe and restrained western references. Fashion-forward, editorial, celebratory and age-appropriate.",
    paletteColors: JSON.stringify(["dusty rose", "chrome silver", "midnight navy", "soft lilac"]),
    eventDate: "October 17, 2026",
    location: "modern indoor celebration space",
    venueName: "",
  } as unknown as Event,
  dna: { modernTraditional: -0.9, formalPlayful: 0.65, elegantCasual: -0.7, indoorOutdoor: -1 },
  guestCount: 24,
});

/** A concept whose layout requests the aspect this image actually is. */
function conceptForAspect(width: number, height: number): AiFirstConcept {
  const ratio = width / height;
  const layout = ratio > 1.2 ? "banner" : ratio < 0.85 ? "full-bleed" : "centered";
  const match = runs.rows.flatMap((r) => r.concepts).find((c) => c.layoutStyle === layout);
  return match ?? runs.rows[0].concepts[0];
}

interface ProofRow {
  file: string;
  bytes: number;
  sha256: string;
  tier1: unknown;
  tier1Passed: boolean;
  vision?: unknown;
  visionCostUsd?: number;
}

const proofRows: ProofRow[] = [];
const client = new Anthropic();

for (const n of [1, 2, 3, 4]) {
  const file = join(PROOF, `artwork-${n}.png`);
  if (!existsSync(file)) continue;
  const bytes = readFileSync(file);
  const size = readPngSize(bytes);
  // Judged against the layout its own aspect implies, so a `dimensions`
  // finding is a real defect rather than an artefact of the pairing.
  const referenceConcept = conceptForAspect(size.width, size.height);
  const tier1 = runTier1Checks({
    bytes,
    concept: referenceConcept,
    overlayCoverage: OVERLAY_COVERAGE[referenceConcept.minOverlay],
    artworkOpacity: 1,
    ocr: true,
  });

  const row: ProofRow = {
    file: `artwork-${n}.png`,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    tier1: {
      passed: tier1.passed,
      durationMs: tier1.durationMs,
      findings: tier1.findings,
      salientRegions: tier1.salientRegions.length,
      dimensions: tier1.image ? `${tier1.image.width}x${tier1.image.height}` : null,
    },
    tier1Passed: tier1.passed,
  };

  process.stdout.write(
    `artwork-${n}.png  tier1 ${tier1.passed ? "PASS" : "FAIL"}  [${tier1.findings.map((f) => f.code).join(", ") || "clean"}]\n`,
  );

  // Tier 2 runs regardless, because the question being answered is what the
  // NEW bar makes of images the OLD bar shipped.
  const verdict = await runVisionGate({ bytes, concept: referenceConcept, brief: proofBrief, client });
  row.vision = verdict;
  row.visionCostUsd = verdict.usage ? visionCostUsd(verdict.usage) : 0;
  process.stdout.write(
    `              tier2 ${verdict.passed ? "PASS" : "FAIL"}  ${JSON.stringify(verdict.scores)}  codes=[${verdict.failureCodes.join(", ")}]\n`,
  );
  proofRows.push(row);
}

writeFileSync(
  join(OUT, "gate-runs.json"),
  JSON.stringify({ layout: layoutRows, proofArtwork: proofRows }, null, 2),
);
process.stdout.write(`\nwrote ${layoutRows.length} layout rows and ${proofRows.length} proof rows\n`);

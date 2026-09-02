// Tier 2: the paid vision pass. Runs only when Tier 1 passed.
//
// Acceptance is deliberately stricter than the existing illustration gate,
// which accepted `overall >= 3`. A 3/5 "premium feel" is a card a host would
// be embarrassed to send, and an average cannot express "one required element
// is missing" — so there is no overall score here at all. Every dimension has
// its own floor and the required/excluded lists are pass/fail.

import Anthropic from "@anthropic-ai/sdk";
import type { EventBrief } from "./brief";
import type { AiFirstConcept } from "@shared/aiFirstInvite";
import { MIN_DIMENSION_SCORE, type VisionScores } from "@shared/aiFirstStream";
import { concreteSubjectReviewRequirementsForBrief } from "./conceptPreflight";
import { typePlacementFrame } from "@shared/aiFirstLayout";
import { LOCAL_TYPE_SURFACE_ALPHA } from "@shared/themeCatalog";

export const VISION_MODEL = "claude-sonnet-4-6";

export { MIN_DIMENSION_SCORE };
export type { VisionScores };

export interface VisionVerdict {
  scores: VisionScores;
  /** One entry per REQUIRED item, in the brief's order. */
  requiredPresent: { requirement: string; present: boolean }[];
  /** One entry per EXCLUDED item that the critic saw. */
  excludedFound: string[];
  notes: string;
  passed: boolean;
  failureCodes: string[];
  /** True when the vision pass could not run — never silently a pass. */
  unavailable: boolean;
  durationMs: number;
  usage: { inputTokens: number; outputTokens: number };
}

const SYSTEM = `You are a strict art director reviewing AI-generated artwork for a printed invitation a host will send to real guests. You are the last check before a customer sees it.

Score each 1-5. 4 means "a professional stationery studio would ship this". 3 means "acceptable but visibly compromised" — that is a FAIL here, so do not use 3 to be kind.

- textLogoWatermarkFree: 5 = no letters, words, numbers, logos, signatures or watermarks anywhere, including stylised or partial ones.
- artifactFree: 5 = no melted, duplicated, malformed or anatomically broken forms.
- premiumFinish: 5 = genuinely premium editorial illustration. Score 1-2 for clipart, stock-template or generic AI look.
- briefFidelity: 5 = the artwork unmistakably delivers the brief's stated identity.
- compositionQuality: 5 = clear, balanced, intentional composition after applying the FINAL TYPE PROTECTION described by the user. For none, gradient or veil protection, any face, person, hero object or required subject inside the supplied LIVE TYPOGRAPHY BOX forces a score of 3 or lower. A plate is different: it is a nearly opaque paper panel in the final renderer, so judge the composition as though the pixels beneath that box are covered. Do not fail a plate merely because raw artwork lies beneath it. Do fail briefFidelity or compositionQuality if covering that box hides the only visible must-have, removes the theme's only recognizable subject, or leaves the visible composition outside the panel unbalanced.
- ageAppropriate: 5 = correctly pitched for the celebrant's age. Babyish work for an adult, or content too mature for a child, scores 1. When the host explicitly requests an all-ages action or fantasy identity, do not fail this dimension merely because faithful imagery includes stylized fantasy weapons, non-graphic supernatural creatures, performance costumes or dramatic poses. Judge whether the treatment becomes graphic, sexualized or genuinely frightening beyond that requested identity's normal family-audience presentation.

Judge BRIEF REQUIREMENTS holistically through briefFidelity and ageAppropriate. Do not repeat them in requiredPresent.

For each VISIBLE MUST-HAVE, report whether that concrete subject is visibly present. These are binary positive visual facts only. Return an empty requiredPresent array when there are no VISIBLE MUST-HAVES. Also list any EXCLUDED item you can actually see.

Reply with JSON only:
{"textLogoWatermarkFree":0,"artifactFree":0,"premiumFinish":0,"briefFidelity":0,"compositionQuality":0,"ageAppropriate":0,"requiredPresent":[{"requirement":"","present":true}],"excludedFound":[],"notes":""}`;

/** Which retry remedy each failed dimension maps onto. */
const TEASER_SYSTEM = `You are a strict art director reviewing the exact final pixels of a personalized pre-payment artwork teaser. The customer sees this artwork at its native aspect ratio with no browser crop, text box, badge, gradient, panel or other overlay.

Score each 1-5. 4 means "a professional stationery studio would confidently show this as a compelling first look". 3 means acceptable but visibly compromised and is a FAIL.

- textLogoWatermarkFree: 5 = no letters, words, numbers, logos, signatures or watermarks anywhere, including stylised or partial ones.
- artifactFree: 5 = no melted, duplicated, malformed or anatomically broken forms.
- premiumFinish: 5 = art-directed, dimensional and commercially polished enough to create purchase desire on its own. Score 1-2 for clipart, stock-template, merchandise-ad, flat-vector mascot or generic AI look; score 3 for competent but ordinary or synthetic-looking work.
- briefFidelity: 5 = the artwork unmistakably delivers the host's named world, requested setting, activities and defining details.
- compositionQuality: 5 = one clear, balanced, intentional full-bleed scene in the exact supplied pixels. Any collage/split-panel treatment, pasted cutout look, poster/sign/card surface, cropped face or head, edge-clipped lead subject, awkward empty panel, or required hero subject pushed partly outside the canvas forces 3 or lower.
- ageAppropriate: 5 = correctly pitched for the celebrant's age. When the host explicitly requests an all-ages action or fantasy identity, do not fail merely because faithful imagery includes stylized fantasy weapons, non-graphic supernatural creatures, performance costumes or dramatic poses.

Judge BRIEF REQUIREMENTS holistically through briefFidelity and ageAppropriate. For each VISIBLE MUST-HAVE, report whether that concrete subject is visibly present. List any EXCLUDED item you can actually see.

Reply with JSON only:
{"textLogoWatermarkFree":0,"artifactFree":0,"premiumFinish":0,"briefFidelity":0,"compositionQuality":0,"ageAppropriate":0,"requiredPresent":[{"requirement":"","present":true}],"excludedFound":[],"notes":""}`;

/** Which retry remedy each failed dimension maps onto. */
const CODE_FOR_DIMENSION: Record<keyof VisionScores, string> = {
  textLogoWatermarkFree: "text-detected",
  artifactFree: "artifact",
  premiumFinish: "premium-feel",
  briefFidelity: "brief-fidelity",
  compositionQuality: "crop-unsafe",
  ageAppropriate: "age-appropriate",
};

function clampScore(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(5, n));
}

export interface VisionGateInput {
  bytes: Buffer;
  concept: AiFirstConcept;
  brief: EventBrief;
  client?: Anthropic;
  /** Invitation is the default; teaser reviews exact standalone pixels. */
  reviewMode?: "invitation" | "teaser";
  signal?: AbortSignal;
}

export async function runVisionGate(input: VisionGateInput): Promise<VisionVerdict> {
  const started = Date.now();
  const empty: VisionScores = {
    textLogoWatermarkFree: 0,
    artifactFree: 0,
    premiumFinish: 0,
    briefFidelity: 0,
    compositionQuality: 0,
    ageAppropriate: 0,
  };

  if (!process.env.ANTHROPIC_API_KEY && !input.client) {
    return {
      scores: empty,
      requiredPresent: [],
      excludedFound: [],
      notes: "ANTHROPIC_API_KEY is not configured",
      passed: false,
      failureCodes: [],
      unavailable: true,
      durationMs: Date.now() - started,
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  if (input.signal?.aborted) {
    return {
      scores: empty,
      requiredPresent: [],
      excludedFound: [],
      notes: input.signal.reason instanceof Error
        ? input.signal.reason.message
        : "vision review was cancelled",
      passed: false,
      failureCodes: [],
      unavailable: true,
      durationMs: Date.now() - started,
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  const client = input.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const { brief, concept } = input;
  const reviewMode = input.reviewMode ?? "invitation";
  const reviewRequirements = concreteSubjectReviewRequirementsForBrief(brief);
  const typeBox = typePlacementFrame(concept);
  const protectionAlpha = LOCAL_TYPE_SURFACE_ALPHA[concept.minOverlay];
  const protectionInstruction = reviewMode === "teaser"
    ? "FINAL CUSTOMER SURFACE: judge the supplied image exactly as shown. The browser adds no crop, type, badge, gradient, panel or overlay."
    : concept.minOverlay === "plate"
      ? `FINAL TYPE PROTECTION: a ${(protectionAlpha * 100).toFixed(0)}%-opaque solid paper panel in ${concept.semanticPalette.textSurface} covers the LIVE TYPOGRAPHY BOX in the rendered invitation. Treat raw pixels beneath the box as covered. Required subjects must remain clearly recognizable outside the panel, and the remaining visible composition must still feel balanced.`
      : `FINAL TYPE PROTECTION: ${concept.minOverlay} (${(protectionAlpha * 100).toFixed(0)}% local surface opacity). The LIVE TYPOGRAPHY BOX must contain no face, person, hero object or required subject.`;

  const userText = [
    `Celebration: ${brief.eventName || brief.eventType || "a celebration"}${brief.milestone ? ` · ${brief.milestone}` : ""}`,
    brief.visualIdentityOverride
      ? `Current host-selected visual identity: ${brief.visualIdentityOverride}`
      : brief.vibe
        ? `Intended feeling: ${brief.vibe}`
        : "",
    `Direction: ${concept.conceptName} — ${concept.description}`,
    reviewMode === "teaser"
      ? ""
      : `LIVE TYPOGRAPHY BOX (percentage of final card): left ${typeBox.left.toFixed(0)}%, top ${typeBox.top.toFixed(0)}%, width ${typeBox.width.toFixed(0)}%, height ${typeBox.height.toFixed(0)}%.`,
    protectionInstruction,
    "",
    "BRIEF REQUIREMENTS (judge holistically in briefFidelity and ageAppropriate):",
    ...brief.requirements.required.map((r) => `- ${r}`),
    "",
    "VISIBLE MUST-HAVES (report each in requiredPresent):",
    ...reviewRequirements.map((r) => `- ${r}`),
    "",
    "EXCLUDED:",
    ...brief.requirements.excluded.map((r) => `- ${r}`),
  ]
    .filter(Boolean)
    .join("\n");

  let raw = "";
  let usage = { inputTokens: 0, outputTokens: 0 };
  try {
    const response = await client.messages.create({
      model: VISION_MODEL,
      max_tokens: 700,
      system: reviewMode === "teaser" ? TEASER_SYSTEM : SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: input.bytes.toString("base64") },
            },
            { type: "text", text: userText },
          ],
        },
      ],
    }, { signal: input.signal });
    raw = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    usage = {
      inputTokens: response.usage?.input_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    };
  } catch (err) {
    return {
      scores: empty,
      requiredPresent: [],
      excludedFound: [],
      notes: `vision call failed: ${(err as Error).message}`,
      passed: false,
      failureCodes: [],
      unavailable: true,
      durationMs: Date.now() - started,
      usage,
    };
  }

  const parsed = extractJson(raw);
  if (!parsed) {
    return {
      scores: empty,
      requiredPresent: [],
      excludedFound: [],
      notes: "vision response was not parseable JSON",
      passed: false,
      failureCodes: [],
      unavailable: true,
      durationMs: Date.now() - started,
      usage,
    };
  }

  const scores: VisionScores = {
    textLogoWatermarkFree: clampScore(parsed.textLogoWatermarkFree),
    artifactFree: clampScore(parsed.artifactFree),
    premiumFinish: clampScore(parsed.premiumFinish),
    briefFidelity: clampScore(parsed.briefFidelity),
    compositionQuality: clampScore(parsed.compositionQuality),
    ageAppropriate: clampScore(parsed.ageAppropriate),
  };

  const reportedRequired = Array.isArray(parsed.requiredPresent)
    ? parsed.requiredPresent.map((r: { requirement?: unknown; present?: unknown }) => ({
        requirement: String(r?.requirement ?? ""),
        present: r?.present === true,
      }))
    : [];
  // The critic is instructed to report every item in order. Rebuild the
  // result from the server-owned list so omitting three difficult
  // requirements and returning one easy true can never become a pass.
  const requiredPresent = reviewRequirements.map((requirement, index) => {
    const exact = reportedRequired.find(
      (reported) => reported.requirement.trim().toLowerCase() === requirement.trim().toLowerCase(),
    );
    const reported = exact ?? reportedRequired[index];
    return { requirement, present: reported?.present === true };
  });
  const excludedFound = Array.isArray(parsed.excludedFound)
    ? parsed.excludedFound.filter((e: unknown): e is string => typeof e === "string" && e.trim().length > 0)
    : [];

  const failureCodes: string[] = [];
  for (const key of Object.keys(scores) as (keyof VisionScores)[]) {
    if (scores[key] < MIN_DIMENSION_SCORE) failureCodes.push(CODE_FOR_DIMENSION[key]);
  }
  // A missing concrete VISIBLE MUST-HAVE is a failure even if every
  // dimension scored well. Holistic theme/age requirements stay governed by
  // their 4/5 score floors, so they cannot contradict a passing score by
  // being duplicated as vague checklist rows.
  const missingRequired = requiredPresent.filter((r) => !r.present);
  if (missingRequired.length > 0) failureCodes.push("brief-fidelity");
  // The critic returning nothing for a non-empty REQUIRED list is not a pass.
  if (reviewRequirements.length > 0 && requiredPresent.length === 0) {
    failureCodes.push("brief-fidelity");
  }
  if (excludedFound.length > 0) failureCodes.push("excluded-present");

  return {
    scores,
    requiredPresent,
    excludedFound,
    notes: typeof parsed.notes === "string" ? parsed.notes : "",
    passed: failureCodes.length === 0,
    failureCodes: Array.from(new Set(failureCodes)),
    unavailable: false,
    durationMs: Date.now() - started,
    usage,
  };
}

function extractJson(raw: string): Record<string, any> | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Anthropic list pricing for Sonnet 4.6, used for the cost ledger. */
export const VISION_INPUT_USD_PER_MTOK = 3;
export const VISION_OUTPUT_USD_PER_MTOK = 15;

export function visionCostUsd(usage: { inputTokens: number; outputTokens: number }): number {
  return (
    (usage.inputTokens / 1_000_000) * VISION_INPUT_USD_PER_MTOK +
    (usage.outputTokens / 1_000_000) * VISION_OUTPUT_USD_PER_MTOK
  );
}

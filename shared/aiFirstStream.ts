// The wire contract between the generation pipeline and the browser.
//
// It lives in shared/ rather than in the pipeline because the client has to
// parse exactly what the server writes, and a drifting copy of these shapes
// is the classic way a progressive UI starts showing stale or wrong state.
// The server's internal records (Tier 1 findings, vision verdicts) are richer
// than what is declared here; they stay assignable to it, so widening the
// server side can never silently break the client.

import type { AiFirstConcept, ConceptSource } from "./aiFirstInvite";

export const TARGET_DIRECTION_COUNT = 4;

export const PROGRESS_MESSAGES = {
  understanding: "Understanding the event's visual direction…",
  reviewingConcepts: "Comparing four creative directions before artwork…",
  firstDirection: "Creating the first invitation direction…",
  anotherDirection: "Building another interpretation…",
  finishing: "Checking the finishing details…",
  ready: "Four directions are ready.",
} as const;

export interface StreamTier1Finding {
  code: string;
  critical: boolean;
  message: string;
}

export const MIN_DIMENSION_SCORE = 4;

export const QUALITY_REJECTION_MESSAGE =
  "Posy rejected this artwork because it didn't clearly deliver your theme at the required quality. Nothing was applied, and no automatic retry was made.";

export const CONCEPT_RETRY_MESSAGE =
  "Posy couldn't get a strong enough set of invitation directions from that attempt. Nothing was applied. Try the direction again or tell Posy what matters most to keep.";

export function hostFacingGenerationError(message: string): string {
  if (
    /generated artwork did not meet Posy's quality standard/i.test(message) ||
    /invitation generation delivered 0 of \d+ promised directions/i.test(message)
  ) {
    return QUALITY_REJECTION_MESSAGE;
  }
  if (
    /creative quartet failed zero-image preflight/i.test(message) ||
    /concept provider returned \d+/i.test(message) ||
    /quartet must use \d+ distinct/i.test(message) ||
    /concept generation failed:/i.test(message)
  ) {
    return CONCEPT_RETRY_MESSAGE;
  }
  return message;
}

export interface VisionScores {
  textLogoWatermarkFree: number;
  artifactFree: number;
  premiumFinish: number;
  briefFidelity: number;
  compositionQuality: number;
  ageAppropriate: number;
}

export interface StreamVisionVerdict {
  scores: VisionScores;
  requiredPresent: { requirement: string; present: boolean }[];
  excludedFound: string[];
  passed: boolean;
  failureCodes: string[];
  unavailable: boolean;
  notes: string;
}

export interface StreamAttempt {
  attempt: number;
  tier1: { passed: boolean; findings: StreamTier1Finding[]; durationMs: number };
  vision?: StreamVisionVerdict;
  failureCodes: string[];
  billed: boolean;
  durationMs: number;
}

export interface FinishedDirection {
  index: number;
  concept: AiFirstConcept;
  source: ConceptSource;
  previewId: string;
  assetHash: string;
  illustrationUrl: string;
  overlay: AiFirstConcept["minOverlay"];
  artworkOpacity?: number;
  attempts: StreamAttempt[];
  reusedPreview: boolean;
  msFromStart: number;
}

export interface RunSummary {
  directions: number;
  adaptedDirections: number;
  billedImages: number;
  reusedImages: number;
  retries: number;
  costUsd: number;
  msToFirstConcept: number | null;
  msToFirstDirection: number | null;
  msToAllDirections: number | null;
  conceptRejections: number;
  degraded: string[];
}

export type PipelineEvent =
  | { type: "progress"; message: string; at: number }
  | { type: "concept"; index: number; concept: AiFirstConcept; at: number }
  | { type: "direction"; direction: FinishedDirection; at: number }
  | { type: "warning"; message: string; at: number }
  | { type: "done"; summary: RunSummary; at: number }
  | { type: "error"; message: string; at: number };

export class SseParser {
  private buffer = "";

  push(chunk: string): PipelineEvent[] {
    this.buffer += chunk;
    const out: PipelineEvent[] = [];
    let cut = this.buffer.indexOf("\n\n");
    while (cut !== -1) {
      const frame = this.buffer.slice(0, cut);
      this.buffer = this.buffer.slice(cut + 2);
      const payload = frame
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("");
      if (payload) {
        try {
          out.push(JSON.parse(payload) as PipelineEvent);
        } catch {
          // A malformed display frame is dropped; the durable run remains the
          // source of truth and the next valid frame can still arrive.
        }
      }
      cut = this.buffer.indexOf("\n\n");
    }
    return out;
  }
}

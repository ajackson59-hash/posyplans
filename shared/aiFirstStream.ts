// The wire contract between the generation pipeline and the browser.
//
// It lives in shared/ rather than in the pipeline because the client has to
// parse exactly what the server writes, and a drifting copy of these shapes
// is the classic way a progressive UI starts showing stale or wrong state.
// The server's internal records (Tier 1 findings, vision verdicts) are richer
// than what is declared here; they stay assignable to it, so widening the
// server side can never silently break the client.

import type { AiFirstConcept, ConceptSource } from "./aiFirstInvite";

/** The exact host-facing progress strings. Each is emitted from a real transition. */
export const PROGRESS_MESSAGES = {
  understanding: "Understanding the event's visual direction…",
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

/** Every scored dimension must clear this. There is deliberately no overall. */
export const MIN_DIMENSION_SCORE = 4;

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
  /** Every attempt, including the ones that failed. Nothing is concealed. */
  attempts: StreamAttempt[];
  /** True when the bytes came from the preview store rather than a new call. */
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
  /** Set when the gate could not run in full — never presented as a pass. */
  degraded: string[];
}

export type PipelineEvent =
  | { type: "progress"; message: string; at: number }
  | { type: "concept"; index: number; concept: AiFirstConcept; at: number }
  | { type: "direction"; direction: FinishedDirection; at: number }
  | { type: "warning"; message: string; at: number }
  | { type: "done"; summary: RunSummary; at: number }
  | { type: "error"; message: string; at: number };

/**
 * Splits an SSE body into events. Kept here so the browser reader and any
 * test harness agree on framing — a partial `data:` line at a chunk boundary
 * is the failure this exists to make impossible.
 */
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
          // A frame we cannot parse is dropped rather than shown as an error:
          // the run itself is still healthy and the next frame will arrive.
        }
      }
      cut = this.buffer.indexOf("\n\n");
    }
    return out;
  }
}

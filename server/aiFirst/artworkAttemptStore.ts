// Durable retention of EVERY billed provider image result, for protected
// review — accepted and rejected alike.
//
// Every attempt that reaches the provider is money, whether or not it
// passes the quality gate. Before this store existed, an attempt's bytes
// were visible for the lifetime of one SSE response at best (as a `data:`
// URL in a `direction`/`warning` event, now removed) and then gone — the
// only surviving trace was `attempts[].failureCodes`, which tells you
// *that* something failed but not what a human reviewer would need to see
// to judge whether the gate was right to reject it, and nothing at all
// survived for an accepted image's gate scores.
//
// This store therefore records every billed attempt, not only the rejected
// ones: `status` distinguishes "accepted" from "rejected", `previewId` is
// populated only on accepted rows (the one thing ordinary routes are
// allowed to point a host at), and the full gate evidence — Tier 1
// findings, vision scores, failure codes, cost, runId, idempotency key —
// is retained either way, so a reviewer can audit an entire run rather than
// only its failures.
//
// This store is intentionally not the preview store: previews are what
// ordinary routes (status, generate, apply) can serve, and a rejected image
// must never reach a host or a guest through them. Access is through
// owner-scoped review routes, matching how apply/status already authorize
// — not a new public diagnostic endpoint. The listing route
// (GET .../ai-first/review/attempts) never embeds image bytes in its JSON;
// a separate per-attempt binary route
// (GET .../ai-first/review/attempts/:id/asset) serves the bytes, gated the
// same way and cached as owner-private, never as a public shared response.

import { createHash } from "node:crypto";
import type { AiFirstConcept } from "@shared/aiFirstInvite";
import type { Tier1Finding } from "./tier1";
import type { VisionVerdict } from "./visionGate";
import { DEFAULT_ARTWORK_MODEL, type ArtworkModel, type ArtworkQuality, type ArtworkSize } from "./artwork";

export type ArtworkAttemptStatus = "accepted" | "rejected";

export interface ArtworkReviewEvidence {
  version: 1;
  /** Identifies the exact customer-visible bytes reviewed, NOT the retained source. */
  reviewedAssetHash: string | null;
  verdict: VisionVerdict | null;
  generationDurationMs: number;
  reviewError?: string;
}

/** Backward-compatible envelope in the existing JSON column; no schema migration. */
export function encodeAttemptVision(scores: VisionVerdict["scores"] | null, evidence?: ArtworkReviewEvidence | null): string | null {
  return evidence ? JSON.stringify({ version: 1, scores, reviewEvidence: evidence })
    : scores ? JSON.stringify(scores) : null;
}

export function decodeAttemptVision(json: string | null): {
  visionScores: VisionVerdict["scores"] | null; reviewEvidence: ArtworkReviewEvidence | null;
} {
  if (!json) return { visionScores: null, reviewEvidence: null };
  const parsed = JSON.parse(json);
  return parsed?.version === 1
    ? { visionScores: parsed.scores ?? null, reviewEvidence: parsed.reviewEvidence ?? null }
    : { visionScores: parsed, reviewEvidence: null };
}

export interface ArtworkAttemptRecord {
  /** Stable id for this row, used by the per-attempt binary asset route. */
  id: string;
  eventId: number;
  ownerToken: string;
  runId: string | null;
  idempotencyKey: string | null;
  directionIndex: number;
  attempt: number;
  status: ArtworkAttemptStatus;
  assetHash: string;
  assetBytesBase64: string;
  /** Set only when status = "accepted". */
  previewId: string | null;
  concept: AiFirstConcept;
  failureCodes: string[];
  tier1Findings: Tier1Finding[];
  visionScores: VisionVerdict["scores"] | null;
  reviewEvidence?: ArtworkReviewEvidence | null;
  model: ArtworkModel;
  quality: ArtworkQuality;
  /** Null only for evidence written before provider provenance was added. */
  size: ArtworkSize | null;
  costUsdMicros: number;
  createdAt: number;
}

export interface ArtworkAttemptInput {
  eventId: number;
  ownerToken: string;
  runId?: string | null;
  idempotencyKey?: string | null;
  directionIndex: number;
  attempt: number;
  status: ArtworkAttemptStatus;
  bytes: Buffer;
  previewId?: string | null;
  concept: AiFirstConcept;
  failureCodes: string[];
  tier1Findings: Tier1Finding[];
  visionScores: VisionVerdict["scores"] | null;
  reviewEvidence?: ArtworkReviewEvidence | null;
  model?: ArtworkModel;
  quality?: ArtworkQuality;
  size?: ArtworkSize | null;
  costUsdMicros: number;
  now?: number;
}

export interface AiFirstArtworkAttemptStore {
  record(input: ArtworkAttemptInput): Promise<ArtworkAttemptRecord>;
  /** Owner-scoped: an event's attempt evidence can only be read with its own ownerToken. Never includes bytes. */
  listForOwner(eventId: number, ownerToken: string): Promise<ArtworkAttemptRecord[]>;
  /** For the per-attempt binary asset route. Owner-scoped by construction. */
  findById(eventId: number, ownerToken: string, id: string): Promise<ArtworkAttemptRecord | undefined>;
}

let counter = 0;
function nextId(): string {
  counter += 1;
  return `attempt-${Date.now().toString(36)}-${counter}`;
}

export class InMemoryArtworkAttemptStore implements AiFirstArtworkAttemptStore {
  private rows: ArtworkAttemptRecord[] = [];

  async record(input: ArtworkAttemptInput): Promise<ArtworkAttemptRecord> {
    const record: ArtworkAttemptRecord = {
      id: nextId(),
      eventId: input.eventId,
      ownerToken: input.ownerToken,
      runId: input.runId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      directionIndex: input.directionIndex,
      attempt: input.attempt,
      status: input.status,
      assetHash: createHash("sha256").update(input.bytes).digest("hex"),
      assetBytesBase64: input.bytes.toString("base64"),
      previewId: input.status === "accepted" ? (input.previewId ?? null) : null,
      concept: input.concept,
      failureCodes: input.failureCodes,
      tier1Findings: input.tier1Findings,
      visionScores: input.visionScores,
      reviewEvidence: input.reviewEvidence ?? null,
      model: input.model ?? DEFAULT_ARTWORK_MODEL,
      quality: input.quality ?? "high",
      size: input.size ?? null,
      costUsdMicros: input.costUsdMicros,
      createdAt: input.now ?? Date.now(),
    };
    this.rows.push(record);
    return record;
  }

  async listForOwner(eventId: number, ownerToken: string): Promise<ArtworkAttemptRecord[]> {
    return this.rows.filter((r) => r.eventId === eventId && r.ownerToken === ownerToken);
  }

  async findById(eventId: number, ownerToken: string, id: string): Promise<ArtworkAttemptRecord | undefined> {
    return this.rows.find((r) => r.eventId === eventId && r.ownerToken === ownerToken && r.id === id);
  }

  get all(): ArtworkAttemptRecord[] {
    return [...this.rows];
  }
}

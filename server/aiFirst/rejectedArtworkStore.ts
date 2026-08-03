// Durable retention of billed-but-rejected artwork, for protected review.
//
// Every attempt that reaches the provider is money, whether or not it passes
// the quality gate. Before this store existed, a rejected attempt's bytes
// were visible for the lifetime of one SSE response (as a `data:` URL in a
// `direction`/`warning` event, now removed) and then gone — the only
// surviving trace was `attempts[].failureCodes`, which tells you *that*
// something failed but not what a human reviewer would need to see to judge
// whether the gate was right to reject it.
//
// This store is intentionally not the preview store: previews are what
// ordinary routes (status, generate, apply) can serve, and a rejected image
// must never reach a host or a guest. Access is through a route scoped by
// the event's existing ownerToken, matching how apply/status already
// authorize — not a new public diagnostic endpoint.

import { createHash } from "node:crypto";
import type { AiFirstConcept } from "@shared/aiFirstInvite";
import type { Tier1Finding } from "./tier1";
import type { VisionVerdict } from "./visionGate";

export interface RejectedArtworkRecord {
  eventId: number;
  ownerToken: string;
  directionIndex: number;
  attempt: number;
  assetHash: string;
  assetBytesBase64: string;
  concept: AiFirstConcept;
  failureCodes: string[];
  tier1Findings: Tier1Finding[];
  visionScores: VisionVerdict["scores"] | null;
  costUsdMicros: number;
  createdAt: number;
}

export interface RejectedArtworkInput {
  eventId: number;
  ownerToken: string;
  directionIndex: number;
  attempt: number;
  bytes: Buffer;
  concept: AiFirstConcept;
  failureCodes: string[];
  tier1Findings: Tier1Finding[];
  visionScores: VisionVerdict["scores"] | null;
  costUsdMicros: number;
  now?: number;
}

export interface AiFirstRejectedArtworkStore {
  record(input: RejectedArtworkInput): Promise<RejectedArtworkRecord>;
  /** Owner-scoped: an event's rejected artwork can only be read with its own ownerToken. */
  listForOwner(eventId: number, ownerToken: string): Promise<RejectedArtworkRecord[]>;
  findAsset(eventId: number, ownerToken: string, assetHash: string): Promise<RejectedArtworkRecord | undefined>;
}

export class InMemoryRejectedArtworkStore implements AiFirstRejectedArtworkStore {
  private rows: RejectedArtworkRecord[] = [];

  async record(input: RejectedArtworkInput): Promise<RejectedArtworkRecord> {
    const record: RejectedArtworkRecord = {
      eventId: input.eventId,
      ownerToken: input.ownerToken,
      directionIndex: input.directionIndex,
      attempt: input.attempt,
      assetHash: createHash("sha256").update(input.bytes).digest("hex"),
      assetBytesBase64: input.bytes.toString("base64"),
      concept: input.concept,
      failureCodes: input.failureCodes,
      tier1Findings: input.tier1Findings,
      visionScores: input.visionScores,
      costUsdMicros: input.costUsdMicros,
      createdAt: input.now ?? Date.now(),
    };
    this.rows.push(record);
    return record;
  }

  async listForOwner(eventId: number, ownerToken: string): Promise<RejectedArtworkRecord[]> {
    return this.rows.filter((r) => r.eventId === eventId && r.ownerToken === ownerToken);
  }

  async findAsset(eventId: number, ownerToken: string, assetHash: string): Promise<RejectedArtworkRecord | undefined> {
    return this.rows.find((r) => r.eventId === eventId && r.ownerToken === ownerToken && r.assetHash === assetHash);
  }

  get all(): RejectedArtworkRecord[] {
    return [...this.rows];
  }
}

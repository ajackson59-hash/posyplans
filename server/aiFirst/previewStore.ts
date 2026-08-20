// Content-addressed preview persistence.
//
// The rule this file exists to enforce: "Use this design" must apply the
// exact bytes a host approved, and must never call the image provider. That
// only holds if the bytes are addressable by their own hash and verified
// again at apply time — a preview id alone would let a stale or swapped
// asset through.
//
// Storage is behind an interface with an in-memory implementation so the
// invariants can be tested without a database. The Drizzle implementation is
// loaded lazily because server/storage.ts throws at import when DATABASE_URL
// is unset, which is the normal state in unit tests.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { AiFirstConcept, ConceptSource } from "@shared/aiFirstInvite";
import { conceptImageFingerprintInput } from "@shared/aiFirstInvite";

export interface PreviewRecord {
  eventId: number;
  previewId: string;
  conceptFingerprint: string;
  assetHash: string;
  assetUrl: string;
  concept: AiFirstConcept;
  source: ConceptSource;
  promoted: boolean;
  promotedAt: number | null;
  createdAt: number;
  lastAccessedAt: number;
}

export interface AiFirstPreviewStore {
  findByFingerprint(eventId: number, conceptFingerprint: string): Promise<PreviewRecord | undefined>;
  findByPreviewId(eventId: number, previewId: string): Promise<PreviewRecord | undefined>;
  /**
   * Every host-servable preview for one event. The preview store contains
   * accepted/adapted directions only, never rejected provider attempts, so
   * this is the durable source used to restore direction cards after a
   * browser refresh.
   */
  listForEvent(eventId: number): Promise<PreviewRecord[]>;
  put(record: PreviewRecord): Promise<PreviewRecord>;
  touch(previewId: string, at: number): Promise<void>;
  promote(eventId: number, previewId: string, at: number): Promise<PreviewRecord | undefined>;
  listForCleanup(before: number): Promise<PreviewRecord[]>;
  remove(previewId: string): Promise<void>;
}

/* ── Content addressing ──────────────────────────────────────────────── */

function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Stable over restyling: only the fields that change pixels feed the hash. */
export function conceptFingerprint(concept: AiFirstConcept): string {
  return sha256(conceptImageFingerprintInput(concept));
}

export function assetHashOf(bytes: Buffer): string {
  return sha256(bytes);
}

/**
 * Event-scoped so a preview id from one event can never address another
 * event's asset, even when two hosts generate byte-identical artwork.
 */
export function previewIdFor(eventId: number, fingerprint: string, assetHash: string): string {
  return sha256(`${eventId} ${fingerprint} ${assetHash}`).slice(0, 32);
}

/* ── Idempotent save ─────────────────────────────────────────────────── */

export interface SavePreviewInput {
  store: AiFirstPreviewStore;
  eventId: number;
  concept: AiFirstConcept;
  bytes: Buffer;
  assetUrl: string;
  source: ConceptSource;
  now?: number;
}

export interface SavePreviewResult {
  record: PreviewRecord;
  /** True when an existing row was returned instead of a new one. */
  reused: boolean;
}

export async function savePreview(input: SavePreviewInput): Promise<SavePreviewResult> {
  const now = input.now ?? Date.now();
  const fingerprint = conceptFingerprint(input.concept);
  const assetHash = assetHashOf(input.bytes);
  const previewId = previewIdFor(input.eventId, fingerprint, assetHash);

  const existing = await input.store.findByPreviewId(input.eventId, previewId);
  if (existing) {
    await input.store.touch(previewId, now);
    return { record: { ...existing, lastAccessedAt: now }, reused: true };
  }

  const record: PreviewRecord = {
    eventId: input.eventId,
    previewId,
    conceptFingerprint: fingerprint,
    assetHash,
    assetUrl: input.assetUrl,
    concept: input.concept,
    source: input.source,
    promoted: false,
    promotedAt: null,
    createdAt: now,
    lastAccessedAt: now,
  };
  return { record: await input.store.put(record), reused: false };
}

/**
 * The pre-generation lookup. A hit here is the whole reason a regenerate
 * with only palette or typography changed costs nothing.
 */
export async function lookupReusablePreview(
  store: AiFirstPreviewStore,
  eventId: number,
  concept: AiFirstConcept,
  now = Date.now(),
): Promise<PreviewRecord | undefined> {
  const hit = await store.findByFingerprint(eventId, conceptFingerprint(concept));
  if (!hit) return undefined;
  await store.touch(hit.previewId, now);
  return { ...hit, lastAccessedAt: now };
}

/* ── Apply ───────────────────────────────────────────────────────────── */

export type ApplyFailure = "not-found" | "asset-hash-mismatch";

export interface ApplyResult {
  ok: boolean;
  failure?: ApplyFailure;
  record?: PreviewRecord;
}

/**
 * Server-side verification on apply. `expectedAssetHash` is what the client
 * claims it approved; if it disagrees with the stored hash the apply is
 * refused rather than silently applying whatever is on the server now.
 */
export async function applyPreview(
  store: AiFirstPreviewStore,
  eventId: number,
  previewId: string,
  expectedAssetHash?: string,
  now = Date.now(),
): Promise<ApplyResult> {
  const record = await store.findByPreviewId(eventId, previewId);
  if (!record) return { ok: false, failure: "not-found" };
  if (expectedAssetHash && expectedAssetHash !== record.assetHash) {
    return { ok: false, failure: "asset-hash-mismatch" };
  }
  const promoted = await store.promote(eventId, previewId, now);
  return { ok: true, record: promoted ?? record };
}

/* ── Serving stored bytes (never the raw data URL over the wire) ───────
 *
 * `assetUrl` on a PreviewRecord is either a `data:image/png;base64,...`
 * string (an AI-generated image, embedded at save time) or a static asset
 * path under the client's public root (an adapted studio direction, see
 * fallback.ts). Neither is safe to hand to the browser directly in an SSE
 * event or a JSON body: the first is a multi-megabyte payload duplicated
 * into a stream event, and the second still shouldn't leak the server's
 * static-file layout as the shipped contract. This resolves either shape to
 * real bytes plus a content type, so a route can serve them with its own
 * URL and its own cache headers instead. */

const STATIC_ROOTS = [
  process.env.POSY_STATIC_ROOT,
  path.resolve(process.cwd(), "public"),
  path.resolve(process.cwd(), "dist", "public"),
  path.resolve(process.cwd(), "client", "public"),
].filter((root): root is string => Boolean(root));

export interface ResolvedAsset {
  bytes: Buffer;
  contentType: string;
}

export async function resolvePreviewAssetBytes(record: PreviewRecord): Promise<ResolvedAsset | undefined> {
  const { assetUrl } = record;
  const dataUrlMatch = /^data:([^;]+);base64,([\s\S]+)$/.exec(assetUrl);
  if (dataUrlMatch) {
    return { bytes: Buffer.from(dataUrlMatch[2], "base64"), contentType: dataUrlMatch[1] || "image/png" };
  }
  // Otherwise treat it as a static path shipped with the build (the adapted
  // studio direction case) — a disk read, never a network or provider call.
  const relative = assetUrl.replace(/^\/+/, "");
  for (const root of STATIC_ROOTS) {
    try {
      const bytes = await readFile(path.join(root, relative));
      const ext = path.extname(relative).toLowerCase();
      const contentType = ext === ".webp" ? "image/webp" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png";
      return { bytes, contentType };
    } catch {
      continue;
    }
  }
  return undefined;
}

/** The event-scoped, owner-authenticated URL a client should be given instead of raw bytes. */
export function previewAssetUrl(ownerToken: string, previewId: string): string {
  return `/api/events/owner/${ownerToken}/ai-first/preview/${previewId}/asset`;
}

/* ── Cleanup ─────────────────────────────────────────────────────────── */

export const PREVIEW_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface CleanupResult {
  removed: string[];
  keptPromoted: number;
}

/** Sweeps unused previews after seven days. Promoted assets are never swept. */
export async function cleanupPreviews(
  store: AiFirstPreviewStore,
  now = Date.now(),
): Promise<CleanupResult> {
  const stale = await store.listForCleanup(now - PREVIEW_TTL_MS);
  const removed: string[] = [];
  let keptPromoted = 0;
  for (const record of stale) {
    if (record.promoted) {
      keptPromoted += 1;
      continue;
    }
    await store.remove(record.previewId);
    removed.push(record.previewId);
  }
  return { removed, keptPromoted };
}

/* ── In-memory implementation ────────────────────────────────────────── */

export class InMemoryPreviewStore implements AiFirstPreviewStore {
  private rows = new Map<string, PreviewRecord>();

  async findByFingerprint(eventId: number, conceptFingerprint: string): Promise<PreviewRecord | undefined> {
    for (const row of Array.from(this.rows.values())) {
      if (row.eventId === eventId && row.conceptFingerprint === conceptFingerprint) return { ...row };
    }
    return undefined;
  }

  async findByPreviewId(eventId: number, previewId: string): Promise<PreviewRecord | undefined> {
    const row = this.rows.get(previewId);
    return row && row.eventId === eventId ? { ...row } : undefined;
  }

  async listForEvent(eventId: number): Promise<PreviewRecord[]> {
    return Array.from(this.rows.values())
      .filter((row) => row.eventId === eventId)
      .map((row) => ({ ...row }));
  }

  async put(record: PreviewRecord): Promise<PreviewRecord> {
    this.rows.set(record.previewId, { ...record });
    return { ...record };
  }

  async touch(previewId: string, at: number): Promise<void> {
    const row = this.rows.get(previewId);
    if (row) row.lastAccessedAt = at;
  }

  async promote(eventId: number, previewId: string, at: number): Promise<PreviewRecord | undefined> {
    const row = this.rows.get(previewId);
    if (!row || row.eventId !== eventId) return undefined;
    row.promoted = true;
    row.promotedAt = at;
    row.lastAccessedAt = at;
    return { ...row };
  }

  async listForCleanup(before: number): Promise<PreviewRecord[]> {
    return Array.from(this.rows.values()).filter((r) => r.lastAccessedAt < before).map((r) => ({ ...r }));
  }

  async remove(previewId: string): Promise<void> {
    this.rows.delete(previewId);
  }

  get size(): number {
    return this.rows.size;
  }
}

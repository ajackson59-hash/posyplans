// Drizzle-backed implementations of the two AI-first stores.
//
// Split out from previewStore.ts and usage.ts so those files stay importable
// without a database — server/storage.ts throws at import when DATABASE_URL
// is unset, which is the normal state in unit tests.

import { createHash } from "node:crypto";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "../storage";
import { aiFirstPreviews, aiFirstImageLedger, aiFirstGenerationRuns, aiFirstArtworkAttempts } from "@shared/schema";
import { aiFirstConceptSchema } from "@shared/aiFirstInvite";
import type { AiFirstPreviewStore, PreviewRecord } from "./previewStore";
import type { AiFirstUsageStore, LedgerEntry, UsageSnapshot } from "./usage";
import {
  RUN_LEASE_EXPIRED_ERROR,
  RUN_LEASE_MS,
  type AiFirstRunStore,
  type ClaimResult,
  type GenerationRunRecord,
  type RunStatus,
} from "./runStore";
import type { AiFirstArtworkAttemptStore, ArtworkAttemptRecord } from "./artworkAttemptStore";
import { DEFAULT_ARTWORK_MODEL, type ArtworkModel, type ArtworkQuality, type ArtworkSize } from "./artwork";

/**
 * postgres-js surfaces a Postgres unique-violation (SQLSTATE 23505) as a
 * thrown error carrying the violated constraint's name. Used below to tell
 * apart the runId unique index from the one-active-run-per-event partial
 * unique index without a separate, race-prone SELECT.
 */
function uniqueViolationConstraint(err: unknown): string | undefined {
  const anyErr = err as { code?: string; constraint_name?: string; constraint?: string } | undefined;
  if (!anyErr || anyErr.code !== "23505") return undefined;
  return anyErr.constraint_name ?? anyErr.constraint;
}

type PreviewRow = typeof aiFirstPreviews.$inferSelect;

function toRecord(row: PreviewRow): PreviewRecord | undefined {
  const parsed = aiFirstConceptSchema.safeParse(JSON.parse(row.conceptJson));
  // A row whose concept no longer satisfies the schema is unusable rather
  // than half-usable: serving it would put an unvalidated concept back into
  // the renderer.
  if (!parsed.success) return undefined;
  return {
    eventId: row.eventId,
    previewId: row.previewId,
    conceptFingerprint: row.conceptFingerprint,
    assetHash: row.assetHash,
    assetUrl: row.assetUrl,
    concept: parsed.data,
    source: row.source === "adapted-studio-direction" ? "adapted-studio-direction" : "ai-generated",
    promoted: row.promoted,
    promotedAt: row.promotedAt,
    createdAt: row.createdAt,
    lastAccessedAt: row.lastAccessedAt,
  };
}

export class DbPreviewStore implements AiFirstPreviewStore {
  async findByFingerprint(eventId: number, conceptFingerprint: string): Promise<PreviewRecord | undefined> {
    const rows = await db
      .select()
      .from(aiFirstPreviews)
      .where(and(eq(aiFirstPreviews.eventId, eventId), eq(aiFirstPreviews.conceptFingerprint, conceptFingerprint)));
    return rows[0] ? toRecord(rows[0]) : undefined;
  }

  async findByPreviewId(eventId: number, previewId: string): Promise<PreviewRecord | undefined> {
    const rows = await db
      .select()
      .from(aiFirstPreviews)
      .where(and(eq(aiFirstPreviews.eventId, eventId), eq(aiFirstPreviews.previewId, previewId)));
    return rows[0] ? toRecord(rows[0]) : undefined;
  }

  async put(record: PreviewRecord): Promise<PreviewRecord> {
    await db
      .insert(aiFirstPreviews)
      .values({
        eventId: record.eventId,
        previewId: record.previewId,
        conceptFingerprint: record.conceptFingerprint,
        assetHash: record.assetHash,
        assetUrl: record.assetUrl,
        conceptJson: JSON.stringify(record.concept),
        source: record.source,
        promoted: record.promoted,
        promotedAt: record.promotedAt,
        createdAt: record.createdAt,
        lastAccessedAt: record.lastAccessedAt,
      })
      // Two tabs previewing the same concept race here; the second is a
      // no-op rather than a 23505.
      .onConflictDoNothing({ target: aiFirstPreviews.previewId });
    return record;
  }

  async touch(previewId: string, at: number): Promise<void> {
    await db.update(aiFirstPreviews).set({ lastAccessedAt: at }).where(eq(aiFirstPreviews.previewId, previewId));
  }

  async promote(eventId: number, previewId: string, at: number): Promise<PreviewRecord | undefined> {
    const rows = await db
      .update(aiFirstPreviews)
      .set({ promoted: true, promotedAt: at, lastAccessedAt: at })
      .where(and(eq(aiFirstPreviews.eventId, eventId), eq(aiFirstPreviews.previewId, previewId)))
      .returning();
    return rows[0] ? toRecord(rows[0]) : undefined;
  }

  async listForCleanup(before: number): Promise<PreviewRecord[]> {
    const rows = await db
      .select()
      .from(aiFirstPreviews)
      .where(and(lt(aiFirstPreviews.lastAccessedAt, before), eq(aiFirstPreviews.promoted, false)));
    return rows.map(toRecord).filter((r): r is PreviewRecord => r !== undefined);
  }

  async remove(previewId: string): Promise<void> {
    await db.delete(aiFirstPreviews).where(eq(aiFirstPreviews.previewId, previewId));
  }
}

export class DbUsageStore implements AiFirstUsageStore {
  /** In-process only; the DB ceilings are the durable guarantee. */
  private active = new Map<number, number>();

  async record(entry: LedgerEntry): Promise<void> {
    await db.insert(aiFirstImageLedger).values({
      eventId: entry.eventId,
      email: entry.email ?? null,
      reason: entry.reason,
      billed: entry.billed,
      automatic: entry.automatic,
      conceptFingerprint: entry.conceptFingerprint ?? null,
      previewId: entry.previewId ?? null,
      reuseOf: entry.reuseOf ?? null,
      idempotencyKey: entry.idempotencyKey ?? null,
      costUsdMicros: entry.costUsdMicros,
      createdAt: entry.createdAt,
    });
  }

  async reserveProviderAttempt(entry: LedgerEntry): Promise<boolean> {
    if (!entry.billed) throw new Error("provider attempt reservations must be billed or billing-uncertain");
    // The existing partial unique index on idempotencyKey is the atomic
    // authority. A competing process or a resumed run gets no inserted row
    // and therefore must not call the provider.
    const inserted = await db
      .insert(aiFirstImageLedger)
      .values({
        eventId: entry.eventId,
        email: entry.email ?? null,
        reason: entry.reason,
        billed: entry.billed,
        automatic: entry.automatic,
        conceptFingerprint: entry.conceptFingerprint ?? null,
        previewId: entry.previewId ?? null,
        reuseOf: entry.reuseOf ?? null,
        idempotencyKey: entry.idempotencyKey ?? null,
        costUsdMicros: entry.costUsdMicros,
        createdAt: entry.createdAt,
      })
      .onConflictDoNothing()
      .returning({ id: aiFirstImageLedger.id });
    return inserted.length === 1;
  }

  async findByIdempotencyKey(key: string): Promise<LedgerEntry | undefined> {
    const rows = await db.select().from(aiFirstImageLedger).where(eq(aiFirstImageLedger.idempotencyKey, key));
    const row = rows[0];
    if (!row) return undefined;
    return {
      eventId: row.eventId,
      email: row.email ?? undefined,
      reason: row.reason as LedgerEntry["reason"],
      billed: row.billed,
      automatic: row.automatic,
      conceptFingerprint: row.conceptFingerprint ?? undefined,
      previewId: row.previewId ?? undefined,
      reuseOf: row.reuseOf ?? undefined,
      idempotencyKey: row.idempotencyKey ?? undefined,
      costUsdMicros: row.costUsdMicros,
      createdAt: row.createdAt,
    };
  }

  async snapshot(eventId: number, email: string | undefined, from: number): Promise<UsageSnapshot> {
    const eventRows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(aiFirstImageLedger)
      .where(and(eq(aiFirstImageLedger.eventId, eventId), eq(aiFirstImageLedger.billed, true)));

    let monthlyBilled = 0;
    if (email) {
      const monthlyRows = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(aiFirstImageLedger)
        .where(
          and(
            eq(aiFirstImageLedger.email, email),
            eq(aiFirstImageLedger.billed, true),
            gte(aiFirstImageLedger.createdAt, from),
          ),
        );
      monthlyBilled = monthlyRows[0]?.n ?? 0;
    }

    return {
      eventBilled: eventRows[0]?.n ?? 0,
      monthlyBilled,
      activeGenerations: this.active.get(eventId) ?? 0,
    };
  }

  beginRun(eventId: number): void {
    this.active.set(eventId, (this.active.get(eventId) ?? 0) + 1);
  }

  endRun(eventId: number): void {
    this.active.set(eventId, Math.max(0, (this.active.get(eventId) ?? 0) - 1));
  }
}

/* ── Durable generation runs ────────────────────────────────────────────
 * See shared/schema.ts for why this table exists: `beginRun`/`endRun`
 * above are process-memory counters and are wrong the instant there is more
 * than one server instance. This is the durable replacement they defer to.
 */
type RunRow = typeof aiFirstGenerationRuns.$inferSelect;

function toRunRecord(row: RunRow): GenerationRunRecord {
  return {
    runId: row.runId,
    eventId: row.eventId,
    ownerToken: row.ownerToken,
    status: row.status as RunStatus,
    progressMessage: row.progressMessage,
    completedCount: row.completedCount,
    fallbackCount: row.fallbackCount,
    errorMessage: row.errorMessage,
    terminal: row.terminal,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class DbRunStore implements AiFirstRunStore {
  private async expireStaleForEvent(eventId: number, now: number): Promise<void> {
    await db
      .update(aiFirstGenerationRuns)
      .set({
        status: "failed",
        terminal: true,
        errorMessage: RUN_LEASE_EXPIRED_ERROR,
        updatedAt: now,
      })
      .where(
        and(
          eq(aiFirstGenerationRuns.eventId, eventId),
          eq(aiFirstGenerationRuns.status, "active"),
          eq(aiFirstGenerationRuns.terminal, false),
          lt(aiFirstGenerationRuns.updatedAt, now - RUN_LEASE_MS),
        ),
      );
  }

  async claim(input: { runId: string; eventId: number; ownerToken: string; now?: number }): Promise<ClaimResult> {
    const now = input.now ?? Date.now();
    // A crashed/terminated Vercel invocation cannot hold this event forever.
    // The conditional update is atomic; if two instances recover together,
    // the existing one-active-run index still permits only one new claimant.
    await this.expireStaleForEvent(input.eventId, now);
    // A plain INSERT, not onConflictDoNothing: this table carries TWO
    // independent unique constraints (see shared/schema.ts), and which one
    // fires tells the caller something different — "you already hold this
    // exact run" versus "a different run already owns this event". Letting
    // Postgres raise the 23505 and reading its constraint name is what makes
    // that distinction atomic: there is no window between a SELECT and this
    // INSERT for another instance to change the answer in.
    try {
      const inserted = await db
        .insert(aiFirstGenerationRuns)
        .values({
          runId: input.runId,
          eventId: input.eventId,
          ownerToken: input.ownerToken,
          status: "active",
          progressMessage: "",
          completedCount: 0,
          fallbackCount: 0,
          errorMessage: null,
          terminal: false,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      return { outcome: "claimed", record: toRunRecord(inserted[0]) };
    } catch (err) {
      const constraint = uniqueViolationConstraint(err);
      if (!constraint) throw err;

      if (constraint === "ai_first_generation_runs_run_id_unique") {
        const existing = await db
          .select()
          .from(aiFirstGenerationRuns)
          .where(eq(aiFirstGenerationRuns.runId, input.runId));
        return { outcome: "duplicate", record: toRunRecord(existing[0]) };
      }

      if (constraint === "ai_first_generation_runs_one_active_per_event_uq") {
        const active = await db
          .select()
          .from(aiFirstGenerationRuns)
          .where(
            and(
              eq(aiFirstGenerationRuns.eventId, input.eventId),
              eq(aiFirstGenerationRuns.status, "active"),
              eq(aiFirstGenerationRuns.terminal, false),
            ),
          );
        if (active[0]) return { outcome: "active-elsewhere", record: toRunRecord(active[0]) };
        // The other run completed in the instant between our failed INSERT
        // and this read — the slot is free again. One retry, not an error:
        // this is a race-of-a-race, not a caller mistake.
        return this.claim(input);
      }

      throw err;
    }
  }

  async get(runId: string): Promise<GenerationRunRecord | undefined> {
    const rows = await db.select().from(aiFirstGenerationRuns).where(eq(aiFirstGenerationRuns.runId, runId));
    return rows[0] ? toRunRecord(rows[0]) : undefined;
  }

  async updateProgress(runId: string, message: string, now = Date.now()): Promise<void> {
    await db
      .update(aiFirstGenerationRuns)
      .set({ progressMessage: message, updatedAt: now })
      .where(eq(aiFirstGenerationRuns.runId, runId));
  }

  async incrementCompleted(runId: string, by = 1, now = Date.now()): Promise<void> {
    await db
      .update(aiFirstGenerationRuns)
      .set({ completedCount: sql`${aiFirstGenerationRuns.completedCount} + ${by}`, updatedAt: now })
      .where(eq(aiFirstGenerationRuns.runId, runId));
  }

  async incrementFallback(runId: string, by = 1, now = Date.now()): Promise<void> {
    await db
      .update(aiFirstGenerationRuns)
      .set({ fallbackCount: sql`${aiFirstGenerationRuns.fallbackCount} + ${by}`, updatedAt: now })
      .where(eq(aiFirstGenerationRuns.runId, runId));
  }

  async complete(runId: string, now = Date.now()): Promise<void> {
    await db
      .update(aiFirstGenerationRuns)
      .set({ status: "completed", terminal: true, updatedAt: now })
      .where(eq(aiFirstGenerationRuns.runId, runId));
  }

  async fail(runId: string, errorMessage: string, now = Date.now()): Promise<void> {
    await db
      .update(aiFirstGenerationRuns)
      .set({ status: "failed", errorMessage, terminal: true, updatedAt: now })
      .where(eq(aiFirstGenerationRuns.runId, runId));
  }

  async hasActiveRun(eventId: number, now = Date.now()): Promise<boolean> {
    await this.expireStaleForEvent(eventId, now);
    const rows = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(aiFirstGenerationRuns)
      .where(
        and(
          eq(aiFirstGenerationRuns.eventId, eventId),
          eq(aiFirstGenerationRuns.status, "active"),
          eq(aiFirstGenerationRuns.terminal, false),
        ),
      );
    return (rows[0]?.n ?? 0) > 0;
  }
}

/* ── Artwork attempt evidence (protected reviewer, accepted AND rejected) ── */
type ArtworkAttemptRow = typeof aiFirstArtworkAttempts.$inferSelect;

function toArtworkAttemptRecord(row: ArtworkAttemptRow): ArtworkAttemptRecord {
  return {
    id: String(row.id),
    eventId: row.eventId,
    ownerToken: row.ownerToken,
    runId: row.runId ?? null,
    idempotencyKey: row.idempotencyKey ?? null,
    directionIndex: row.directionIndex,
    attempt: row.attempt,
    status: row.status as ArtworkAttemptRecord["status"],
    assetHash: row.assetHash,
    assetBytesBase64: row.assetBytesBase64,
    previewId: row.previewId ?? null,
    concept: JSON.parse(row.conceptJson),
    failureCodes: JSON.parse(row.failureCodesJson),
    tier1Findings: JSON.parse(row.tier1FindingsJson),
    visionScores: row.visionScoresJson ? JSON.parse(row.visionScoresJson) : null,
    model: row.model as ArtworkModel,
    quality: row.quality as ArtworkQuality,
    size: (row.size as ArtworkSize | null) ?? null,
    costUsdMicros: row.costUsdMicros,
    createdAt: row.createdAt,
  };
}

export class DbArtworkAttemptStore implements AiFirstArtworkAttemptStore {
  async record(input: Parameters<AiFirstArtworkAttemptStore["record"]>[0]): Promise<ArtworkAttemptRecord> {
    const assetHash = createHash("sha256").update(input.bytes).digest("hex");
    const now = input.now ?? Date.now();
    const previewId = input.status === "accepted" ? input.previewId ?? null : null;
    const inserted = await db
      .insert(aiFirstArtworkAttempts)
      .values({
        eventId: input.eventId,
        ownerToken: input.ownerToken,
        runId: input.runId ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        directionIndex: input.directionIndex,
        attempt: input.attempt,
        status: input.status,
        assetHash,
        assetBytesBase64: input.bytes.toString("base64"),
        previewId,
        conceptJson: JSON.stringify(input.concept),
        failureCodesJson: JSON.stringify(input.failureCodes),
        tier1FindingsJson: JSON.stringify(input.tier1Findings),
        visionScoresJson: input.visionScores ? JSON.stringify(input.visionScores) : null,
        model: input.model ?? DEFAULT_ARTWORK_MODEL,
        quality: input.quality ?? "high",
        size: input.size ?? null,
        costUsdMicros: input.costUsdMicros,
        createdAt: now,
      })
      .returning();
    return toArtworkAttemptRecord(inserted[0]);
  }

  async listForOwner(eventId: number, ownerToken: string): Promise<ArtworkAttemptRecord[]> {
    const rows = await db
      .select()
      .from(aiFirstArtworkAttempts)
      .where(and(eq(aiFirstArtworkAttempts.eventId, eventId), eq(aiFirstArtworkAttempts.ownerToken, ownerToken)));
    return rows.map(toArtworkAttemptRecord);
  }

  async findById(eventId: number, ownerToken: string, id: string): Promise<ArtworkAttemptRecord | undefined> {
    const numericId = Number(id);
    if (!Number.isFinite(numericId)) return undefined;
    const rows = await db
      .select()
      .from(aiFirstArtworkAttempts)
      .where(
        and(
          eq(aiFirstArtworkAttempts.eventId, eventId),
          eq(aiFirstArtworkAttempts.ownerToken, ownerToken),
          eq(aiFirstArtworkAttempts.id, numericId),
        ),
      );
    return rows[0] ? toArtworkAttemptRecord(rows[0]) : undefined;
  }
}

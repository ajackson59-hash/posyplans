// Drizzle-backed implementations of the two AI-first stores.
//
// Split out from previewStore.ts and usage.ts so those files stay importable
// without a database — server/storage.ts throws at import when DATABASE_URL
// is unset, which is the normal state in unit tests.

import { createHash } from "node:crypto";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "../storage";
import { aiFirstPreviews, aiFirstImageLedger, aiFirstGenerationRuns, aiFirstRejectedArtwork } from "@shared/schema";
import { aiFirstConceptSchema } from "@shared/aiFirstInvite";
import type { AiFirstPreviewStore, PreviewRecord } from "./previewStore";
import type { AiFirstUsageStore, LedgerEntry, UsageSnapshot } from "./usage";
import type { AiFirstRunStore, ClaimResult, GenerationRunRecord, RunStatus } from "./runStore";
import type { AiFirstRejectedArtworkStore, RejectedArtworkRecord } from "./rejectedArtworkStore";

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
  async claim(input: { runId: string; eventId: number; ownerToken: string; now?: number }): Promise<ClaimResult> {
    const now = input.now ?? Date.now();
    // The unique index on runId makes this atomic across every server
    // instance: only one INSERT can ever land for a given runId, so a
    // duplicate click or a duplicate request that reaches a second instance
    // both fall into the `.returning()` coming back empty below.
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
      .onConflictDoNothing({ target: aiFirstGenerationRuns.runId })
      .returning();

    if (inserted[0]) return { outcome: "claimed", record: toRunRecord(inserted[0]) };

    const existing = await db
      .select()
      .from(aiFirstGenerationRuns)
      .where(eq(aiFirstGenerationRuns.runId, input.runId));
    // existing[0] must be present: the insert only no-ops on a conflict.
    return { outcome: "duplicate", record: toRunRecord(existing[0]) };
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

  async hasActiveRun(eventId: number): Promise<boolean> {
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

/* ── Rejected artwork (protected reviewer evidence) ─────────────────── */
type RejectedRow = typeof aiFirstRejectedArtwork.$inferSelect;

function toRejectedRecord(row: RejectedRow): RejectedArtworkRecord {
  return {
    eventId: row.eventId,
    ownerToken: row.ownerToken,
    directionIndex: row.directionIndex,
    attempt: row.attempt,
    assetHash: row.assetHash,
    assetBytesBase64: row.assetBytesBase64,
    concept: JSON.parse(row.conceptJson),
    failureCodes: JSON.parse(row.failureCodesJson),
    tier1Findings: JSON.parse(row.tier1FindingsJson),
    visionScores: row.visionScoresJson ? JSON.parse(row.visionScoresJson) : null,
    costUsdMicros: row.costUsdMicros,
    createdAt: row.createdAt,
  };
}

export class DbRejectedArtworkStore implements AiFirstRejectedArtworkStore {
  async record(input: Parameters<AiFirstRejectedArtworkStore["record"]>[0]): Promise<RejectedArtworkRecord> {
    const assetHash = createHash("sha256").update(input.bytes).digest("hex");
    const now = input.now ?? Date.now();
    await db.insert(aiFirstRejectedArtwork).values({
      eventId: input.eventId,
      ownerToken: input.ownerToken,
      directionIndex: input.directionIndex,
      attempt: input.attempt,
      assetHash,
      assetBytesBase64: input.bytes.toString("base64"),
      conceptJson: JSON.stringify(input.concept),
      failureCodesJson: JSON.stringify(input.failureCodes),
      tier1FindingsJson: JSON.stringify(input.tier1Findings),
      visionScoresJson: input.visionScores ? JSON.stringify(input.visionScores) : null,
      costUsdMicros: input.costUsdMicros,
      createdAt: now,
    });
    return {
      eventId: input.eventId,
      ownerToken: input.ownerToken,
      directionIndex: input.directionIndex,
      attempt: input.attempt,
      assetHash,
      assetBytesBase64: input.bytes.toString("base64"),
      concept: input.concept,
      failureCodes: input.failureCodes,
      tier1Findings: input.tier1Findings,
      visionScores: input.visionScores,
      costUsdMicros: input.costUsdMicros,
      createdAt: now,
    };
  }

  async listForOwner(eventId: number, ownerToken: string): Promise<RejectedArtworkRecord[]> {
    const rows = await db
      .select()
      .from(aiFirstRejectedArtwork)
      .where(and(eq(aiFirstRejectedArtwork.eventId, eventId), eq(aiFirstRejectedArtwork.ownerToken, ownerToken)));
    return rows.map(toRejectedRecord);
  }

  async findAsset(eventId: number, ownerToken: string, assetHash: string): Promise<RejectedArtworkRecord | undefined> {
    const rows = await db
      .select()
      .from(aiFirstRejectedArtwork)
      .where(
        and(
          eq(aiFirstRejectedArtwork.eventId, eventId),
          eq(aiFirstRejectedArtwork.ownerToken, ownerToken),
          eq(aiFirstRejectedArtwork.assetHash, assetHash),
        ),
      );
    return rows[0] ? toRejectedRecord(rows[0]) : undefined;
  }
}

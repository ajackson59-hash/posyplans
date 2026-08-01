// Drizzle-backed implementations of the two AI-first stores.
//
// Split out from previewStore.ts and usage.ts so those files stay importable
// without a database — server/storage.ts throws at import when DATABASE_URL
// is unset, which is the normal state in unit tests.

import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "../storage";
import { aiFirstPreviews, aiFirstImageLedger } from "@shared/schema";
import { aiFirstConceptSchema } from "@shared/aiFirstInvite";
import type { AiFirstPreviewStore, PreviewRecord } from "./previewStore";
import type { AiFirstUsageStore, LedgerEntry, UsageSnapshot } from "./usage";

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

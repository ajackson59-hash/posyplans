import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { bigint, integer, jsonb, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import {
  events, guests, budgetItems, menuItems, shoppingListItems, timelineItems,
  insertBudgetItemSchema, insertMenuItemSchema, insertShoppingListItemSchema, insertTimelineItemSchema,
} from '@shared/schema';
import type { PlanContent, PlanRegenerationRecord, PlanRegenerationState, PlanSnapshot } from '@shared/planRegeneration';
import { db } from './storage';
import { planFingerprint, snapshotEvent } from './planSnapshot';
import { resolveGuestCount } from '@shared/guestCount';

// Kept server-only: no candidate/archive column should enter an owner response
// through the shared event schema. The additive migration owns constraints/RLS.
const regenerations = pgTable('plan_regenerations', {
  id: uuid('id').primaryKey(),
  eventId: integer('event_id').notNull(),
  requestId: text('request_id').notNull(),
  state: text('state').$type<PlanRegenerationState>().notNull(),
  stage: text('stage'),
  error: text('error'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  base: jsonb('base').$type<PlanSnapshot>().notNull(),
  candidate: jsonb('candidate').$type<Partial<PlanContent>>(),
  previous: jsonb('previous').$type<PlanSnapshot>(),
});

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
const unresolved: PlanRegenerationState[] = ['running', 'ready', 'failed'];
export const PLAN_REGENERATION_IDLE_TIMEOUT_MS = 10 * 60 * 1000;

export class PlanRegenerationStoreError extends Error {
  constructor(
    public readonly code: 'event_not_found' | 'regeneration_not_found' | 'regeneration_not_ready' | 'regeneration_running' | 'plan_changed',
    message: string,
    public readonly status: 404 | 409 = 409,
  ) {
    super(message);
    this.name = 'PlanRegenerationStoreError';
  }
}

export interface PlanRegenerationStore {
  read(eventId: number): Promise<PlanRegenerationRecord | null>;
  reserve(eventId: number, requestId: string): Promise<{ record: PlanRegenerationRecord; started: boolean }>;
  checkpoint(eventId: number, id: string, stage: string, candidate: Partial<PlanContent>): Promise<boolean>;
  complete(eventId: number, id: string, candidate: PlanContent): Promise<boolean>;
  fail(eventId: number, id: string, message: string): Promise<boolean>;
  apply(eventId: number, id: string): Promise<PlanRegenerationRecord>;
  discard(eventId: number, id: string): Promise<PlanRegenerationRecord>;
  snapshot(eventId: number): Promise<PlanSnapshot>;
}

/** All writes take the same event lock as ordinary planning CRUD. No provider
 * call runs inside a transaction, and only a successful new reservation starts
 * a worker. A dead worker is fenced out instead of silently redispatched. */
export class DbPlanRegenerationStore implements PlanRegenerationStore {
  constructor(
    private readonly database: Pick<typeof db, 'transaction'> = db,
    private readonly now: () => number = Date.now,
    private readonly newId: () => string = randomUUID,
  ) {}

  private async lockEvent(tx: Transaction, eventId: number) {
    const [event] = await tx.select().from(events).where(eq(events.id, eventId)).for('update');
    if (!event) throw new PlanRegenerationStoreError('event_not_found', 'Event not found.', 404);
    return event;
  }

  private async snapshotInTransaction(tx: Transaction, eventId: number): Promise<PlanSnapshot> {
    const event = await this.lockEvent(tx, eventId);
    return {
      event: snapshotEvent(event),
      resolvedGuestCount: resolveGuestCount(event.estimatedGuestCount,
        await tx.select().from(guests).where(eq(guests.eventId, eventId))),
      budgetItems: await tx.select().from(budgetItems).where(eq(budgetItems.eventId, eventId)),
      menuItems: await tx.select().from(menuItems).where(eq(menuItems.eventId, eventId)),
      shoppingItems: await tx.select().from(shoppingListItems).where(eq(shoppingListItems.eventId, eventId)),
      timelineItems: await tx.select().from(timelineItems).where(eq(timelineItems.eventId, eventId)),
    };
  }

  snapshot(eventId: number): Promise<PlanSnapshot> {
    return this.database.transaction(tx => this.snapshotInTransaction(tx, eventId));
  }

  private async get(tx: Transaction, eventId: number, id: string): Promise<PlanRegenerationRecord> {
    const [row] = await tx.select().from(regenerations)
      .where(and(eq(regenerations.eventId, eventId), eq(regenerations.id, id)));
    if (!row) throw new PlanRegenerationStoreError('regeneration_not_found', 'Plan revision not found.', 404);
    return row;
  }

  private async update(tx: Transaction, row: PlanRegenerationRecord, data: Partial<PlanRegenerationRecord>) {
    const [updated] = await tx.update(regenerations).set({ ...data, updatedAt: Math.max(this.now(), row.createdAt) })
      .where(and(eq(regenerations.eventId, row.eventId), eq(regenerations.id, row.id))).returning();
    return updated;
  }

  private async expire(tx: Transaction, row: PlanRegenerationRecord): Promise<PlanRegenerationRecord> {
    if (row.state !== 'running' || this.now() - row.updatedAt < PLAN_REGENERATION_IDLE_TIMEOUT_MS) return row;
    return this.update(tx, row, {
      state: 'failed',
      error: 'This revision stopped before it finished. Your current plan is unchanged. Discard this revision before starting another.',
    });
  }

  async read(eventId: number): Promise<PlanRegenerationRecord | null> {
    return this.database.transaction(async tx => {
      await this.lockEvent(tx, eventId);
      const [active] = await tx.select().from(regenerations)
        .where(and(eq(regenerations.eventId, eventId), inArray(regenerations.state, unresolved))).limit(1);
      if (active) return this.expire(tx, active);
      const [latest] = await tx.select().from(regenerations).where(eq(regenerations.eventId, eventId))
        .orderBy(desc(regenerations.updatedAt), desc(regenerations.id)).limit(1);
      return latest ?? null;
    });
  }

  async reserve(eventId: number, requestId: string) {
    return this.database.transaction(async tx => {
      await this.lockEvent(tx, eventId);
      const [replay] = await tx.select().from(regenerations)
        .where(and(eq(regenerations.eventId, eventId), eq(regenerations.requestId, requestId)));
      if (replay) return { record: await this.expire(tx, replay), started: false };
      const [active] = await tx.select().from(regenerations)
        .where(and(eq(regenerations.eventId, eventId), inArray(regenerations.state, unresolved))).limit(1);
      if (active) return { record: await this.expire(tx, active), started: false };
      const now = this.now();
      const [record] = await tx.insert(regenerations).values({
        id: this.newId(), eventId, requestId, state: 'running', stage: null, error: null,
        createdAt: now, updatedAt: now, base: await this.snapshotInTransaction(tx, eventId),
        candidate: null, previous: null,
      }).returning();
      return { record, started: true };
    });
  }

  private async withRunning(
    eventId: number, id: string, work: (tx: Transaction, row: PlanRegenerationRecord) => Promise<unknown>,
  ): Promise<boolean> {
    return this.database.transaction(async tx => {
      await this.lockEvent(tx, eventId);
      const row = await this.expire(tx, await this.get(tx, eventId, id));
      if (row.state !== 'running') return false;
      await work(tx, row);
      return true;
    });
  }

  checkpoint(eventId: number, id: string, stage: string, candidate: Partial<PlanContent>): Promise<boolean> {
    return this.withRunning(eventId, id, (tx, row) => this.update(tx, row, {
      stage, candidate: { ...row.candidate, ...candidate },
    }));
  }

  complete(eventId: number, id: string, candidate: PlanContent): Promise<boolean> {
    return this.withRunning(eventId, id, (tx, row) => this.update(tx, row, {
      state: 'ready', stage: null, error: null, candidate: validatedContent(candidate),
    }));
  }

  fail(eventId: number, id: string, message: string): Promise<boolean> {
    return this.withRunning(eventId, id, (tx, row) => this.update(tx, row, {
      state: 'failed', error: message,
    }));
  }

  async apply(eventId: number, id: string): Promise<PlanRegenerationRecord> {
    return this.database.transaction(async tx => {
      await this.lockEvent(tx, eventId);
      const row = await this.get(tx, eventId, id);
      if (row.state === 'applied') return row;
      if (row.state !== 'ready' || !row.candidate) {
        throw new PlanRegenerationStoreError('regeneration_not_ready', 'This plan revision is not ready to apply.');
      }
      const previous = await this.snapshotInTransaction(tx, eventId);
      if (planFingerprint(previous) !== planFingerprint(row.base)) {
        throw new PlanRegenerationStoreError('plan_changed', 'Your plan changed after this revision started. Keep your current edits and discard this revision before starting another.');
      }
      const candidate = validatedContent(row.candidate as PlanContent);
      // Archive, replacement and applied marker commit together or roll back
      // together. Validation requires a complete candidate before any delete.
      await tx.delete(budgetItems).where(eq(budgetItems.eventId, eventId));
      await tx.delete(menuItems).where(eq(menuItems.eventId, eventId));
      await tx.delete(shoppingListItems).where(eq(shoppingListItems.eventId, eventId));
      await tx.delete(timelineItems).where(eq(timelineItems.eventId, eventId));
      if (candidate.budgetItems.length) await tx.insert(budgetItems).values(candidate.budgetItems.map(item => ({ ...item, eventId })));
      if (candidate.menuItems.length) await tx.insert(menuItems).values(candidate.menuItems.map(item => ({ ...item, eventId })));
      if (candidate.shoppingItems.length) await tx.insert(shoppingListItems).values(candidate.shoppingItems.map(item => ({ ...item, eventId })));
      if (candidate.timelineItems.length) await tx.insert(timelineItems).values(candidate.timelineItems.map(item => ({ ...item, eventId })));
      await tx.update(events).set({ eventIdentity: candidate.eventIdentity }).where(eq(events.id, eventId));
      return this.update(tx, row, { state: 'applied', previous });
    });
  }

  async discard(eventId: number, id: string): Promise<PlanRegenerationRecord> {
    return this.database.transaction(async tx => {
      await this.lockEvent(tx, eventId);
      const row = await this.expire(tx, await this.get(tx, eventId, id));
      if (row.state === 'running') {
        throw new PlanRegenerationStoreError('regeneration_running', 'This revision is still running.');
      }
      if (row.state === 'applied' || row.state === 'discarded') return row;
      return this.update(tx, row, { state: 'discarded' });
    });
  }
}

function validatedContent(content: PlanContent): PlanContent {
  if (typeof content.eventIdentity !== 'string' || !content.eventIdentity.trim() || content.eventIdentity.trim().length > 1000) {
    throw new Error('A plan revision needs an event identity of 1–1000 characters.');
  }
  for (const section of [content.budgetItems, content.menuItems, content.shoppingItems, content.timelineItems]) {
    if (!Array.isArray(section) || section.length < 1 || section.length > 100) {
      throw new Error('Each plan revision section must contain 1–100 items.');
    }
  }
  // The insert schemas discard IDs and event IDs even for malformed provider
  // output, ensuring every inserted item belongs to the locked parent event.
  return {
    eventIdentity: content.eventIdentity.trim(),
    budgetItems: content.budgetItems.map(item => insertBudgetItemSchema.parse(item)),
    menuItems: content.menuItems.map(item => insertMenuItemSchema.parse(item)),
    shoppingItems: content.shoppingItems.map(item => insertShoppingListItemSchema.parse(item)),
    timelineItems: content.timelineItems.map(item => insertTimelineItemSchema.parse(item)),
  };
}

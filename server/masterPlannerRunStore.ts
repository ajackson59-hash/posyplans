import { and, eq } from 'drizzle-orm';
import {
  events, masterPlannerGenerations, budgetItems, menuItems, shoppingListItems, timelineItems,
  insertBudgetItemSchema, insertMenuItemSchema, insertShoppingListItemSchema, insertTimelineItemSchema,
} from '@shared/schema';
import type {
  Event, InsertBudgetItem, InsertMenuItem, InsertShoppingListItem, InsertTimelineItem, MasterPlannerGeneration,
} from '@shared/schema';
import { db, INITIAL_GENERATION_CLAIM_TIMEOUT_MS } from './storage';
import { safeParseStages } from './masterPlannerEntitlement';

export { INITIAL_GENERATION_CLAIM_TIMEOUT_MS } from './storage';

export interface InitialGenerationStagePatch {
  event?: Partial<Event>;
  budgetItems?: InsertBudgetItem[];
  menuItems?: InsertMenuItem[];
  shoppingItems?: InsertShoppingListItem[];
  timelineItems?: InsertTimelineItem[];
}

export class InitialGenerationClaimLostError extends Error {
  constructor() {
    super('This plan generation is no longer active. Check its saved status before retrying.');
    this.name = 'InitialGenerationClaimLostError';
  }
}

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** A worker may publish stage output only while it owns this exact execution
 * claim. Output and its resume checkpoint commit together, closing the crash
 * window that previously appended the same section on a retry. */
export class MasterPlannerRunStore {
  constructor(
    private readonly eventId: number,
    private readonly generationId: number,
    private readonly claim: number,
    private readonly database: Pick<typeof db, 'transaction'> = db,
    private readonly now: () => number = Date.now,
  ) {}

  private active<T>(work: (tx: Transaction, generation: MasterPlannerGeneration) => Promise<T>): Promise<T> {
    return this.database.transaction(async tx => {
      const [event] = await tx.select({ id: events.id }).from(events).where(eq(events.id, this.eventId)).for('update');
      if (!event) throw new InitialGenerationClaimLostError();
      const [generation] = await tx.select().from(masterPlannerGenerations).where(and(
        eq(masterPlannerGenerations.id, this.generationId), eq(masterPlannerGenerations.eventId, this.eventId),
      ));
      if (!generation || generation.state !== 'running' || !Number.isFinite(this.claim) || this.claim <= 0 ||
        generation.reservedAt !== this.claim || this.now() - this.claim >= INITIAL_GENERATION_CLAIM_TIMEOUT_MS) {
        throw new InitialGenerationClaimLostError();
      }
      return work(tx, generation);
    });
  }

  assertActive(): Promise<void> {
    return this.active(async () => {});
  }

  setStage(stage: string): Promise<void> {
    return this.active(async tx => {
      await tx.update(events).set({ draftStatus: 'generating', draftStage: stage }).where(eq(events.id, this.eventId));
    });
  }

  completeStage(stage: string, patch: InitialGenerationStagePatch): Promise<void> {
    return this.active(async (tx, generation) => {
      const completed = safeParseStages(generation.completedStages);
      if (completed.includes(stage)) return;
      if (patch.budgetItems?.length) await tx.insert(budgetItems).values(patch.budgetItems.map(item => ({
        ...insertBudgetItemSchema.parse(item), eventId: this.eventId,
      })));
      if (patch.menuItems?.length) await tx.insert(menuItems).values(patch.menuItems.map(item => ({
        ...insertMenuItemSchema.parse(item), eventId: this.eventId,
      })));
      if (patch.shoppingItems?.length) await tx.insert(shoppingListItems).values(patch.shoppingItems.map(item => ({
        ...insertShoppingListItemSchema.parse(item), eventId: this.eventId,
      })));
      if (patch.timelineItems?.length) await tx.insert(timelineItems).values(patch.timelineItems.map(item => ({
        ...insertTimelineItemSchema.parse(item), eventId: this.eventId,
      })));
      if (patch.event) {
        // First-plan stages can set their own presentation fields, never access
        // tokens, payment data, invite publication, or captured contact details.
        const writable = ['themeName', 'paletteColors', 'eventIdentity', 'inviteArtworkUrl',
          'inviteIllustrationUrl', 'customInviteImageUrl', 'inviteDesignConceptJson'] as const;
        const changes: Partial<Event> = {};
        for (const key of writable) if (patch.event[key] !== undefined) changes[key] = patch.event[key];
        if (Object.keys(changes).length) await tx.update(events).set(changes).where(eq(events.id, this.eventId));
      }
      await tx.update(masterPlannerGenerations).set({ completedStages: JSON.stringify([...completed, stage]) })
        .where(and(eq(masterPlannerGenerations.id, this.generationId), eq(masterPlannerGenerations.eventId, this.eventId)));
    });
  }

  fail(stage: string): Promise<void> {
    return this.active(async tx => {
      await tx.update(events).set({ draftStatus: 'failed_partial', draftStage: stage }).where(eq(events.id, this.eventId));
      await tx.update(masterPlannerGenerations).set({ state: 'failed', failedAt: this.now(), failedStage: stage })
        .where(and(eq(masterPlannerGenerations.id, this.generationId), eq(masterPlannerGenerations.eventId, this.eventId)));
    });
  }

  finish(): Promise<void> {
    return this.active(async tx => {
      await tx.update(events).set({ draftStatus: 'ready', draftStage: 'done' }).where(eq(events.id, this.eventId));
      await tx.update(masterPlannerGenerations).set({ state: 'consumed', consumedAt: this.now(), failedAt: null, failedStage: null })
        .where(and(eq(masterPlannerGenerations.id, this.generationId), eq(masterPlannerGenerations.eventId, this.eventId)));
    });
  }
}

export { MasterPlannerRunStore as DbMasterPlannerRunStore };

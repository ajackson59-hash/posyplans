import { z } from 'zod';
import { insertBudgetItemSchema, insertMenuItemSchema, insertShoppingListItemSchema, insertTimelineItemSchema } from '@shared/schema';
import type { PlanContent, PlanRegenerationRecord, PlanRegenerationView, PlanSnapshot } from '@shared/planRegeneration';
import { generateTimeline } from '@shared/timelineGenerator';
import { generateThemeAndIdentityAi } from './themeAi';
import { generateBudgetSuggestionAi } from './budgetAi';
import { generateMenuAi } from './menuAi';
import { generateShoppingAi } from './shoppingAi';
import { planFingerprint } from './planSnapshot';
import type { PlanRegenerationStore } from './planRegenerationStore';

const candidateSchema = z.object({
  eventIdentity: z.string().trim().min(1).max(1000),
  budgetItems: z.array(insertBudgetItemSchema).min(1).max(100),
  menuItems: z.array(insertMenuItemSchema).min(1).max(100),
  shoppingItems: z.array(insertShoppingListItemSchema).min(1).max(100),
  timelineItems: z.array(insertTimelineItemSchema).min(1).max(100),
});

export function validatePlanCandidate(value: unknown): PlanContent {
  return candidateSchema.parse(value);
}

export function planRegenerationView(record: PlanRegenerationRecord, current: PlanSnapshot): PlanRegenerationView {
  const baseChanged = record.state === 'ready' && planFingerprint(record.base) !== planFingerprint(current);
  return {
    id: record.id, state: record.state, stage: record.stage, error: record.error,
    createdAt: record.createdAt, baseChanged, canApply: record.state === 'ready' && !baseChanged,
    candidate: record.state === 'ready' || record.state === 'applied' ? validatePlanCandidate(record.candidate) : null,
    previousAvailable: !!record.previous,
  };
}

export interface PlanRegenerationDeps {
  identity: typeof generateThemeAndIdentityAi;
  budget: typeof generateBudgetSuggestionAi;
  menu: typeof generateMenuAi;
  shopping: typeof generateShoppingAi;
}

/** Only the durable reservation winner calls this function. There is deliberately
 * no automatic restart of a run whose provider outcome may be unknown. Each
 * stage is checkpointed before dispatch; completed candidate sections are private.
 * No live plan, artwork, invitation or guest record is mutated by generation. */
export async function runPlanRegeneration(
  record: PlanRegenerationRecord,
  store: PlanRegenerationStore,
  deps: PlanRegenerationDeps,
): Promise<void> {
  const { id, eventId } = record;
  const e = record.base.event;
  const candidate: Partial<PlanContent> = {};
  const checkpoint = (stage: string) => store.checkpoint(eventId, id, stage, candidate);
  const noRetry = { maxRetries: 0 };
  try {
    const guestCount = record.base.resolvedGuestCount;
    if (!await checkpoint('identity')) return;
    const identity = await deps.identity({ eventName: e.eventName, eventType: e.eventType,
      vibeDescription: e.vibeDescription, guestCount }, noRetry);
    candidate.eventIdentity = identity.eventIdentity;

    if (!await checkpoint('budget')) return;
    const budget = await deps.budget({ eventName: e.eventName, eventType: e.eventType,
      themeName: e.themeName, headcount: guestCount, targetBudget: e.budgetCeiling }, noRetry);
    candidate.budgetItems = budget.items.map(item => insertBudgetItemSchema.parse(item));

    if (!await checkpoint('menu')) return;
    const menu = await deps.menu({ eventName: e.eventName, eventType: e.eventType,
      themeName: e.themeName, vibeDescription: e.vibeDescription, guestCount }, noRetry);
    candidate.menuItems = menu.items.map(item => insertMenuItemSchema.parse(item));

    if (!await checkpoint('shopping')) return;
    const shopping = await deps.shopping({ eventName: e.eventName, eventType: e.eventType,
      themeName: e.themeName, guestCount,
      menuItems: candidate.menuItems.map(item => ({ course: item.course ?? 'Other', itemName: item.itemName })) }, noRetry);
    candidate.shoppingItems = shopping.items.map(item => insertShoppingListItemSchema.parse(item));

    if (!await checkpoint('timeline')) return;
    candidate.timelineItems = generateTimeline({ eventType: e.eventType, guestCount,
      hasCakeMenuItem: candidate.menuItems.some(item => item.course === 'Cake') })
      .map(item => insertTimelineItemSchema.parse(item));
    await store.complete(eventId, id, validatePlanCandidate(candidate));
  } catch {
    // Provider details can contain prompts or credentials. The owner gets a safe
    // explanation; an unfinished candidate is never applied or automatically retried.
    await store.fail(eventId, id, 'This new plan could not be completed. Your current plan and edits are unchanged.');
  }
}

export const defaultPlanRegenerationProviders = {
  identity: generateThemeAndIdentityAi, budget: generateBudgetSuggestionAi,
  menu: generateMenuAi, shopping: generateShoppingAi,
};

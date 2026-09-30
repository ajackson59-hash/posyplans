import type {
  Event, BudgetItem, MenuItem, ShoppingListItem, TimelineItem,
  InsertBudgetItem, InsertMenuItem, InsertShoppingListItem, InsertTimelineItem,
} from './schema';

/** Planning content only. Invitations, artwork and guest identity never belong to a replacement. */
export interface PlanContent {
  eventIdentity: string;
  budgetItems: InsertBudgetItem[];
  menuItems: InsertMenuItem[];
  shoppingItems: InsertShoppingListItem[];
  timelineItems: InsertTimelineItem[];
}

/** Server-only archive: never serialize this through an owner/public response. */
export interface PlanSnapshot {
  resolvedGuestCount: number;
  event: Pick<Event, 'id' | 'eventIdentity' | 'eventName' | 'eventType' | 'eventDate'
    | 'estimatedGuestCount' | 'vibeDescription' | 'themeName' | 'budgetCeiling'
    | 'budgetTotal' | 'location' | 'hostNames' | 'draftStatus'>;
  budgetItems: BudgetItem[];
  menuItems: MenuItem[];
  shoppingItems: ShoppingListItem[];
  timelineItems: TimelineItem[];
}

export type PlanRegenerationState = 'running' | 'ready' | 'failed' | 'applied' | 'discarded';
export interface PlanRegenerationRecord {
  id: string;
  eventId: number;
  requestId: string;
  state: PlanRegenerationState;
  stage: string | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
  base: PlanSnapshot;
  candidate: Partial<PlanContent> | null;
  previous: PlanSnapshot | null;
}

export interface PlanRegenerationView {
  id: string;
  state: PlanRegenerationState;
  stage: string | null;
  error: string | null;
  createdAt: number;
  canApply: boolean;
  baseChanged: boolean;
  candidate: PlanContent | null;
  previousAvailable: boolean;
}

export interface PlanRegenerationResponse {
  eligible: boolean;
  operation: PlanRegenerationView | null;
}

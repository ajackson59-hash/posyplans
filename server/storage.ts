import { events, guests, budgetItems, menuItems, shoppingListItems, timelineItems, themeSuggestionCache, masterPlannerGenerations, emailEntitlements, analyticsEvents } from '@shared/schema';
import type {
  Event, InsertEvent, UpdateEvent,
  Guest, InsertGuest, UpdateGuest,
  BudgetItem, InsertBudgetItem, UpdateBudgetItem,
  MenuItem, InsertMenuItem, UpdateMenuItem,
  ShoppingListItem, InsertShoppingListItem, UpdateShoppingListItem,
  TimelineItem, InsertTimelineItem, UpdateTimelineItem,
  ThemeSuggestionCacheRow,
  MasterPlannerGeneration, GenerationKind,
  EmailEntitlement,
  AnalyticsEvent, AnalyticsEventName,
} from '@shared/schema';
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { eq, and, isNull } from "drizzle-orm";
import { randomBytes } from "crypto";
import { previewCompletionCondition, previewReservationCondition } from "./prePaymentPreviewReservation";
import { customerArtworkRolloutEnabled } from "./customerArtwork";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Add the Supabase pooled connection string to your environment.");
}

// `prepare: false` is required for Supabase's Supavisor pooler in
// transaction mode (and for most serverless/edge deploy targets, including
// Vercel) — prepared statements can't be reused across pooled connections.
const sql = postgres(process.env.DATABASE_URL, { prepare: false });

export const db = drizzle(sql);

function randomToken(len: number): string {
  return randomBytes(len).toString("base64url").slice(0, len);
}

export interface InitialGenerationReservation {
  ok: boolean;
  reason?: 'already_consumed' | 'interrupted';
  generation?: MasterPlannerGeneration;
  shouldStart: boolean;
}

export const INITIAL_GENERATION_CLAIM_TIMEOUT_MS = 10 * 60 * 1000;
type StorageTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Coordinate ordinary plan edits with the atomic candidate-apply boundary. */
async function withPlanEventLock<T>(eventId: number, work: (tx: StorageTransaction) => Promise<T>): Promise<T> {
  return db.transaction(async tx => {
    const [event] = await tx.select({ id: events.id }).from(events).where(eq(events.id, eventId)).for('update');
    if (!event) throw new Error('Event not found.');
    return work(tx);
  });
}

/** Expiry is visible recovery only: a later explicit request must claim a new
 * execution token before any provider work can resume. Parent event is locked. */
async function expireInitialGenerationLocked(
  tx: StorageTransaction, eventId: number, rows: MasterPlannerGeneration[], now: number,
): Promise<boolean> {
  // A historical duplicate must not turn an already completed plan back into
  // a loading/failure screen when a status request examines old ledger rows.
  if (rows.some(row => row.state === 'consumed')) return false;
  const expired = rows.filter(row => row.state === 'running' &&
    (!row.reservedAt || now - row.reservedAt >= INITIAL_GENERATION_CLAIM_TIMEOUT_MS));
  if (!expired.length) return false;
  const [event] = await tx.select({ draftStatus: events.draftStatus }).from(events).where(eq(events.id, eventId));
  if (event?.draftStatus === 'ready') return false;
  for (const row of expired) {
    await tx.update(masterPlannerGenerations).set({
      state: 'failed', failedAt: now, failedStage: 'interrupted',
    }).where(and(eq(masterPlannerGenerations.id, row.id), eq(masterPlannerGenerations.eventId, eventId)));
  }
  if (!rows.some(row => row.state === 'running' && !expired.includes(row))) {
    await tx.update(events).set({ draftStatus: 'failed_partial' }).where(eq(events.id, eventId));
  }
  return true;
}

export interface IStorage {
  createEvent(data: InsertEvent): Promise<Event>;
  getEventByOwnerToken(ownerToken: string): Promise<Event | undefined>;
  getEventByShareSlug(shareSlug: string): Promise<Event | undefined>;
  updateEventByOwnerToken(ownerToken: string, data: UpdateEvent): Promise<Event | undefined>;
  markEventSparkUnlocked(ownerToken: string, checkoutSessionId: string): Promise<Event | undefined>;

  listGuests(eventId: number): Promise<Guest[]>;
  createGuest(eventId: number, data: InsertGuest): Promise<Guest>;
  updateGuest(eventId: number, guestId: number, data: Partial<Guest>): Promise<Guest | undefined>;
  deleteGuest(eventId: number, guestId: number): Promise<boolean>;
  getGuest(guestId: number): Promise<Guest | undefined>;
  getGuestByAccessToken(eventId: number, accessToken: string): Promise<Guest | undefined>;
  rotateGuestAccessToken(eventId: number, guestId: number): Promise<Guest | undefined>;

  listBudgetItems(eventId: number): Promise<BudgetItem[]>;
  createBudgetItem(eventId: number, data: InsertBudgetItem): Promise<BudgetItem>;
  createBudgetItemsBulk(eventId: number, items: InsertBudgetItem[]): Promise<BudgetItem[]>;
  updateBudgetItem(eventId: number, itemId: number, data: Partial<BudgetItem>): Promise<BudgetItem | undefined>;
  deleteBudgetItem(eventId: number, itemId: number): Promise<boolean>;

  listMenuItems(eventId: number): Promise<MenuItem[]>;
  createMenuItem(eventId: number, data: InsertMenuItem): Promise<MenuItem>;
  createMenuItemsBulk(eventId: number, items: InsertMenuItem[]): Promise<MenuItem[]>;
  updateMenuItem(eventId: number, itemId: number, data: Partial<MenuItem>): Promise<MenuItem | undefined>;
  deleteMenuItem(eventId: number, itemId: number): Promise<boolean>;

  listShoppingListItems(eventId: number): Promise<ShoppingListItem[]>;
  createShoppingListItem(eventId: number, data: InsertShoppingListItem): Promise<ShoppingListItem>;
  createShoppingListItemsBulk(eventId: number, items: InsertShoppingListItem[]): Promise<ShoppingListItem[]>;
  updateShoppingListItem(eventId: number, itemId: number, data: Partial<ShoppingListItem>): Promise<ShoppingListItem | undefined>;
  deleteShoppingListItem(eventId: number, itemId: number): Promise<boolean>;

  listTimelineItems(eventId: number): Promise<TimelineItem[]>;
  createTimelineItem(eventId: number, data: InsertTimelineItem): Promise<TimelineItem>;
  createTimelineItemsBulk(eventId: number, items: InsertTimelineItem[]): Promise<TimelineItem[]>;
  updateTimelineItem(eventId: number, itemId: number, data: Partial<TimelineItem>): Promise<TimelineItem | undefined>;
  deleteTimelineItem(eventId: number, itemId: number): Promise<boolean>;

  getThemeSuggestionCache(cacheKey: string): Promise<ThemeSuggestionCacheRow | undefined>;
  setThemeSuggestionCache(cacheKey: string, theme: string, eventType: string, suggestionsJson: string): Promise<ThemeSuggestionCacheRow>;

  getEventById(eventId: number): Promise<Event | undefined>;
  updateEventById(eventId: number, data: Partial<Event>): Promise<Event | undefined>;
  reservePrePaymentPreview(event: Event, startedAt: number): Promise<Event | undefined>;
  completePrePaymentPreview(event: Event, data: Pick<Event, "prePaymentPreviewUrl" | "prePaymentPreviewUsedAt">): Promise<Event | undefined>;
  setEventCapturedEmail(eventId: number, email: string): Promise<Event | undefined>;
  getEventsByEmail(email: string): Promise<Event[]>;

  expireInitialGeneration(eventId: number): Promise<void>;
  reserveInitialGeneration(eventId: number, allowResume?: boolean): Promise<InitialGenerationReservation>;
  getLatestGenerationForEvent(eventId: number): Promise<MasterPlannerGeneration | undefined>;
  getGeneration(id: number): Promise<MasterPlannerGeneration | undefined>;
  createGeneration(eventId: number, kind: GenerationKind, attemptNumber: number): Promise<MasterPlannerGeneration>;
  updateGeneration(id: number, data: Partial<MasterPlannerGeneration>): Promise<MasterPlannerGeneration | undefined>;

  getEmailEntitlement(email: string): Promise<EmailEntitlement | undefined>;
  upsertEmailEntitlement(email: string, data: Partial<EmailEntitlement>): Promise<EmailEntitlement>;

  logAnalyticsEvent(
    eventName: AnalyticsEventName,
    data?: { email?: string; billingInterval?: string; metadata?: Record<string, unknown> },
  ): Promise<AnalyticsEvent>;
}

export class DatabaseStorage implements IStorage {
  async completePrePaymentPreview(event: Event, data: Pick<Event, "prePaymentPreviewUrl" | "prePaymentPreviewUsedAt">): Promise<Event | undefined> {
    const [completed] = await db.update(events).set(data).where(previewCompletionCondition(event)).returning();
    return completed;
  }

  async reservePrePaymentPreview(event: Event, startedAt: number): Promise<Event | undefined> {
    const [reserved] = await db.update(events).set({
      prePaymentPreviewAttempts: event.prePaymentPreviewAttempts + 1,
      prePaymentPreviewUrl: "",
      prePaymentPreviewUsedAt: startedAt,
    }).where(previewReservationCondition(event)).returning();
    return reserved;
  }

  async createEvent(data: InsertEvent): Promise<Event> {
    const ownerToken = randomToken(24);
    const shareSlug = randomToken(10);
    const rows = await db.insert(events).values({
      ...data,
      // New invitations stay private until the host has reviewed and
      // deliberately published them. The database default remains published
      // only to preserve the behavior of pre-existing rows.
      inviteStatus: "draft",
      customerArtworkEnabled: customerArtworkRolloutEnabled(),
      ownerToken,
      shareSlug,
      createdAt: Date.now(),
    }).returning();
    return rows[0];
  }

  async getEventByOwnerToken(ownerToken: string): Promise<Event | undefined> {
    const rows = await db.select().from(events).where(eq(events.ownerToken, ownerToken));
    return rows[0];
  }

  async getEventByShareSlug(shareSlug: string): Promise<Event | undefined> {
    const rows = await db.select().from(events).where(eq(events.shareSlug, shareSlug));
    return rows[0];
  }

  async updateEventByOwnerToken(ownerToken: string, data: UpdateEvent): Promise<Event | undefined> {
    const existing = await this.getEventByOwnerToken(ownerToken);
    if (!existing) return undefined;
    // A patch body with no recognized fields (e.g. a client only sent
    // system-controlled keys like draftStatus, which Zod silently strips
    // before this ever runs) has nothing left to set. Return the event
    // unchanged instead of letting an empty SET clause throw.
    if (Object.keys(data).length === 0) return existing;
    const rows = await db.update(events).set(data).where(eq(events.id, existing.id)).returning();
    return rows[0];
  }

  // Grants an event its one-time Spark unlock. Idempotent: if the event is
  // already unlocked, returns it untouched (a replayed webhook or a
  // success-page refresh must never re-stamp the timestamp or overwrite the
  // originating session id).
  async markEventSparkUnlocked(ownerToken: string, checkoutSessionId: string): Promise<Event | undefined> {
    const existing = await this.getEventByOwnerToken(ownerToken);
    if (!existing) return undefined;
    if (existing.sparkUnlockedAt) return existing;
    const rows = await db
      .update(events)
      .set({ sparkUnlockedAt: Date.now(), sparkCheckoutSessionId: checkoutSessionId })
      .where(and(eq(events.id, existing.id), isNull(events.sparkUnlockedAt)))
      .returning();
    // A simultaneous webhook/return may have won after the initial read.
    return rows[0] ?? this.getEventByOwnerToken(ownerToken);
  }

  async listGuests(eventId: number): Promise<Guest[]> {
    return await db.select().from(guests).where(eq(guests.eventId, eventId));
  }

  async createGuest(eventId: number, data: InsertGuest): Promise<Guest> {
    return withPlanEventLock(eventId, async tx => {
      const rows = await tx.insert(guests).values({ ...data, eventId }).returning();
      return rows[0];
    });
  }

  async updateGuest(eventId: number, guestId: number, data: Partial<Guest>): Promise<Guest | undefined> {
    return withPlanEventLock(eventId, async tx => {
      const condition = and(eq(guests.id, guestId), eq(guests.eventId, eventId));
      const { id: _id, eventId: _eventId, ...changes } = data;
      if (Object.keys(changes).length === 0) {
        const rows = await tx.select().from(guests).where(condition);
        return rows[0];
      }
      const rows = await tx.update(guests).set(changes).where(condition).returning();
      return rows[0];
    });
  }

  async deleteGuest(eventId: number, guestId: number): Promise<boolean> {
    return withPlanEventLock(eventId, async tx => {
      const rows = await tx.delete(guests).where(and(eq(guests.id, guestId), eq(guests.eventId, eventId))).returning();
      return rows.length > 0;
    });
  }

  async getGuest(guestId: number): Promise<Guest | undefined> {
    const rows = await db.select().from(guests).where(eq(guests.id, guestId));
    return rows[0];
  }

  async getGuestByAccessToken(eventId: number, accessToken: string): Promise<Guest | undefined> {
    const rows = await db.select().from(guests).where(and(
      eq(guests.eventId, eventId),
      eq(guests.accessToken, accessToken),
    ));
    return rows[0];
  }

  async rotateGuestAccessToken(eventId: number, guestId: number): Promise<Guest | undefined> {
    const existing = await this.getGuest(guestId);
    if (!existing || existing.eventId !== eventId) return undefined;
    const rows = await db.update(guests)
      .set({ accessToken: randomToken(32) })
      .where(and(eq(guests.id, guestId), eq(guests.eventId, eventId)))
      .returning();
    return rows[0];
  }

  async listBudgetItems(eventId: number): Promise<BudgetItem[]> {
    return await db.select().from(budgetItems).where(eq(budgetItems.eventId, eventId));
  }

  async createBudgetItem(eventId: number, data: InsertBudgetItem): Promise<BudgetItem> {
    return withPlanEventLock(eventId, async tx => {
      const rows = await tx.insert(budgetItems).values({ ...data, eventId }).returning();
      return rows[0];
    });
  }

  async createBudgetItemsBulk(eventId: number, items: InsertBudgetItem[]): Promise<BudgetItem[]> {
    if (items.length === 0) return [];
    return withPlanEventLock(eventId, async tx =>
      tx.insert(budgetItems).values(items.map((data) => ({ ...data, eventId }))).returning());
  }

  async updateBudgetItem(eventId: number, itemId: number, data: Partial<BudgetItem>): Promise<BudgetItem | undefined> {
    return withPlanEventLock(eventId, async tx => {
      const condition = and(eq(budgetItems.id, itemId), eq(budgetItems.eventId, eventId));
      // A row cannot move to another event outside that event's lock.
      const { id: _id, eventId: _eventId, ...changes } = data;
      if (Object.keys(changes).length === 0) {
        const rows = await tx.select().from(budgetItems).where(condition);
        return rows[0];
      }
      const rows = await tx.update(budgetItems).set(changes).where(condition).returning();
      return rows[0];
    });
  }

  async deleteBudgetItem(eventId: number, itemId: number): Promise<boolean> {
    return withPlanEventLock(eventId, async tx => {
      const rows = await tx.delete(budgetItems).where(and(eq(budgetItems.id, itemId), eq(budgetItems.eventId, eventId))).returning();
      return rows.length > 0;
    });
  }

  async listMenuItems(eventId: number): Promise<MenuItem[]> {
    return await db.select().from(menuItems).where(eq(menuItems.eventId, eventId));
  }

  async createMenuItem(eventId: number, data: InsertMenuItem): Promise<MenuItem> {
    return withPlanEventLock(eventId, async tx => {
      const rows = await tx.insert(menuItems).values({ ...data, eventId }).returning();
      return rows[0];
    });
  }

  async createMenuItemsBulk(eventId: number, items: InsertMenuItem[]): Promise<MenuItem[]> {
    if (items.length === 0) return [];
    return withPlanEventLock(eventId, async tx =>
      tx.insert(menuItems).values(items.map((data) => ({ ...data, eventId }))).returning());
  }

  async updateMenuItem(eventId: number, itemId: number, data: Partial<MenuItem>): Promise<MenuItem | undefined> {
    return withPlanEventLock(eventId, async tx => {
      const condition = and(eq(menuItems.id, itemId), eq(menuItems.eventId, eventId));
      // A row cannot move to another event outside that event's lock.
      const { id: _id, eventId: _eventId, ...changes } = data;
      if (Object.keys(changes).length === 0) {
        const rows = await tx.select().from(menuItems).where(condition);
        return rows[0];
      }
      const rows = await tx.update(menuItems).set(changes).where(condition).returning();
      return rows[0];
    });
  }

  async deleteMenuItem(eventId: number, itemId: number): Promise<boolean> {
    return withPlanEventLock(eventId, async tx => {
      const rows = await tx.delete(menuItems).where(and(eq(menuItems.id, itemId), eq(menuItems.eventId, eventId))).returning();
      return rows.length > 0;
    });
  }

  async listShoppingListItems(eventId: number): Promise<ShoppingListItem[]> {
    return await db.select().from(shoppingListItems).where(eq(shoppingListItems.eventId, eventId));
  }

  async createShoppingListItem(eventId: number, data: InsertShoppingListItem): Promise<ShoppingListItem> {
    return withPlanEventLock(eventId, async tx => {
      const rows = await tx.insert(shoppingListItems).values({ ...data, eventId }).returning();
      return rows[0];
    });
  }

  async createShoppingListItemsBulk(eventId: number, items: InsertShoppingListItem[]): Promise<ShoppingListItem[]> {
    if (items.length === 0) return [];
    return withPlanEventLock(eventId, async tx =>
      tx.insert(shoppingListItems).values(items.map((data) => ({ ...data, eventId }))).returning());
  }

  async updateShoppingListItem(eventId: number, itemId: number, data: Partial<ShoppingListItem>): Promise<ShoppingListItem | undefined> {
    return withPlanEventLock(eventId, async tx => {
      const condition = and(eq(shoppingListItems.id, itemId), eq(shoppingListItems.eventId, eventId));
      // A row cannot move to another event outside that event's lock.
      const { id: _id, eventId: _eventId, ...changes } = data;
      if (Object.keys(changes).length === 0) {
        const rows = await tx.select().from(shoppingListItems).where(condition);
        return rows[0];
      }
      const rows = await tx.update(shoppingListItems).set(changes).where(condition).returning();
      return rows[0];
    });
  }

  async deleteShoppingListItem(eventId: number, itemId: number): Promise<boolean> {
    return withPlanEventLock(eventId, async tx => {
      const rows = await tx.delete(shoppingListItems).where(and(eq(shoppingListItems.id, itemId), eq(shoppingListItems.eventId, eventId))).returning();
      return rows.length > 0;
    });
  }

  async listTimelineItems(eventId: number): Promise<TimelineItem[]> {
    return await db.select().from(timelineItems).where(eq(timelineItems.eventId, eventId));
  }

  async createTimelineItem(eventId: number, data: InsertTimelineItem): Promise<TimelineItem> {
    return withPlanEventLock(eventId, async tx => {
      const rows = await tx.insert(timelineItems).values({ ...data, eventId }).returning();
      return rows[0];
    });
  }

  async createTimelineItemsBulk(eventId: number, items: InsertTimelineItem[]): Promise<TimelineItem[]> {
    if (items.length === 0) return [];
    return withPlanEventLock(eventId, async tx =>
      tx.insert(timelineItems).values(items.map((data) => ({ ...data, eventId }))).returning());
  }

  async updateTimelineItem(eventId: number, itemId: number, data: Partial<TimelineItem>): Promise<TimelineItem | undefined> {
    return withPlanEventLock(eventId, async tx => {
      const condition = and(eq(timelineItems.id, itemId), eq(timelineItems.eventId, eventId));
      // A row cannot move to another event outside that event's lock.
      const { id: _id, eventId: _eventId, ...changes } = data;
      if (Object.keys(changes).length === 0) {
        const rows = await tx.select().from(timelineItems).where(condition);
        return rows[0];
      }
      const rows = await tx.update(timelineItems).set(changes).where(condition).returning();
      return rows[0];
    });
  }

  async deleteTimelineItem(eventId: number, itemId: number): Promise<boolean> {
    return withPlanEventLock(eventId, async tx => {
      const rows = await tx.delete(timelineItems).where(and(eq(timelineItems.id, itemId), eq(timelineItems.eventId, eventId))).returning();
      return rows.length > 0;
    });
  }

  async getThemeSuggestionCache(cacheKey: string): Promise<ThemeSuggestionCacheRow | undefined> {
    const rows = await db.select().from(themeSuggestionCache).where(eq(themeSuggestionCache.cacheKey, cacheKey));
    return rows[0];
  }

  async setThemeSuggestionCache(cacheKey: string, theme: string, eventType: string, suggestionsJson: string): Promise<ThemeSuggestionCacheRow> {
    const existing = await this.getThemeSuggestionCache(cacheKey);
    if (existing) {
      const rows = await db.update(themeSuggestionCache).set({ suggestionsJson, createdAt: Date.now() }).where(eq(themeSuggestionCache.id, existing.id)).returning();
      return rows[0];
    }
    const rows = await db.insert(themeSuggestionCache).values({ cacheKey, theme, eventType, suggestionsJson, createdAt: Date.now() }).returning();
    return rows[0];
  }

  async getEventById(eventId: number): Promise<Event | undefined> {
    const rows = await db.select().from(events).where(eq(events.id, eventId));
    return rows[0];
  }

  async updateEventById(eventId: number, data: Partial<Event>): Promise<Event | undefined> {
    const existing = await this.getEventById(eventId);
    if (!existing) return undefined;
    if (Object.keys(data).length === 0) return existing;
    const rows = await db.update(events).set(data).where(eq(events.id, eventId)).returning();
    return rows[0];
  }

  // Stamps the host's email onto the event (the entitlement gate resolves Plus
  // membership through this column — see canGenerateDraft). Normalizes to
  // trimmed lowercase. Idempotent: re-stamping the same normalized email is a
  // no-op that leaves emailCapturedAt untouched. Callers own any
  // don't-overwrite-a-different-email policy; this just writes what it's given.
  async setEventCapturedEmail(eventId: number, email: string): Promise<Event | undefined> {
    const existing = await this.getEventById(eventId);
    if (!existing) return undefined;
    const normalized = email.trim().toLowerCase();
    if (existing.capturedEmail === normalized) return existing;
    const rows = await db
      .update(events)
      .set({ capturedEmail: normalized, emailCapturedAt: Date.now() })
      .where(eq(events.id, eventId))
      .returning();
    return rows[0];
  }

  async getEventsByEmail(email: string): Promise<Event[]> {
    const normalized = email.trim().toLowerCase();
    const rows = await db
      .select()
      .from(events)
      .where(eq(events.capturedEmail, normalized));
    // Most recent first
    return rows.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  }

  async expireInitialGeneration(eventId: number): Promise<void> {
    await withPlanEventLock(eventId, async tx => {
      const rows = await tx.select().from(masterPlannerGenerations).where(eq(masterPlannerGenerations.eventId, eventId));
      await expireInitialGenerationLocked(tx, eventId, rows, Date.now());
    });
  }

  async reserveInitialGeneration(eventId: number, allowResume = false): Promise<InitialGenerationReservation> {
    return withPlanEventLock(eventId, async tx => {
      const rows = await tx.select().from(masterPlannerGenerations).where(eq(masterPlannerGenerations.eventId, eventId));
      // A consumed attempt cannot be bypassed by an older interrupted row.
      if (rows.some(row => row.state === 'consumed')) {
        return { ok: false, reason: 'already_consumed', shouldStart: false };
      }
      const now = Date.now();
      if (await expireInitialGenerationLocked(tx, eventId, rows, now)) {
        return { ok: false, reason: 'interrupted', shouldStart: false };
      }
      const running = rows.find(row => row.state === 'running');
      if (running) return { ok: true, generation: running, shouldStart: false };
      const latest = rows.reduce<MasterPlannerGeneration | undefined>((prior, row) =>
        !prior || row.attemptNumber > prior.attemptNumber ||
        (row.attemptNumber === prior.attemptNumber && row.id > prior.id) ? row : prior, undefined);
      if (latest) {
        if (!allowResume) return { ok: false, reason: 'interrupted', shouldStart: false };
        const [generation] = await tx.update(masterPlannerGenerations).set({
          state: 'running', reservedAt: Math.max(now, (latest.reservedAt ?? 0) + 1), failedAt: null, failedStage: null,
        }).where(and(eq(masterPlannerGenerations.id, latest.id), eq(masterPlannerGenerations.eventId, eventId))).returning();
        return { ok: true, generation, shouldStart: true };
      }
      const [generation] = await tx.insert(masterPlannerGenerations).values({
        eventId, kind: 'free_first_draft', attemptNumber: 1, state: 'running',
        reservedAt: now, completedStages: '[]',
      }).returning();
      return { ok: true, generation, shouldStart: true };
    });
  }

  async getLatestGenerationForEvent(eventId: number): Promise<MasterPlannerGeneration | undefined> {
    const rows = await db
      .select()
      .from(masterPlannerGenerations)
      .where(eq(masterPlannerGenerations.eventId, eventId));
    if (rows.length === 0) return undefined;
    return rows.reduce((latest, row) => (row.attemptNumber > latest.attemptNumber ? row : latest), rows[0]);
  }

  async createGeneration(eventId: number, kind: GenerationKind, attemptNumber: number): Promise<MasterPlannerGeneration> {
    const rows = await db
      .insert(masterPlannerGenerations)
      .values({ eventId, kind, attemptNumber, state: "reserved", reservedAt: Date.now(), completedStages: "[]" })
      .returning();
    return rows[0];
  }

  async getGeneration(id: number): Promise<MasterPlannerGeneration | undefined> {
    const rows = await db.select().from(masterPlannerGenerations).where(eq(masterPlannerGenerations.id, id));
    return rows[0];
  }

  async updateGeneration(id: number, data: Partial<MasterPlannerGeneration>): Promise<MasterPlannerGeneration | undefined> {
    const existing = await this.getGeneration(id);
    if (!existing) return undefined;
    if (Object.keys(data).length === 0) return existing;
    const rows = await db.update(masterPlannerGenerations).set(data).where(eq(masterPlannerGenerations.id, id)).returning();
    return rows[0];
  }

  async getEmailEntitlement(email: string): Promise<EmailEntitlement | undefined> {
    const rows = await db.select().from(emailEntitlements).where(eq(emailEntitlements.email, email.toLowerCase()));
    return rows[0];
  }

  // Creates the entitlement row on first checkout attempt (planTier defaults
  // to "spark" until the checkout actually completes), or updates whichever
  // fields the caller passes (planTier, trial dates, Stripe ids, billing
  // interval) on every later call — checkout confirm, webhook events, etc.
  async upsertEmailEntitlement(email: string, data: Partial<EmailEntitlement>): Promise<EmailEntitlement> {
    const normalized = email.toLowerCase();
    const existing = await this.getEmailEntitlement(normalized);
    const now = Date.now();
    if (!existing) {
      const rows = await db
        .insert(emailEntitlements)
        .values({
          email: normalized,
          planTier: "spark",
          additionalDraftsUsed: 0,
          createdAt: now,
          updatedAt: now,
          ...data,
        })
        .onConflictDoUpdate({ target: emailEntitlements.email, set: { ...data, updatedAt: now } })
        .returning();
      return rows[0];
    }
    if (Object.keys(data).length === 0) return existing;
    const rows = await db
      .update(emailEntitlements)
      .set({ ...data, updatedAt: now })
      .where(eq(emailEntitlements.email, normalized))
      .returning();
    return rows[0];
  }

  async logAnalyticsEvent(
    eventName: AnalyticsEventName,
    data: { email?: string; billingInterval?: string; metadata?: Record<string, unknown> } = {},
  ): Promise<AnalyticsEvent> {
    const rows = await db
      .insert(analyticsEvents)
      .values({
        eventName,
        email: data.email?.toLowerCase(),
        billingInterval: data.billingInterval,
        metadataJson: JSON.stringify(data.metadata ?? {}),
        createdAt: Date.now(),
      })
      .returning();
    return rows[0];
  }
}

export const storage = new DatabaseStorage();

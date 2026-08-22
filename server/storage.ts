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
import { eq, and } from "drizzle-orm";
import { randomBytes } from "crypto";

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
  setEventCapturedEmail(eventId: number, email: string): Promise<Event | undefined>;
  getEventsByEmail(email: string): Promise<Event[]>;

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
  async createEvent(data: InsertEvent): Promise<Event> {
    const ownerToken = randomToken(24);
    const shareSlug = randomToken(10);
    const rows = await db.insert(events).values({
      ...data,
      // New invitations stay private until the host has reviewed and
      // deliberately published them. The database default remains published
      // only to preserve the behavior of pre-existing rows.
      inviteStatus: "draft",
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
      .where(eq(events.id, existing.id))
      .returning();
    return rows[0];
  }

  async listGuests(eventId: number): Promise<Guest[]> {
    return await db.select().from(guests).where(eq(guests.eventId, eventId));
  }

  async createGuest(eventId: number, data: InsertGuest): Promise<Guest> {
    const rows = await db.insert(guests).values({ ...data, eventId }).returning();
    return rows[0];
  }

  async updateGuest(eventId: number, guestId: number, data: Partial<Guest>): Promise<Guest | undefined> {
    const existingRows = await db.select().from(guests).where(and(eq(guests.id, guestId), eq(guests.eventId, eventId)));
    if (!existingRows[0]) return undefined;
    const rows = await db.update(guests).set(data).where(eq(guests.id, guestId)).returning();
    return rows[0];
  }

  async deleteGuest(eventId: number, guestId: number): Promise<boolean> {
    const rows = await db.delete(guests).where(and(eq(guests.id, guestId), eq(guests.eventId, eventId))).returning();
    return rows.length > 0;
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
    const rows = await db.insert(budgetItems).values({ ...data, eventId }).returning();
    return rows[0];
  }

  async createBudgetItemsBulk(eventId: number, items: InsertBudgetItem[]): Promise<BudgetItem[]> {
    if (items.length === 0) return [];
    return await db.insert(budgetItems).values(items.map((data) => ({ ...data, eventId }))).returning();
  }

  async updateBudgetItem(eventId: number, itemId: number, data: Partial<BudgetItem>): Promise<BudgetItem | undefined> {
    const existingRows = await db.select().from(budgetItems).where(and(eq(budgetItems.id, itemId), eq(budgetItems.eventId, eventId)));
    if (!existingRows[0]) return undefined;
    const rows = await db.update(budgetItems).set(data).where(eq(budgetItems.id, itemId)).returning();
    return rows[0];
  }

  async deleteBudgetItem(eventId: number, itemId: number): Promise<boolean> {
    const rows = await db.delete(budgetItems).where(and(eq(budgetItems.id, itemId), eq(budgetItems.eventId, eventId))).returning();
    return rows.length > 0;
  }

  async listMenuItems(eventId: number): Promise<MenuItem[]> {
    return await db.select().from(menuItems).where(eq(menuItems.eventId, eventId));
  }

  async createMenuItem(eventId: number, data: InsertMenuItem): Promise<MenuItem> {
    const rows = await db.insert(menuItems).values({ ...data, eventId }).returning();
    return rows[0];
  }

  async createMenuItemsBulk(eventId: number, items: InsertMenuItem[]): Promise<MenuItem[]> {
    if (items.length === 0) return [];
    return await db.insert(menuItems).values(items.map((data) => ({ ...data, eventId }))).returning();
  }

  async updateMenuItem(eventId: number, itemId: number, data: Partial<MenuItem>): Promise<MenuItem | undefined> {
    const existingRows = await db.select().from(menuItems).where(and(eq(menuItems.id, itemId), eq(menuItems.eventId, eventId)));
    if (!existingRows[0]) return undefined;
    const rows = await db.update(menuItems).set(data).where(eq(menuItems.id, itemId)).returning();
    return rows[0];
  }

  async deleteMenuItem(eventId: number, itemId: number): Promise<boolean> {
    const rows = await db.delete(menuItems).where(and(eq(menuItems.id, itemId), eq(menuItems.eventId, eventId))).returning();
    return rows.length > 0;
  }

  async listShoppingListItems(eventId: number): Promise<ShoppingListItem[]> {
    return await db.select().from(shoppingListItems).where(eq(shoppingListItems.eventId, eventId));
  }

  async createShoppingListItem(eventId: number, data: InsertShoppingListItem): Promise<ShoppingListItem> {
    const rows = await db.insert(shoppingListItems).values({ ...data, eventId }).returning();
    return rows[0];
  }

  async createShoppingListItemsBulk(eventId: number, items: InsertShoppingListItem[]): Promise<ShoppingListItem[]> {
    if (items.length === 0) return [];
    return await db.insert(shoppingListItems).values(items.map((data) => ({ ...data, eventId }))).returning();
  }

  async updateShoppingListItem(eventId: number, itemId: number, data: Partial<ShoppingListItem>): Promise<ShoppingListItem | undefined> {
    const existingRows = await db.select().from(shoppingListItems).where(and(eq(shoppingListItems.id, itemId), eq(shoppingListItems.eventId, eventId)));
    if (!existingRows[0]) return undefined;
    const rows = await db.update(shoppingListItems).set(data).where(eq(shoppingListItems.id, itemId)).returning();
    return rows[0];
  }

  async deleteShoppingListItem(eventId: number, itemId: number): Promise<boolean> {
    const rows = await db.delete(shoppingListItems).where(and(eq(shoppingListItems.id, itemId), eq(shoppingListItems.eventId, eventId))).returning();
    return rows.length > 0;
  }

  async listTimelineItems(eventId: number): Promise<TimelineItem[]> {
    return await db.select().from(timelineItems).where(eq(timelineItems.eventId, eventId));
  }

  async createTimelineItem(eventId: number, data: InsertTimelineItem): Promise<TimelineItem> {
    const rows = await db.insert(timelineItems).values({ ...data, eventId }).returning();
    return rows[0];
  }

  async createTimelineItemsBulk(eventId: number, items: InsertTimelineItem[]): Promise<TimelineItem[]> {
    if (items.length === 0) return [];
    return await db.insert(timelineItems).values(items.map((data) => ({ ...data, eventId }))).returning();
  }

  async updateTimelineItem(eventId: number, itemId: number, data: Partial<TimelineItem>): Promise<TimelineItem | undefined> {
    const existingRows = await db.select().from(timelineItems).where(and(eq(timelineItems.id, itemId), eq(timelineItems.eventId, eventId)));
    if (!existingRows[0]) return undefined;
    const rows = await db.update(timelineItems).set(data).where(eq(timelineItems.id, itemId)).returning();
    return rows[0];
  }

  async deleteTimelineItem(eventId: number, itemId: number): Promise<boolean> {
    const rows = await db.delete(timelineItems).where(and(eq(timelineItems.id, itemId), eq(timelineItems.eventId, eventId))).returning();
    return rows.length > 0;
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

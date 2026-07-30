import type { Express } from "express";
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { storage } from "./storage";
import {
  insertEventSchema, updateEventSchema, insertGuestSchema, updateGuestSchema, rsvpSubmitSchema,
  insertBudgetItemSchema, updateBudgetItemSchema,
  insertMenuItemSchema, updateMenuItemSchema,
  insertShoppingListItemSchema, updateShoppingListItemSchema,
  insertTimelineItemSchema, updateTimelineItemSchema,
  intakeSchema,
} from "@shared/schema";
import { z } from "zod";
import type { Event, Guest } from "@shared/schema";
import { sendInviteEmail } from "./email";
import { sendReminderSms } from "./sms";
import { matchThemeLibrary, libraryEntryToSuggestion, buildResourceUrl, type ThemeSuggestion } from "./themeLibrary";
import { generateThemeSuggestionAi } from "./themeAi";
import { applyInviteTokens, INVITE_TONES } from "@shared/inviteTokens";
import { generateInviteToneAi, type InviteTone } from "./inviteAi";
import { generateBudgetSuggestionAi } from "./budgetAi";
import { isFuzzyNameMatch } from "./fuzzyMatch";
import { generateInviteDesignConcepts, extractInspirationNotes } from "./inviteDesignAi";
import { generateInviteIllustration, generateInviteIllustrationWithQualityGate } from "./illustrationGen";
import { isValidInviteDesignConcept, type InviteDesignConcept, parseInviteDesignConcept, getFontPairing, FONT_PAIRINGS, LAYOUT_STYLES, BORDER_STYLES } from "@shared/inviteDesign";
import { deriveThemeDna, isLinerPattern, isStampStyle } from "@shared/themeDna";
import { computeEventDna, dnaSummaryForPrompt } from "@shared/eventDna";
import { recommendInviteFormat } from "@shared/inviteFormatRecommendation";
import { detectContradictions } from "@shared/contradictions";
import { detectMenuThemeCoherence } from "@shared/menuThemeCoherence";
import { computeReadinessScore } from "@shared/readinessScore";
import { detectTimelineConflicts } from "@shared/timelineConflicts";
import { detectMissingItems } from "@shared/missingItems";
import { assessBudgetFeasibility } from "@shared/budgetFeasibility";
import { reserveOrResumeFreeDraft, getEntitlementSummary, safeParseStages, canGenerateDraft } from "./masterPlannerEntitlement";
import { runMasterPlannerOrchestration } from "./masterPlannerOrchestrator";
import type Stripe from "stripe";
import { parseCookies, serializeConsentCookie } from "./cookies";
import { getStripe, getPriceId, getSparkPriceId, isStripeConfigured, getWebhookSecret, planTierFromSubscriptionStatus, plusPriceValue, CHECKOUT_PRICES, type BillingInterval } from "./stripe";
import { sendMetaPurchaseEvent } from "./metaCapi";

function publicEventView(event: Event) {
  // Never expose ownerToken (the host's secret edit key) on public routes.
  const { ownerToken, capturedEmail, ...rest } = event;
  return rest;
}

// Defense-in-depth email capture from trusted Stripe moments (checkout confirm
// / webhook), where we have both a Stripe-verified email and the event. More
// trustworthy than the typed-in /email-capture route, so it's stamped here too
// to guarantee the entitlement gate can resolve Plus membership. Honors the
// same "don't overwrite a different existing email" rule and, critically, never
// throws — checkout and webhook processing must complete regardless.
async function stampCapturedEmailSafe(eventId: number, email: string | null | undefined): Promise<void> {
  try {
    const normalized = (email ?? "").trim().toLowerCase();
    if (!normalized) return;
    const event = await storage.getEventById(eventId);
    if (!event) return;
    if (event.capturedEmail && event.capturedEmail !== normalized) {
      console.warn(`[email-capture] event ${eventId} already has a different captured email; not overwriting from Stripe`);
      return;
    }
    await storage.setEventCapturedEmail(eventId, normalized);
  } catch (err) {
    console.error(`[email-capture] failed to stamp email on event ${eventId}:`, err);
  }
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  /* ============ EVENT: CREATE / OWNER ACCESS ============ */
  app.post("/api/events", async (req, res) => {
    const parsed = insertEventSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const event = await storage.createEvent(parsed.data);
    res.json(event);
  });

  // Email capture — stamps the host's email onto the event so they can
  // recover access later. The client (DraftGenerating.tsx) already calls
  // this route, but it was missing on the server, causing captured_email to
  // stay NULL on every event. Requires the ownerToken to verify ownership.
  app.post("/api/events/:eventId/email-capture", async (req, res) => {
    const eventId = Number(req.params.eventId);
    if (!Number.isFinite(eventId) || eventId <= 0) {
      return res.status(400).json({ error: "Invalid event ID" });
    }
    const { email, ownerToken } = req.body as { email?: string; ownerToken?: string };
    if (!email || !email.trim()) {
      return res.status(400).json({ error: "Email is required" });
    }
    if (!ownerToken) {
      return res.status(400).json({ error: "Owner token is required" });
    }
    // Verify ownership before stamping the email
    const event = await storage.getEventById(eventId);
    if (!event || event.ownerToken !== ownerToken) {
      return res.status(404).json({ error: "Event not found" });
    }
    await storage.setEventCapturedEmail(eventId, email);
    // Return the updated event so the client can refetch entitlements
    const updated = await storage.getEventById(eventId);
    res.json(updated);
  });

  // Email-based event lookup — lets a returning host find their events by
  // entering the email they used. Returns only the minimal info needed to
  // redirect to the dashboard (no sensitive guest/budget data).
  app.post("/api/events/lookup", async (req, res) => {
    const { email } = req.body as { email?: string };
    if (!email || !email.trim()) {
      return res.status(400).json({ error: "Email is required" });
    }
    const normalized = email.trim().toLowerCase();
    const found = await storage.getEventsByEmail(normalized);
    // Return only the fields needed for recovery — ownerToken, event name,
    // date, and type. No guest lists, budgets, or other sensitive data.
    const safe = found.map((e) => ({
      ownerToken: e.ownerToken,
      eventName: e.eventName,
      eventType: e.eventType,
      eventDate: e.eventDate,
      createdAt: e.createdAt,
    }));
    res.json({ events: safe });
  });

  app.get("/api/events/owner/:ownerToken", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const guestList = await storage.listGuests(event.id);
    res.json({ event, guests: guestList });
  });

  app.patch("/api/events/owner/:ownerToken", async (req, res) => {
    const parsed = updateEventSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const updated = await storage.updateEventByOwnerToken(req.params.ownerToken, parsed.data);
    if (!updated) return res.status(404).json({ error: "Event not found" });
    res.json(updated);
  });

  // AI Master Planner Intake wizard writes here. Deliberately narrower than
  // the generic PATCH above — only the handful of fields the wizard owns
  // (eventType, eventDate, estimatedGuestCount, budgetCeiling,
  // vibeDescription). No AI calls happen on this route; the actual
  // generation kicks off from a separate orchestrator endpoint in Phase 3.
  app.patch("/api/events/owner/:ownerToken/intake", async (req, res) => {
    const parsed = intakeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const updated = await storage.updateEventByOwnerToken(req.params.ownerToken, parsed.data);
    if (!updated) return res.status(404).json({ error: "Event not found" });
    res.json(updated);
  });

  /* ============ EVENT: PUBLIC RSVP PAGE ============ */
  app.get("/api/events/public/:shareSlug", async (req, res) => {
    const event = await storage.getEventByShareSlug(req.params.shareSlug);
    if (!event) return res.status(404).json({ error: "Event not found" });
    res.json(publicEventView(event));
  });

  app.get("/api/events/public/:shareSlug/search-guests", async (req, res) => {
    const event = await storage.getEventByShareSlug(req.params.shareSlug);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const query = String(req.query.q || "").trim().toLowerCase();
    const all = await storage.listGuests(event.id);
    let matches: typeof all = [];
    if (query) {
      // Rank exact substring matches first (most confident), then fall back
      // to typo-tolerant fuzzy matches so a small misspelling (e.g.
      // "Jonh" for "John") still surfaces the right guest.
      const substringMatches = all.filter((g) => g.name.toLowerCase().includes(query));
      const substringIds = new Set(substringMatches.map((g) => g.id));
      const fuzzyMatches = all.filter((g) => !substringIds.has(g.id) && isFuzzyNameMatch(query, g.name));
      matches = [...substringMatches, ...fuzzyMatches];
    }
    res.json(matches.slice(0, 8).map((g) => ({ id: g.id, name: g.name, group: g.group, rsvpStatus: g.rsvpStatus })));
  });

  app.post("/api/events/public/:shareSlug/guests/:guestId/rsvp", async (req, res) => {
    const event = await storage.getEventByShareSlug(req.params.shareSlug);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const guestId = Number(req.params.guestId);
    const guest = await storage.getGuest(guestId);
    if (!guest || guest.eventId !== event.id) return res.status(404).json({ error: "Guest not found" });

    const parsed = rsvpSubmitSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });

    let attendingAdults = parsed.data.attendingAdults;
    let attendingChildren = parsed.data.attendingChildren;
    let attendingCount = parsed.data.attendingCount;

    if ((parsed.data.status === "yes" || parsed.data.status === "maybe") && (attendingAdults != null || attendingChildren != null)) {
      // Enforce the host's RSVP restriction server-side too, in case the
      // client is bypassed. Mirrors the logic in the RSVP page UI.
      attendingAdults = Math.max(1, attendingAdults ?? 1);
      attendingChildren = Math.max(0, attendingChildren ?? 0);
      if (event.rsvpRestriction === "no_children") {
        attendingChildren = 0;
      } else if (event.rsvpRestriction === "plus_one") {
        const total = attendingAdults + attendingChildren;
        if (total > 2) {
          const overflow = total - 2;
          attendingChildren = Math.max(0, attendingChildren - overflow);
          attendingAdults = Math.min(attendingAdults, 2 - attendingChildren);
        }
      } else if (event.rsvpRestriction === "no_additional_guests") {
        attendingAdults = 1;
        attendingChildren = 0;
      }
      attendingCount = attendingAdults + attendingChildren;
    } else if (parsed.data.status === "no") {
      attendingAdults = 0;
      attendingChildren = 0;
      attendingCount = 0;
    }

    const updated = await storage.updateGuest(event.id, guestId, {
      rsvpStatus: parsed.data.status,
      attendingCount: attendingCount ?? (parsed.data.status === "yes" ? guest.partySize : parsed.data.status === "maybe" ? guest.partySize : 0),
      attendingAdults: attendingAdults ?? null,
      attendingChildren: attendingChildren ?? null,
      note: parsed.data.note ?? guest.note,
      respondedAt: Date.now(),
    });
    res.json(updated);
  });

  /* ============ GUESTS: OWNER MANAGEMENT ============ */
  app.get("/api/events/owner/:ownerToken/guests", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    res.json(await storage.listGuests(event.id));
  });

  app.post("/api/events/owner/:ownerToken/guests", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const parsed = insertGuestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const guest = await storage.createGuest(event.id, parsed.data);
    res.json(guest);
  });

  app.patch("/api/events/owner/:ownerToken/guests/:guestId", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const parsed = updateGuestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const updated = await storage.updateGuest(event.id, Number(req.params.guestId), parsed.data);
    if (!updated) return res.status(404).json({ error: "Guest not found" });
    res.json(updated);
  });

  app.post("/api/events/owner/:ownerToken/guests/:guestId/mark-invited", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const updated = await storage.updateGuest(event.id, Number(req.params.guestId), { invitedAt: Date.now() });
    if (!updated) return res.status(404).json({ error: "Guest not found" });
    res.json(updated);
  });

  app.delete("/api/events/owner/:ownerToken/guests/:guestId", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const ok = await storage.deleteGuest(event.id, Number(req.params.guestId));
    if (!ok) return res.status(404).json({ error: "Guest not found" });
    res.json({ success: true });
  });

  /* ============ BUDGET ITEMS ============ */
  app.get("/api/events/owner/:ownerToken/budget-items", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    res.json(await storage.listBudgetItems(event.id));
  });

  app.post("/api/events/owner/:ownerToken/budget-items", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const parsed = insertBudgetItemSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const item = await storage.createBudgetItem(event.id, parsed.data);
    res.json(item);
  });

  app.post("/api/events/owner/:ownerToken/budget-items/bulk", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const parsed = z.object({ items: z.array(insertBudgetItemSchema) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const created = await storage.createBudgetItemsBulk(event.id, parsed.data.items);
    res.json(created);
  });

  // AI budget starter: proposes a headcount/theme-scaled line-item breakdown
  // the host reviews and picks from, rather than auto-writing their budget.
  app.post("/api/events/owner/:ownerToken/budget/generate-suggestions", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const headcount = Math.max(0, Math.round(Number(req.body?.headcount) || 0));
    try {
      const suggestion = await generateBudgetSuggestionAi({
        eventName: event.eventName,
        eventType: event.eventType,
        themeName: event.themeName,
        headcount,
        targetBudget: event.budgetTotal ?? null,
      });
      res.json(suggestion);
    } catch (err) {
      console.error("Budget suggestion AI failed:", err);
      res.status(502).json({ error: "Couldn't generate budget suggestions right now. Please try again." });
    }
  });

  app.patch("/api/events/owner/:ownerToken/budget-items/:itemId", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const parsed = updateBudgetItemSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const updated = await storage.updateBudgetItem(event.id, Number(req.params.itemId), parsed.data);
    if (!updated) return res.status(404).json({ error: "Budget item not found" });
    res.json(updated);
  });

  app.delete("/api/events/owner/:ownerToken/budget-items/:itemId", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const ok = await storage.deleteBudgetItem(event.id, Number(req.params.itemId));
    if (!ok) return res.status(404).json({ error: "Budget item not found" });
    res.json({ success: true });
  });

  /* ============ MENU ITEMS ============ */
  app.get("/api/events/owner/:ownerToken/menu-items", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    res.json(await storage.listMenuItems(event.id));
  });

  app.post("/api/events/owner/:ownerToken/menu-items", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const parsed = insertMenuItemSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const item = await storage.createMenuItem(event.id, parsed.data);
    res.json(item);
  });

  app.patch("/api/events/owner/:ownerToken/menu-items/:itemId", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const parsed = updateMenuItemSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const updated = await storage.updateMenuItem(event.id, Number(req.params.itemId), parsed.data);
    if (!updated) return res.status(404).json({ error: "Menu item not found" });
    res.json(updated);
  });

  // Bulk-add from theme-adaptive suggestions
  app.post("/api/events/owner/:ownerToken/menu-items/bulk", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const parsed = z.object({ items: z.array(insertMenuItemSchema) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const created = await Promise.all(parsed.data.items.map((item) => storage.createMenuItem(event.id, item)));
    res.json(created);
  });

  app.delete("/api/events/owner/:ownerToken/menu-items/:itemId", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const ok = await storage.deleteMenuItem(event.id, Number(req.params.itemId));
    if (!ok) return res.status(404).json({ error: "Menu item not found" });
    res.json({ success: true });
  });

  /* ============ SHOPPING & PACKING LIST ============ */
  app.get("/api/events/owner/:ownerToken/shopping-items", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    res.json(await storage.listShoppingListItems(event.id));
  });

  app.post("/api/events/owner/:ownerToken/shopping-items", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const parsed = insertShoppingListItemSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const item = await storage.createShoppingListItem(event.id, parsed.data);
    res.json(item);
  });

  // Bulk-add from the curated "commonly forgotten items" resource list
  app.post("/api/events/owner/:ownerToken/shopping-items/bulk", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const parsed = z.object({ items: z.array(insertShoppingListItemSchema) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const created = await storage.createShoppingListItemsBulk(event.id, parsed.data.items);
    res.json(created);
  });

  app.patch("/api/events/owner/:ownerToken/shopping-items/:itemId", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const parsed = updateShoppingListItemSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const updated = await storage.updateShoppingListItem(event.id, Number(req.params.itemId), parsed.data);
    if (!updated) return res.status(404).json({ error: "Shopping item not found" });
    res.json(updated);
  });

  app.delete("/api/events/owner/:ownerToken/shopping-items/:itemId", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const ok = await storage.deleteShoppingListItem(event.id, Number(req.params.itemId));
    if (!ok) return res.status(404).json({ error: "Shopping item not found" });
    res.json({ success: true });
  });

  /* ============ EVENT-DAY TIMELINE ============ */
  app.get("/api/events/owner/:ownerToken/timeline-items", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    res.json(await storage.listTimelineItems(event.id));
  });

  app.post("/api/events/owner/:ownerToken/timeline-items", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const parsed = insertTimelineItemSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const item = await storage.createTimelineItem(event.id, parsed.data);
    res.json(item);
  });

  // Bulk-add from a curated run-of-show template for the event's type
  app.post("/api/events/owner/:ownerToken/timeline-items/bulk", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const parsed = z.object({ items: z.array(insertTimelineItemSchema) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const created = await storage.createTimelineItemsBulk(event.id, parsed.data.items);
    res.json(created);
  });

  app.patch("/api/events/owner/:ownerToken/timeline-items/:itemId", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const parsed = updateTimelineItemSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
    const updated = await storage.updateTimelineItem(event.id, Number(req.params.itemId), parsed.data);
    if (!updated) return res.status(404).json({ error: "Timeline item not found" });
    res.json(updated);
  });

  app.delete("/api/events/owner/:ownerToken/timeline-items/:itemId", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const ok = await storage.deleteTimelineItem(event.id, Number(req.params.itemId));
    if (!ok) return res.status(404).json({ error: "Timeline item not found" });
    res.json({ success: true });
  });

  /* ============ THEME-ADAPTIVE SUGGESTIONS ============ */
  // Given the event's theme text, returns ready-to-use menu/décor/timeline
  // ideas and a palette. Checks the curated library first (instant, free),
  // then a DB cache of prior AI generations, then falls back to an LLM call
  // for themes outside the library — always caching the AI result and always
  // including a Pinterest search link as a permanent fallback resource.
  app.post("/api/events/owner/:ownerToken/theme-suggestions", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });

    const parsed = z.object({ theme: z.string().min(1).max(120) }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Please enter a theme first." });
    const rawTheme = parsed.data.theme.trim();

    const libraryMatch = matchThemeLibrary(rawTheme);
    if (libraryMatch) {
      return res.json(libraryEntryToSuggestion(libraryMatch, rawTheme));
    }

    const eventType = event.eventType || "";
    const cacheKey = `${rawTheme.toLowerCase()}::${eventType.toLowerCase()}`;
    const cached = await storage.getThemeSuggestionCache(cacheKey);
    if (cached) {
      try {
        const suggestion: ThemeSuggestion = JSON.parse(cached.suggestionsJson);
        return res.json(suggestion);
      } catch {
        // fall through to regenerate if the cached JSON is somehow corrupt
      }
    }

    try {
      const suggestion = await generateThemeSuggestionAi(rawTheme, eventType);
      await storage.setThemeSuggestionCache(cacheKey, rawTheme, eventType, JSON.stringify(suggestion));
      res.json(suggestion);
    } catch (err) {
      // If we can't automate it, always still hand back a usable resource link
      // per the "if we can't automate it, include a resource" principle.
      res.status(200).json({
        theme: rawTheme,
        source: "resource-only",
        paletteColors: [],
        menuIdeas: [],
        shoppingIdeas: [],
        timelineIdeas: [],
        budgetTip: "",
        resourceUrl: buildResourceUrl(rawTheme),
        error: "We couldn't generate custom ideas for this theme right now, but here's a curated search to get you started.",
      });
    }
  });

  /* ============ AUTOMATED INVITE EMAIL SENDING ============ */
  // Sends via Resend (see server/email.ts). Requires RESEND_API_KEY (and a
  // verified sending domain via RESEND_FROM_EMAIL) to be configured.
  app.post("/api/events/owner/:ownerToken/guests/:guestId/send-email", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const guest = await storage.getGuest(Number(req.params.guestId));
    if (!guest || guest.eventId !== event.id) return res.status(404).json({ error: "Guest not found" });
    if (!guest.email) return res.status(400).json({ error: "This guest has no email address on file" });

    const rsvpOrigin = String(req.body?.origin || "");
    const rsvpUrl = rsvpOrigin ? `${rsvpOrigin}/rsvp/${event.shareSlug}` : `/rsvp/${event.shareSlug}`;
    const tokenCtx = { guestName: guest.name.split(" ")[0] || guest.name, eventName: event.eventName, eventDate: event.eventDate, location: event.location, hostNames: event.hostNames };
    const rawMessage = event.inviteMessage || `We'd love for you to join us for ${event.eventName}.`;
    const withGreeting = rawMessage.includes("{{guestName}}") ? rawMessage : `Hi {{guestName}},\n\n${rawMessage}`;
    const base = applyInviteTokens(withGreeting, tokenCtx);
    const body = `${base}\n\nPlease RSVP here: ${rsvpUrl}\n\nCan't wait to celebrate with you!`;
    const subject = applyInviteTokens(event.inviteSubject || `You're invited: ${event.eventName}`, tokenCtx);

    const result = await sendInviteEmail({ to: guest.email, subject, body });
    if (!result.ok) {
      await storage.updateGuest(event.id, guest.id, { emailSendError: result.error || "Failed to send" });
      return res.status(502).json({ error: result.error || "Failed to send email", authUrl: result.authUrl });
    }
    const updated = await storage.updateGuest(event.id, guest.id, {
      emailSentAt: Date.now(),
      emailSendError: "",
      invitedAt: guest.invitedAt ?? Date.now(),
    });
    res.json(updated);
  });

  app.post("/api/events/owner/:ownerToken/guests/send-bulk-email", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const allGuests = await storage.listGuests(event.id);
    const rsvpOrigin = String(req.body?.origin || "");
    const rsvpUrl = rsvpOrigin ? `${rsvpOrigin}/rsvp/${event.shareSlug}` : `/rsvp/${event.shareSlug}`;
    const rawSubject = event.inviteSubject || `You're invited: ${event.eventName}`;
    const targets = allGuests.filter((g) => g.email && !g.emailSentAt);

    const results: { guestId: number; name: string; ok: boolean; error?: string }[] = [];
    const rawMessage = event.inviteMessage || `We'd love for you to join us for ${event.eventName}.`;
    const messageTemplate = rawMessage.includes("{{guestName}}") ? rawMessage : `Hi {{guestName}},\n\n${rawMessage}`;
    for (const guest of targets) {
      const tokenCtx = { guestName: guest.name.split(" ")[0] || guest.name, eventName: event.eventName, eventDate: event.eventDate, location: event.location, hostNames: event.hostNames };
      const base = applyInviteTokens(messageTemplate, tokenCtx);
      const subject = applyInviteTokens(rawSubject, tokenCtx);
      const body = `${base}\n\nPlease RSVP here: ${rsvpUrl}\n\nCan't wait to celebrate with you!`;
      const result = await sendInviteEmail({ to: guest.email, subject, body });
      if (result.ok) {
        await storage.updateGuest(event.id, guest.id, {
          emailSentAt: Date.now(),
          emailSendError: "",
          invitedAt: guest.invitedAt ?? Date.now(),
        });
        results.push({ guestId: guest.id, name: guest.name, ok: true });
      } else {
        await storage.updateGuest(event.id, guest.id, { emailSendError: result.error || "Failed to send" });
        results.push({ guestId: guest.id, name: guest.name, ok: false, error: result.error });
        // If auth is required, stop the batch early — retrying more sends won't help.
        if (result.authUrl) break;
      }
    }
    res.json({ attempted: targets.length, results });
  });

  /* ============ RSVP REMINDER EMAIL ============ */
  // Sends a shorter nudge (not the full invite) to guests who are still
  // "pending" and have an email on file, referencing the RSVP deadline.
  app.post("/api/events/owner/:ownerToken/guests/send-reminder-email", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const allGuests = await storage.listGuests(event.id);
    const rsvpOrigin = String(req.body?.origin || "");
    const rsvpUrl = rsvpOrigin ? `${rsvpOrigin}/rsvp/${event.shareSlug}` : `/rsvp/${event.shareSlug}`;
    const targets = allGuests.filter((g) => g.email && g.rsvpStatus === "pending");
    const deadlineLine = event.rsvpDeadline ? `We'd love to hear back by ${event.rsvpDeadline}.` : "We'd love to hear back from you soon.";

    const results: { guestId: number; name: string; ok: boolean; error?: string }[] = [];
    for (const guest of targets) {
      const greetingName = guest.name.split(" ")[0] || guest.name;
      const subject = `Reminder: RSVP for ${event.eventName}`;
      const body = `Hi ${greetingName},\n\nJust a friendly reminder to RSVP for ${event.eventName}. ${deadlineLine}\n\nRSVP here: ${rsvpUrl}\n\nThanks so much!`;
      const result = await sendInviteEmail({ to: guest.email, subject, body });
      if (result.ok) {
        await storage.updateGuest(event.id, guest.id, { emailSendError: "" });
        results.push({ guestId: guest.id, name: guest.name, ok: true });
      } else {
        await storage.updateGuest(event.id, guest.id, { emailSendError: result.error || "Failed to send" });
        results.push({ guestId: guest.id, name: guest.name, ok: false, error: result.error });
        if (result.authUrl) break;
      }
    }
    res.json({ attempted: targets.length, results });
  });

  /* ============ SMS RSVP REMINDERS ============ */
  // SMS consent is separate and optional (see /sms-terms) — a guest opting
  // in to SMS is never inferred from an RSVP or having a phone on file.
  // This endpoint is the only way smsOptIn gets set to true, and it's
  // guest-initiated from the public RSVP page, never pre-checked by a host.
  app.post("/api/events/public/:shareSlug/guests/:guestId/sms-opt-in", async (req, res) => {
    const event = await storage.getEventByShareSlug(req.params.shareSlug);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const guest = await storage.getGuest(Number(req.params.guestId));
    if (!guest || guest.eventId !== event.id) return res.status(404).json({ error: "Guest not found" });

    const optIn = Boolean(req.body?.optIn);
    const phone = typeof req.body?.phone === "string" ? req.body.phone.trim() : undefined;
    if (optIn && !(phone || guest.phone)) {
      return res.status(400).json({ error: "A phone number is needed to opt in to texts" });
    }

    const updated = await storage.updateGuest(event.id, guest.id, {
      ...(phone ? { phone } : {}),
      smsOptIn: optIn,
      smsConsentAt: optIn ? Date.now() : null,
    });
    res.json(updated);
  });

  // Sends via Twilio (see server/sms.ts). Requires TWILIO_ACCOUNT_SID,
  // TWILIO_AUTH_TOKEN, and a Messaging Service (TWILIO_MESSAGING_SERVICE_SID)
  // to be configured. Only ever sends to guests with smsOptIn === true.
  app.post("/api/events/owner/:ownerToken/guests/:guestId/send-sms", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const guest = await storage.getGuest(Number(req.params.guestId));
    if (!guest || guest.eventId !== event.id) return res.status(404).json({ error: "Guest not found" });
    if (!guest.smsOptIn) return res.status(400).json({ error: "This guest hasn't opted in to text messages" });
    if (!guest.phone) return res.status(400).json({ error: "This guest has no phone number on file" });

    const rsvpOrigin = String(req.body?.origin || "");
    const rsvpUrl = rsvpOrigin ? `${rsvpOrigin}/rsvp/${event.shareSlug}` : `/rsvp/${event.shareSlug}`;
    const greetingName = guest.name.split(" ")[0] || guest.name;
    const deadlineLine = event.rsvpDeadline ? ` by ${event.rsvpDeadline}` : "";
    const body = `Hi ${greetingName}, just a reminder to RSVP for ${event.eventName}${deadlineLine}: ${rsvpUrl}\n\nReply STOP to opt out.`;

    const result = await sendReminderSms({ to: guest.phone, body });
    if (!result.ok) {
      await storage.updateGuest(event.id, guest.id, { smsSendError: result.error || "Failed to send" });
      return res.status(502).json({ error: result.error || "Failed to send text" });
    }
    const updated = await storage.updateGuest(event.id, guest.id, { smsSentAt: Date.now(), smsSendError: "" });
    res.json(updated);
  });

  app.post("/api/events/owner/:ownerToken/guests/send-reminder-sms", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const allGuests = await storage.listGuests(event.id);
    const rsvpOrigin = String(req.body?.origin || "");
    const rsvpUrl = rsvpOrigin ? `${rsvpOrigin}/rsvp/${event.shareSlug}` : `/rsvp/${event.shareSlug}`;
    const deadlineLine = event.rsvpDeadline ? ` by ${event.rsvpDeadline}` : "";
    const targets = allGuests.filter((g) => g.smsOptIn && g.phone && g.rsvpStatus === "pending");

    const results: { guestId: number; name: string; ok: boolean; error?: string }[] = [];
    for (const guest of targets) {
      const greetingName = guest.name.split(" ")[0] || guest.name;
      const body = `Hi ${greetingName}, just a reminder to RSVP for ${event.eventName}${deadlineLine}: ${rsvpUrl}\n\nReply STOP to opt out.`;
      const result = await sendReminderSms({ to: guest.phone, body });
      if (result.ok) {
        await storage.updateGuest(event.id, guest.id, { smsSentAt: Date.now(), smsSendError: "" });
        results.push({ guestId: guest.id, name: guest.name, ok: true });
      } else {
        await storage.updateGuest(event.id, guest.id, { smsSendError: result.error || "Failed to send" });
        results.push({ guestId: guest.id, name: guest.name, ok: false, error: result.error });
      }
    }
    res.json({ attempted: targets.length, results });
  });

  /* ============ AI INVITE TONE GENERATOR ============ */
  app.get("/api/invite-tones", async (_req, res) => {
    res.json(INVITE_TONES);
  });

  app.post("/api/events/owner/:ownerToken/invite/generate-tone", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const tone = String(req.body?.tone || "");
    if (!INVITE_TONES.some((t) => t.value === tone)) {
      return res.status(400).json({ error: "Unknown tone" });
    }
    try {
      const generated = await generateInviteToneAi({
        tone: tone as InviteTone,
        eventName: event.eventName,
        eventType: event.eventType,
        eventDate: event.eventDate,
        location: event.location,
        hostNames: event.hostNames,
        themeName: event.themeName,
      });
      res.json(generated);
    } catch (err) {
      res.status(502).json({ error: "Couldn't generate invite text right now — please try again." });
    }
  });

  /* ============ EVENT DNA ============ */
  // A quiet, per-event style profile inferred from choices already made
  // elsewhere in the app (menu sourcing, budget allocation, event type, any
  // applied invitation design) — never a form or quiz the host fills out.
  // Computed fresh on every read (see shared/eventDna.ts), never stored, so
  // it can never drift from the event's current data. Read-only: there is no
  // route to edit it directly, by design.
  async function getEventDnaProfile(ownerToken: string, event: Event) {
    const [menuItems, budgetItems] = await Promise.all([
      storage.listMenuItems(event.id),
      storage.listBudgetItems(event.id),
    ]);
    const appliedConcept = parseInviteDesignConcept(event.inviteDesignConceptJson);
    return computeEventDna({
      eventType: event.eventType,
      menuItems,
      budgetItems,
      appliedConceptDnaHints: appliedConcept?.dnaHints,
    });
  }

  app.get("/api/events/owner/:ownerToken/dna", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    res.json(await getEventDnaProfile(req.params.ownerToken, event));
  });

  // Guest-count + Event DNA driven default for which invite tone (see
  // shared/inviteTokens.ts's INVITE_TONES) best fits this party (backlog
  // #26). Purely rule-based read of data computed elsewhere — no AI cost.
  app.get("/api/events/owner/:ownerToken/invite-format-recommendation", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const dnaProfile = await getEventDnaProfile(req.params.ownerToken, event);
    const guests = await storage.listGuests(event.id);
    const guestCount = guests.reduce((sum, g) => sum + g.partySize, 0);
    res.json({ recommendation: recommendInviteFormat(dnaProfile, guestCount) });
  });

  /* ============ CROSS-MODULE CONTRADICTIONS ============ */
  // Flags places where two choices made in different parts of the app quietly
  // disagree with each other (see shared/contradictions.ts). Purely rule-based
  // — no AI call — computed fresh on every read, never stored.
  app.get("/api/events/owner/:ownerToken/contradictions", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const [guests, menuItems, budgetItems] = await Promise.all([
      storage.listGuests(event.id),
      storage.listMenuItems(event.id),
      storage.listBudgetItems(event.id),
    ]);
    const appliedConcept = parseInviteDesignConcept(event.inviteDesignConceptJson);
    const contradictions = detectContradictions({
      eventType: event.eventType,
      budgetTotal: event.budgetTotal,
      guests,
      menuItems,
      budgetItems,
      appliedConceptDnaHints: appliedConcept?.dnaHints,
    });
    res.json({ contradictions });
  });

  /* ============ EVENT READINESS SCORE ============ */
  // One synthesized 0-100 number combining budget health, menu completeness,
  // RSVP response rate, shopping-list coverage, and timeline planning (see
  // shared/readinessScore.ts). Purely rule-based — no AI call — computed
  // fresh on every read, never stored.
  app.get("/api/events/owner/:ownerToken/readiness", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const [guests, menuItems, budgetItems, shoppingItems, timelineItems] = await Promise.all([
      storage.listGuests(event.id),
      storage.listMenuItems(event.id),
      storage.listBudgetItems(event.id),
      storage.listShoppingListItems(event.id),
      storage.listTimelineItems(event.id),
    ]);
    const readiness = computeReadinessScore({
      budgetTotal: event.budgetTotal,
      budgetItems,
      menuItems,
      guests,
      shoppingItems,
      timelineItems,
    });
    res.json(readiness);
  });

  /* ============ TIMELINE CONFLICT DETECTION ============ */
  // Flags scheduling problems within the day-of timeline itself — items at
  // the exact same clock time, or items whose running order disagrees with
  // their actual times (see shared/timelineConflicts.ts). Purely rule-based
  // — no AI call — computed fresh on every read, never stored.
  app.get("/api/events/owner/:ownerToken/timeline-conflicts", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const timelineItems = await storage.listTimelineItems(event.id);
    const conflicts = detectTimelineConflicts(timelineItems);
    res.json({ conflicts });
  });

  /* ============ MISSING-ITEM DETECTION ============ */
  // Cross-references the shopping list against a curated "commonly
  // forgotten" resource and invited headcount (see shared/missingItems.ts).
  // Purely rule-based — no AI call — computed fresh on every read, never
  // stored.
  app.get("/api/events/owner/:ownerToken/missing-items", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const [shoppingItems, guests] = await Promise.all([
      storage.listShoppingListItems(event.id),
      storage.listGuests(event.id),
    ]);
    const suggestions = detectMissingItems({ shoppingItems, guests });
    res.json({ suggestions });
  });

  /* ============ MENU-TO-THEME COHERENCE ============ */
  // Flags when the host's theme doesn't show up anywhere in the menu they
  // have built so far (see shared/menuThemeCoherence.ts). Resolves the
  // theme match and keyword vocabulary here via the same curated Theme
  // Library the Theme tab's idea generator uses (./themeLibrary.ts), then
  // hands off to the shared, framework-agnostic checker. Purely rule-based
  // — no AI call — computed fresh on every read, never stored.
  app.get("/api/events/owner/:ownerToken/menu-theme-coherence", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const menuItems = await storage.listMenuItems(event.id);
    const matchedEntry = matchThemeLibrary(event.themeName);
    const flags = detectMenuThemeCoherence({
      matchedThemeLabel: matchedEntry?.label ?? null,
      themeKeywords: matchedEntry?.keywords ?? [],
      menuItems,
    });
    res.json({ flags });
  });

  /* ============ BUDGET-FEASIBILITY SCORING ============ */
  // Compares what's actually budgeted per category against a rough,
  // hardcoded "typical for a group this size" benchmark (see
  // shared/budgetFeasibility.ts). Purely rule-based — no AI call — computed
  // fresh on every read, never stored.
  app.get("/api/events/owner/:ownerToken/budget-feasibility", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const [budgetItems, guests] = await Promise.all([
      storage.listBudgetItems(event.id),
      storage.listGuests(event.id),
    ]);
    const feasibility = assessBudgetFeasibility({ budgetItems, guests });
    res.json(feasibility);
  });

  /* ============ INVITATION INTELLIGENCE ============ */
  // Normalizes the optional inspirationImages field from a request body into
  // at most 3 non-empty data-URL strings (validation of the data URL itself
  // happens in extractInspirationNotes).
  function readInspirationImages(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    return value.filter((x): x is string => typeof x === "string" && x.startsWith("data:image/")).slice(0, 3);
  }

  // Generates 4 coordinated design concepts (palette + font pairing + border
  // + layout + illustration idea) from a free-text theme prompt. Text-only —
  // no image is generated yet, so a host can browse all 4 cheaply.
  app.post("/api/events/owner/:ownerToken/invite/generate-concepts", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const themePrompt = String(req.body?.themePrompt || "").trim();
    if (!themePrompt) return res.status(400).json({ error: "themePrompt is required" });
    const inspirationImages = readInspirationImages(req.body?.inspirationImages);
    try {
      const dnaProfile = await getEventDnaProfile(req.params.ownerToken, event);
      const guests = await storage.listGuests(event.id);
      const guestCount = guests.reduce((sum, g) => sum + g.partySize, 0);
      const formatRecommendation = recommendInviteFormat(dnaProfile, guestCount);
      const inspirationNotes = inspirationImages.length > 0 ? await extractInspirationNotes(inspirationImages) : "";
      const concepts = await generateInviteDesignConcepts({
        themePrompt,
        eventName: event.eventName,
        eventType: event.eventType,
        eventDate: event.eventDate,
        location: event.location,
        hostNames: event.hostNames,
        themeName: event.themeName,
        dnaSummary: dnaSummaryForPrompt(dnaProfile),
        formatGuidance: formatRecommendation?.conceptGuidance ?? null,
        inspirationNotes: inspirationNotes || null,
        preferredStyleLanes: Array.isArray(req.body?.preferredStyleLanes) ? req.body.preferredStyleLanes.filter((x: unknown) => typeof x === "string") : null,
      });
      res.json({ concepts, dnaProfile, inspirationNotes: inspirationNotes || undefined });
    } catch (err) {
      res.status(502).json({ error: "Couldn't generate design concepts right now — please try again." });
    }
  });

  // "Not quite right?" refinement pass: takes the 4 concepts a host has already
  // seen plus plain-English feedback ("more elegant", "less busy", …) and
  // regenerates 4 NEW concepts that address the feedback while keeping the same
  // theme/event details. Text-only, same response shape as generate-concepts.
  app.post("/api/events/owner/:ownerToken/invite/refine-concepts", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const feedback = String(req.body?.feedback || "").trim();
    if (!feedback) return res.status(400).json({ error: "feedback is required" });
    const previousConcepts = Array.isArray(req.body?.previousConcepts)
      ? (req.body.previousConcepts as unknown[]).filter(isValidInviteDesignConcept)
      : [];
    const themePrompt = String(req.body?.themePrompt || "").trim() || event.themeName || feedback;
    const inspirationImages = readInspirationImages(req.body?.inspirationImages);
    try {
      const dnaProfile = await getEventDnaProfile(req.params.ownerToken, event);
      const guests = await storage.listGuests(event.id);
      const guestCount = guests.reduce((sum, g) => sum + g.partySize, 0);
      const formatRecommendation = recommendInviteFormat(dnaProfile, guestCount);
      const inspirationNotes = inspirationImages.length > 0 ? await extractInspirationNotes(inspirationImages) : "";
      const concepts = await generateInviteDesignConcepts({
        themePrompt,
        eventName: event.eventName,
        eventType: event.eventType,
        eventDate: event.eventDate,
        location: event.location,
        hostNames: event.hostNames,
        themeName: event.themeName,
        dnaSummary: dnaSummaryForPrompt(dnaProfile),
        formatGuidance: formatRecommendation?.conceptGuidance ?? null,
        previousConcepts,
        feedback,
        inspirationNotes: inspirationNotes || null,
      });
      res.json({ concepts, dnaProfile, inspirationNotes: inspirationNotes || undefined });
    } catch (err) {
      res.status(502).json({ error: "Couldn't refine design concepts right now — please try again." });
    }
  });

  // Generates a concept's illustration WITHOUT committing it — lets a host
  // preview the real AI artwork on a card before deciding which of the 4
  // concepts to apply. Uses the exact same generator and aspect-ratio logic
  // as apply-concept, but never writes to the event; the client caches the
  // returned url and passes it back on apply so the image isn't regenerated.
  app.post("/api/events/owner/:ownerToken/invite/preview-concept", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const concept = req.body?.concept;
    if (!isValidInviteDesignConcept(concept)) {
      return res.status(400).json({ error: "Invalid design concept" });
    }
    try {
      const aspectRatio = concept.layoutStyle === "banner" ? "16:9" : concept.layoutStyle === "full-bleed" ? "9:16" : "1:1";
      let illustrationUrl: string | null = null;
      try {
        // First attempt at medium quality — fast, good enough for preview
        illustrationUrl = await generateInviteIllustration(concept, aspectRatio, "medium");
      } catch (firstErr) {
        console.error("preview-concept first attempt failed, retrying at low quality:", firstErr);
        try {
          // Silent retry at low quality — faster, more likely to succeed
          illustrationUrl = await generateInviteIllustration(concept, aspectRatio, "low");
        } catch (secondErr) {
          console.error("preview-concept retry also failed:", secondErr);
          // Return a graceful fallback instead of an error — the client shows
          // a styled CSS card with the concept's palette/fonts
          return res.json({ illustrationUrl: null, fallback: true });
        }
      }
      res.json({ illustrationUrl });
    } catch (err) {
      console.error("preview-concept unexpected error:", err);
      res.json({ illustrationUrl: null, fallback: true });
    }
  });

  // Applies one chosen concept: generates its bounded illustration (the only
  // image generated in this whole flow — kept cost-conscious by deferring
  // image generation until a concept is actually picked) and saves the
  // concept + illustration on the event so the invite, RSVP page, and
  // thank-you card all pick it up.
  app.post("/api/events/owner/:ownerToken/invite/apply-concept", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const concept = req.body?.concept;
    if (!isValidInviteDesignConcept(concept)) {
      return res.status(400).json({ error: "Invalid design concept" });
    }
    // A host may have already previewed this concept's artwork (see
    // preview-concept); if so the client sends that url back and we reuse it
    // rather than paying to regenerate the same image. Otherwise generate now.
    const preGenerated = typeof req.body?.illustrationUrl === "string" ? req.body.illustrationUrl : null;
    try {
      const aspectRatio = concept.layoutStyle === "banner" ? "16:9" : concept.layoutStyle === "full-bleed" ? "9:16" : "1:1";
      const illustrationUrl = preGenerated ?? (await generateInviteIllustrationWithQualityGate(concept, aspectRatio));
      // Coordinate the rest of the stationery suite from the concept's Theme
      // DNA so envelope/liner/stamp match by default. Pure derivation, no LLM
      // call. The host can override any of these later via the suite route.
      const dna = deriveThemeDna(concept);
      const updated = await storage.updateEventByOwnerToken(req.params.ownerToken, {
        inviteDesignConceptJson: JSON.stringify(concept),
        inviteIllustrationUrl: illustrationUrl,
        envelopeColor: dna.primaryColor,
        envelopeLinerPattern: dna.linerPattern,
        stampStyle: dna.stampStyle,
      });
      if (!updated) return res.status(404).json({ error: "Event not found" });
      res.json(updated);
    } catch (err) {
      console.error("apply-concept illustration generation failed:", err);
      res.status(502).json({ error: "Couldn't generate the illustration right now — please try again." });
    }
  });

  // Lets a host nudge individual colors on an already-applied concept
  // without regenerating the illustration (image generation only happens
  // on apply/change-design) — kept free for every plan tier.
  app.patch("/api/events/owner/:ownerToken/invite/concept-palette", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const appliedConcept = parseInviteDesignConcept(event.inviteDesignConceptJson);
    if (!appliedConcept) return res.status(400).json({ error: "No design concept is applied yet" });
    const paletteColors = req.body?.paletteColors;
    if (
      !Array.isArray(paletteColors) ||
      paletteColors.length !== 4 ||
      !paletteColors.every((c) => typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c))
    ) {
      return res.status(400).json({ error: "paletteColors must be an array of 4 hex colors" });
    }
    const updatedConcept = { ...appliedConcept, paletteColors };
    const updated = await storage.updateEventByOwnerToken(req.params.ownerToken, {
      inviteDesignConceptJson: JSON.stringify(updatedConcept),
    });
    if (!updated) return res.status(404).json({ error: "Event not found" });
    res.json(updated);
  });

  // Reverts to the manual invite styling fields (font/accent color pickers),
  // clearing any applied AI design concept.
  app.post("/api/events/owner/:ownerToken/invite/clear-concept", async (req, res) => {
    const updated = await storage.updateEventByOwnerToken(req.params.ownerToken, {
      inviteDesignConceptJson: "{}",
      inviteIllustrationUrl: "",
    });
    if (!updated) return res.status(404).json({ error: "Event not found" });
    res.json(updated);
  });

  // Host overrides for the coordinated stationery suite (envelope color,
  // liner pattern, stamp style). Only the fields actually supplied are
  // written, so each control can PATCH independently without clobbering the
  // others. Defaults come from the concept's Theme DNA on apply-concept.
  app.patch("/api/events/owner/:ownerToken/invite/suite", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });

    const updates: { envelopeColor?: string; envelopeLinerPattern?: string; stampStyle?: string; linerColor?: string; stampColor?: string } = {};

    if (req.body?.envelopeColor !== undefined) {
      const color = req.body.envelopeColor;
      if (typeof color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(color)) {
        return res.status(400).json({ error: "envelopeColor must be a hex color" });
      }
      updates.envelopeColor = color;
    }
    if (req.body?.envelopeLinerPattern !== undefined) {
      if (!isLinerPattern(req.body.envelopeLinerPattern)) {
        return res.status(400).json({ error: "envelopeLinerPattern must be one of: solid, dots, stripes, chevron, floral" });
      }
      updates.envelopeLinerPattern = req.body.envelopeLinerPattern;
    }
    if (req.body?.stampStyle !== undefined) {
      if (!isStampStyle(req.body.stampStyle)) {
        return res.status(400).json({ error: "stampStyle must be a valid stamp style" });
      }
      updates.stampStyle = req.body.stampStyle;
    }
    if (req.body?.linerColor !== undefined) {
      const color = req.body.linerColor;
      if (typeof color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(color)) {
        return res.status(400).json({ error: "linerColor must be a hex color" });
      }
      updates.linerColor = color;
    }
    if (req.body?.stampColor !== undefined) {
      const color = req.body.stampColor;
      if (typeof color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(color)) {
        return res.status(400).json({ error: "stampColor must be a hex color" });
      }
      updates.stampColor = color;
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ error: "No suite fields supplied" });
    }

    const updated = await storage.updateEventByOwnerToken(req.params.ownerToken, updates);
    if (!updated) return res.status(404).json({ error: "Event not found" });
    res.json(updated);
  });

  // Publish / unpublish the guest list. When "draft", the public RSVP page
  // shows a "not ready yet" message instead of the RSVP form. Defaults to
  // "published" so pre-existing events are unaffected.
  app.patch("/api/events/owner/:ownerToken/invite-status", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const status = req.body?.status;
    if (status !== "draft" && status !== "published") {
      return res.status(400).json({ error: "status must be 'draft' or 'published'" });
    }
    const updated = await storage.updateEventByOwnerToken(req.params.ownerToken, { inviteStatus: status });
    if (!updated) return res.status(404).json({ error: "Event not found" });
    res.json(updated);
  });

  // Update RSVP phone number (shown on public RSVP page for guests who
  // prefer to call or text instead of using the web form).
  app.patch("/api/events/owner/:ownerToken/rsvp-phone", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const phone = typeof req.body?.phone === "string" ? req.body.phone.trim() : "";
    const updated = await storage.updateEventByOwnerToken(req.params.ownerToken, { rsvpPhone: phone });
    if (!updated) return res.status(404).json({ error: "Event not found" });
    res.json(updated);
  });

  // ── Live Design Editor endpoint ───────────────────────────────────
  // Accepts partial updates to the applied concept's design fields
  // (font, layout, border, palette) and the invite text (subject, message).
  // All changes preserve the existing illustration — no regeneration.
  // Only fields actually supplied are written; missing fields stay as-is.
  app.patch("/api/events/owner/:ownerToken/invite/live-design", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const appliedConcept = parseInviteDesignConcept(event.inviteDesignConceptJson);
    if (!appliedConcept) return res.status(400).json({ error: "No design concept is applied yet" });

    const updates: Partial<InviteDesignConcept> = {};
    const eventUpdates: Record<string, string> = {};

    // Font pairing
    if (typeof req.body?.fontPairingId === "string") {
      if (!FONT_PAIRINGS.some((f) => f.id === req.body.fontPairingId)) {
        return res.status(400).json({ error: "Invalid fontPairingId" });
      }
      updates.fontPairingId = req.body.fontPairingId;
    }

    // Layout style
    if (typeof req.body?.layoutStyle === "string") {
      if (!(LAYOUT_STYLES as readonly string[]).includes(req.body.layoutStyle)) {
        return res.status(400).json({ error: "Invalid layoutStyle" });
      }
      updates.layoutStyle = req.body.layoutStyle as InviteDesignConcept["layoutStyle"];
    }

    // Border style
    if (typeof req.body?.borderStyle === "string") {
      if (!(BORDER_STYLES as readonly string[]).includes(req.body.borderStyle)) {
        return res.status(400).json({ error: "Invalid borderStyle" });
      }
      updates.borderStyle = req.body.borderStyle as InviteDesignConcept["borderStyle"];
    }

    // Palette colors (must be exactly 4 hex colors if supplied)
    if (Array.isArray(req.body?.paletteColors)) {
      const pc = req.body.paletteColors;
      if (pc.length !== 4 || !pc.every((c: unknown) => typeof c === "string" && /^#[0-9a-fA-F]{6}$/.test(c))) {
        return res.status(400).json({ error: "paletteColors must be an array of 4 hex colors" });
      }
      updates.paletteColors = pc;
    }

    // Invite subject text
    if (typeof req.body?.inviteSubject === "string") {
      eventUpdates.inviteSubject = req.body.inviteSubject.slice(0, 200);
    }

    // Invite message text
    if (typeof req.body?.inviteMessage === "string") {
      eventUpdates.inviteMessage = req.body.inviteMessage.slice(0, 1000);
    }

    // Merge concept updates into the stored JSON
    if (Object.keys(updates).length > 0) {
      const updatedConcept = { ...appliedConcept, ...updates };
      eventUpdates.inviteDesignConceptJson = JSON.stringify(updatedConcept);
    }

    if (Object.keys(eventUpdates).length === 0) {
      return res.json(event); // no-op
    }

    const updated = await storage.updateEventByOwnerToken(req.params.ownerToken, eventUpdates);
    if (!updated) return res.status(404).json({ error: "Event not found" });
    res.json(updated);
  });

  // "Upload my complete invitation design": the host already has a finished
  // invite (made elsewhere or bought) and wants it shown AS-IS — no Posy
  // border, font overlay, or palette. Distinct from "use your own photo",
  // which slots an image INTO a Posy concept template. The image is stored as
  // a data URI in a text column, exactly like inviteArtworkUrl and
  // inviteIllustrationUrl (the client compresses it via readImageFileAsDataUrl).
  app.patch("/api/events/owner/:ownerToken/invite/custom-design", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const imageDataUrl = req.body?.imageDataUrl;
    if (typeof imageDataUrl !== "string" || !imageDataUrl.startsWith("data:image/")) {
      return res.status(400).json({ error: "imageDataUrl must be an image data URL" });
    }
    const updated = await storage.updateEventByOwnerToken(req.params.ownerToken, {
      customInviteImageUrl: imageDataUrl,
      inviteRenderMode: "custom",
    });
    if (!updated) return res.status(404).json({ error: "Event not found" });
    res.json(updated);
  });

  // Switches back to Posy's concept-driven rendering. Deliberately
  // non-destructive: only inviteRenderMode is cleared, so the previously
  // applied concept AND the uploaded custom image both survive and the host
  // can toggle back and forth without losing either.
  app.patch("/api/events/owner/:ownerToken/invite/custom-design/clear", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const updated = await storage.updateEventByOwnerToken(req.params.ownerToken, {
      inviteRenderMode: "",
    });
    if (!updated) return res.status(404).json({ error: "Event not found" });
    res.json(updated);
  });

  /* ============ AI MASTER PLANNER ============ */
  // Kicks off the full first-draft generation sequence (theme + identity,
  // budget, menu, shopping, timeline, invitation design, and rule-based
  // checks) for an event. Gated by the free-draft entitlement (see
  // server/masterPlannerEntitlement.ts) so a host only ever spends their
  // one free automated draft once, with atomic reserve/resume semantics
  // that let a retry pick up from the last successfully completed stage
  // instead of re-running (and re-spending AI calls on) work that already
  // succeeded.
  app.post("/api/events/owner/:ownerToken/master-planner/generate", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });

    // Paid-access gate first: an event needs its Spark unlock (one-time) or
    // an active Plus subscription before it can draft a plan at all.
    const access = await canGenerateDraft(event.id);
    if (!access.ok) {
      return res.status(402).json({ error: "This event needs Spark or Plus to generate a plan." });
    }

    const reservation = await reserveOrResumeFreeDraft(event.id);
    if (!reservation.ok || !reservation.generation) {
      return res.status(409).json({ error: "This event's plan has already been generated." });
    }

    const generationId = reservation.generation.id;
    res.json({ generationId, draftStatus: "generating" });

    // Orchestration runs after the response is sent — the client polls
    // GET .../master-planner/status for progress. Errors are already
    // persisted onto the event/generation rows by the orchestrator itself
    // (draftStatus="failed_partial", generation.state="failed"), so this
    // catch only needs to stop an unhandled rejection from surfacing.
    runMasterPlannerOrchestration(event.id, generationId).catch((err) => {
      console.error(`Master Planner orchestration failed for event ${event.id}:`, err);
    });
  });

  // Polled by the loading screen to render its narrated checklist and to
  // know when to navigate on to the dashboard.
  app.get("/api/events/owner/:ownerToken/master-planner/status", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const generation = await storage.getLatestGenerationForEvent(event.id);
    res.json({
      draftStatus: event.draftStatus,
      draftStage: event.draftStage,
      completedStages: generation ? safeParseStages(generation.completedStages) : [],
      failedStage: generation?.failedStage ?? null,
    });
  });

  // Read-only summary of the event's free-draft / plan-tier state — feeds
  // the future upgrade-prompt UI (Phase 5), but reports honestly today.
  app.get("/api/events/owner/:ownerToken/master-planner/entitlement", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    const summary = await getEntitlementSummary(event.id);
    if (!summary) return res.status(404).json({ error: "Event not found" });
    res.json(summary);
  });

  // Captures the host's email onto an event so the entitlement gate can resolve
  // their Plus membership (canGenerateDraft looks up capturedEmail in
  // email_entitlements). This is the route referenced-but-never-built that left
  // captured_email NULL on every event. Ownership is proven the same way every
  // other event-mutation route proves it — a valid ownerToken — except the
  // token rides in the body here since the path is eventId-scoped per spec.
  // Never upserts into email_entitlements: Stripe checkout/webhook remain the
  // single source of truth for what a given email is actually entitled to.
  app.post("/api/events/:eventId/email-capture", async (req, res) => {
    const eventId = Number(req.params.eventId);
    if (!Number.isInteger(eventId)) return res.status(400).json({ error: "Invalid event id." });

    const email = typeof req.body?.email === "string" ? req.body.email : "";
    const ownerToken = typeof req.body?.ownerToken === "string" ? req.body.ownerToken : "";
    const normalized = email.trim().toLowerCase();
    // Basic plausibility check — real verification comes from the Stripe-side
    // stamping; this just rejects obvious garbage before touching storage.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
      return res.status(400).json({ error: "Please enter a valid email address." });
    }

    if (!ownerToken) return res.status(401).json({ error: "Missing ownerToken." });
    const event = await storage.getEventByOwnerToken(ownerToken);
    if (!event || event.id !== eventId) {
      return res.status(403).json({ error: "You don't have access to this event." });
    }

    // Don't silently clobber a different email already on the event — treat the
    // first captured email as authoritative and no-op on a mismatch. Blank or
    // an identical email falls through to the (idempotent) set.
    if (event.capturedEmail && event.capturedEmail !== normalized) {
      console.warn(`[email-capture] event ${eventId} already has a different captured email; ignoring new value`);
    } else {
      await storage.setEventCapturedEmail(eventId, normalized);
    }

    const summary = await getEntitlementSummary(eventId);
    if (!summary) return res.status(404).json({ error: "Event not found" });
    res.json(summary);
  });

  // Draft Overview (Design Spec §1, State 3) — the one-page synthesis a host
  // lands on right after generation finishes, before going into the familiar
  // six tabs. Deliberately has no storage of its own: everything here is
  // composed live from the same tables every other read in this file already
  // uses (event, budget/menu/timeline items, guests, readiness, contradiction/
  // missing-item/budget-feasibility checks). Persisting a second copy would
  // create a second source of truth that goes stale the moment someone edits
  // a tab, and deriving it live costs nothing extra at this data size.
  app.get("/api/events/owner/:ownerToken/master-planner/draft-overview", async (req, res) => {
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });

    const [guests, menuItems, budgetItems, shoppingItems, timelineItems] = await Promise.all([
      storage.listGuests(event.id),
      storage.listMenuItems(event.id),
      storage.listBudgetItems(event.id),
      storage.listShoppingListItems(event.id),
      storage.listTimelineItems(event.id),
    ]);

    // Budget: total + the 3 largest categories by allocated amount.
    const categoryTotals = new Map<string, number>();
    for (const item of budgetItems) {
      categoryTotals.set(item.category, (categoryTotals.get(item.category) ?? 0) + item.estimatedCost);
    }
    const topCategories = Array.from(categoryTotals.entries())
      .map(([category, total]) => ({ category, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 3);

    // Menu: 4-5 headline items, in the order the orchestrator generated them.
    const menuHighlights = [...menuItems]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .slice(0, 5)
      .map((m) => ({ id: m.id, itemName: m.itemName, course: m.course }));

    // Timeline: 3-4 highlights, not the full schedule. "Special Moments" items
    // surface first since they're the most narratively interesting, then the
    // remaining slots fill from the rest of the day in chronological order.
    const sortedTimeline = [...timelineItems].sort((a, b) => a.sortOrder - b.sortOrder);
    const specialMoments = sortedTimeline.filter((t) => t.category === "Special Moments");
    const rest = sortedTimeline.filter((t) => t.category !== "Special Moments");
    const timelineHighlights = [...specialMoments, ...rest]
      .slice(0, 4)
      .map((t) => ({ id: t.id, time: t.time, title: t.title, category: t.category }));

    // Applied invitation concept, for the small preview card.
    const appliedConcept = parseInviteDesignConcept(event.inviteDesignConceptJson);
    const invitationConcept = appliedConcept
      ? {
          conceptName: appliedConcept.conceptName,
          description: appliedConcept.description,
          paletteColors: appliedConcept.paletteColors,
          fontPairingLabel: getFontPairing(appliedConcept.fontPairingId).label,
          borderStyle: appliedConcept.borderStyle,
          layoutStyle: appliedConcept.layoutStyle,
          illustrationUrl: event.inviteIllustrationUrl || "",
        }
      : null;

    // Initial Readiness Score — same computation every other read of it uses.
    const readiness = computeReadinessScore({
      budgetTotal: event.budgetTotal,
      budgetItems,
      menuItems,
      guests,
      shoppingItems,
      timelineItems,
    });

    // "Things I'd double check" — a short, calm list (2-3 items max) pulled
    // from the same three rule-based check modules used elsewhere in the app,
    // combined here rather than shown as three separate feeds. Warnings surface
    // ahead of notices since they're the more actionable of the two.
    const appliedConceptForChecks = appliedConcept;
    const contradictions = detectContradictions({
      eventType: event.eventType,
      budgetTotal: event.budgetTotal,
      guests,
      menuItems,
      budgetItems,
      appliedConceptDnaHints: appliedConceptForChecks?.dnaHints,
    });
    const missingItemSuggestions = detectMissingItems({ shoppingItems, guests });
    const budgetFeasibility = assessBudgetFeasibility({ budgetItems, guests });
    const severityRank = (s: "notice" | "warning") => (s === "warning" ? 0 : 1);
    const thingsToDoubleCheck = [...contradictions, ...missingItemSuggestions, ...budgetFeasibility.flags]
      .sort((a, b) => severityRank(a.severity) - severityRank(b.severity))
      .slice(0, 3)
      .map((flag) => ({ id: flag.id, severity: flag.severity, title: flag.title, detail: flag.detail }));

    res.json({
      eventIdentity: event.eventIdentity,
      theme: {
        name: event.themeName,
        paletteColors: JSON.parse(event.paletteColors || "[]"),
      },
      budget: {
        total: event.budgetTotal,
        topCategories,
      },
      menuHighlights,
      timelineHighlights,
      invitationConcept,
      readiness,
      thingsToDoubleCheck,
    });
  });

  /* ============ CHECKOUT: STRIPE ============
     Two products:
     - Spark: one-time $9.99 payment that unlocks a single event's full plan.
     - Plus:  recurring subscription, $99/yr or $11.99/mo (no free trial).
     See PartyPilot_GTM_Strategy_Master.md (filename predates the Posy rebrand). */

  // Lets the frontend show a real checkout button vs. a graceful
  // "launching soon" state without ever hitting an error path.
  app.get("/api/checkout/config", (_req, res) => {
    res.json({ configured: isStripeConfigured() });
  });

  const checkoutSessionSchema = z.object({
    email: z.string().trim().email(),
    // Which product is being purchased. Defaults to "plus" so existing
    // callers that omit it keep the subscription behavior.
    plan: z.enum(["plus", "spark"]).default("plus"),
    billingInterval: z.enum(["annual", "monthly"]).default("annual"),
    // For Plus: the event a host was mid-build on, if they upgraded from
    // inside their dashboard rather than the standalone /pricing page.
    // For Spark: REQUIRED — the event's ownerToken, since a Spark purchase is
    // event-scoped. Carried through to success_url so checkout can send them
    // back to that event.
    returnToken: z.string().trim().optional(),
  });

  app.post("/api/checkout/create-session", async (req, res) => {
    const parsed = checkoutSessionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Please provide a valid email and billing option." });
    }
    const { email, plan, billingInterval, returnToken } = parsed.data;

    const stripe = getStripe();
    if (!stripe) {
      return res.status(503).json({ error: "Checkout isn't set up yet — please check back soon." });
    }

    const origin = `${req.protocol}://${req.get("host")}`;

    if (plan === "spark") {
      const sparkPriceId = getSparkPriceId();
      if (!sparkPriceId) {
        return res.status(503).json({ error: "Checkout isn't set up yet — please check back soon." });
      }
      // A Spark purchase always belongs to a specific event.
      if (!returnToken) {
        return res.status(400).json({ error: "This event couldn't be found for checkout. Please try again from your event." });
      }
      try {
        const session = await stripe.checkout.sessions.create({
          mode: "payment",
          customer_email: email,
          line_items: [{ price: sparkPriceId, quantity: 1 }],
          success_url: `${origin}/draft-generating/${encodeURIComponent(returnToken)}?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${origin}/draft-generating/${encodeURIComponent(returnToken)}?checkout=cancelled`,
          metadata: { plan: "spark", ownerToken: returnToken },
        });
        return res.json({ url: session.url });
      } catch (err) {
        console.error("Stripe Spark checkout session creation failed:", err);
        return res.status(502).json({ error: "Couldn't start checkout. Please try again." });
      }
    }

    // plan === "plus" — recurring subscription, no trial.
    const priceId = getPriceId(billingInterval);
    if (!priceId) {
      return res.status(503).json({ error: "Checkout isn't set up yet — please check back soon." });
    }

    // Reserve/refresh the entitlement row up front so the captured email
    // always has a row to update once the session completes, even if the
    // host abandons checkout before coming back.
    await storage.upsertEmailEntitlement(email, { billingInterval });

    try {
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer_email: email,
        line_items: [{ price: priceId, quantity: 1 }],
        payment_method_collection: "always",
        success_url: returnToken
          ? `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}&returnToken=${encodeURIComponent(returnToken)}`
          : `${origin}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: returnToken
          ? `${origin}/pricing?checkout=cancelled&returnToken=${encodeURIComponent(returnToken)}`
          : `${origin}/pricing?checkout=cancelled`,
        metadata: { plan: "plus", billingInterval, ...(returnToken ? { returnToken } : {}) },
      });
      res.json({ url: session.url });
    } catch (err) {
      console.error("Stripe checkout session creation failed:", err);
      res.status(502).json({ error: "Couldn't start checkout. Please try again." });
    }
  });

  // Pull-based confirmation: retrieves the session directly from Stripe and
  // activates the entitlement right on the success-page load, instead of
  // waiting on a webhook. Chosen because no stable production domain exists
  // yet to register a long-lived webhook endpoint against (see GTM doc).
  // Safe to call more than once for the same session — e.g. a page refresh
  // — without double-firing the analytics conversion event.
  app.get("/api/checkout/confirm", async (req, res) => {
    const sessionId = typeof req.query.sessionId === "string" ? req.query.sessionId : undefined;
    if (!sessionId) return res.status(400).json({ error: "Missing sessionId." });

    const stripe = getStripe();
    if (!stripe) return res.status(503).json({ error: "Checkout isn't set up yet." });

    try {
      const session = await stripe.checkout.sessions.retrieve(sessionId, { expand: ["subscription", "customer"] });
      if (session.status !== "complete") {
        return res.status(409).json({ error: "This checkout session hasn't completed yet." });
      }

      // Spark one-time purchase (mode: "payment") — no subscription. Unlock
      // the event named in metadata and report back so the success flow can
      // send the host into generation. Idempotent via markEventSparkUnlocked.
      if (session.mode === "payment") {
        const ownerToken = session.metadata?.ownerToken;
        const email = (session.customer_details?.email || session.customer_email || "").toLowerCase();
        if (!ownerToken) {
          return res.status(500).json({ error: "This checkout session is missing its event reference." });
        }
        const unlocked = await storage.markEventSparkUnlocked(ownerToken, session.id);
        // Defense-in-depth: stamp the Stripe-verified email onto the event so
        // the entitlement gate resolves Plus membership even if the client
        // /email-capture call never fired. Blank-or-same rule; never throws.
        if (unlocked) await stampCapturedEmailSafe(unlocked.id, email);
        // Server-side Purchase conversion (Meta CAPI). event_id = session.id so
        // it dedupes against the client Pixel fired on the success page.
        await sendMetaPurchaseEvent({
          email,
          phone: session.customer_details?.phone,
          value: CHECKOUT_PRICES.spark,
          currency: "USD",
          eventId: session.id,
          eventSourceUrl: req.get("referer") || undefined,
        });
        return res.json({
          plan: "spark",
          unlocked: true,
          email,
          returnToken: ownerToken,
          firedEvent: "spark_unlocked",
          eventId: session.id,
          value: CHECKOUT_PRICES.spark,
        });
      }

      if (!session.subscription || typeof session.subscription === "string") {
        return res.status(409).json({ error: "This checkout session hasn't completed yet." });
      }
      const subscription = session.subscription as Stripe.Subscription;
      const email = (session.customer_details?.email || session.customer_email || "").toLowerCase();
      if (!email) return res.status(500).json({ error: "No email on this checkout session." });

      const newPlanTier = planTierFromSubscriptionStatus(subscription.status);
      const billingInterval = session.metadata?.billingInterval as BillingInterval | undefined;
      const previous = await storage.getEmailEntitlement(email);
      const isNewTransition = previous?.planTier !== newPlanTier;

      const updated = await storage.upsertEmailEntitlement(email, {
        planTier: newPlanTier,
        stripeCustomerId: typeof session.customer === "string" ? session.customer : session.customer?.id,
        stripeSubscriptionId: subscription.id,
        billingInterval: billingInterval ?? previous?.billingInterval ?? null,
        trialStartedAt: subscription.trial_start ? subscription.trial_start * 1000 : previous?.trialStartedAt ?? null,
        trialEndsAt: subscription.trial_end ? subscription.trial_end * 1000 : previous?.trialEndsAt ?? null,
      });

      // Defense-in-depth: if this Plus checkout was started from inside a
      // specific event (returnToken carried through the session metadata),
      // stamp the verified email onto that event so its entitlement gate
      // immediately resolves the new Plus membership. Blank-or-same; no throw.
      const plusReturnToken = session.metadata?.returnToken;
      if (plusReturnToken) {
        const returnEvent = await storage.getEventByOwnerToken(plusReturnToken);
        if (returnEvent) await stampCapturedEmailSafe(returnEvent.id, email);
      }

      let firedEvent: "trial_started" | "subscribed" | null = null;
      if (isNewTransition) {
        if (newPlanTier === "plus_trial") {
          firedEvent = "trial_started";
        } else if (newPlanTier === "plus_active" && previous?.planTier !== "plus_trial") {
          // Trial → active (a trial converting to paid) is caught by the
          // webhook handler below once webhooks are live, not here — the
          // host is usually long gone from the success page by then.
          firedEvent = "subscribed";
        }
        if (firedEvent) {
          await storage.logAnalyticsEvent(firedEvent, { email, billingInterval: updated.billingInterval ?? undefined, metadata: { subscriptionId: subscription.id } });
          // Server-side Purchase conversion (Meta CAPI). event_id =
          // subscription.id so it dedupes against the client Pixel.
          await sendMetaPurchaseEvent({
            email,
            phone: session.customer_details?.phone,
            value: plusPriceValue(updated.billingInterval as BillingInterval | null),
            currency: "USD",
            eventId: subscription.id,
            eventSourceUrl: req.get("referer") || undefined,
          });
        }
      }

      res.json({
        plan: "plus",
        planTier: updated.planTier,
        trialEndsAt: updated.trialEndsAt,
        billingInterval: updated.billingInterval,
        firedEvent,
        eventId: subscription.id,
        value: plusPriceValue(updated.billingInterval as BillingInterval | null),
        email,
      });
    } catch (err) {
      console.error("Stripe checkout confirmation failed:", err);
      res.status(502).json({ error: "Couldn't confirm your checkout. Please contact support if this persists." });
    }
  });

  // Production-ready webhook handler. Posy's domain (posyplans.com) is now
  // locked in, but this endpoint is still reachable-but-inert until a webhook
  // pointing at https://posyplans.com/api/stripe/webhook is registered in the
  // Stripe Dashboard and STRIPE_WEBHOOK_SECRET is set. Until then,
  // /api/checkout/confirm above is what activates entitlements.
  app.post("/api/stripe/webhook", async (req, res) => {
    const stripe = getStripe();
    const webhookSecret = getWebhookSecret();
    if (!stripe || !webhookSecret) {
      return res.status(501).json({ error: "Webhook not configured yet." });
    }

    const signature = req.headers["stripe-signature"];
    if (!signature || typeof signature !== "string" || !req.rawBody) {
      return res.status(400).json({ error: "Missing Stripe signature." });
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(req.rawBody as Buffer, signature, webhookSecret);
    } catch (err) {
      console.error("Stripe webhook signature verification failed:", err);
      return res.status(400).json({ error: "Invalid signature." });
    }

    try {
      switch (event.type) {
        case "checkout.session.completed": {
          // Spark one-time unlock. The pull-based /api/checkout/confirm is the
          // primary path, but handle it here too for when the webhook is
          // registered. Idempotent via markEventSparkUnlocked.
          const session = event.data.object as Stripe.Checkout.Session;
          if (session.mode === "payment" && session.metadata?.plan === "spark") {
            const ownerToken = session.metadata?.ownerToken;
            if (ownerToken) await storage.markEventSparkUnlocked(ownerToken, session.id);
          }
          break;
        }
        case "customer.subscription.updated":
        case "customer.subscription.created": {
          const subscription = event.data.object as Stripe.Subscription;
          const customer = await stripe.customers.retrieve(subscription.customer as string);
          const email = !("deleted" in customer) ? customer.email?.toLowerCase() : undefined;
          if (email) {
            const previous = await storage.getEmailEntitlement(email);
            const newPlanTier = planTierFromSubscriptionStatus(subscription.status);
            await storage.upsertEmailEntitlement(email, {
              planTier: newPlanTier,
              stripeCustomerId: subscription.customer as string,
              stripeSubscriptionId: subscription.id,
              trialStartedAt: subscription.trial_start ? subscription.trial_start * 1000 : previous?.trialStartedAt ?? null,
              trialEndsAt: subscription.trial_end ? subscription.trial_end * 1000 : previous?.trialEndsAt ?? null,
            });
            // Trial converting to paid — the transition /api/checkout/confirm
            // can't catch, since the host isn't on the success page anymore.
            if (previous?.planTier === "plus_trial" && newPlanTier === "plus_active") {
              await storage.logAnalyticsEvent("subscribed", { email, metadata: { subscriptionId: subscription.id, via: "trial_conversion" } });
              // Defense-in-depth: stamp the verified email onto the originating
              // event if the subscription carries a returnToken in its metadata.
              // (Present only if checkout set subscription_data.metadata; absent
              // otherwise, in which case this safely no-ops.) Never throws.
              const returnToken = subscription.metadata?.returnToken;
              if (returnToken) {
                const subEvent = await storage.getEventByOwnerToken(returnToken);
                if (subEvent) await stampCapturedEmailSafe(subEvent.id, email);
              }
              // Server-side Purchase conversion (Meta CAPI). Interval comes
              // from the subscription's price since no metadata is present on
              // the webhook object. event_id = subscription.id for dedup.
              const interval = subscription.items.data[0]?.price?.recurring?.interval;
              const phone = !("deleted" in customer) ? customer.phone ?? undefined : undefined;
              await sendMetaPurchaseEvent({
                email,
                phone,
                value: interval === "month" ? CHECKOUT_PRICES.plusMonthly : CHECKOUT_PRICES.plusAnnual,
                currency: "USD",
                eventId: subscription.id,
              });
            }
          }
          break;
        }
        case "customer.subscription.deleted": {
          const subscription = event.data.object as Stripe.Subscription;
          const customer = await stripe.customers.retrieve(subscription.customer as string);
          const email = !("deleted" in customer) ? customer.email?.toLowerCase() : undefined;
          if (email) await storage.upsertEmailEntitlement(email, { planTier: "plus_expired" });
          break;
        }
        case "invoice.payment_failed": {
          // Logged for visibility; Stripe's own Smart Retries handles the
          // dunning flow, and customer.subscription.updated above handles
          // the eventual downgrade once Stripe marks it past_due/canceled.
          console.warn("Stripe invoice payment failed:", (event.data.object as Stripe.Invoice).id);
          break;
        }
        default:
          break;
      }
      res.json({ received: true });
    } catch (err) {
      console.error("Stripe webhook handling failed:", err);
      res.status(500).json({ error: "Webhook handler error." });
    }
  });

  // --- Cookie consent (PartyPilot_SMS_Cookie_Consent_Copy.md, filename predates the Posy rebrand, §2) ---
  // Persisted via a plain Set-Cookie header, read back via the raw
  // Cookie request header — no cookie-parser dependency, and the frontend
  // never touches document.cookie/localStorage directly.
  const CONSENT_CATEGORIES = ["analytics", "marketing"] as const;
  type ConsentCategory = (typeof CONSENT_CATEGORIES)[number];
  type ConsentPrefs = Record<ConsentCategory, boolean>;

  app.get("/api/consent", (req, res) => {
    const cookies = parseCookies(req.headers.cookie);
    const raw = cookies.pp_consent;
    if (!raw) {
      return res.json({ hasChoice: false });
    }
    try {
      const parsed = JSON.parse(raw);
      const prefs: ConsentPrefs = {
        analytics: parsed.analytics === true,
        marketing: parsed.marketing === true,
      };
      return res.json({ hasChoice: true, ...prefs });
    } catch {
      return res.json({ hasChoice: false });
    }
  });

  app.post("/api/consent", (req, res) => {
    const analytics = req.body?.analytics === true;
    const marketing = req.body?.marketing === true;
    const prefs: ConsentPrefs = { analytics, marketing };
    res.setHeader("Set-Cookie", serializeConsentCookie(JSON.stringify(prefs)));
    return res.json({ hasChoice: true, ...prefs });
  });

  return httpServer;
}

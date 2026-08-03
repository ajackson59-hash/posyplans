import { pgTable, text, integer, serial, boolean, bigint, uniqueIndex, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

/* ============ EVENTS ============ */
// No login system — each event is accessed by two secret-ish codes:
// - ownerToken: lets the host view/edit the guest list and invitations
// - shareSlug: the public RSVP page guests use to respond
export const events = pgTable("events", {
  id: serial("id").primaryKey(),
  ownerToken: text("owner_token").notNull().unique(),
  shareSlug: text("share_slug").notNull().unique(),
  eventName: text("event_name").notNull(),
  eventType: text("event_type").notNull().default(""),
  eventDate: text("event_date").notNull().default(""),
  location: text("location").notNull().default(""),
  hostNames: text("host_names").notNull().default(""),
  themeName: text("theme_name").notNull().default(""),
  paletteColors: text("palette_colors").notNull().default("[]"), // JSON string array of hex colors
  inviteSubject: text("invite_subject").notNull().default(""),
  inviteMessage: text("invite_message").notNull().default(""),
  // Optional custom artwork the host uploads (a photo, a kid's drawing, a
  // designed invite, etc.) to feature on the invite preview and public RSVP
  // page. Stored as a data URI — the client resizes/compresses the image
  // before upload so this stays reasonably small. Empty string means "no
  // custom artwork", and the app falls back to the plain themed invite card.
  inviteArtworkUrl: text("invite_artwork_url").notNull().default(""),
  // Invitation styling — lets a host give their invite text a bit of
  // personality beyond the default app typography, without building a full
  // design canvas. Both fields default to values that match the app's
  // existing look, so pre-existing invites render unchanged.
  // inviteFontFamily: one of INVITE_FONT_OPTIONS ids from client/src/lib/inviteStyles.ts
  inviteFontFamily: text("invite_font_family").notNull().default("classic-serif"),
  // inviteAccentColor: a hex color, or "" to auto-derive from the event's theme palette
  inviteAccentColor: text("invite_accent_color").notNull().default(""),
  // Invitation Intelligence: an AI-generated design concept (palette, font
  // pairing, border, layout — see shared/inviteDesign.ts) applied on top of
  // the manual invite styling above. "{}" means no concept has been applied
  // yet, in which case the app falls back to inviteFontFamily/inviteAccentColor.
  inviteDesignConceptJson: text("invite_design_concept_json").notNull().default("{}"),
  // Bounded, text-free decorative illustration generated for the applied
  // design concept. Stored as a data URI, same convention as inviteArtworkUrl.
  // Empty string means no illustration has been generated yet.
  inviteIllustrationUrl: text("invite_illustration_url").notNull().default(""),
  // "Upload my complete invitation design": a finished invite the host made or
  // bought elsewhere, used AS-IS with no Posy border, font overlay, or palette.
  // Distinct from inviteArtworkUrl above (which is slotted INTO a Posy
  // template). Stored as a data URI, same convention as the other image
  // columns. Empty string means no full-custom design has been uploaded.
  customInviteImageUrl: text("custom_invite_image_url").notNull().default(""),
  // Which renderer the invite/RSVP page uses. "custom" = show
  // customInviteImageUrl full-bleed with zero Posy styling. Empty string (the
  // default, and the value every pre-existing event has) = today's
  // concept-driven rendering, unchanged. Toggling to "custom" and back is
  // non-destructive — the applied concept fields are never cleared.
  inviteRenderMode: text("invite_render_mode").notNull().default(""),
  // Coordinated design suite — envelope, patterned liner, and stamp derived
  // from the applied concept's Theme DNA (see shared/themeDna.ts) so the whole
  // stationery set matches the invite. Auto-populated when a concept is
  // applied, then overridable by the host. Empty string means "not set", in
  // which case the suite UI and the guest-facing envelope reveal fall back to
  // deriving values from the concept on the fly — so pre-existing events are
  // completely unaffected.
  envelopeColor: text("envelope_color").notNull().default(""),
  envelopeLinerPattern: text("envelope_liner_pattern").notNull().default(""),
  stampStyle: text("stamp_style").notNull().default(""),
  // Custom colors for the liner pattern and stamp, overriding the derived
  // accent/backgroundColor from the concept's Theme DNA. Empty string means
  // "not set" — falls back to derived DNA values, so pre-existing events
  // are unaffected.
  linerColor: text("liner_color").notNull().default(""),
  stampColor: text("stamp_color").notNull().default(""),
  budgetTotal: integer("budget_total"), // planned overall budget in whole dollars, editable by host
  // Structured venue details — separate from the short display `location` above.
  // Lets a host record exactly where the event is, how many people it holds,
  // and who to call with day-of questions (e.g. a venue coordinator).
  venueName: text("venue_name").notNull().default(""),
  venueAddress: text("venue_address").notNull().default(""),
  venueCapacity: integer("venue_capacity"), // max guests the venue can hold, if known
  venueContactName: text("venue_contact_name").notNull().default(""),
  venueContactPhone: text("venue_contact_phone").notNull().default(""),
  // How guests are allowed to RSVP for extra headcount beyond themselves.
  // "none": no restriction, guest can enter any adult/child counts.
  // "no_children": children counter is hidden, adults only.
  // "plus_one": guest may bring exactly one additional adult, no children counter.
  // "no_additional_guests": guest can only RSVP for themselves (count locked to 1).
  rsvpRestriction: text("rsvp_restriction").notNull().default("none"),
  rsvpDeadline: text("rsvp_deadline").notNull().default(""), // friendly display date, same format as eventDate
  // Controls whether the public RSVP page is live. "draft" shows a
  // "not ready yet" message; "published" shows the full RSVP form.
  // Defaults to "published" so pre-existing events are unaffected.
  inviteStatus: text("invite_status").notNull().default("published"),
  // Optional phone number the host can share on the RSVP page for guests
  // who prefer to call or text instead of using the web form.
  rsvpPhone: text("rsvp_phone").notNull().default(""),
  // Epoch-millisecond timestamps use bigint (Postgres 4-byte integer maxes
  // out around 2.1B, well below current Date.now() values ~1.7T).
  createdAt: bigint("created_at", { mode: "number" }).notNull(),

  /* ---- AI Master Planner: intake + draft lifecycle ---- */
  // Collected during the pre-guest-list Intake wizard, before real guests
  // exist. Generators (Budget, Menu, Shopping, Timeline) size against this
  // until an actual guest/RSVP count exists, at which point that real count
  // takes precedence (same fallback pattern `headcountForAi` already uses).
  estimatedGuestCount: integer("estimated_guest_count"), // nullable
  // Distinct from budgetTotal (which today is a byproduct of adding budget
  // items). This is the number the host types during intake, before any
  // line items exist.
  budgetCeiling: integer("budget_ceiling"), // whole dollars, nullable
  // The raw free-text intake sentence, kept verbatim so later regeneration
  // (e.g. a "refresh my invitation looks" cascade suggestion) can reuse the
  // original framing without asking the host to re-type it.
  vibeDescription: text("vibe_description").notNull().default(""),
  // Narrative event-identity blurb generated once alongside the theme.
  // Editable like any other field, never regenerated silently.
  eventIdentity: text("event_identity").notNull().default(""),
  // Drives the narrated loading screen and safe recovery if the browser is
  // closed mid-generation. System-controlled — not exposed on insert/update
  // schemas below; only the orchestrator (Phase 3) writes this.
  draftStatus: text("draft_status").notNull().default("none"), // none | generating | ready | failed_partial
  // Machine-readable current stage name, drives the polling endpoint's
  // narrated checklist. System-controlled, same as draftStatus.
  draftStage: text("draft_stage"), // nullable

  /* ---- Entitlement: email capture (see masterPlannerGenerations / emailEntitlements below) ---- */
  // Set once the host chooses to save/export/email their plan — the "value
  // moment" capture point. System-controlled: only the /email-capture route
  // writes this, never the generic event PATCH.
  capturedEmail: text("captured_email"), // nullable
  emailCapturedAt: bigint("email_captured_at", { mode: "number" }), // nullable

  /* ---- Spark one-time unlock (see server/stripe.ts, server/routes.ts) ---- */
  // Set when a Spark one-time payment ($9.99) succeeds for this event —
  // grants this single event its one full AI-drafted plan. System-controlled:
  // only the checkout confirm route / Stripe webhook writes these, never the
  // generic event PATCH.
  sparkUnlockedAt: bigint("spark_unlocked_at", { mode: "number" }), // nullable, millis
  // The Stripe checkout session that unlocked this event, kept for
  // idempotency so a re-confirm / replayed webhook never double-processes.
  sparkCheckoutSessionId: text("spark_checkout_session_id"), // nullable
});

export const RSVP_RESTRICTIONS = ["none", "no_children", "plus_one", "no_additional_guests"] as const;
export type RsvpRestriction = (typeof RSVP_RESTRICTIONS)[number];

export const DRAFT_STATUSES = ["none", "generating", "ready", "failed_partial"] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

// System-controlled fields are omitted from both insert and update schemas —
// they must only ever be written by trusted server-side code (the
// masterPlannerOrchestrator and the /email-capture route in Phase 3+), never
// accepted as arbitrary client PATCH body fields on the generic event routes.
export const insertEventSchema = createInsertSchema(events).omit({
  id: true,
  ownerToken: true,
  shareSlug: true,
  createdAt: true,
  draftStatus: true,
  draftStage: true,
  capturedEmail: true,
  emailCapturedAt: true,
  sparkUnlockedAt: true,
  sparkCheckoutSessionId: true,
});
export const updateEventSchema = insertEventSchema.partial();

// Dedicated schema for the Intake wizard's PATCH .../intake route — a
// narrower surface than the general updateEventSchema so intake only ever
// touches the fields it owns.
export const intakeSchema = z.object({
  eventName: z.string().min(1).optional(),
  eventType: z.string().optional(),
  eventDate: z.string().optional(),
  estimatedGuestCount: z.number().int().min(1).max(2000).optional(),
  budgetCeiling: z.number().int().min(0).optional(),
  vibeDescription: z.string().max(500).optional(),
});
export type IntakeInput = z.infer<typeof intakeSchema>;

export type InsertEvent = z.infer<typeof insertEventSchema>;
export type UpdateEvent = z.infer<typeof updateEventSchema>;
export type Event = typeof events.$inferSelect;

/* ============ GUESTS ============ */
export const RSVP_STATUSES = ["pending", "yes", "no", "maybe"] as const;
export type RsvpStatus = (typeof RSVP_STATUSES)[number];

export const guests = pgTable("guests", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull(),
  name: text("name").notNull(),
  email: text("email").notNull().default(""),
  phone: text("phone").notNull().default(""),
  group: text("group_label").notNull().default(""), // e.g. "Family", "Work friends"
  partySize: integer("party_size").notNull().default(1), // invited headcount incl. guest
  rsvpStatus: text("rsvp_status").notNull().default("pending"),
  attendingCount: integer("attending_count"), // filled once guest RSVPs yes/maybe (adults + children)
  attendingAdults: integer("attending_adults"), // breakdown: adults, filled once guest RSVPs yes/maybe
  attendingChildren: integer("attending_children"), // breakdown: children, filled once guest RSVPs yes/maybe
  note: text("note").notNull().default(""), // dietary notes, message from guest
  invitedAt: bigint("invited_at", { mode: "number" }),
  respondedAt: bigint("responded_at", { mode: "number" }),
  emailSentAt: bigint("email_sent_at", { mode: "number" }), // set when an automated invite email was sent via the host's Gmail
  emailSendError: text("email_send_error"), // last automated send error, if any
  // SMS consent is separate and optional from email/RSVP (see SMS Terms).
  // smsOptIn must be an explicit, unchecked-by-default choice — never inferred
  // from having a phone number on file. smsConsentAt records when consent was
  // given, which doubles as the compliance record TCPA expects.
  smsOptIn: boolean("sms_opt_in").notNull().default(false),
  smsConsentAt: bigint("sms_consent_at", { mode: "number" }),
  smsSentAt: bigint("sms_sent_at", { mode: "number" }), // set when an automated reminder text was sent
  smsSendError: text("sms_send_error"), // last automated SMS send error, if any
});

export const insertGuestSchema = createInsertSchema(guests).omit({
  id: true,
  eventId: true,
  rsvpStatus: true,
  attendingCount: true,
  attendingAdults: true,
  attendingChildren: true,
  invitedAt: true,
  respondedAt: true,
});
export const updateGuestSchema = insertGuestSchema.partial();

export const rsvpSubmitSchema = z.object({
  status: z.enum(["yes", "no", "maybe"]),
  attendingCount: z.number().int().min(0).max(50).optional(),
  attendingAdults: z.number().int().min(0).max(50).optional(),
  attendingChildren: z.number().int().min(0).max(50).optional(),
  note: z.string().max(500).optional(),
});

export type InsertGuest = z.infer<typeof insertGuestSchema>;
export type UpdateGuest = z.infer<typeof updateGuestSchema>;
export type RsvpSubmit = z.infer<typeof rsvpSubmitSchema>;
export type Guest = typeof guests.$inferSelect;

/* ============ BUDGET ITEMS ============ */
export const BUDGET_CATEGORIES = [
  "Venue",
  "Food & Beverage",
  "Décor",
  "Entertainment",
  "Rentals",
  "Photography",
  "Favors & Gifts",
  "Attire",
  "Other",
] as const;
export type BudgetCategory = (typeof BUDGET_CATEGORIES)[number];

export const budgetItems = pgTable("budget_items", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull(),
  category: text("category").notNull().default("Other"),
  name: text("name").notNull(),
  estimatedCost: integer("estimated_cost").notNull().default(0), // whole dollars
  actualCost: integer("actual_cost"), // whole dollars, filled once known/paid
  depositPaid: integer("deposit_paid").notNull().default(0), // whole dollars paid so far
  isPaidInFull: boolean("is_paid_in_full").notNull().default(false),
  vendor: text("vendor").notNull().default(""),
  notes: text("notes").notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const insertBudgetItemSchema = createInsertSchema(budgetItems).omit({
  id: true,
  eventId: true,
});
export const updateBudgetItemSchema = insertBudgetItemSchema.partial();

export type InsertBudgetItem = z.infer<typeof insertBudgetItemSchema>;
export type UpdateBudgetItem = z.infer<typeof updateBudgetItemSchema>;
export type BudgetItem = typeof budgetItems.$inferSelect;

/* ============ MENU ITEMS ============ */
export const MENU_COURSES = [
  "Appetizers",
  "Main Course",
  "Sides",
  "Dessert",
  "Drinks & Bar",
  "Cake",
  "Other",
] as const;
export type MenuCourse = (typeof MENU_COURSES)[number];

export const MENU_SOURCES = [
  "Caterer",
  "Store-bought",
  "Homemade",
  "Potluck / guests bringing",
  "Restaurant delivery",
  "Other",
] as const;
export type MenuSource = (typeof MENU_SOURCES)[number];

export const menuItems = pgTable("menu_items", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull(),
  course: text("course").notNull().default("Main Course"),
  itemName: text("item_name").notNull(),
  source: text("source").notNull().default("Homemade"),
  servesCount: integer("serves_count"), // optional, how many it feeds
  costEstimate: integer("cost_estimate").notNull().default(0), // whole dollars
  dietaryTags: text("dietary_tags").notNull().default(""), // free text, e.g. "nut-free, vegetarian"
  notes: text("notes").notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const insertMenuItemSchema = createInsertSchema(menuItems).omit({
  id: true,
  eventId: true,
});
export const updateMenuItemSchema = insertMenuItemSchema.partial();

export type InsertMenuItem = z.infer<typeof insertMenuItemSchema>;
export type UpdateMenuItem = z.infer<typeof updateMenuItemSchema>;
export type MenuItem = typeof menuItems.$inferSelect;

/* ============ SHOPPING & PACKING LIST ============ */
// Covers the "unglamorous things people forget" ask: a categorized master list
// that tracks whether each item is already owned, still needs to be bought/rented,
// or is being borrowed — plus where it's coming from and whether it's been
// physically packed/loaded for the event.
export const SHOPPING_CATEGORIES = [
  "Décor",
  "Food & Beverages",
  "Serving Supplies",
  "Guest Supplies",
  "Bathroom Essentials",
  "Entertainment",
  "Emergency Supplies",
  "Setup Tools",
  "Cleanup Supplies",
  "Take-Home Items",
] as const;
export type ShoppingCategory = (typeof SHOPPING_CATEGORIES)[number];

export const PROCUREMENT_STATUSES = ["need", "have", "borrowing"] as const;
export type ProcurementStatus = (typeof PROCUREMENT_STATUSES)[number];

export const shoppingListItems = pgTable("shopping_list_items", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull(),
  category: text("category").notNull().default("Décor"),
  itemName: text("item_name").notNull(),
  quantity: text("quantity").notNull().default("1"),
  status: text("status").notNull().default("need"), // need | have | borrowing
  estimatedCost: integer("estimated_cost").notNull().default(0), // whole dollars, only relevant when status = need
  source: text("source").notNull().default(""), // store/vendor/who it's borrowed from
  notes: text("notes").notNull().default(""),
  isPacked: boolean("is_packed").notNull().default(false), // checked off once packed/loaded for the event
  sortOrder: integer("sort_order").notNull().default(0),
});

export const insertShoppingListItemSchema = createInsertSchema(shoppingListItems).omit({
  id: true,
  eventId: true,
});
export const updateShoppingListItemSchema = insertShoppingListItemSchema.partial();

export type InsertShoppingListItem = z.infer<typeof insertShoppingListItemSchema>;
export type UpdateShoppingListItem = z.infer<typeof updateShoppingListItemSchema>;
export type ShoppingListItem = typeof shoppingListItems.$inferSelect;

/* ============ EVENT-DAY TIMELINE ============ */
// A run-of-show schedule the host can check off in real time on the day itself
// ("can I be present at my own event instead of managing chaos?"). `time` is
// free text (a clock time or a relative marker like "30 min before") so hosts
// aren't forced into a rigid start-time model.
export const TIMELINE_CATEGORIES = [
  "Setup",
  "Arrival",
  "Activities",
  "Food & Toasts",
  "Special Moments",
  "Wind Down",
  "Cleanup",
] as const;
export type TimelineCategory = (typeof TIMELINE_CATEGORIES)[number];

export const timelineItems = pgTable("timeline_items", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull(),
  time: text("time").notNull().default(""), // e.g. "2:00 PM" or "30 min before guests arrive"
  title: text("title").notNull(),
  category: text("category").notNull().default("Activities"),
  assignedTo: text("assigned_to").notNull().default(""), // who's responsible: host, caterer, DJ, a friend, etc.
  notes: text("notes").notNull().default(""),
  isDone: boolean("is_done").notNull().default(false), // checked off day-of
  sortOrder: integer("sort_order").notNull().default(0),
});

export const insertTimelineItemSchema = createInsertSchema(timelineItems).omit({
  id: true,
  eventId: true,
});
export const updateTimelineItemSchema = insertTimelineItemSchema.partial();

export type InsertTimelineItem = z.infer<typeof insertTimelineItemSchema>;
export type UpdateTimelineItem = z.infer<typeof updateTimelineItemSchema>;
export type TimelineItem = typeof timelineItems.$inferSelect;

/* ============ THEME SUGGESTIONS ============ */
// Caches theme-idea generations (menu/décor/timeline/budget suggestions tailored
// to a party theme like "Golf / Hole in One") so repeat lookups for the same
// theme + event type don't re-hit the AI model. Curated-library matches are
// never cached here (they're free/instant); only AI-generated fallbacks for
// themes outside the curated library are stored.
export const themeSuggestionCache = pgTable("theme_suggestion_cache", {
  id: serial("id").primaryKey(),
  cacheKey: text("cache_key").notNull().unique(), // normalized `${theme}::${eventType}`
  theme: text("theme").notNull(),
  eventType: text("event_type").notNull().default(""),
  suggestionsJson: text("suggestions_json").notNull(), // JSON blob, shape mirrors ThemeSuggestion
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export type ThemeSuggestionCacheRow = typeof themeSuggestionCache.$inferSelect;

/* ============ MASTER PLANNER GENERATIONS (entitlement ledger) ============ */
// One row per AI Master Planner generation *attempt* for an event. This is
// the ledger that makes the entitlement layer's guarantees possible:
// atomic reservation before the orchestrator starts, "never consume the
// free draft on failure", and safe resume from a partial failure without
// re-running (and re-spending AI calls on) stages that already succeeded.
// See PartyPilot_AI_Master_Planner_Engineering_Breakdown.md §4 (filename
// predates the Posy rebrand) for the full design. Not wired into any route
// yet in Phase 1 — schema only, so Phase 3's
// orchestration work never has to touch the schema again.
export const GENERATION_KINDS = ["free_first_draft", "paid_additional_draft"] as const;
export type GenerationKind = (typeof GENERATION_KINDS)[number];

export const GENERATION_STATES = ["reserved", "consumed", "failed"] as const;
export type GenerationState = (typeof GENERATION_STATES)[number];

export const masterPlannerGenerations = pgTable("master_planner_generations", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull(),
  attemptNumber: integer("attempt_number").notNull().default(1),
  kind: text("kind").notNull().default("free_first_draft"), // free_first_draft | paid_additional_draft
  state: text("state").notNull().default("reserved"), // reserved | consumed | failed
  reservedAt: bigint("reserved_at", { mode: "number" }),
  consumedAt: bigint("consumed_at", { mode: "number" }),
  failedAt: bigint("failed_at", { mode: "number" }),
  // JSON array of stage names already persisted successfully, e.g.
  // ["theme","budget","menu"] — lets a retry resume instead of re-running.
  completedStages: text("completed_stages").notNull().default("[]"),
  failedStage: text("failed_stage"), // nullable — which stage to resume from
});

export type MasterPlannerGeneration = typeof masterPlannerGenerations.$inferSelect;

/* ============ EMAIL ENTITLEMENTS ============ */
// One row per verified email, independent of any single event. Everything
// after the free first draft (regenerations, alternate menus/timelines,
// invitation refreshes, AI cascade regen, additional full drafts) is gated
// against this table, keyed by the email captured at the value moment
// (save/export/email-me-my-plan) rather than an account, since Posy
// has no login system today. See Engineering Breakdown §4.1/§4.2.
export const PLAN_TIERS = ["spark", "plus_trial", "plus_active", "plus_expired"] as const;
export type PlanTier = (typeof PLAN_TIERS)[number];

export const emailEntitlements = pgTable("email_entitlements", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(), // normalized lowercase
  planTier: text("plan_tier").notNull().default("spark"), // spark | plus_trial | plus_active | plus_expired
  trialStartedAt: bigint("trial_started_at", { mode: "number" }), // nullable — populated once Stripe trial-start wiring exists
  trialEndsAt: bigint("trial_ends_at", { mode: "number" }), // nullable
  // Written by the checkout create-session/confirm routes and the Stripe
  // webhook handler (see server/stripe.ts, server/routes.ts). No longer
  // unused — Phase "Stripe checkout" wires these.
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  // "annual" | "monthly" — which price the host picked at checkout. Purely
  // informational (billing page display); Stripe's subscription is the
  // source of truth for what's actually being charged.
  billingInterval: text("billing_interval"),
  // Counter placeholder for a future numeric cap on additional full drafts.
  // The cap itself is an open question (Engineering Breakdown, Open
  // Questions) — not enforced yet.
  additionalDraftsUsed: integer("additional_drafts_used").notNull().default(0),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
});

export type EmailEntitlement = typeof emailEntitlements.$inferSelect;

// First-party conversion-event ledger (GTM doc: "a conversion event that
// fires on trial-start and on subscribe"). Written server-side only, at the
// same two checkpoints the client-side analytics pixel would fire from, so
// we always have a source of truth even if the browser event is lost to an
// ad blocker, a declined analytics-cookie-consent choice, or (currently) a
// client-side analytics tool that doesn't support custom events — see
// client/src/lib/analytics.ts.
export const ANALYTICS_EVENT_NAMES = ["trial_started", "subscribed"] as const;
export type AnalyticsEventName = (typeof ANALYTICS_EVENT_NAMES)[number];

export const analyticsEvents = pgTable("analytics_events", {
  id: serial("id").primaryKey(),
  eventName: text("event_name").notNull(), // trial_started | subscribed
  email: text("email"), // nullable — normalized lowercase
  billingInterval: text("billing_interval"), // nullable — annual | monthly
  metadataJson: text("metadata_json").notNull().default("{}"),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export type AnalyticsEvent = typeof analyticsEvents.$inferSelect;

/* ============ AI-FIRST INVITATION PREVIEWS ============ */
// Content-addressed durable storage for AI-first invitation artwork.
//
// Additive only: nothing in the existing invitation flow reads or writes
// these tables, so an environment that has not run the migration keeps
// working exactly as before with the feature flag off.
//
// The three identifiers do different jobs and none of them substitutes for
// another:
//   conceptFingerprint  sha256 of the art-direction fields that actually
//                       change the pixels. Recolouring or re-typesetting a
//                       concept keeps the fingerprint, so restyling never
//                       re-bills an image.
//   assetHash           sha256 of the PNG bytes. This is what "Use this
//                       design" verifies server-side, so applying a preview
//                       provably uses the approved bytes.
//   previewId           event-scoped public handle. Event-scoped so one
//                       host's preview id can never address another host's
//                       asset even when the artwork is byte-identical.
export const aiFirstPreviews = pgTable("ai_first_previews", {
  id: serial("id").primaryKey(),
  eventId: integer("event_id").notNull(),
  previewId: text("preview_id").notNull().unique(),
  conceptFingerprint: text("concept_fingerprint").notNull(),
  assetHash: text("asset_hash").notNull(),
  // Data URI or object-store URL for the approved artwork bytes.
  assetUrl: text("asset_url").notNull(),
  conceptJson: text("concept_json").notNull(),
  source: text("source").notNull().default("ai-generated"), // ai-generated | adapted-studio-direction
  // Promoted previews are the ones a host actually applied. They are never
  // swept, which is why cleanup can be aggressive about everything else.
  promoted: boolean("promoted").notNull().default(false),
  promotedAt: bigint("promoted_at", { mode: "number" }),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  lastAccessedAt: bigint("last_accessed_at", { mode: "number" }).notNull(),
});

export type AiFirstPreview = typeof aiFirstPreviews.$inferSelect;

/* ============ AI-FIRST IMAGE LEDGER (cost control) ============ */
// One row per artwork *attempt*, billed or not. Kept separate from
// masterPlannerGenerations because that ledger counts host-visible planning
// drafts, whereas this one counts provider image spend — a quality retry is
// real money but is not a host action, and reuse is a host action that is
// not money. Collapsing the two would make both numbers wrong.
export const AI_IMAGE_REASONS = ["initial", "quality-retry", "reuse", "apply"] as const;
export type AiImageReason = (typeof AI_IMAGE_REASONS)[number];

export const aiFirstImageLedger = pgTable(
  "ai_first_image_ledger",
  {
    id: serial("id").primaryKey(),
    eventId: integer("event_id").notNull(),
    email: text("email"), // nullable — normalized lowercase, for monthly caps
    reason: text("reason").notNull(), // initial | quality-retry | reuse | apply
    // False for reuse/apply and for anything the provider never charged for.
    billed: boolean("billed").notNull().default(true),
    // True when the attempt was an automatic quality retry: counts against
    // spend, never against the host's visible action allowance.
    automatic: boolean("automatic").notNull().default(false),
    conceptFingerprint: text("concept_fingerprint"),
    previewId: text("preview_id"),
    // Set on reuse rows to the previewId whose bytes were served instead.
    reuseOf: text("reuse_of"),
    idempotencyKey: text("idempotency_key"),
    costUsdMicros: integer("cost_usd_micros").notNull().default(0),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (table) => [
    // A REAL partial unique index, part of the generated schema (see
    // migrations/ for the SQL this produces via `drizzle-kit generate` —
    // not a comment). Two concurrent requests inserting a ledger row for
    // the same run+direction+attempt idempotency key now race at the
    // database: the loser's INSERT fails with a unique-violation instead of
    // both succeeding. `findByIdempotencyKey` followed by `record` in
    // usage.ts is the read-then-write fast path for the common case; this
    // index is what makes the outcome correct even when two application
    // processes run that fast path at the same instant.
    uniqueIndex("ai_first_image_ledger_idempotency_key_uq")
      .on(table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
  ],
);

export type AiFirstImageLedgerRow = typeof aiFirstImageLedger.$inferSelect;

/* ============ AI-FIRST GENERATION RUNS (durable idempotency) ============ */
// One row per attempted generation run, keyed by a client-generated runId.
// This is the fix for the defect where "active generation" and "has this
// run already spent" lived only in server process memory (a Map on
// DbUsageStore / InMemoryUsageStore): correct on one long-lived process,
// silently wrong the moment two Vercel instances or a redeploy are in the
// picture, because each instance has its own Map.
//
// Two constraints, not one, make the atomicity real:
//
// 1. A plain unique index on run_id. This is what makes "duplicate click,
//    same run id" and "duplicate request to a second server instance, same
//    run id" the same case: both are a second INSERT attempt against a row
//    that already exists.
//
// 2. A PARTIAL unique index on (event_id) WHERE status = 'active' AND
//    terminal = false. This is the fix for the gap a prior pass of this
//    repair left open: two server instances racing with *different* run
//    ids for the *same event* both pass a `hasActiveRun` check-then-`claim`
//    sequence, because neither request's runId collides with the other's.
//    Only a second, independent constraint on event_id — not on run_id —
//    closes that race, by making "this event already has an active,
//    non-terminal run" a fact the database itself refuses to duplicate,
//    regardless of what run id either request used.
//
// Both indexes are part of the generated schema below (see migrations/ for
// the SQL `drizzle-kit generate` produced from them), not comments.
export const aiFirstGenerationRuns = pgTable(
  "ai_first_generation_runs",
  {
    id: serial("id").primaryKey(),
    runId: text("run_id").notNull().unique(),
    eventId: integer("event_id").notNull(),
    ownerToken: text("owner_token").notNull(),
    // active | completed | failed
    status: text("status").notNull().default("active"),
    progressMessage: text("progress_message").notNull().default(""),
    completedCount: integer("completed_count").notNull().default(0),
    fallbackCount: integer("fallback_count").notNull().default(0),
    errorMessage: text("error_message"),
    // True once the run has reached an explicit done/error/failed terminal
    // state. A row that is merely "not active anymore" (e.g. the process
    // died) but never reached this is exactly the unexpected-EOF case the
    // client must treat as a failure, not a success.
    terminal: boolean("terminal").notNull().default(false),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (table) => [
    // "Only one non-terminal active run per event, ever, no matter which
    // run id got there first." A second instance's INSERT for a *different*
    // run id on the same event now fails at the database with a
    // unique-violation on this index, the same way a duplicate run id
    // fails on the run_id unique index above. claim() below turns that
    // unique-violation into an "active-elsewhere" outcome distinct from a
    // same-runId "duplicate" outcome, so callers can tell the two apart.
    uniqueIndex("ai_first_generation_runs_one_active_per_event_uq")
      .on(table.eventId)
      .where(sql`${table.status} = 'active' and ${table.terminal} = false`),
    index("ai_first_generation_runs_event_id_idx").on(table.eventId),
  ],
);

export type AiFirstGenerationRunRow = typeof aiFirstGenerationRuns.$inferSelect;

/* ============ AI-FIRST ARTWORK ATTEMPTS (protected reviewer evidence) ==== */
// Every billed image is money spent — accepted AND rejected — and the host
// facing routes only ever show the accepted one per direction. Before this
// table existed, a rejected attempt's bytes only lived in the SSE stream
// (as a data URL, now removed — see the preview asset route) and in the
// pipeline's in-memory attempt log; nothing durable survived the request,
// for either outcome. That made "why did we pay for four images this event
// only shows one direction" unanswerable after the fact, and gave no way to
// audit an accepted image's gate scores after the fact either.
//
// This table therefore records every billed attempt, not only the rejected
// ones: `status` distinguishes accepted from rejected, `previewId` is set
// only on accepted rows (there is somewhere ordinary routes are allowed to
// point a host to), and `assetBytesBase64` + gate findings are retained for
// every row so a reviewer can audit the whole run, not just its failures.
//
// It is intentionally separate from ai_first_previews: ordinary user-facing
// routes (status, generate, apply) must never be able to surface a rejected
// image, so "rejected" is not a flag on the previews table but a distinct
// store with its own access path, gated the same way apply/status already
// are — by ownerToken, the event's existing secret. There is no new public
// diagnostic endpoint; see server/aiFirst/routes.ts for the owner-scoped
// review routes (a listing route that never embeds bytes, and a per-attempt
// binary asset route that does, served with owner-private cache headers).
export const aiFirstArtworkAttempts = pgTable(
  "ai_first_artwork_attempts",
  {
    id: serial("id").primaryKey(),
    eventId: integer("event_id").notNull(),
    ownerToken: text("owner_token").notNull(),
    runId: text("run_id"),
    idempotencyKey: text("idempotency_key"),
    directionIndex: integer("direction_index").notNull(),
    attempt: integer("attempt").notNull(),
    // accepted | rejected — every billed provider result, either way.
    status: text("status").notNull(),
    assetHash: text("asset_hash").notNull(),
    assetBytesBase64: text("asset_bytes_base64").notNull(),
    // Set only when status = 'accepted': the previewId ordinary routes may
    // reference. Rejected rows have no previewId — they are not reachable
    // through the preview store at all.
    previewId: text("preview_id"),
    conceptJson: text("concept_json").notNull(),
    failureCodesJson: text("failure_codes_json").notNull(),
    tier1FindingsJson: text("tier1_findings_json").notNull(),
    visionScoresJson: text("vision_scores_json"),
    costUsdMicros: integer("cost_usd_micros").notNull().default(0),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (table) => [index("ai_first_artwork_attempts_event_id_idx").on(table.eventId)],
);

export type AiFirstArtworkAttemptRow = typeof aiFirstArtworkAttempts.$inferSelect;

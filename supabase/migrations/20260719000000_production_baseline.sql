-- Baseline for Posy's pre-Supabase-migration production schema.
--
-- Generated from the main-branch Drizzle schema at 985c550 with
-- `drizzle-kit generate`, reconciled column-for-column against project
-- jvioxjetpqafkbwqihto, then rolled back only for the changes represented by
-- the five later migrations already recorded in Production. This makes a
-- clean branch replay those recorded migrations in their original order.
--
-- Production already contains these objects. When adopting this baseline on
-- Production, mark this version applied with `supabase migration repair`;
-- do not execute this file against the existing Production schema.

CREATE TABLE "analytics_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_name" text NOT NULL,
	"email" text,
	"billing_interval" text,
	"metadata_json" text DEFAULT '{}' NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "budget_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"category" text DEFAULT 'Other' NOT NULL,
	"name" text NOT NULL,
	"estimated_cost" integer DEFAULT 0 NOT NULL,
	"actual_cost" integer,
	"deposit_paid" integer DEFAULT 0 NOT NULL,
	"is_paid_in_full" boolean DEFAULT false NOT NULL,
	"vendor" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_entitlements" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"plan_tier" text DEFAULT 'spark' NOT NULL,
	"trial_started_at" bigint,
	"trial_ends_at" bigint,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"billing_interval" text,
	"additional_drafts_used" integer DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "email_entitlements_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" serial PRIMARY KEY NOT NULL,
	"owner_token" text NOT NULL,
	"share_slug" text NOT NULL,
	"event_name" text NOT NULL,
	"event_type" text DEFAULT '' NOT NULL,
	"event_date" text DEFAULT '' NOT NULL,
	"location" text DEFAULT '' NOT NULL,
	"host_names" text DEFAULT '' NOT NULL,
	"theme_name" text DEFAULT '' NOT NULL,
	"palette_colors" text DEFAULT '[]' NOT NULL,
	"invite_subject" text DEFAULT '' NOT NULL,
	"invite_message" text DEFAULT '' NOT NULL,
	"invite_artwork_url" text DEFAULT '' NOT NULL,
	"invite_font_family" text DEFAULT 'classic-serif' NOT NULL,
	"invite_accent_color" text DEFAULT '' NOT NULL,
	"invite_design_concept_json" text DEFAULT '{}' NOT NULL,
	"invite_illustration_url" text DEFAULT '' NOT NULL,
	"custom_invite_image_url" text DEFAULT '' NOT NULL,
	"invite_render_mode" text DEFAULT '' NOT NULL,
	"envelope_color" text DEFAULT '' NOT NULL,
	"envelope_liner_pattern" text DEFAULT '' NOT NULL,
	"stamp_style" text DEFAULT '' NOT NULL,
	"budget_total" integer,
	"venue_name" text DEFAULT '' NOT NULL,
	"venue_address" text DEFAULT '' NOT NULL,
	"venue_capacity" integer,
	"venue_contact_name" text DEFAULT '' NOT NULL,
	"venue_contact_phone" text DEFAULT '' NOT NULL,
	"rsvp_restriction" text DEFAULT 'none' NOT NULL,
	"rsvp_deadline" text DEFAULT '' NOT NULL,
	"created_at" bigint NOT NULL,
	"estimated_guest_count" integer,
	"budget_ceiling" integer,
	"vibe_description" text DEFAULT '' NOT NULL,
	"event_identity" text DEFAULT '' NOT NULL,
	"draft_status" text DEFAULT 'none' NOT NULL,
	"draft_stage" text,
	"captured_email" text,
	"email_captured_at" bigint,
	CONSTRAINT "events_owner_token_unique" UNIQUE("owner_token"),
	CONSTRAINT "events_share_slug_unique" UNIQUE("share_slug")
);
--> statement-breakpoint
CREATE TABLE "guests" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"name" text NOT NULL,
	"email" text DEFAULT '' NOT NULL,
	"phone" text DEFAULT '' NOT NULL,
	"group_label" text DEFAULT '' NOT NULL,
	"party_size" integer DEFAULT 1 NOT NULL,
	"rsvp_status" text DEFAULT 'pending' NOT NULL,
	"attending_count" integer,
	"attending_adults" integer,
	"attending_children" integer,
	"note" text DEFAULT '' NOT NULL,
	"invited_at" bigint,
	"responded_at" bigint,
	"email_sent_at" bigint,
	"email_send_error" text
);
--> statement-breakpoint
CREATE TABLE "master_planner_generations" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"attempt_number" integer DEFAULT 1 NOT NULL,
	"kind" text DEFAULT 'free_first_draft' NOT NULL,
	"state" text DEFAULT 'reserved' NOT NULL,
	"reserved_at" bigint,
	"consumed_at" bigint,
	"failed_at" bigint,
	"completed_stages" text DEFAULT '[]' NOT NULL,
	"failed_stage" text
);
--> statement-breakpoint
CREATE TABLE "menu_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"course" text DEFAULT 'Main Course' NOT NULL,
	"item_name" text NOT NULL,
	"source" text DEFAULT 'Homemade' NOT NULL,
	"serves_count" integer,
	"cost_estimate" integer DEFAULT 0 NOT NULL,
	"dietary_tags" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "shopping_list_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"category" text DEFAULT 'Décor' NOT NULL,
	"item_name" text NOT NULL,
	"quantity" text DEFAULT '1' NOT NULL,
	"status" text DEFAULT 'need' NOT NULL,
	"estimated_cost" integer DEFAULT 0 NOT NULL,
	"source" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"is_packed" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "theme_suggestion_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"cache_key" text NOT NULL,
	"theme" text NOT NULL,
	"event_type" text DEFAULT '' NOT NULL,
	"suggestions_json" text NOT NULL,
	"created_at" bigint NOT NULL,
	CONSTRAINT "theme_suggestion_cache_cache_key_unique" UNIQUE("cache_key")
);
--> statement-breakpoint
CREATE TABLE "timeline_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"time" text DEFAULT '' NOT NULL,
	"title" text NOT NULL,
	"category" text DEFAULT 'Activities' NOT NULL,
	"assigned_to" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"is_done" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);

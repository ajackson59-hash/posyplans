-- Initial additive storage for the disabled-by-default AI-first invitation flow.
-- Generated from shared/schema.ts at commit 81f1cc4 with drizzle-kit.

CREATE TABLE "ai_first_previews" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"preview_id" text NOT NULL,
	"concept_fingerprint" text NOT NULL,
	"asset_hash" text NOT NULL,
	"asset_url" text NOT NULL,
	"concept_json" text NOT NULL,
	"source" text DEFAULT 'ai-generated' NOT NULL,
	"promoted" boolean DEFAULT false NOT NULL,
	"promoted_at" bigint,
	"created_at" bigint NOT NULL,
	"last_accessed_at" bigint NOT NULL,
	CONSTRAINT "ai_first_previews_preview_id_unique" UNIQUE("preview_id")
);
--> statement-breakpoint
CREATE TABLE "ai_first_image_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"email" text,
	"reason" text NOT NULL,
	"billed" boolean DEFAULT true NOT NULL,
	"automatic" boolean DEFAULT false NOT NULL,
	"concept_fingerprint" text,
	"preview_id" text,
	"reuse_of" text,
	"idempotency_key" text,
	"cost_usd_micros" integer DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL
);

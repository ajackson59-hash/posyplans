-- Reliability repair (PR #3): durable run authority + protected artwork evidence.
--
-- This file was authored by extracting the exact DDL `drizzle-kit generate`
-- produces from shared/schema.ts for the objects this repair adds or
-- changes (verified against a scratch drizzle-kit run against this exact
-- schema.ts; not hand-typed SQL). It is scoped to only this repair's
-- changes, not a full-schema baseline: this project has no prior
-- drizzle-kit migration history (see package.json's "db:push" script,
-- which runs `drizzle-kit push` directly against the schema rather than
-- through tracked migration files), so a plain `drizzle-kit generate` run
-- here would otherwise emit a spurious "CREATE TABLE" for all fourteen
-- existing tables as if this were the project's first-ever migration —
-- which is wrong and would conflict with the tables that already exist.
--
-- THIS MUST BE APPLIED before the code in this repair is deployed anywhere
-- real: it is a required migration, not optional documentation. Apply it
-- via `npm run db:push` (this project's actual schema-deploy command) or by
-- running this file directly against the target database. Per this
-- repair's scope, that application step was NOT performed here -- no
-- command in this repair connected to any database, staging, preview, or
-- production instance. Deploying the TypeScript changes in this repair
-- without first applying this migration will fail at runtime the moment
-- the new stores are used, because the tables/indexes described below will
-- not exist yet.
--
-- What changes and why, three objects:
--
-- 1. ai_first_image_ledger gains a REAL partial unique index on
--    idempotency_key. Two concurrent requests inserting a ledger row for
--    the same run+direction+attempt key now race at the database: the
--    loser's INSERT fails with a unique-violation instead of both
--    succeeding, closing the "two processes both pass the
--    findByIdempotencyKey-then-record fast path at the same instant" gap
--    that a comment-only note could not.
--
-- 2. ai_first_generation_runs is new: one row per attempted run, with TWO
--    independent unique constraints —
--      a. a plain unique index on run_id (duplicate click / duplicate
--         request to a second instance, same run id, collide here), and
--      b. a PARTIAL unique index on event_id WHERE status = 'active' AND
--         terminal = false (two instances racing with DIFFERENT run ids
--         for the SAME event collide here instead — this is the
--         independent-run-id race a prior pass of this repair left open;
--         see server/aiFirst/runStore.ts's claim() for how the two
--         constraint violations are told apart).
--
-- 3. ai_first_artwork_attempts is new: durable, protected-review-only
--    evidence for every billed provider image, accepted or rejected, with
--    gate findings/scores, cost, run id, idempotency key, and (for
--    accepted rows only) the previewId ordinary routes may reference.

CREATE UNIQUE INDEX "ai_first_image_ledger_idempotency_key_uq"
  ON "ai_first_image_ledger" USING btree ("idempotency_key")
  WHERE "ai_first_image_ledger"."idempotency_key" is not null;
--> statement-breakpoint

CREATE TABLE "ai_first_generation_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"event_id" integer NOT NULL,
	"owner_token" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"progress_message" text DEFAULT '' NOT NULL,
	"completed_count" integer DEFAULT 0 NOT NULL,
	"fallback_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"terminal" boolean DEFAULT false NOT NULL,
	"created_at" bigint NOT NULL,
	"updated_at" bigint NOT NULL,
	CONSTRAINT "ai_first_generation_runs_run_id_unique" UNIQUE("run_id")
);
--> statement-breakpoint

CREATE UNIQUE INDEX "ai_first_generation_runs_one_active_per_event_uq"
  ON "ai_first_generation_runs" USING btree ("event_id")
  WHERE "ai_first_generation_runs"."status" = 'active' and "ai_first_generation_runs"."terminal" = false;
--> statement-breakpoint

CREATE TABLE "ai_first_artwork_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"event_id" integer NOT NULL,
	"owner_token" text NOT NULL,
	"run_id" text,
	"idempotency_key" text,
	"direction_index" integer NOT NULL,
	"attempt" integer NOT NULL,
	"status" text NOT NULL,
	"asset_hash" text NOT NULL,
	"asset_bytes_base64" text NOT NULL,
	"preview_id" text,
	"concept_json" text NOT NULL,
	"failure_codes_json" text NOT NULL,
	"tier1_findings_json" text NOT NULL,
	"vision_scores_json" text,
	"cost_usd_micros" integer DEFAULT 0 NOT NULL,
	"created_at" bigint NOT NULL
);
--> statement-breakpoint

CREATE INDEX "ai_first_artwork_attempts_event_id_idx" ON "ai_first_artwork_attempts" USING btree ("event_id");
--> statement-breakpoint
CREATE INDEX "ai_first_generation_runs_event_id_idx" ON "ai_first_generation_runs" USING btree ("event_id");

-- B2a: real, capped, email-gated invitation preview shown before payment.
-- See server/prePaymentPreview.ts for the attempt cap and gating logic, and
-- server/routes.ts for the generation + blur-serving routes.

ALTER TABLE "events"
  ADD COLUMN IF NOT EXISTS "pre_payment_preview_url" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "events"
  ADD COLUMN IF NOT EXISTS "pre_payment_preview_used_at" bigint;
--> statement-breakpoint
ALTER TABLE "events"
  ADD COLUMN IF NOT EXISTS "pre_payment_preview_attempts" integer DEFAULT 0 NOT NULL;

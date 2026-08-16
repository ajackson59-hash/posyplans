-- Provider provenance for protected AI-first artwork evidence.
-- Safe for the six known Preview rows: their model and quality are known,
-- while their exact output size is not reconstructed after the fact.

ALTER TABLE "ai_first_artwork_attempts"
  ADD COLUMN IF NOT EXISTS "model" text DEFAULT 'gpt-image-1' NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_first_artwork_attempts"
  ADD COLUMN IF NOT EXISTS "quality" text DEFAULT 'high' NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_first_artwork_attempts"
  ADD COLUMN IF NOT EXISTS "size" text;

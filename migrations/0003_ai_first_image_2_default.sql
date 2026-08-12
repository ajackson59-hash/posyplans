-- Quality-first default for new AI-first artwork-attempt provenance rows.
-- GPT Image 1 remains a supported explicit operator override for legacy
-- comparison, but an unset model must not silently select it.
ALTER TABLE "ai_first_artwork_attempts"
  ALTER COLUMN "model" SET DEFAULT 'gpt-image-2';

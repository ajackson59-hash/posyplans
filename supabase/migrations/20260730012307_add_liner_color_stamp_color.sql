-- Recovered verbatim from Production migration history.
ALTER TABLE events ADD COLUMN IF NOT EXISTS liner_color text NOT NULL DEFAULT '';
ALTER TABLE events ADD COLUMN IF NOT EXISTS stamp_color text NOT NULL DEFAULT '';

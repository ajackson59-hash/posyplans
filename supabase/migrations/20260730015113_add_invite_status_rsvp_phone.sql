-- Recovered verbatim from Production migration history.
ALTER TABLE events ADD COLUMN IF NOT EXISTS invite_status text NOT NULL DEFAULT 'published';
ALTER TABLE events ADD COLUMN IF NOT EXISTS rsvp_phone text NOT NULL DEFAULT '';

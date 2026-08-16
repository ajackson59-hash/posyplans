-- Recovered verbatim from Production migration history.
ALTER TABLE events ADD COLUMN IF NOT EXISTS spark_unlocked_at bigint;
ALTER TABLE events ADD COLUMN IF NOT EXISTS spark_checkout_session_id text;

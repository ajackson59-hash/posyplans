-- Recovered verbatim from Production migration history.
ALTER TABLE guests
  ADD COLUMN sms_opt_in boolean NOT NULL DEFAULT false,
  ADD COLUMN sms_consent_at bigint,
  ADD COLUMN sms_sent_at bigint,
  ADD COLUMN sms_send_error text;

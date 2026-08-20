-- Give every guest an opaque, high-entropy bearer token for a personalized
-- RSVP link. Existing sequential guest ids must never be usable as public
-- credentials or as a way to enumerate an event's guest list.

begin;

alter table public.guests
  add column access_token text;

update public.guests
set access_token = replace(gen_random_uuid()::text, '-', '')
where access_token is null;

alter table public.guests
  alter column access_token set default replace(gen_random_uuid()::text, '-', ''),
  alter column access_token set not null;

create unique index guests_access_token_unique
  on public.guests (access_token);

comment on column public.guests.access_token is
  'Opaque bearer token for the recipient-specific RSVP URL. Never expose through public guest-list endpoints.';

commit;

alter table public.events add column customer_artwork_enabled boolean not null default false;
create table public.customer_artwork_sessions (
  event_id integer primary key references public.events(id) on delete cascade,
  version integer not null default 0 check (version >= 0),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  check (payload ?& array['eventId','ownerHash','version','attempts','selections']),
  check (((payload->>'eventId')::integer=event_id and (payload->>'version')::integer=version) is true),
  check (jsonb_typeof(payload->'attempts')='array' and jsonb_array_length(payload->'attempts') <= 4)
);
alter table public.customer_artwork_sessions enable row level security;
revoke all on public.customer_artwork_sessions from public, anon, authenticated;
grant select,insert,update,delete on public.customer_artwork_sessions to service_role;
comment on table public.customer_artwork_sessions is 'Server-only customer image requests, retained versions, and selections. Not staff or model quality approval. One lifetime budget per event.';

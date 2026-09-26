create table public.human_artwork_reviews (
  id text primary key,
  event_id integer not null references public.events(id) on delete cascade,
  brief_hash text not null check (brief_hash ~ '^[a-f0-9]{64}$'),
  state text not null check (state in ('queued','generating','review','approved','rejected','failed')),
  version integer not null default 0 check (version >= 0),
  payload jsonb not null,
  created_at timestamptz not null default now(),
  unique(event_id,brief_hash),
  check (payload ?& array['id','eventId','briefHash','state','version','ownerToken','brief','history']),
  check ((payload->>'id'=id and (payload->>'eventId')::integer=event_id
    and payload->>'briefHash'=brief_hash and payload->>'state'=state and (payload->>'version')::integer=version) is true)
);
alter table public.human_artwork_reviews enable row level security;
revoke all on public.human_artwork_reviews from public, anon, authenticated;
grant select,insert,update,delete on public.human_artwork_reviews to service_role;
create index human_artwork_reviews_created_idx on public.human_artwork_reviews(created_at desc);
comment on table public.human_artwork_reviews is 'Server-only human artwork queue. Never a model approval or a public asset store.';

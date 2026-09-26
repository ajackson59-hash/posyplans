-- Staged replacements remain private until the host explicitly applies them.
-- This does not alter invitations, artwork, guests or existing planning rows.
create table public.plan_regenerations (
  id uuid primary key,
  event_id integer not null references public.events(id) on delete cascade,
  request_id text not null check (length(request_id) between 1 and 200),
  state text not null check (state in ('running', 'ready', 'failed', 'applied', 'discarded')),
  stage text,
  error text,
  created_at bigint not null,
  updated_at bigint not null,
  base jsonb not null check (jsonb_typeof(base) = 'object'),
  candidate jsonb check (candidate is null or jsonb_typeof(candidate) = 'object'),
  previous jsonb check (previous is null or jsonb_typeof(previous) = 'object'),
  constraint plan_regenerations_request_key unique (event_id, request_id),
  check (updated_at >= created_at),
  check (state not in ('ready', 'applied') or candidate is not null),
  check (state <> 'applied' or previous is not null)
);

-- An interrupted/failed candidate requires a deliberate discard before a new
-- provider call. Retrying a request id always resolves to its existing row.
create unique index plan_regenerations_unresolved_event_idx
  on public.plan_regenerations(event_id)
  where state in ('running', 'ready', 'failed');
create index plan_regenerations_event_updated_idx
  on public.plan_regenerations(event_id, updated_at desc, id);

alter table public.plan_regenerations enable row level security;
revoke all on public.plan_regenerations from public, anon, authenticated;
grant select, insert, update, delete on public.plan_regenerations to service_role;
create policy plan_regenerations_deny_data_api
  on public.plan_regenerations as restrictive for all to anon, authenticated
  using (false) with check (false);
comment on table public.plan_regenerations is
  'Server-only plan candidates, idempotency records and previous plan snapshots; excludes invitation artwork and credentials.';

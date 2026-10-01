-- Closed by default. Preview cohort history/limits are reconciled separately;
-- schema installation never grants a new spending allowance.
create table public.image_spend_policies (
  id text primary key,
  paused boolean not null default true,
  stop_reason text not null default 'not_reconciled',
  request_limit integer not null default 0 check(request_limit >= 0),
  create_limit integer not null default 0 check(create_limit >= 0),
  edit_limit integer not null default 0 check(edit_limit >= 0),
  requests_reserved integer not null default 0 check(requests_reserved >= 0),
  creates_reserved integer not null default 0 check(creates_reserved >= 0),
  edits_reserved integer not null default 0 check(edits_reserved >= 0),
  updated_at timestamptz not null default now(),
  check(requests_reserved = creates_reserved + edits_reserved)
);
create table public.image_spend_requests (
  id uuid primary key,
  policy_id text not null references public.image_spend_policies(id),
  -- Retain spend evidence if an event is later deleted. No cascading refund.
  event_id integer references public.events(id) on delete set null,
  operation text not null check(operation in ('create','edit')),
  model text not null,
  fingerprint text check(fingerprint is null or fingerprint ~ '^[a-f0-9]{64}$'),
  execution_id uuid,
  state text not null check(state in ('reserved','dispatched','completed','unknown','blocked','historical')),
  provider_calls integer check(provider_calls is null or provider_calls >= 0),
  usage jsonb check(usage is null or jsonb_typeof(usage)='object'),
  created_at timestamptz not null default now(),
  dispatched_at timestamptz,
  completed_at timestamptz,
  check(state not in ('reserved','dispatched') or fingerprint is not null),
  check(state <> 'dispatched' or execution_id is not null)
);
create index image_spend_requests_unresolved_idx on public.image_spend_requests(policy_id,state)
  where state in ('reserved','dispatched','unknown');
create index image_spend_requests_event_idx on public.image_spend_requests(event_id);
alter table public.image_spend_policies enable row level security;
alter table public.image_spend_requests enable row level security;
revoke all on public.image_spend_policies, public.image_spend_requests from public, anon, authenticated;
grant select,insert,update,delete on public.image_spend_policies, public.image_spend_requests to service_role;
create policy image_spend_policies_deny_data_api on public.image_spend_policies as restrictive
  for all to anon,authenticated using(false) with check(false);
create policy image_spend_requests_deny_data_api on public.image_spend_requests as restrictive
  for all to anon,authenticated using(false) with check(false);
insert into public.image_spend_policies(id) values('launch-preview-image-v1');
comment on table public.image_spend_policies is 'Server-only lifetime request ceilings for guarded Preview code; not provider-account billing caps. Never reset on deploy or timeout.';
comment on table public.image_spend_requests is 'Single-use image dispatch permits. Unknown outcomes retain their budget and stop new work; no credentials, prompts or pixels.';

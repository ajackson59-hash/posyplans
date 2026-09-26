-- Possession of a billing inbox must be proven before it can attach Plus.
-- Codes are HMAC digests only. No raw code or provider credential is persisted.
create table public.plus_link_challenges (
  id uuid primary key,
  event_id integer not null references public.events(id) on delete cascade,
  request_key uuid not null,
  recipient text not null check (recipient = lower(trim(recipient)) and length(recipient) between 3 and 320),
  recipient_hash text not null check (recipient_hash ~ '^[a-f0-9]{64}$'),
  code_hash text check (code_hash is null or code_hash ~ '^[a-f0-9]{64}$'),
  subscription_id text check (subscription_id is null or subscription_id ~ '^sub_[A-Za-z0-9_]+$'),
  customer_id text check (customer_id is null or customer_id ~ '^cus_[A-Za-z0-9_]+$'),
  state text not null default 'pending' check (state in ('pending','sending','sent','verifying','consumed','failed','superseded')),
  attempts integer not null default 0 check (attempts between 0 and 5),
  created_at bigint not null check (created_at >= 0),
  expires_at bigint not null,
  resend_at bigint not null,
  execution_id uuid,
  unique(event_id, request_key),
  check (expires_at > created_at and resend_at >= created_at + 60000),
  check (state not in ('sending','sent','verifying','consumed') or
    (code_hash is not null and subscription_id is not null and customer_id is not null)),
  check (state not in ('verifying','consumed') or execution_id is not null)
);
create index plus_link_challenges_event_latest_idx on public.plus_link_challenges(event_id, created_at desc);
create index plus_link_challenges_recipient_cooldown_idx on public.plus_link_challenges(recipient_hash, resend_at);
create table public.plus_link_rate_buckets (
  scope text not null check (scope in ('global','event','recipient','ip')),
  key_hash text not null check (key_hash ~ '^[a-f0-9]{64}$'),
  bucket_start bigint not null check (bucket_start >= 0),
  count integer not null default 0 check (count >= 0),
  primary key(scope, key_hash, bucket_start)
);
alter table public.plus_link_challenges enable row level security;
alter table public.plus_link_rate_buckets enable row level security;
revoke all on public.plus_link_challenges, public.plus_link_rate_buckets from public, anon, authenticated;
grant select,insert,update,delete on public.plus_link_challenges, public.plus_link_rate_buckets to service_role;
create policy plus_link_challenges_deny_data_api on public.plus_link_challenges as restrictive
  for all to anon,authenticated using(false) with check(false);
create policy plus_link_rate_buckets_deny_data_api on public.plus_link_rate_buckets as restrictive
  for all to anon,authenticated using(false) with check(false);
alter table public.event_plus_memberships drop constraint event_plus_memberships_source_check;
alter table public.event_plus_memberships add constraint event_plus_memberships_source_check
  check (source in ('checkout','subscription','historical_settlement','email_verification'));
comment on table public.plus_link_challenges is 'Private short-lived billing inbox verification. Retains no raw code; a consumed challenge binds only its exact event/subscription/customer.';
comment on table public.plus_link_rate_buckets is 'Private durable hourly issuance ceilings across event, HMAC recipient, HMAC IP, and application; not process-local counters.';

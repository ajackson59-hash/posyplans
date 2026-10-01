-- Contact email never grants membership. Stripe subscription identity and its
-- event-specific payment provenance stay server-only, outside event JSON.
create table public.plus_memberships (
  subscription_id text primary key check (subscription_id ~ '^sub_[A-Za-z0-9_]+$'),
  customer_id text not null check (customer_id ~ '^cus_[A-Za-z0-9_]+$'),
  plan_tier text not null check (plan_tier in ('plus_active', 'plus_trial', 'plus_expired')),
  trial_ends_at bigint,
  billing_interval text check (billing_interval is null or billing_interval in ('monthly', 'annual')),
  subscription_created_at bigint check (subscription_created_at >= 0),
  observed_at bigint not null check (observed_at >= 0)
);
create table public.event_plus_memberships (
  event_id integer primary key references public.events(id) on delete cascade,
  subscription_id text not null references public.plus_memberships(subscription_id),
  bound_at bigint not null check (bound_at >= 0),
  source text not null check (source in ('checkout', 'subscription', 'historical_settlement')),
  source_id text not null check (length(source_id) between 1 and 255)
);
create index event_plus_memberships_subscription_idx on public.event_plus_memberships(subscription_id);

alter table public.plus_memberships enable row level security;
alter table public.event_plus_memberships enable row level security;
revoke all on public.plus_memberships, public.event_plus_memberships from public, anon, authenticated;
grant select, insert, update, delete on public.plus_memberships, public.event_plus_memberships to service_role;
create policy plus_memberships_deny_data_api on public.plus_memberships
  as restrictive for all to anon, authenticated using (false) with check (false);
create policy event_plus_memberships_deny_data_api on public.event_plus_memberships
  as restrictive for all to anon, authenticated using (false) with check (false);
comment on table public.event_plus_memberships is
  'Server-only exact Plus subscription bindings from settled Stripe metadata, never from typed contact email. Backfill only with trusted settlement evidence.';
-- Deliberately no email-based backfill. Inventory and reconcile prior Stripe
-- purchase metadata before enabling this gate for an existing deployment.

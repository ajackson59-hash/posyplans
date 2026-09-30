-- Activity tracking only. No historical backfill, deletion or retention reset.
create table public.event_retention_activity (
  event_id integer primary key references public.events(id) on delete cascade,
  last_activity_at timestamptz not null default clock_timestamp(),
  first_recorded_at timestamptz not null default clock_timestamp(),
  last_activity_kind text not null check (last_activity_kind in ('created','host_visit','host_action','guest_rsvp'))
);
create index event_retention_activity_last_activity_idx on public.event_retention_activity(last_activity_at);
alter table public.event_retention_activity enable row level security;
revoke all on public.event_retention_activity from public, anon, authenticated;
grant select, insert, update, delete on public.event_retention_activity to service_role;
create policy event_retention_activity_deny_data_api on public.event_retention_activity
  as restrictive for all to anon, authenticated using (false) with check (false);
comment on table public.event_retention_activity is
  'Private server-observed deliberate event activity. Missing legacy rows mean unknown history; no automatic deletion. Never advance for polling, workers or webhooks.';

-- Both application creation paths are covered atomically, including the
-- criticalDb idempotent startup route. Existing events are left untouched.
create function public.record_event_creation_activity() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare observed_at timestamptz := clock_timestamp();
begin
  insert into public.event_retention_activity(event_id,last_activity_at,first_recorded_at,last_activity_kind)
    values (new.id,observed_at,observed_at,'created');
  return new;
end;
$$;
revoke all on function public.record_event_creation_activity() from public,anon,authenticated,service_role;
create trigger events_record_creation_activity after insert on public.events
  for each row execute function public.record_event_creation_activity();

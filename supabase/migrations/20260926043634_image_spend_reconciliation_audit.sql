-- Administrative accounting evidence, never a provider result or a refund.
-- Installing this schema does not reconcile a request or reopen a policy.
alter table public.image_spend_requests drop constraint image_spend_requests_state_check;
alter table public.image_spend_requests add constraint image_spend_requests_state_check
  check(state in ('reserved','dispatched','completed','unknown','blocked','historical','reconciled'));
alter table public.image_spend_requests add constraint image_spend_reconciled_unknown_usage
  check(state <> 'reconciled' or (usage is null and provider_calls = 1));

create table public.image_spend_reconciliations (
  request_id uuid primary key references public.image_spend_requests(id),
  policy_id text not null references public.image_spend_policies(id),
  reconciled_at timestamptz not null default clock_timestamp(),
  reconciled_by text not null default current_user,
  basis text not null check(basis = 'provider_exports_as_of'),
  export_day date not null,
  as_of_date date not null check(as_of_date >= export_day),
  cost_export_sha256 text not null check(cost_export_sha256 ~ '^[a-f0-9]{64}$'),
  activity_export_sha256 text not null check(activity_export_sha256 ~ '^[a-f0-9]{64}$'),
  export_day_total_usd_micros bigint not null check(export_day_total_usd_micros >= 0),
  reason text not null check(length(reason) between 20 and 2000),
  context jsonb not null check(jsonb_typeof(context) = 'object'),
  request_before jsonb not null check(jsonb_typeof(request_before) = 'object'),
  policy_before jsonb not null check(jsonb_typeof(policy_before) = 'object'),
  session_version integer not null check(session_version >= 0),
  session_payload_md5 text not null check(session_payload_md5 ~ '^[a-f0-9]{32}$')
);
alter table public.image_spend_reconciliations enable row level security;
revoke all on public.image_spend_reconciliations from public, anon, authenticated, service_role;
comment on table public.image_spend_reconciliations is
  'Append-only administrator accounting review. Usage remains unknown; export-day total is not an attributed request charge. No runtime or Data API write access.';

create function public.image_spend_audit_fence() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare
  p public.image_spend_policies%rowtype;
  r public.image_spend_requests%rowtype;
  s public.customer_artwork_sessions%rowtype;
begin
  if tg_op <> 'INSERT' then
    raise exception 'Image accounting audit is append-only';
  end if;
  -- Same lock order as request reservation/completion: policy, permit, session.
  select * into strict p from public.image_spend_policies where id = new.policy_id for update;
  select * into strict r from public.image_spend_requests where id = new.request_id for update;
  select * into strict s from public.customer_artwork_sessions where event_id = r.event_id for update;
  if not p.paused or r.policy_id <> p.id or r.state <> 'unknown'
    or r.usage is not null or r.provider_calls is distinct from 1
    or new.request_before is distinct from to_jsonb(r)
    or new.policy_before is distinct from to_jsonb(p)
    or new.session_version <> s.version
    or new.session_payload_md5 <> md5(s.payload::text) then
    raise exception 'Image accounting reconciliation precondition changed';
  end if;
  return new;
end;
$$;
revoke all on function public.image_spend_audit_fence() from public, anon, authenticated, service_role;
create trigger image_spend_audit_insert_fence before insert or update or delete
  on public.image_spend_reconciliations for each row execute function public.image_spend_audit_fence();
create trigger image_spend_audit_truncate_fence before truncate
  on public.image_spend_reconciliations for each statement execute function public.image_spend_audit_fence();

create function public.image_spend_reconciled_fence() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.state = 'reconciled' then raise exception 'Reconciliation requires an existing unknown request'; end if;
    return new;
  end if;
  if old.state = 'reconciled' then
    if to_jsonb(new) is distinct from to_jsonb(old) then
      raise exception 'Reconciled request evidence is immutable';
    end if;
  elsif new.state = 'reconciled' then
    if old.state <> 'unknown' or (to_jsonb(new) - 'state') is distinct from (to_jsonb(old) - 'state')
      or not exists(select 1 from public.image_spend_reconciliations a
        join public.image_spend_policies p on p.id = a.policy_id
        where a.request_id = old.id and a.policy_id = old.policy_id and p.paused
          and a.request_before = to_jsonb(old) and a.policy_before = to_jsonb(p)) then
      raise exception 'Reconciliation requires paused policy and matching audit evidence';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.image_spend_reconciled_fence() from public, anon, authenticated, service_role;
create trigger image_spend_reconciled_fence before insert or update
  on public.image_spend_requests for each row execute function public.image_spend_reconciled_fence();

create function public.image_spend_audit_commit_fence() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  -- Audit insertion and the sole ledger-state change must commit together.
  -- The reconciliation transaction cannot also unpause/reset/change a policy
  -- or rewrite the saved session that supplied the original failed evidence.
  if not exists(select 1 from public.image_spend_requests r
    join public.image_spend_policies p on p.id = r.policy_id
    join public.customer_artwork_sessions s on s.event_id = r.event_id
    where r.id = new.request_id and r.policy_id = new.policy_id and r.state = 'reconciled'
      and (to_jsonb(r) - 'state') = (new.request_before - 'state')
      and p.paused and to_jsonb(p) = new.policy_before
      and s.version = new.session_version and md5(s.payload::text) = new.session_payload_md5) then
    raise exception 'Image accounting audit and preserved evidence must commit together';
  end if;
  return null;
end;
$$;
revoke all on function public.image_spend_audit_commit_fence() from public, anon, authenticated, service_role;
create constraint trigger image_spend_audit_commit_fence after insert
  on public.image_spend_reconciliations deferrable initially deferred
  for each row execute function public.image_spend_audit_commit_fence();

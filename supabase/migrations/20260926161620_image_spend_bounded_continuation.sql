-- A continuation is an explicit, expiring administrator risk decision, NOT
-- reconciliation, a billing receipt, a refund or permission to retry a failure.
-- Schema installation grants no continuation and does not unpause spending.
create table public.image_spend_continuations (
  request_id uuid primary key references public.image_spend_requests(id),
  policy_id text not null references public.image_spend_policies(id),
  reviewed_at timestamptz not null default clock_timestamp(),
  reviewed_by text not null default current_user,
  expires_at timestamptz not null,
  allowed_event_ids integer[] not null check(cardinality(allowed_event_ids) between 1 and 3),
  request_ceiling integer not null,
  create_ceiling integer not null,
  edit_ceiling integer not null,
  reserved_unknown_usd_micros bigint not null check(reserved_unknown_usd_micros >= 1000000),
  planning_reserve_usd_micros bigint not null check(planning_reserve_usd_micros > reserved_unknown_usd_micros),
  reason text not null check(length(reason) between 20 and 2000),
  request_before jsonb not null check(jsonb_typeof(request_before)='object'),
  policy_before jsonb not null check(jsonb_typeof(policy_before)='object'),
  failed_attempt_md5 text not null check(failed_attempt_md5 ~ '^[a-f0-9]{32}$')
);
alter table public.image_spend_continuations enable row level security;
revoke all on public.image_spend_continuations from public,anon,authenticated,service_role;
grant select on public.image_spend_continuations to service_role;
comment on table public.image_spend_continuations is
  'Administrator-only bounded continuation for named unrelated fresh events. Unknown request/usage/counters remain unchanged. Reserve is a planning liability, not a provider-enforced dollar cap.';

create function public.image_spend_continuation_fence() returns trigger
language plpgsql security invoker set search_path='' as $$
declare
  p public.image_spend_policies%rowtype;
  r public.image_spend_requests%rowtype;
  a jsonb;
begin
  if tg_op <> 'INSERT' then raise exception 'Image spend continuation is append-only'; end if;
  select * into strict p from public.image_spend_policies where id=new.policy_id for update;
  select * into strict r from public.image_spend_requests where id=new.request_id for update;
  perform 1 from public.customer_artwork_sessions where event_id=r.event_id for update;
  select x.value into strict a from public.customer_artwork_sessions s,
    lateral jsonb_array_elements(s.payload->'attempts') x where s.event_id=r.event_id and x.value->>'id'=r.id::text;
  if not p.paused or p.stop_reason<>'provider_billing_unknown'
    or r.policy_id<>p.id or r.state<>'unknown' or r.usage is not null
    or r.provider_calls is distinct from 1 or r.dispatched_at is null or r.completed_at is null
    or new.request_before is distinct from to_jsonb(r) or new.policy_before is distinct from to_jsonb(p)
    or a->>'status' is distinct from 'failed' or a->>'billing' is distinct from 'unknown'
    or a#>>'{diagnostics,code}' is distinct from 'moderation_blocked'
    or a#>>'{diagnostics,type}' is distinct from 'image_generation_user_error'
    or a#>>'{diagnostics,moderationStage}' is distinct from 'output'
    or a#>>'{diagnostics,status}' is distinct from '400'
    or a->>'providerCalls' is distinct from '1'
    or a ? 'imageBase64' or a ? 'sourceBase64' or a ? 'telemetry'
    or new.failed_attempt_md5 is distinct from md5(a::text)
    or new.expires_at <= clock_timestamp() or new.expires_at > clock_timestamp()+interval '24 hours'
    or new.request_ceiling <= p.requests_reserved or new.request_ceiling > least(p.request_limit,p.requests_reserved+6)
    or new.create_ceiling < p.creates_reserved or new.create_ceiling > least(p.create_limit,p.creates_reserved+3)
    or new.edit_ceiling < p.edits_reserved or new.edit_ceiling > least(p.edit_limit,p.edits_reserved+3)
    or new.request_ceiling > new.create_ceiling+new.edit_ceiling
    or array_position(new.allowed_event_ids,null) is not null
    or cardinality(new.allowed_event_ids) <> (select count(distinct id) from unnest(new.allowed_event_ids) id)
    or r.event_id=any(new.allowed_event_ids)
    or exists(select 1 from public.image_spend_requests where policy_id=p.id and id<>r.id and state in('reserved','dispatched','unknown'))
    or exists(select 1 from unnest(new.allowed_event_ids) as scope(event_id) left join public.events e on e.id=scope.event_id
      where e.id is null or e.customer_artwork_enabled is not true or e.invite_status<>'draft' or e.draft_status<>'none'
        or exists(select 1 from public.image_spend_requests q where q.event_id=scope.event_id)
        or exists(select 1 from public.customer_artwork_sessions s where s.event_id=scope.event_id and
          (jsonb_array_length(s.payload->'attempts')<>0 or coalesce(jsonb_array_length(s.payload->'uploads'),0)<>0))) then
    raise exception 'Bounded continuation precondition changed';
  end if;
  new.reviewed_at=clock_timestamp(); new.reviewed_by=current_user;
  return new;
end;
$$;
revoke all on function public.image_spend_continuation_fence() from public,anon,authenticated,service_role;
create trigger image_spend_continuation_fence before insert or update or delete on public.image_spend_continuations
  for each row execute function public.image_spend_continuation_fence();
create trigger image_spend_continuation_truncate before truncate on public.image_spend_continuations
  for each statement execute function public.image_spend_continuation_fence();

create function public.image_spend_continuation_commit_fence() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if not exists(select 1 from public.image_spend_requests r join public.image_spend_policies p on p.id=r.policy_id
    join public.customer_artwork_sessions s on s.event_id=r.event_id
    where r.id=new.request_id and to_jsonb(r)=new.request_before and to_jsonb(p)=new.policy_before and p.paused
      and exists(select 1 from jsonb_array_elements(s.payload->'attempts') a
        where a->>'id'=r.id::text and md5(a::text)=new.failed_attempt_md5)) then
    raise exception 'Continuation must preserve unknown request and paused policy at commit';
  end if;
  return null;
end;
$$;
revoke all on function public.image_spend_continuation_commit_fence() from public,anon,authenticated,service_role;
create constraint trigger image_spend_continuation_commit_fence after insert on public.image_spend_continuations
  deferrable initially deferred for each row execute function public.image_spend_continuation_commit_fence();

create function public.image_spend_continued_request_fence() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if exists(select 1 from public.image_spend_continuations where request_id=old.id)
    and to_jsonb(new) is distinct from to_jsonb(old)
    and not(new.state='reconciled' and (to_jsonb(new)-'state')=(to_jsonb(old)-'state')) then
    raise exception 'Continued unknown request evidence is immutable';
  end if;
  return new;
end;
$$;
revoke all on function public.image_spend_continued_request_fence() from public,anon,authenticated,service_role;
create trigger image_spend_continued_request_fence before update on public.image_spend_requests
  for each row execute function public.image_spend_continued_request_fence();

-- Called only by the server's existing guard. Missing/expired/mismatched audit
-- returns false. Reserved/dispatched permits are NEVER cleared by this function.
create function public.image_spend_unknown_continuable(request_id uuid, target_event integer,
  target_operation text, already_reserved boolean default false) returns boolean
language sql stable security invoker set search_path='' as $$
select exists (
  select 1 from public.image_spend_continuations c
  join public.image_spend_requests r on r.id=c.request_id
  join public.image_spend_policies p on p.id=c.policy_id
  join public.customer_artwork_sessions s on s.event_id=r.event_id
  where c.request_id=$1 and r.state='unknown' and r.policy_id=p.id and to_jsonb(r)=c.request_before
    and c.expires_at>statement_timestamp() and $2=any(c.allowed_event_ids) and $2<>r.event_id
    and p.request_limit=(c.policy_before->>'request_limit')::integer
    and p.create_limit=(c.policy_before->>'create_limit')::integer
    and p.edit_limit=(c.policy_before->>'edit_limit')::integer
    and p.requests_reserved >= (c.policy_before->>'requests_reserved')::integer
    and p.creates_reserved >= (c.policy_before->>'creates_reserved')::integer
    and p.edits_reserved >= (c.policy_before->>'edits_reserved')::integer
    and p.requests_reserved + case when $4 then 0 else 1 end <= c.request_ceiling
    and p.creates_reserved <= c.create_ceiling and p.edits_reserved <= c.edit_ceiling
    and (($3='create' and p.creates_reserved + case when $4 then 0 else 1 end <= c.create_ceiling)
      or ($3='edit' and p.edits_reserved + case when $4 then 0 else 1 end <= c.edit_ceiling)
      or ($3 is null and (p.creates_reserved<c.create_ceiling or p.edits_reserved<c.edit_ceiling)))
    and exists(select 1 from jsonb_array_elements(s.payload->'attempts') a
      where a->>'id'=r.id::text and md5(a::text)=c.failed_attempt_md5)
);
$$;
revoke all on function public.image_spend_unknown_continuable(uuid,integer,text,boolean) from public,anon,authenticated;
grant execute on function public.image_spend_unknown_continuable(uuid,integer,text,boolean) to service_role;

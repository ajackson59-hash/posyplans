-- Explicitly authorized implementation of bounded recovery (26 September 2026).
-- Run only after migration/CI and exact Preview review. NOT reconciliation.
-- Leaves the policy paused; no provider request, retry, counter reset or refund.
begin;
set local lock_timeout='5s';
set local statement_timeout='20s';
do $review$
declare
  p public.image_spend_policies%rowtype;
  r public.image_spend_requests%rowtype;
  s public.customer_artwork_sessions%rowtype;
  a jsonb;
begin
  select * into strict p from public.image_spend_policies where id='launch-preview-image-v1' for update;
  select * into strict r from public.image_spend_requests where id='3e0b6097-3fc8-4f96-9bfe-bca217a6e729' for update;
  select * into strict s from public.customer_artwork_sessions where event_id=80 for update;
  if not p.paused or p.stop_reason<>'provider_billing_unknown'
    or p.request_limit<>16 or p.create_limit<>8 or p.edit_limit<>8
    or p.requests_reserved<>7 or p.creates_reserved<>4 or p.edits_reserved<>3
    or r.event_id<>80 or r.policy_id<>p.id or r.state<>'unknown' or r.provider_calls<>1 or r.usage is not null
    or r.fingerprint<>'d377d7df0bfa45e76a0fb5fce4603a0f1788a8af54077ee553c12eb6c1751952'
    or s.version<>2 or md5(s.payload::text)<>'1a5e3adecae3ff2ab9fb546c7a133147'
    or (select count(*) from public.image_spend_requests where policy_id=p.id)<>7
    or exists(select 1 from public.image_spend_requests where policy_id=p.id and id<>r.id and state in('reserved','dispatched','unknown'))
    or exists(select 1 from public.image_spend_continuations where request_id=r.id) then
    raise exception 'Event80 bounded-review baseline changed; keep spending paused';
  end if;
  a=s.payload->'attempts'->0;
  if a->>'id'<>r.id::text or a#>>'{diagnostics,requestId}'<>'req_f4a2f2dfdcdb4237965afd5a5ff6402a'
    or a#>>'{diagnostics,promptSha256}'<>'4a417009405669bf5393b4ffeca5d8cfa3f81411b082cd4338c41aec394e9810' then
    raise exception 'Event80 provider evidence changed';
  end if;
  insert into public.image_spend_continuations(request_id,policy_id,expires_at,allowed_event_ids,
    request_ceiling,create_ceiling,edit_ceiling,reserved_unknown_usd_micros,planning_reserve_usd_micros,
    reason,request_before,policy_before,failed_attempt_md5)
  values(r.id,p.id,clock_timestamp()+interval '24 hours',array[81,82,83],13,7,6,1000000,5000000,
    'User authorized bounded recovery on 2026-09-26. Reserve $1 of the existing $5 planning reserve for unknown Event80 liability; retain one consumed call and null usage. Permit only frozen unrelated cases06–08, no Event80 retry, within original16/8/8 lifetime limits.',
    to_jsonb(r),to_jsonb(p),md5(a::text));
end
$review$;
commit;
select request_id,allowed_event_ids,expires_at,request_ceiling,create_ceiling,edit_ceiling,
  reserved_unknown_usd_micros,planning_reserve_usd_micros from public.image_spend_continuations
where request_id='3e0b6097-3fc8-4f96-9bfe-bca217a6e729';

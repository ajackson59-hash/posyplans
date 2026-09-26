-- Applied 2026-09-26 solely in Supabase Preview project zniggkeyyohniqrccblm.
-- Retained as guarded, idempotent provenance; do not run on other projects.
-- Evidence: Posy-Checkout-Verification-2026-09-16.md, Library
-- libfile_0863e0bb4eb08191874bfa0bb60a6411 version 6, lines 65-111.
-- This is a narrowly documented historical synthetic purchase, not email-based
-- membership inference or a fresh Stripe status check. No email/provider call.
begin;
do $$
declare
  legacy public.email_entitlements%rowtype;
  original public.events%rowtype;
  current_membership public.plus_memberships%rowtype;
  current_binding public.event_plus_memberships%rowtype;
begin
  -- Stop on inventory drift; no broad import is permitted by this script.
  if (select count(*) from public.email_entitlements) <> 1 then
    raise exception 'Preview membership inventory changed; re-audit before backfill';
  end if;
  select * into strict legacy from public.email_entitlements
    where plan_tier='plus_active' and billing_interval='monthly'
      and created_at=1789522952486 and updated_at=1789527307845
      and md5(stripe_subscription_id)='2cd996431cf10b988cd4ddfd95ab77d0'
      and md5(stripe_customer_id)='4e324f61721ac4809337cafa3fde1a68'
    for update;
  select * into strict original from public.events
    where id=66 and created_at=1789522856303 and draft_status='none'
      and invite_status='draft' and spark_unlocked_at is null
      and md5(owner_token)='970aef5f03d50ff6fe885d9c10c45785'
      and md5(captured_email)='5561d6c50702611f2e931bb21f84de8b'
      and md5(invite_artwork_url)='5d3ec9985b1c79eeb46d19ed15e64c01'
      and md5(invite_illustration_url)='5d3ec9985b1c79eeb46d19ed15e64c01'
    for update;
  if original.captured_email <> legacy.email
    or (select count(*) from public.events where captured_email=legacy.email) <> 1
    or exists(select 1 from public.guests where event_id=66)
    or exists(select 1 from public.plan_regenerations where event_id=66)
    or not exists(select 1 from public.master_planner_generations
      where id=4 and event_id=66 and kind='qa_no_model_guard' and state='consumed') then
    raise exception 'Original synthetic event evidence changed';
  end if;
  if (select count(*) from public.analytics_events
      where email=legacy.email and event_name='subscribed') <> 1
    or not exists(select 1 from public.analytics_events where id=1
      and email=legacy.email and event_name='subscribed' and billing_interval='monthly'
      and created_at=1789523797268
      and metadata_json::jsonb->>'subscriptionId'=legacy.stripe_subscription_id
      and md5(metadata_json)='7c8eb0f77e783a6a349b2f79d7bd09a4') then
    raise exception 'Exact settled subscription evidence changed';
  end if;

  select * into current_membership from public.plus_memberships
    where subscription_id=legacy.stripe_subscription_id for update;
  if found and (current_membership.customer_id <> legacy.stripe_customer_id
    or current_membership.plan_tier <> 'plus_active') then
    raise exception 'New membership state conflicts with historical evidence';
  end if;
  select * into current_binding from public.event_plus_memberships where event_id=66 for update;
  if found and current_binding.subscription_id <> legacy.stripe_subscription_id then
    raise exception 'Event already has a different proven membership';
  end if;
  -- Stripe subscription.created is absent from the historical report; NULL is
  -- deliberate. Never substitute the local entitlement row's created_at.
  insert into public.plus_memberships(subscription_id,customer_id,plan_tier,trial_ends_at,
    billing_interval,subscription_created_at,observed_at)
  values(legacy.stripe_subscription_id,legacy.stripe_customer_id,legacy.plan_tier,
    legacy.trial_ends_at,legacy.billing_interval,null,legacy.updated_at)
  on conflict(subscription_id) do nothing;
  insert into public.event_plus_memberships(event_id,subscription_id,bound_at,source,source_id)
  values(66,legacy.stripe_subscription_id,1789523797268,'historical_settlement',
    'checkout-verification-20260916-v6:analytics-1:event-66')
  on conflict(event_id) do nothing;
end $$;
-- Sanitized readback only. No owner token, email, Stripe ID or invoice data.
select b.event_id,m.plan_tier,m.billing_interval,b.source,b.source_id,
  md5(m.subscription_id) as subscription_fingerprint,md5(m.customer_id) as customer_fingerprint,
  m.subscription_created_at,m.observed_at
from public.event_plus_memberships b join public.plus_memberships m using(subscription_id)
where b.event_id=66;
commit;

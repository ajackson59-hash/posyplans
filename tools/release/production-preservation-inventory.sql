-- Read-only. No contact details, owner tokens, Stripe IDs, prompts or pixels.
-- Run against the explicitly selected Production project before/after release.
select jsonb_build_object(
  'events', (select count(*) from public.events),
  'spark_unlocked', (select count(*) from public.events where spark_unlocked_at is not null),
  'saved_artwork', (select count(*) from public.events where coalesce(invite_artwork_url,'')<>'' or coalesce(custom_invite_image_url,'')<>''),
  'ready_plans', (select count(*) from public.events where draft_status in ('ready','failed_partial')),
  'running_plans', (select count(*) from public.events where draft_status='generating'),
  'event_snapshot', (select md5(coalesce(string_agg(md5(row_to_json(e)::text),'' order by id),'')) from public.events e),
  'entitlement_snapshot', (select md5(coalesce(string_agg(md5(row_to_json(e)::text),'' order by id),'')) from public.email_entitlements e),
  'entitlements', (select jsonb_agg(t) from (select plan_tier,count(*) as records,
    count(*) filter(where stripe_customer_id is not null and stripe_subscription_id is not null) as with_pair
    from public.email_entitlements group by plan_tier) t),
  'duplicate_image_keys', (select count(*) from (select idempotency_key from public.ai_first_artwork_attempts
    where idempotency_key is not null group by idempotency_key having count(*)>1) d)
) as inventory;

select c.relname as table_name,c.relrowsecurity as rls,
  has_table_privilege('anon',c.oid,'SELECT') as anon_select,
  has_table_privilege('authenticated',c.oid,'SELECT') as authenticated_select
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r' order by c.relname;

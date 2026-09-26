-- Reviewed Preview evidence only. Run after the reconciliation-audit migration.
-- This file is NOT a migration and is never run by the application or CI deploy.
-- It reconciles accounting as of the two supplied exports, not provider usage,
-- final lifetime invoice certainty, successful artwork, or permission to retry.
-- It deliberately leaves the policy paused and every limit/counter unchanged.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '20s';
do $reconcile_event75$
declare
  p public.image_spend_policies%rowtype;
  r public.image_spend_requests%rowtype;
  s public.customer_artwork_sessions%rowtype;
  a public.image_spend_reconciliations%rowtype;
  evidence jsonb := '{
    "schemaVersion":1,
    "environment":"Preview",
    "branch":"codex/launch-blockers",
    "trialId":"customer-flow-20260923-03",
    "eventId":75,
    "permitId":"02421bef-9f67-46c6-8498-88e7279a1e26",
    "providerRequestId":"req_416d75c32ada4ca3929e9c23794f0d8e",
    "promptSha256":"c3a1fc52c64c4a4004d141705e66c4fd95e0a8597d4623f1b08c3a848b0ba314",
    "exportWindowStart":"2026-09-25T00:00:00Z",
    "exportWindowEndExclusive":"2026-09-26T00:00:00Z",
    "exportGeneratedAt":null,
    "asOfMeaning":"User-provided exports labelled through 2026-09-26; generation timestamp unavailable",
    "costFile":"cost_2026-08-27_2026-09-26.csv",
    "activityFile":"completions_usage_2026-08-27_2026-09-26.csv",
    "activityProjectIdSha256":"74b8fe4b0ee0abf0312d626ca15eea509903d7dfce8cdcbe3d8a791bfd152e7d",
    "activityApiKeyIdSha256":"921c26a702eba3021b76f22eee4f1c7a938aff8be098741a9f872ea5e7d99a3c",
    "costOrganizationIdSha256":"c5b1824b76d554adf38400a4a10ec60587b02d8665f3fe525cb89e5bec403fe7",
    "matchingRecordedRequest":{
      "eventId":74,"permitId":"26ae49b3-52b5-41a7-a105-a4fa8c7eea74",
      "model":"gpt-image-2","batch":false,"serviceTier":"default","numModelRequests":1,
      "inputTokens":2736,"textInputTokens":1200,"imageInputTokens":1536,
      "outputTokens":1372,"imageOutputTokens":1372,"textOutputTokens":0,"cachedInputTokens":0,
      "estimatedUsdMicros":59448
    },
    "accountingConclusion":"No additional failed-request billing is recorded in these exports as of review",
    "exportDayTotalScope":"Entire exported UTC day; includes Event74, not an attributed Event75 charge",
    "event75AttributedChargeUsd":null,
    "event75ProviderUsageKnown":false,
    "event75ArtworkStatus":"failed",
    "event75RetryAuthorized":false,
    "policyUnpauseAuthorizedByThisReconciliation":false
  }'::jsonb;
  explanation text := 'The supplied Activity export records one nonbatch/default gpt-image-2 request on September 25 with the exact retained Event74 usage. Its standard-rate estimate equals the full exported USD 0.059448 daily cost. No additional failed-request billing is recorded as of these exports. Event75 request usage and attributed charge remain unknown; its failed result and physical call remain retained. This accounting reconciliation does not authorize an Event75 retry or reopen generation.';
  changed integer;
begin
  select * into strict p from public.image_spend_policies
    where id = 'launch-preview-image-v1' for update;
  if not p.paused or p.stop_reason <> 'provider_billing_unknown'
    or p.request_limit <> 16 or p.create_limit <> 8 or p.edit_limit <> 8
    or p.requests_reserved <> 4 or p.creates_reserved <> 2 or p.edits_reserved <> 2 then
    raise exception 'Event75 reconciliation requires the exact paused four-call cohort';
  end if;
  perform 1 from public.image_spend_requests where policy_id = p.id order by id for update;
  select * into strict r from public.image_spend_requests
    where id = '02421bef-9f67-46c6-8498-88e7279a1e26' and policy_id = p.id;
  if r.event_id is distinct from 75 or r.operation <> 'create' or r.model <> 'gpt-image-2'
    or r.state not in ('unknown','reconciled') or r.provider_calls is distinct from 1 or r.usage is not null
    or r.fingerprint is not null or r.execution_id is not null or r.dispatched_at is not null
    or r.created_at is distinct from to_timestamp(1790309032547::numeric / 1000)
    or r.completed_at is distinct from to_timestamp(1790309072683::numeric / 1000) then
    raise exception 'Event75 imported permit differs from reviewed failed-request evidence';
  end if;
  if (select count(*) from public.image_spend_requests where policy_id = p.id) <> 4
    or (select count(*) from public.image_spend_requests where policy_id = p.id
      and state = 'historical' and provider_calls = 1 and usage is not null and model = 'gpt-image-2'
      and ((id = '7dfd96c3-6372-45f3-b00a-017619455731' and event_id = 73 and operation = 'create')
        or (id = 'e27b8e62-226d-4ea3-ad16-86077d469529' and event_id = 73 and operation = 'edit')
        or (id = '26ae49b3-52b5-41a7-a105-a4fa8c7eea74' and event_id = 74 and operation = 'edit'))) <> 3
    or not exists(select 1 from public.image_spend_requests where id = '26ae49b3-52b5-41a7-a105-a4fa8c7eea74'
      and usage @> '{"inputTokens":2736,"textInputTokens":1200,"imageInputTokens":1536,"outputTokens":1372,"imageOutputTokens":1372,"textOutputTokens":0}'::jsonb
      and created_at >= '2026-09-25T00:00:00Z'::timestamptz
      and completed_at < '2026-09-26T00:00:00Z'::timestamptz) then
    raise exception 'Recorded cohort or matching Event74 usage differs from reviewed exports';
  end if;
  select * into strict s from public.customer_artwork_sessions where event_id = 75 for update;
  if s.version <> 2 or md5(s.payload::text) <> '0701076221b3bbb3cef5e517a5682efb'
    or jsonb_array_length(s.payload->'attempts') <> 1
    or not (s.payload->'attempts'->0 @> '{"id":"02421bef-9f67-46c6-8498-88e7279a1e26","status":"failed","billing":"unknown","failure":"provider","providerCalls":1,"diagnostics":{"code":"moderation_blocked","requestId":"req_416d75c32ada4ca3929e9c23794f0d8e","moderationStage":"output"}}'::jsonb) then
    raise exception 'Event75 saved failed session changed; preserve and inspect it';
  end if;

  select * into a from public.image_spend_reconciliations where request_id = r.id;
  if found then
    -- Re-running this exact reviewed script while still paused is a no-op.
    if r.state <> 'reconciled' or a.policy_id <> p.id or a.basis <> 'provider_exports_as_of'
      or a.export_day <> date '2026-09-25' or a.as_of_date <> date '2026-09-26'
      or a.cost_export_sha256 <> 'b2562889cf5dc847a9b478912236e1d7cdd20ae51ad9e58d4d2057dd4a28d048'
      or a.activity_export_sha256 <> '2effa8eed39c8556c8eae61a5e7b178076199a96597917cd04468630f5bf44e2'
      or a.export_day_total_usd_micros <> 59448 or a.context <> evidence or a.reason <> explanation
      or a.request_before <> jsonb_set(to_jsonb(r), '{state}', '"unknown"'::jsonb)
      or a.policy_before <> to_jsonb(p) or a.session_version <> s.version
      or a.session_payload_md5 <> md5(s.payload::text) then
      raise exception 'Existing Event75 reconciliation differs; no evidence may be overwritten';
    end if;
    return;
  end if;
  if r.state <> 'unknown' then raise exception 'Missing audit for reconciled Event75'; end if;

  insert into public.image_spend_reconciliations
    (request_id, policy_id, basis, export_day, as_of_date, cost_export_sha256, activity_export_sha256,
     export_day_total_usd_micros, reason, context, request_before, policy_before, session_version, session_payload_md5)
    values(r.id, p.id, 'provider_exports_as_of', date '2026-09-25', date '2026-09-26',
      'b2562889cf5dc847a9b478912236e1d7cdd20ae51ad9e58d4d2057dd4a28d048',
      '2effa8eed39c8556c8eae61a5e7b178076199a96597917cd04468630f5bf44e2',
      59448, explanation, evidence, to_jsonb(r), to_jsonb(p), s.version, md5(s.payload::text));
  update public.image_spend_requests set state = 'reconciled'
    where id = r.id and state = 'unknown' and to_jsonb(image_spend_requests) = to_jsonb(r);
  get diagnostics changed = row_count;
  if changed <> 1 then raise exception 'Event75 ledger compare-and-set lost'; end if;
end
$reconcile_event75$;
set constraints all immediate;
commit;

-- Sanitized readback: no session content, owner credentials or billing IDs.
select r.event_id, r.id as permit_id, r.state, r.provider_calls, r.usage is null as usage_still_unknown,
  p.paused, p.stop_reason, p.request_limit, p.requests_reserved, p.creates_reserved, p.edits_reserved,
  a.basis, a.export_day, a.as_of_date, a.export_day_total_usd_micros, a.reconciled_at,
  a.cost_export_sha256, a.activity_export_sha256, a.session_version, a.session_payload_md5
from public.image_spend_requests r
join public.image_spend_policies p on p.id = r.policy_id
join public.image_spend_reconciliations a on a.request_id = r.id
where r.id = '02421bef-9f67-46c6-8498-88e7279a1e26';

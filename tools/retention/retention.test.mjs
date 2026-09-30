import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { CONTENT_TABLES, planDeletion, executeDeletion, reportRetention } from './retention.mjs';

const modulePath = process.env.POSY_RETENTION_PGLITE_MODULE;
if (!modulePath) throw Error('POSY_RETENTION_PGLITE_MODULE must identify a pinned disposable PGlite module; no live database fallback.');
const { PGlite } = await import(pathToFileURL(modulePath).href);
const migrations = new URL('../../supabase/migrations/', import.meta.url);
let originalFetch;

before(async () => {
  // PGlite filesystem/WASM initialization does not need external provider traffic.
  originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw Error('Network forbidden in retention fixture'); };
});
after(() => { globalThis.fetch = originalFetch; });

async function setup() {
  const pg = new PGlite();
  await pg.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  for (const name of (await readdir(migrations)).filter(n => n.endsWith('.sql')).sort()) {
    await pg.exec(await readFile(new URL(name, migrations), 'utf8'));
  }
  const query = async (sql, params = []) => (await pg.query(sql, params)).rows;
  const db = { query, transaction: async (mode, callback) => {
    await pg.exec(mode === 'read' ? 'begin isolation level repeatable read read only' : 'begin');
    try { const result = await callback({ query }); await pg.exec('commit'); return result; }
    catch (error) { await pg.exec('rollback'); throw error; }
  } };
  await query(`insert into events(id,owner_token,share_slug,event_name,created_at,captured_email,custom_invite_image_url)
    values (1,'private-owner-1','private-share-1','Private synthetic name',1,'same@example.invalid','data:image/png;base64,ORIGINAL'),
      (2,'private-owner-2','private-share-2','Unrelated synthetic name',1,'same@example.invalid','data:image/png;base64,UNRELATED')`);
  await query(`insert into plus_memberships values ('sub_shared','cus_shared','plus_active',null,'monthly',1,1)`);
  await query(`insert into email_entitlements(email,created_at,updated_at,stripe_subscription_id) values ('same@example.invalid',1,1,'sub_shared')`);
  await query(`insert into plus_link_rate_buckets values('global',repeat('a',64),0,4)`);
  await query(`insert into analytics_events(event_name,email,metadata_json,created_at) values('subscribed','same@example.invalid','{"eventId":1}',1)`);
  await query(`insert into theme_suggestion_cache(cache_key,theme,suggestions_json,created_at) values('shared','Private theme','{}',1)`);
  for (const id of [1, 2]) {
    await query('insert into guests(event_id,name,email,note) values($1,$2,$3,$4)', [id,'Private guest','guest@example.invalid','Dietary note']);
    await query('insert into budget_items(event_id,name,notes) values($1,$2,$3)',[id,'Private budget','Private notes']);
    await query('insert into menu_items(event_id,item_name) values($1,$2)',[id,'Private menu']);
    await query('insert into shopping_list_items(event_id,item_name) values($1,$2)',[id,'Private shopping']);
    await query('insert into timeline_items(event_id,title) values($1,$2)',[id,'Private timeline']);
    await query('insert into master_planner_generations(event_id,completed_stages) values($1,$2)',[id,'["private generation"]']);
    await query(`insert into ai_first_previews(event_id,preview_id,concept_fingerprint,asset_hash,asset_url,concept_json,created_at,last_accessed_at)
      values($1,$2,'hash','hash','data:image/png;base64,SAVED','{"prompt":"private prompt"}',1,1)`,[id,`preview-${id}`]);
    await query(`insert into ai_first_artwork_attempts(event_id,owner_token,direction_index,attempt,status,asset_hash,asset_bytes_base64,concept_json,failure_codes_json,tier1_findings_json,created_at)
      values($1,'private-owner',0,1,'rejected','hash','REJECTED','{"prompt":"private prompt"}','[]','[]',1)`,[id]);
    await query(`insert into ai_first_generation_runs(event_id,run_id,owner_token,status,terminal,created_at,updated_at)
      values($1,$2,'private-owner','completed',true,1,1)`,[id,`run-${id}`]);
    const reviewId = `review-${id}`;
    const payload = {id:reviewId,eventId:id,briefHash:'a'.repeat(64),state:'rejected',version:0,ownerToken:'private-owner',brief:'private',history:['ORIGINAL','REJECTED']};
    await query(`insert into human_artwork_reviews(id,event_id,brief_hash,state,payload) values($1,$2,$3,'rejected',$4::jsonb)`,[reviewId,id,'a'.repeat(64),JSON.stringify(payload)]);
    await query(`insert into customer_artwork_sessions(event_id,payload) values($1,$2::jsonb)`,[id,JSON.stringify({eventId:id,ownerHash:'private-hash',version:0,attempts:[],selections:{},uploads:['ORIGINAL']})]);
    await query(`insert into plan_regenerations(id,event_id,request_id,state,created_at,updated_at,base,candidate,previous)
      values($1,$2,'private-request','applied',1,1,'{"guest":"old private guest"}','{"guest":"current"}','{"guest":"previous"}')`,[`10000000-0000-4000-8000-${String(id).padStart(12,'0')}`,id]);
    await query(`insert into event_plus_memberships values($1,'sub_shared',1,'checkout','synthetic-checkout')`,[id]);
    await query(`insert into plus_link_challenges(id,event_id,request_key,recipient,recipient_hash,created_at,expires_at,resend_at)
      values($1,$2,$1,'same@example.invalid',repeat('a',64),0,120000,60000)`,[`20000000-0000-4000-8000-${String(id).padStart(12,'0')}`,id]);
    await query(`insert into ai_first_image_ledger(event_id,email,reason,cost_usd_micros,created_at)
      values($1,'same@example.invalid','initial',10000,1)`,[id]);
    await query(`insert into image_spend_requests(id,policy_id,event_id,operation,model,state,provider_calls)
      values($1,'launch-production-image-v1',$2,'create','synthetic-only','completed',1)`,[`30000000-0000-4000-8000-${String(id).padStart(12,'0')}`,id]);
  }
  await query(`update image_spend_policies set requests_reserved=2,creates_reserved=2 where id='launch-production-image-v1'`);
  return { pg, db, query };
}

function approval(plan) {
  return {execute:true,eventId:plan.eventId,basis:plan.basis,fingerprint:plan.fingerprint,requestId:'synthetic_request_1',
    requesterVerifiedForWholeEvent:true,inactivityReviewApproved:true,maintenanceReference:'synthetic_maintenance_1',
    maintenanceActive:true,allWritersDrained:true,legacyWorkersCannotResume:true,residualScopesReviewed:true,backupDeletionLedgerPrepared:true};
}

async function snapshot(q) {
  const tables = await q("select tablename from pg_tables where schemaname='public' order by tablename");
  const out = {};
  for (const {tablename} of tables) out[tablename] = (await q(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') as data from public.${tablename} t`))[0].data;
  return out;
}

async function run(body) {
  const context = await setup();
  try { await body(context); } finally { await context.pg.close(); }
}

test('ordinary deletion removes all event content and preserves unrelated/shared/accounting records', async () => run(async ({db,query}) => {
  const before = await snapshot(query);
  const plan = await planDeletion(db,1);
  assert.deepEqual(plan.blockers,[]);
  assert.ok(CONTENT_TABLES.every(t => plan.content[t].count === 1));
  const report = JSON.stringify(plan);
  for (const secret of ['private-owner','same@example.invalid','private prompt','Dietary note','REJECTED']) assert.ok(!report.includes(secret));
  assert.deepEqual(await snapshot(query),before,'planning is read-only');
  const receipt = await executeDeletion(db,plan,approval(plan));
  assert.equal(receipt.deletedCounts.events,1);
  assert.equal(receipt.detachedSpendRows,1);
  assert.equal(receipt.retainedLegacyAccountingRows,1);
  const after = await snapshot(query);
  for (const table of ['events',...CONTENT_TABLES]) {
    assert.deepEqual(after[table],before[table].filter(r => (table==='events'?r.id:r.event_id)!==1),table);
  }
  for (const table of Object.keys(before).filter(t=>!['events',...CONTENT_TABLES,'image_spend_requests'].includes(t))) assert.deepEqual(after[table],before[table],table);
  assert.deepEqual(after.image_spend_requests,before.image_spend_requests.map(r=>({...r,event_id:r.event_id===1?null:r.event_id})));
  assert.equal(after.events[0].owner_token,'private-owner-2');
  assert.ok(!JSON.stringify(receipt).includes('same@example.invalid'));
}));

test('stale fingerprint rejects a changed child without deleting any row', async () => run(async ({db,query}) => {
  const plan=await planDeletion(db,1);
  await query("update guests set note='Changed by late worker' where event_id=1");
  const before=await snapshot(query);
  await assert.rejects(executeDeletion(db,plan,approval(plan)),/stale_plan/);
  assert.deepEqual(await snapshot(query),before);
}));

test('immutable reconciliation stops before mutation; existing audit triggers remain enabled', async () => run(async ({db,query}) => {
  await db.transaction('write',async tx=>{
    await tx.query("update image_spend_requests set state='unknown' where event_id=1");
    await tx.query(`insert into image_spend_reconciliations(request_id,policy_id,basis,export_day,as_of_date,
      cost_export_sha256,activity_export_sha256,export_day_total_usd_micros,reason,context,request_before,policy_before,session_version,session_payload_md5)
      select r.id,r.policy_id,'provider_exports_as_of',current_date,current_date,repeat('a',64),repeat('b',64),0,
        'Synthetic accounting review evidence','{}',to_jsonb(r),to_jsonb(p),s.version,md5(s.payload::text)
      from image_spend_requests r join image_spend_policies p on p.id=r.policy_id
      join customer_artwork_sessions s on s.event_id=r.event_id where r.event_id=1`);
    await tx.query("update image_spend_requests set state='reconciled' where event_id=1");
  });
  const before=await snapshot(query);
  const plan=await planDeletion(db,1);
  assert.ok(plan.blockers.includes('immutable_image_evidence_requires_separate_review'));
  await assert.rejects(executeDeletion(db,plan,approval(plan)),/immutable_image_evidence/);
  assert.deepEqual(await snapshot(query),before);
  await assert.rejects(query('delete from events where id=1'),/immutable/);
}));

test('immutable continuation protects its failed event and its allowed fresh event', async () => run(async ({db,query}) => {
  const requestId='30000000-0000-4000-8000-000000000001';
  await query('delete from image_spend_requests where event_id=2');
  await query("update events set customer_artwork_enabled=true,invite_status='draft' where id=2");
  await query("update customer_artwork_sessions set payload=jsonb_set(payload,'{uploads}','[]') where event_id=2");
  await query(`update image_spend_policies set stop_reason='provider_billing_unknown',request_limit=4,create_limit=4,
    requests_reserved=1,creates_reserved=1 where id='launch-production-image-v1'`);
  await query("update image_spend_requests set state='unknown',dispatched_at=now(),completed_at=now() where event_id=1");
  const attempt={id:requestId,status:'failed',billing:'unknown',providerCalls:1,
    diagnostics:{code:'moderation_blocked',type:'image_generation_user_error',moderationStage:'output',status:400}};
  await query("update customer_artwork_sessions set payload=jsonb_set(payload,'{attempts}',$1::jsonb) where event_id=1",[JSON.stringify([attempt])]);
  await query(`insert into image_spend_continuations(request_id,policy_id,expires_at,allowed_event_ids,
    request_ceiling,create_ceiling,edit_ceiling,reserved_unknown_usd_micros,planning_reserve_usd_micros,
    reason,request_before,policy_before,failed_attempt_md5)
    select r.id,r.policy_id,now()+interval '1 hour',array[2],4,4,0,1000000,2000000,
      'Synthetic continuation for unrelated fresh event',to_jsonb(r),to_jsonb(p),md5((s.payload->'attempts'->0)::text)
    from image_spend_requests r join image_spend_policies p on p.id=r.policy_id
    join customer_artwork_sessions s on s.event_id=r.event_id where r.event_id=1`);
  const before=await snapshot(query);
  for(const id of [1,2]) {
    const plan=await planDeletion(db,id);
    await assert.rejects(executeDeletion(db,plan,approval(plan)),/immutable_image_evidence/);
  }
  assert.deepEqual(await snapshot(query),before);
  await assert.rejects(query('delete from events where id=1'),/immutable/);
}));

test('failure after child deletes rolls the entire deletion back', async () => run(async ({db,query,pg}) => {
  await pg.exec(`create function public.synthetic_delete_failure() returns trigger language plpgsql as $$
    begin raise exception 'Synthetic event delete failure'; end; $$;
    create trigger synthetic_delete_failure before delete on public.events for each row execute function public.synthetic_delete_failure();`);
  const plan=await planDeletion(db,1);
  const before=await snapshot(query);
  await assert.rejects(executeDeletion(db,plan,approval(plan)),/Synthetic event delete failure/);
  assert.deepEqual(await snapshot(query),before);
}));

test('inactivity uses calendar months, unknown history never qualifies, and expired plans fail', async () => run(async ({db,query}) => {
  await query("update event_retention_activity set last_activity_at='2024-02-29 12:00:00+00' where event_id=1");
  await query('delete from event_retention_activity where event_id=2');
  const report=await reportRetention(db);
  assert.equal(new Date(report.events[0].due_at).toISOString(),'2025-02-28T12:00:00.000Z');
  assert.equal(report.events[0].retention_status,'review_due');
  assert.equal(report.events[1].retention_status,'unknown_history');
  const unknown=await planDeletion(db,2,'inactivity');
  await assert.rejects(executeDeletion(db,unknown,approval(unknown)),/inactivity_cutoff_not_established/);
  const expired=await planDeletion(db,1,'inactivity');
  expired.activity.observed_at='2000-01-01T00:00:00Z';
  await assert.rejects(executeDeletion(db,expired,approval(expired)),/plan_expired/);
  const due=await planDeletion(db,1,'inactivity');
  assert.equal((await executeDeletion(db,due,approval(due))).basis,'inactivity');
}));

test('unverified maintenance and frozen support events cannot be executed', async () => run(async ({db,query}) => {
  const plan=await planDeletion(db,1);
  const before=await snapshot(query);
  await assert.rejects(executeDeletion(db,plan,{...approval(plan),allWritersDrained:false}),/verified_maintenance/);
  await assert.rejects(executeDeletion(db,plan,{...approval(plan),requesterVerifiedForWholeEvent:false}),/verified_whole_event/);
  assert.deepEqual(await snapshot(query),before);
  for (const id of [75,80]) {
    await query('insert into events(id,owner_token,share_slug,event_name,created_at) values($1,$2,$3,\'Frozen fixture\',1)',[id,`frozen-owner-${id}`,`frozen-share-${id}`]);
    const frozen=await planDeletion(db,id);
    await assert.rejects(executeDeletion(db,frozen,approval(frozen)),/frozen_support_case/);
  }
}));

test('unknown event storage fails closed instead of silently leaving or cascading data', async () => run(async ({db,pg}) => {
  await pg.exec('create table public.future_event_content(id integer,event_id integer,payload text)');
  await assert.rejects(planDeletion(db,1),/unreviewed_event_storage/);
}));

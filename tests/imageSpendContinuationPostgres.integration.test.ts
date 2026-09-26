// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api';
import { events, type Event } from '../shared/schema';
import { postgresIntegrationUrl } from '../script/postgres-test-config.mjs';
import type { CustomerArtworkAttempt } from '../server/customerArtwork';
const target=postgresIntegrationUrl(); process.env.DATABASE_URL=target;
vi.mock('@anthropic-ai/sdk',()=>({default:class {constructor(){throw Error('No provider clients in integration tests');}}}));
const network=vi.fn(async()=>{throw Error('No network in continuation tests');});vi.stubGlobal('fetch',network);
const control=postgres(target,{prepare:false,max:6,connect_timeout:3,idle_timeout:2});
const policyId='launch-preview-image-v1';
const migration='20260926161620_image_spend_bounded_continuation.sql';
let schema:string[], migrations:string[], production:typeof import('../server/storage'), artwork:typeof import('../server/customerArtwork');
let spending:InstanceType<typeof import('../server/imageSpendStore').DbImageSpendStore>;
let sessions:InstanceType<typeof import('../server/customerArtworkStore').DbCustomerArtworkStore>;
let failed:Event, allowed:Event[], blocked:Event, requestId:string;
async function drop(){
  await control.unsafe('drop table if exists public.image_spend_continuations,public.image_spend_reconciliations,public.image_spend_requests,public.image_spend_policies,public.customer_artwork_sessions,public.events cascade');
  for(const name of ['image_spend_audit_fence','image_spend_reconciled_fence','image_spend_audit_commit_fence','image_spend_continuation_fence','image_spend_continuation_commit_fence','image_spend_continued_request_fence'])await control.unsafe(`drop function if exists public.${name}() cascade`);
  await control.unsafe('drop function if exists public.image_spend_unknown_continuable(uuid,integer,text,boolean) cascade');
}
beforeAll(async()=>{
  expect((await control`select current_database() as name`)[0].name).toBe('posy_integration');
  expect(await control`select tablename from pg_tables where schemaname='public'`).toHaveLength(0);
  schema=await generateMigration(generateDrizzleJson({}),generateDrizzleJson({events}));
  migrations=await Promise.all(['20260923174419_customer_artwork_sessions.sql','20260926022248_image_spend_guard.sql','20260926043634_image_spend_reconciliation_audit.sql',migration].map(name=>readFile(new URL(`../supabase/migrations/${name}`,import.meta.url),'utf8')));
  migrations[0]=migrations[0].replace(/^alter table public\.events add column customer_artwork_enabled boolean not null default false;\s*/,'');
  for(const role of ['anon','authenticated','service_role'])if(!(await control`select rolname from pg_roles where rolname=${role}`).length)await control.unsafe(`create role ${role} nologin${role==='service_role'?' bypassrls':''}`);
  production=await import('../server/storage');artwork=await import('../server/customerArtwork');
  spending=new(await import('../server/imageSpendStore')).DbImageSpendStore(production.db);
  sessions=new(await import('../server/customerArtworkStore')).DbCustomerArtworkStore(production.db,()=>({VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'codex/launch-blockers'}));
},30000);
beforeEach(async()=>{
  await drop();await control.begin(async tx=>{for(const sql of [...schema,...migrations])await tx.unsafe(sql);});
  const rows=await production.db.insert(events).values(Array.from({length:4},()=>({ownerToken:randomUUID(),shareSlug:randomUUID(),eventName:'Synthetic bounded recovery',eventType:'Celebration',createdAt:Date.now(),inviteStatus:'draft',draftStatus:'none',customerArtworkEnabled:true}))).returning();
  [failed,...allowed]=rows;blocked=allowed.pop()!;requestId=randomUUID();
  const row=artwork.emptyCustomerArtwork(failed);row.version=2;
  row.attempts=[{id:requestId,requestKey:'failed',brief:{} as any,briefHash:'a'.repeat(64),prompt:'synthetic',model:'gpt-image-2',operation:'create',status:'failed',failure:'provider',billing:'unknown',providerCalls:1,startedAt:1,completedAt:2,
    diagnostics:{status:400,code:'moderation_blocked',type:'image_generation_user_error',moderationStage:'output',requestId:'req_synthetic'} as any}];
  await sessions.create(row);
  await control`update public.image_spend_policies set paused=true,stop_reason='provider_billing_unknown',request_limit=16,create_limit=8,edit_limit=8,requests_reserved=1,creates_reserved=1,edits_reserved=0 where id=${policyId}`;
  await control`insert into public.image_spend_requests(id,policy_id,event_id,operation,model,fingerprint,execution_id,state,provider_calls,usage,dispatched_at,completed_at)
    values(${requestId}::uuid,${policyId},${failed.id},'create','gpt-image-2',${'b'.repeat(64)},${randomUUID()}::uuid,'unknown',1,null,now()-interval '1 minute',now())`;
},30000);
afterEach(()=>expect(network).not.toHaveBeenCalled());
afterAll(async()=>{if(production?.db.$client)await production.db.$client.end({timeout:3});await drop();await control.end({timeout:3});vi.unstubAllGlobals();});
async function snapshot(){return (await control`select (select to_jsonb(r) from public.image_spend_requests r where id=${requestId}::uuid) as request,(select to_jsonb(p) from public.image_spend_policies p where id=${policyId}) as policy,(select payload from public.customer_artwork_sessions where event_id=${failed.id}) as session`)[0];}
async function insertAudit(tx:any,overrides:{events?:number[];expires?:Date;ceiling?:number}={}){
  await tx`insert into public.image_spend_continuations(request_id,policy_id,expires_at,allowed_event_ids,request_ceiling,create_ceiling,edit_ceiling,reserved_unknown_usd_micros,planning_reserve_usd_micros,reason,request_before,policy_before,failed_attempt_md5)
    select r.id,p.id,${overrides.expires??new Date(Date.now()+3600000)},${overrides.events??allowed.map(e=>e.id)},${overrides.ceiling??3},3,0,1000000,5000000,'Synthetic explicit risk review with preserved failed outcome and no retry.',to_jsonb(r),to_jsonb(p),md5((s.payload->'attempts'->0)::text)
    from public.image_spend_requests r join public.image_spend_policies p on p.id=r.policy_id join public.customer_artwork_sessions s on s.event_id=r.event_id where r.id=${requestId}::uuid`;
}
async function reviewed(){await control.begin(tx=>insertAudit(tx));}
async function unpause(){await control`update public.image_spend_policies set paused=false where id=${policyId}`;}
async function claim(event:Event){
 const row=await sessions.create(artwork.emptyCustomerArtwork(event));
 return artwork.claimCustomerArtwork(event,row,{version:row.version,briefHash:artwork.customerArtworkBriefHash(event),requestKey:randomUUID()},sessions);
}

describe('audited bounded continuation of unrelated artwork tests',()=>{
 it('preserves the unknown request, failed session and counters; keeps the global hold until a separate unpause',async()=>{
  const before=await snapshot();await reviewed();expect(await snapshot()).toEqual(before);
  expect(await spending.available(allowed[0].id)).toBe(false);
  await unpause();expect(await spending.available(allowed[0].id)).toBe(true);
  expect(await spending.available()).toBe(false);expect(await spending.available(failed.id)).toBe(false);expect(await spending.available(blocked.id)).toBe(false);
  await expect(claim(blocked)).rejects.toThrow();
  const claimed=await claim(allowed[0]);expect(claimed.request).not.toBeNull();
  const executionId=randomUUID();await spending.claimDispatch({...claimed.request!,imageSpendExecution:executionId});
  expect(await spending.available(allowed[1].id)).toBe(false);
  await expect(spending.claimDispatch({...claimed.request!,imageSpendExecution:randomUUID()})).rejects.toThrow('paused');
  const after=await snapshot();expect(after.request).toEqual(before.request);expect(after.session).toEqual(before.session);
  expect(after.policy.requests_reserved).toBe(2);
 });
 it.each(['past','over-day','same-event','duplicate','missing-event','expanded-ceiling'] as const)('rejects unsafe audit: %s',async kind=>{
  const before=await snapshot();
  const options=kind==='past'?{expires:new Date(Date.now()-1000)}:kind==='over-day'?{expires:new Date(Date.now()+90000000)}:kind==='same-event'?{events:[failed.id]}:kind==='duplicate'?{events:[allowed[0].id,allowed[0].id]}:kind==='missing-event'?{events:[999999]}:{ceiling:16};
  await expect(control.begin(tx=>insertAudit(tx,options))).rejects.toThrow();expect(await snapshot()).toEqual(before);
 });
 it('rejects timeout/ambiguous errors and concurrent unpause or counter changes in the audit transaction',async()=>{
  await control`update public.customer_artwork_sessions set payload=jsonb_set(payload,'{attempts,0,diagnostics,code}','"timeout"'::jsonb) where event_id=${failed.id}`;
  await expect(reviewed()).rejects.toThrow('precondition');
  await control`update public.customer_artwork_sessions set payload=jsonb_set(payload,'{attempts,0,diagnostics,code}','"moderation_blocked"'::jsonb) where event_id=${failed.id}`;
  for(const change of ['paused=false','requests_reserved=2,creates_reserved=2'])await expect(control.begin(async tx=>{await insertAudit(tx);await tx.unsafe(`update public.image_spend_policies set ${change} where id='launch-preview-image-v1'`);})).rejects.toThrow('preserve');
  expect(await control`select * from public.image_spend_continuations`).toHaveLength(0);
 });
 it('stops again on a second provider failure without erasing the original unknown request',async()=>{
  await reviewed();await unpause();const claim1=await claim(allowed[0]);const execution=randomUUID();
  await spending.claimDispatch({...claim1.request!,imageSpendExecution:execution});
  await spending.finish(allowed[0].id,{...claim1.attempt,status:'failed',failure:'provider',billing:'unknown',providerCalls:1,completedAt:Date.now()} as CustomerArtworkAttempt,execution);
  expect(await spending.available(allowed[1].id)).toBe(false);
  await unpause();expect(await spending.available(allowed[1].id)).toBe(false);
  expect((await snapshot()).request).toMatchObject({state:'unknown',usage:null,provider_calls:1});
 });
 it('enforces absolute continuation ceilings and rejects counter rollback and altered evidence',async()=>{
  await reviewed();await unpause();
  await control`update public.image_spend_policies set requests_reserved=3,creates_reserved=3 where id=${policyId}`;
  expect(await spending.available(allowed[0].id)).toBe(false);
  await control`update public.image_spend_policies set requests_reserved=0,creates_reserved=0 where id=${policyId}`;
  expect(await spending.available(allowed[0].id)).toBe(false);
  await control`update public.image_spend_policies set requests_reserved=1,creates_reserved=1 where id=${policyId}`;
  await control`update public.customer_artwork_sessions set payload=jsonb_set(payload,'{attempts,0,prompt}','"altered evidence"'::jsonb) where event_id=${failed.id}`;
  expect(await spending.available(allowed[0].id)).toBe(false);
 });
 it('expires between reservation and physical dispatch without requiring a scheduler',async()=>{
  await control.begin(tx=>insertAudit(tx,{expires:new Date(Date.now()+1500)}));await unpause();
  const claim1=await claim(allowed[0]);
  await new Promise(resolve=>setTimeout(resolve,1700));
  expect(await spending.available(allowed[1].id)).toBe(false);
  await expect(spending.claimDispatch({...claim1.request!,imageSpendExecution:randomUUID()})).rejects.toThrow('paused');
  expect((await control`select state from public.image_spend_requests where id=${claim1.attempt.id}::uuid`)[0].state).toBe('reserved');
 });
 it('lets customer upload/selection metadata evolve without altering the audited failed attempt',async()=>{
  await reviewed();await unpause();
  const row=(await sessions.get(failed.id))!;
  expect(await sessions.compareAndSet({...row,version:row.version+1,uploads:[]},row.version)).toBe(true);
  expect(await spending.available(allowed[0].id)).toBe(true);
 });
 it('makes audit immutable and denies client/service-role administration',async()=>{
  await reviewed();const before=await snapshot();
  for(const statement of ['delete from public.image_spend_continuations','truncate public.image_spend_continuations',"update public.image_spend_continuations set reason='An attempted policy replacement'",'truncate public.image_spend_requests cascade'])await expect(control.unsafe(statement)).rejects.toThrow('append-only');
  await expect(control`update public.image_spend_requests set usage='{}'::jsonb where id=${requestId}::uuid`).rejects.toThrow('immutable');
  for(const role of ['anon','authenticated','service_role'])await expect(control.begin(async tx=>{await tx.unsafe(`set local role ${role}`);await tx.unsafe('insert into public.image_spend_continuations default values');})).rejects.toThrow('permission denied');
  for(const role of ['anon','authenticated'])await expect(control.begin(async tx=>{await tx.unsafe(`set local role ${role}`);await tx.unsafe('select * from public.image_spend_continuations');})).rejects.toThrow('permission denied');
  expect(await snapshot()).toEqual(before);
 });
});

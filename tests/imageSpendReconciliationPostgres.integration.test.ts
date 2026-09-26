// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api';
import { events } from '../shared/schema';
import type { CustomerArtworkAttempt } from '../server/customerArtwork';
import { postgresIntegrationUrl } from '../script/postgres-test-config.mjs';

// This suite can only use the explicitly opted-in disposable loopback database.
// DROP/recreate is test isolation, not an operator cleanup or a production path:
// the shipped append-only audit correctly forbids TRUNCATE, including CASCADE.
const target = postgresIntegrationUrl();
process.env.DATABASE_URL = target;
vi.mock('@anthropic-ai/sdk', () => ({ default: class {
  constructor() { throw Error('Provider clients are forbidden in reconciliation tests.'); }
} }));
const networkFetch = vi.fn(async () => { throw Error('HTTP/provider calls are forbidden in reconciliation tests.'); });
vi.stubGlobal('fetch', networkFetch);
const control = postgres(target, { prepare: false, max: 6, connect_timeout: 3, idle_timeout: 2 });
type Connection = postgres.Sql | postgres.TransactionSql;
const policyId = 'launch-preview-image-v1';
let initialized = false;
let schemaStatements: string[];
let migrationTexts: string[];
let production: typeof import('../server/storage');
let spending: InstanceType<typeof import('../server/imageSpendStore').DbImageSpendStore>;
let requestId: string;
let eventId: number;

async function dropTestSchema() {
  await control.unsafe('drop table if exists public.image_spend_continuations, public.image_spend_reconciliations, public.image_spend_requests, public.image_spend_policies, public.customer_artwork_sessions, public.events cascade');
  await control.unsafe('drop function if exists public.image_spend_unknown_continuable(uuid,integer,text,boolean) cascade');
  for (const name of ['image_spend_audit_fence', 'image_spend_reconciled_fence', 'image_spend_audit_commit_fence', 'image_spend_continuation_fence', 'image_spend_continuation_commit_fence', 'image_spend_continued_request_fence']) {
    await control.unsafe(`drop function if exists public.${name}() cascade`);
  }
}

beforeAll(async () => {
  const [identity] = await control`select current_database() as name`;
  if (identity.name !== 'posy_integration') throw Error('Unexpected integration database.');
  const tables = await control`select tablename from pg_tables where schemaname='public'`;
  if (tables.length) throw Error('Use a fresh empty disposable PostgreSQL database.');
  schemaStatements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson({ events }));
  const session = await readFile(new URL('../supabase/migrations/20260923174419_customer_artwork_sessions.sql', import.meta.url), 'utf8');
  migrationTexts = [session.replace(/^alter table public\.events add column customer_artwork_enabled boolean not null default false;\s*/, ''),
    await readFile(new URL('../supabase/migrations/20260926022248_image_spend_guard.sql', import.meta.url), 'utf8'),
    await readFile(new URL('../supabase/migrations/20260926043634_image_spend_reconciliation_audit.sql', import.meta.url), 'utf8'),
    await readFile(new URL('../supabase/migrations/20260926161620_image_spend_bounded_continuation.sql', import.meta.url), 'utf8')];
  for (const role of ['anon', 'authenticated', 'service_role']) {
    const found = await control`select rolname from pg_roles where rolname=${role}`;
    if (!found.length) await control.unsafe(`create role ${role} nologin${role === 'service_role' ? ' bypassrls' : ''}`);
  }
  initialized = true;
  production = await import('../server/storage');
  const { DbImageSpendStore } = await import('../server/imageSpendStore');
  spending = new DbImageSpendStore(production.db);
}, 30_000);

beforeEach(async () => {
  await dropTestSchema();
  await control.begin(async tx => {
    for (const statement of schemaStatements) await tx.unsafe(statement);
    for (const migration of migrationTexts) await tx.unsafe(migration);
  });
  const [created] = await production.db.insert(events).values({
    ownerToken: `synthetic-owner-${randomUUID()}`, shareSlug: `synthetic-share-${randomUUID()}`,
    eventName: 'Synthetic accounting fixture', eventType: 'Celebration', createdAt: Date.now(),
    inviteStatus: 'draft', customerArtworkEnabled: true,
  }).returning({ id: events.id });
  eventId = created.id;
  requestId = randomUUID();
  const payload = { eventId, ownerHash: 'a'.repeat(64), version: 2, selections: [], attempts: [{
    id: requestId, status: 'failed', failure: 'provider', billing: 'unknown', providerCalls: 1,
    diagnostics: { code: 'moderation_blocked', moderationStage: 'output', requestId: 'req_synthetic_only' },
  }] };
  await control`insert into public.customer_artwork_sessions(event_id,version,payload)
    values(${eventId},2,${control.json(payload)})`;
  await control`update public.image_spend_policies set paused=true,stop_reason='provider_billing_unknown',
    request_limit=16,create_limit=8,edit_limit=8,requests_reserved=1,creates_reserved=1,edits_reserved=0
    where id=${policyId}`;
  await control`insert into public.image_spend_requests
    (id,policy_id,event_id,operation,model,fingerprint,execution_id,state,provider_calls,usage,dispatched_at,completed_at)
    values(${requestId}::uuid,${policyId},${eventId},'create','gpt-image-2',${'b'.repeat(64)},${randomUUID()}::uuid,
      'unknown',1,null,now()-interval '1 minute',now())`;
}, 30_000);

afterEach(() => { expect(networkFetch).not.toHaveBeenCalled(); });
afterAll(async () => {
  if (production?.db.$client) await production.db.$client.end({ timeout: 3 });
  if (initialized) await dropTestSchema();
  await control.end({ timeout: 3 });
  vi.unstubAllGlobals();
});

async function snapshot(database: Connection = control) {
  const [row] = await database`select
    (select to_jsonb(r) from public.image_spend_requests r where id=${requestId}::uuid) as request,
    (select to_jsonb(p) from public.image_spend_policies p where id=${policyId}) as policy,
    (select to_jsonb(s) from public.customer_artwork_sessions s where event_id=${eventId}) as session,
    (select md5(payload::text) from public.customer_artwork_sessions where event_id=${eventId}) as payload_md5`;
  return row;
}

async function insertAudit(database: Connection, before: Awaited<ReturnType<typeof snapshot>>) {
  await database`insert into public.image_spend_reconciliations
    (request_id,policy_id,basis,export_day,as_of_date,cost_export_sha256,activity_export_sha256,
      export_day_total_usd_micros,reason,context,request_before,policy_before,session_version,session_payload_md5)
    values(${requestId}::uuid,${policyId},'provider_exports_as_of','2026-09-25','2026-09-27',
      ${'c'.repeat(64)},${'d'.repeat(64)},59448,
      'Synthetic administrative review; aggregate ceiling is not an attributed request charge.',
      ${database.json({ synthetic: true, actualRequestCharge: 'unknown', providerUsage: 'unknown' })},
      ${database.json(before.request)},${database.json(before.policy)},${before.session.version},${before.payload_md5})`;
}

async function reconcile(database: Connection, before: Awaited<ReturnType<typeof snapshot>>) {
  await insertAudit(database, before);
  const changed = await database`update public.image_spend_requests set state='reconciled'
    where id=${requestId}::uuid and state='unknown' returning id`;
  expect(changed).toHaveLength(1);
}

async function committedReconciliation() {
  const before = await snapshot();
  await control.begin(tx => reconcile(tx, before));
  return before;
}

async function expectNoReconciliation(before: Awaited<ReturnType<typeof snapshot>>) {
  expect(await snapshot()).toEqual(before);
  expect(await control`select request_id from public.image_spend_reconciliations`).toHaveLength(0);
  expect(await spending.available()).toBe(false);
}

async function operatorFixture() {
  // Exact reviewed identities/counters/times with deliberately synthetic
  // private session content. The only script substitution is its frozen MD5.
  await control`delete from public.image_spend_requests`;
  await control`delete from public.customer_artwork_sessions`;
  await control`delete from public.events`;
  await production.db.insert(events).values([73, 74, 75].map(id => ({
    id, ownerToken: `synthetic-operator-owner-${id}`, shareSlug: `synthetic-operator-share-${id}`,
    eventName: 'Synthetic operator fixture', eventType: 'Celebration', createdAt: Date.now(), inviteStatus: 'draft',
  })));
  requestId = '02421bef-9f67-46c6-8498-88e7279a1e26';
  eventId = 75;
  const payload = { eventId, ownerHash: 'a'.repeat(64), version: 2, selections: [], attempts: [{
    id: requestId, status: 'failed', billing: 'unknown', failure: 'provider', providerCalls: 1,
    diagnostics: { code: 'moderation_blocked', requestId: 'req_416d75c32ada4ca3929e9c23794f0d8e', moderationStage: 'output' },
  }] };
  await control`insert into public.customer_artwork_sessions(event_id,version,payload) values(75,2,${control.json(payload)})`;
  await control`update public.image_spend_policies set requests_reserved=4,creates_reserved=2,edits_reserved=2 where id=${policyId}`;
  await control`insert into public.image_spend_requests
    (id,policy_id,event_id,operation,model,state,provider_calls,created_at,completed_at)
    values(${requestId}::uuid,${policyId},75,'create','gpt-image-2','unknown',1,
      to_timestamp(1790309032547::numeric/1000),to_timestamp(1790309072683::numeric/1000))`;
  const knownUsage = { inputTokens: 2736, textInputTokens: 1200, imageInputTokens: 1536,
    outputTokens: 1372, imageOutputTokens: 1372, textOutputTokens: 0 };
  for (const [id, event, operation] of [
    ['7dfd96c3-6372-45f3-b00a-017619455731', 73, 'create'],
    ['e27b8e62-226d-4ea3-ad16-86077d469529', 73, 'edit'],
    ['26ae49b3-52b5-41a7-a105-a4fa8c7eea74', 74, 'edit'],
  ] as const) await control`insert into public.image_spend_requests
    (id,policy_id,event_id,operation,model,state,provider_calls,usage,created_at,completed_at)
    values(${id}::uuid,${policyId},${event},${operation},'gpt-image-2','historical',1,${control.json(knownUsage)},
      '2026-09-25T01:00:00Z'::timestamptz,'2026-09-25T01:01:00Z'::timestamptz)`;
  const script = await readFile(new URL('../tools/qa/sql/reconcile-event75-image-accounting.sql', import.meta.url), 'utf8');
  const frozenMd5 = '0701076221b3bbb3cef5e517a5682efb';
  expect(script.split(frozenMd5)).toHaveLength(2);
  return script.replace(frozenMd5, (await snapshot()).payload_md5);
}

async function runOperatorScript(script: string) {
  // The operator file owns its explicit BEGIN/COMMIT. Reserve one connection
  // so a rejected script is rolled back before returning it to the pool.
  const connection = await control.reserve();
  try { await connection.unsafe(script); }
  catch (error) { await connection.unsafe('rollback'); throw error; }
  finally { connection.release(); }
}

describe('administrative image accounting reconciliation on disposable PostgreSQL', () => {
  it('commits only the audited state change, retaining the failed session, unknown usage, counters and pause', async () => {
    expect(await spending.available()).toBe(false);
    const before = await committedReconciliation();
    const after = await snapshot();
    expect(after.request).toEqual({ ...before.request, state: 'reconciled' });
    expect(after.request).toMatchObject({ usage: null, provider_calls: 1 });
    expect(after.policy).toEqual(before.policy);
    expect(after.session).toEqual(before.session);
    expect(after.payload_md5).toBe(before.payload_md5);
    const [audit] = await control`select * from public.image_spend_reconciliations`;
    expect(audit).toMatchObject({ request_id: requestId, policy_id: policyId, basis: 'provider_exports_as_of',
      request_before: before.request, policy_before: before.policy, session_version: 2,
      session_payload_md5: before.payload_md5, context: { actualRequestCharge: 'unknown', providerUsage: 'unknown' } });
    expect(String(audit.export_day_total_usd_micros)).toBe('59448');
    expect(audit.reconciled_by).toBe('posy_integration');
    expect(await spending.available()).toBe(false);
    // Late workers and an explicit replay cannot reinterpret this failed call
    // as returned artwork or dispatch its permanently consumed permit again.
    for (const status of ['ready', 'failed'] as const) await spending.finish(eventId, {
      ...before.session.payload.attempts[0], status, billing: 'usage-recorded',
      sourceBase64: 'synthetic-late-result', imageBase64: 'synthetic-late-result',
    } as CustomerArtworkAttempt, randomUUID());
    await expect(spending.claimDispatch({ model: 'gpt-image-2', prompt: 'Synthetic replay; never dispatch',
      aspectRatio: '9:16', quality: 'medium', maxTransientRetries: 0,
      imageSpendPermit: requestId, imageSpendExecution: randomUUID() })).rejects.toMatchObject({ code: 'duplicate' });
    expect(await snapshot()).toEqual(after);

    // A separate, explicitly synthetic policy action is required to reopen.
    await control`update public.image_spend_policies set paused=false,stop_reason='synthetic_separate_reopen' where id=${policyId}`;
    expect(await spending.available()).toBe(true);
    // The one reviewed exception cannot waive a later unresolved request.
    await control`insert into public.image_spend_requests(id,policy_id,event_id,operation,model,state,provider_calls)
      values(${randomUUID()}::uuid,${policyId},${eventId},'create','gpt-image-2','unknown',1)`;
    expect(await spending.available()).toBe(false);
  });

  it.each(['request', 'policy', 'session_version', 'session_payload'] as const)('rejects stale %s evidence without partial writes', async field => {
    const before = await snapshot();
    const stale = structuredClone(before);
    if (field === 'request') stale.request.model = 'gpt-image-1';
    if (field === 'policy') stale.policy.request_limit += 1;
    if (field === 'session_version') stale.session.version += 1;
    if (field === 'session_payload') stale.payload_md5 = 'e'.repeat(32);
    await expect(control.begin(tx => reconcile(tx, stale))).rejects.toThrow('precondition changed');
    await expectNoReconciliation(before);
  });

  it('rejects reconciliation while unpaused and a bare ledger state flip without an audit', async () => {
    const before = await snapshot();
    await expect(control.begin(async tx => {
      await tx`update public.image_spend_policies set paused=false where id=${policyId}`;
      await reconcile(tx, await snapshot(tx));
    })).rejects.toThrow('precondition changed');
    await expect(control`update public.image_spend_requests set state='reconciled' where id=${requestId}::uuid`)
      .rejects.toThrow('matching audit evidence');
    await expect(control`insert into public.image_spend_requests(id,policy_id,operation,model,state,provider_calls)
      values(${randomUUID()}::uuid,${policyId},'create','gpt-image-2','reconciled',1)`)
      .rejects.toThrow('existing unknown request');
    await expectNoReconciliation(before);
  });

  it.each(['usage', 'provider_calls'] as const)('rejects fabricated %s evidence instead of rewriting the failed call', async field => {
    const before = await snapshot();
    await expect(control.begin(async tx => {
      if (field === 'usage') await tx`update public.image_spend_requests set usage='{"inputTokens":1,"outputTokens":1}'::jsonb where id=${requestId}::uuid`;
      else await tx`update public.image_spend_requests set provider_calls=0 where id=${requestId}::uuid`;
      await reconcile(tx, await snapshot(tx));
    })).rejects.toThrow('precondition changed');
    await expectNoReconciliation(before);
  });

  it('rejects changing another permit field along with the reconciled state', async () => {
    const before = await snapshot();
    await expect(control.begin(async tx => {
      await insertAudit(tx, before);
      await tx`update public.image_spend_requests set state='reconciled',completed_at=now()+interval '1 second' where id=${requestId}::uuid`;
    })).rejects.toThrow('matching audit evidence');
    await expectNoReconciliation(before);
  });

  it('rolls back an orphan audit at actual commit, and supports checking the deferred fence explicitly', async () => {
    const before = await snapshot();
    await expect(control.begin(tx => insertAudit(tx, before))).rejects.toThrow('must commit together');
    await expectNoReconciliation(before);
    await expect(control.begin(async tx => {
      await insertAudit(tx, before);
      await tx.unsafe('set constraints all immediate');
    })).rejects.toThrow('must commit together');
    await expectNoReconciliation(before);
  });

  it.each(['unpause', 'counter', 'session'] as const)('rolls back audit and ledger when %s changes in the reconciliation transaction', async change => {
    const before = await snapshot();
    await expect(control.begin(async tx => {
      await reconcile(tx, before);
      if (change === 'unpause') await tx`update public.image_spend_policies set paused=false where id=${policyId}`;
      if (change === 'counter') await tx`update public.image_spend_policies set requests_reserved=2,creates_reserved=2 where id=${policyId}`;
      if (change === 'session') await tx`update public.customer_artwork_sessions
        set version=3,payload=jsonb_set(payload,'{version}','3'::jsonb) where event_id=${eventId}`;
    })).rejects.toThrow('must commit together');
    await expectNoReconciliation(before);
  });

  it('allows only one administrator to reconcile the same captured state under concurrency', async () => {
    const before = await snapshot();
    const attempts = await Promise.allSettled(Array.from({ length: 3 }, () => control.begin(tx => reconcile(tx, before))));
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(attempts.filter(result => result.status === 'rejected')).toHaveLength(2);
    expect(await control`select request_id from public.image_spend_reconciliations`).toHaveLength(1);
    const after = await snapshot();
    expect(after.request).toEqual({ ...before.request, state: 'reconciled' });
    expect(after.policy).toEqual(before.policy);
    expect(after.session).toEqual(before.session);
  });

  it('makes committed audit append-only and reconciled ledger evidence immutable, including cascading deletion', async () => {
    await committedReconciliation();
    const before = await snapshot();
    const [audit] = await control`select to_jsonb(a) as value from public.image_spend_reconciliations a`;
    for (const statement of [
      "update public.image_spend_reconciliations set reason='Attempted replacement of accounting evidence'",
      'delete from public.image_spend_reconciliations', 'truncate public.image_spend_reconciliations',
      'truncate public.image_spend_requests cascade',
    ]) await expect(control.unsafe(statement)).rejects.toThrow('append-only');
    for (const statement of [
      "update public.image_spend_requests set state='completed'", 'update public.image_spend_requests set provider_calls=0',
      "update public.image_spend_requests set usage='{}'::jsonb", "update public.image_spend_requests set model='gpt-image-1'",
    ]) await expect(control.unsafe(statement)).rejects.toThrow('immutable');
    await expect(control`delete from public.image_spend_requests where id=${requestId}::uuid`).rejects.toThrow(/foreign key/);
    await expect(control`delete from public.events where id=${eventId}`).rejects.toThrow(/immutable/);
    expect(await snapshot()).toEqual(before);
    expect((await control`select to_jsonb(a) as value from public.image_spend_reconciliations a`)[0]).toEqual(audit);
  });

  it.each(['anon', 'authenticated', 'service_role'])('denies %s access to audit rows and administrator functions', async role => {
    await committedReconciliation();
    const before = await snapshot();
    for (const statement of [
      'select * from public.image_spend_reconciliations', 'insert into public.image_spend_reconciliations default values',
      "update public.image_spend_reconciliations set reason='Attempted replacement of accounting evidence'",
      'delete from public.image_spend_reconciliations', 'truncate public.image_spend_reconciliations',
    ]) await expect(control.begin(async tx => {
      await tx.unsafe(`set local role ${role}`); await tx.unsafe(statement);
    })).rejects.toThrow(/permission denied/);
    const [permissions] = await control`select
      has_function_privilege(${role},'public.image_spend_audit_fence()','EXECUTE') as insert_fence,
      has_function_privilege(${role},'public.image_spend_reconciled_fence()','EXECUTE') as ledger_fence,
      has_function_privilege(${role},'public.image_spend_audit_commit_fence()','EXECUTE') as commit_fence`;
    expect(permissions).toEqual({ insert_fence: false, ledger_fence: false, commit_fence: false });
    expect(await snapshot()).toEqual(before);
    const [rls] = await control`select relrowsecurity from pg_class where oid='public.image_spend_reconciliations'::regclass`;
    expect(rls.relrowsecurity).toBe(true);
  });

  it('executes the reviewed operator SQL once and replays it idempotently with only the synthetic session checksum substituted', async () => {
    const script = await operatorFixture();
    const before = await snapshot();
    const otherPermits = await control`select to_jsonb(r) as row from public.image_spend_requests r
      where id<>${requestId}::uuid order by id`;
    await runOperatorScript(script);
    const after = await snapshot();
    expect(after.request).toEqual({ ...before.request, state: 'reconciled' });
    expect(after.policy).toEqual(before.policy);
    expect(after.session).toEqual(before.session);
    expect(await spending.available()).toBe(false);
    const audit = await control`select to_jsonb(a) as row from public.image_spend_reconciliations a`;
    expect(audit).toHaveLength(1);
    expect(audit[0].row).toMatchObject({
      cost_export_sha256: 'b2562889cf5dc847a9b478912236e1d7cdd20ae51ad9e58d4d2057dd4a28d048',
      activity_export_sha256: '2effa8eed39c8556c8eae61a5e7b178076199a96597917cd04468630f5bf44e2',
      context: { event75AttributedChargeUsd: null, event75ProviderUsageKnown: false,
        event75ArtworkStatus: 'failed', event75RetryAuthorized: false, policyUnpauseAuthorizedByThisReconciliation: false },
    });
    await runOperatorScript(script);
    expect(await snapshot()).toEqual(after);
    expect(await control`select to_jsonb(a) as row from public.image_spend_reconciliations a`).toEqual(audit);
    expect(await control`select to_jsonb(r) as row from public.image_spend_requests r
      where id<>${requestId}::uuid order by id`).toEqual(otherPermits);
  });

  it.each(['retained_usage', 'permit_timestamp', 'session_evidence'] as const)('aborts the exact operator script when %s differs from reviewed evidence', async change => {
    const script = await operatorFixture();
    if (change === 'retained_usage') await control`update public.image_spend_requests
      set usage=jsonb_set(usage,'{outputTokens}','1373'::jsonb) where id='26ae49b3-52b5-41a7-a105-a4fa8c7eea74'::uuid`;
    if (change === 'permit_timestamp') await control`update public.image_spend_requests
      set completed_at=completed_at+interval '1 millisecond' where id=${requestId}::uuid`;
    if (change === 'session_evidence') await control`update public.customer_artwork_sessions
      set payload=jsonb_set(payload,'{attempts,0,diagnostics,code}','"different_evidence"'::jsonb) where event_id=75`;
    const before = await snapshot();
    await expect(runOperatorScript(script)).rejects.toThrow(/differs|changed/);
    await expectNoReconciliation(before);
  });
});

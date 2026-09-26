// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api';
import { events } from '../shared/schema';
import type { Event } from '../shared/schema';
import type { CustomerArtworkAttempt, CustomerArtworkSession } from '../server/customerArtwork';
import type { ArtworkRequest } from '../server/aiFirst/artwork';
import { postgresIntegrationUrl } from '../script/postgres-test-config.mjs';

// Independent, sequential suite on the explicitly opted-in disposable database.
// A hosted DATABASE_URL is never a fallback and historical baseline migrations
// are never replayed. HTTP and image providers are forbidden throughout.
const target = postgresIntegrationUrl();
process.env.DATABASE_URL = target;
process.env.ANTHROPIC_API_KEY = 'forbidden-in-integration';
process.env.OPENAI_API_KEY = 'forbidden-in-integration';
vi.mock('@anthropic-ai/sdk', () => ({ default: class {
  constructor() { throw new Error('Provider clients are forbidden in PostgreSQL integration tests.'); }
} }));
const networkFetch = vi.fn(async () => { throw new Error('HTTP/provider calls are forbidden in PostgreSQL integration tests.'); });
vi.stubGlobal('fetch', networkFetch);

const control = postgres(target, { prepare: false, max: 8, connect_timeout: 3, idle_timeout: 2 });
let initialized = false;
let production: typeof import('../server/storage');
let artwork: typeof import('../server/customerArtwork');
let guard: typeof import('../server/imageSpendGuard');
let sessions: InstanceType<typeof import('../server/customerArtworkStore').DbCustomerArtworkStore>;
let spending: InstanceType<typeof import('../server/imageSpendStore').DbImageSpendStore>;
let event: Event;
let migrationDefaults: Record<string, unknown>;
const preview = { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'codex/launch-blockers' };

beforeAll(async () => {
  const [identity] = await control`select current_database() as name`;
  if (identity.name !== 'posy_integration') throw new Error('Unexpected integration database.');
  const existing = await control`select tablename from pg_tables where schemaname = 'public'`;
  if (existing.length) throw new Error('Integration database is not empty. Use a fresh disposable PostgreSQL database.');

  const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson({ events }));
  expect(statements.length).toBeGreaterThan(0);
  const sessionMigration = await readFile(new URL('../supabase/migrations/20260923174419_customer_artwork_sessions.sql', import.meta.url), 'utf8');
  // Drizzle's current events schema already contains this column. Retain the
  // real session-table migration and its constraints/grants exactly as shipped.
  const sessionTables = sessionMigration.replace(/^alter table public\.events add column customer_artwork_enabled boolean not null default false;\s*/, '');
  const spendMigration = await readFile(new URL('../supabase/migrations/20260926022248_image_spend_guard.sql', import.meta.url), 'utf8');
  await control.begin(async tx => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const found = await tx`select rolname from pg_roles where rolname = ${role}`;
      if (!found.length) await tx.unsafe(`create role ${role} nologin${role === 'service_role' ? ' bypassrls' : ''}`);
    }
    for (const statement of statements) await tx.unsafe(statement);
    await tx.unsafe(sessionTables);
    await tx.unsafe(spendMigration);
    await tx.unsafe(await readFile(new URL('../supabase/migrations/20260926112828_image_spend_bounded_continuation.sql', import.meta.url), 'utf8'));
  });
  initialized = true;
  production = await import('../server/storage');
  artwork = await import('../server/customerArtwork');
  guard = await import('../server/imageSpendGuard');
  const { DbCustomerArtworkStore } = await import('../server/customerArtworkStore');
  const { DbImageSpendStore } = await import('../server/imageSpendStore');
  sessions = new DbCustomerArtworkStore(production.db, () => preview);
  spending = new DbImageSpendStore(production.db);
  [migrationDefaults] = await control`select * from public.image_spend_policies where id = ${guard.IMAGE_SPEND_POLICY}`;
}, 30_000);

beforeEach(async () => {
  await control.unsafe('drop table public.image_spend_continuations cascade');
  await control.unsafe('truncate public.image_spend_requests, public.image_spend_policies, public.customer_artwork_sessions, public.events restart identity cascade');
  await control`insert into public.image_spend_policies(id, paused, stop_reason, request_limit, create_limit, edit_limit)
    values(${guard.IMAGE_SPEND_POLICY}, false, 'synthetic_test_only', 16, 8, 8)`;
  event = await createEvent();
  const migration = await readFile(new URL('../supabase/migrations/20260926112828_image_spend_bounded_continuation.sql', import.meta.url), 'utf8');
  for (const name of ['image_spend_continuation_fence','image_spend_continuation_commit_fence','image_spend_continued_request_fence']) await control.unsafe(`drop function if exists public.${name}() cascade`);
  await control.unsafe('drop function if exists public.image_spend_unknown_continuable(uuid,integer,text,boolean) cascade');
  await control.unsafe(migration);
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (initialized) {
    await control.unsafe('drop trigger if exists posy_test_fail_spend_completion on public.image_spend_requests');
    await control.unsafe('drop function if exists public.posy_test_fail_spend_completion()');
  }
  expect(networkFetch).not.toHaveBeenCalled();
});

afterAll(async () => {
  if (production?.db.$client) await production.db.$client.end({ timeout: 3 });
  if (initialized) await control.unsafe('drop table public.image_spend_continuations, public.image_spend_requests, public.image_spend_policies, public.customer_artwork_sessions, public.events cascade');
  for (const name of ['image_spend_continuation_fence','image_spend_continuation_commit_fence','image_spend_continued_request_fence']) await control.unsafe(`drop function if exists public.${name}() cascade`);
  await control.unsafe('drop function if exists public.image_spend_unknown_continuable(uuid,integer,text,boolean) cascade');
  await control.end({ timeout: 3 });
  vi.unstubAllGlobals();
});

async function createEvent() {
  const [created] = await production.db.insert(events).values({
    ownerToken: `synthetic-owner-${randomUUID()}`, shareSlug: `synthetic-${randomUUID()}`,
    eventName: 'Synthetic spending-guard fixture', eventType: 'Birthday Party',
    eventDate: '2026-10-17', themeName: 'Saved garden', estimatedGuestCount: 12,
    draftStatus: 'none', createdAt: Date.now(), inviteStatus: 'draft', customerArtworkEnabled: true,
  }).returning();
  return created;
}

async function emptySession(forEvent = event): Promise<CustomerArtworkSession> {
  return sessions.create(artwork.emptyCustomerArtwork(forEvent));
}

async function pending(forEvent = event, operation: 'create' | 'edit' = 'create', base?: CustomerArtworkSession) {
  const original = base ?? await emptySession(forEvent);
  const { humanArtworkBrief } = await import('../server/humanArtworkReview');
  const brief = humanArtworkBrief(forEvent);
  const attempt: CustomerArtworkAttempt = {
    id: randomUUID(), requestKey: randomUUID(), brief, briefHash: artwork.customerArtworkBriefHash(forEvent),
    operation, status: 'running', startedAt: Date.now(), model: 'gpt-image-2',
    prompt: `Synthetic retained request: ${JSON.stringify(brief)}`, providerCalls: null, billing: 'unknown',
  };
  const request: ArtworkRequest = {
    model: 'gpt-image-2', prompt: attempt.prompt, aspectRatio: '9:16', quality: 'medium', outputFormat: 'jpeg',
    maxTransientRetries: 0, imageSpendPermit: attempt.id, imageSpendExecution: randomUUID(),
    ...(operation === 'edit' ? { referenceImages: [{ bytes: Buffer.from('synthetic saved source'), mimeType: 'image/png' as const }] } : {}),
  };
  const next = { ...original, version: original.version + 1, attempts: [...original.attempts, attempt] };
  return { original, next, attempt, request };
}

type Pending = Awaited<ReturnType<typeof pending>>;
const reserve = (claim: Pending) => sessions.reserveRequest(claim.next, claim.original.version, claim.attempt, claim.request);
const knownResult = (claim: Pending): CustomerArtworkAttempt => ({
  ...claim.attempt, status: 'ready', completedAt: Date.now(), providerCalls: 1, billing: 'usage-recorded',
  imageBase64: Buffer.from('synthetic result; not artwork quality evidence').toString('base64'),
  imageHash: createHash('sha256').update('synthetic result; not artwork quality evidence').digest('hex'),
  telemetry: { outputFormat: 'jpeg', providerRequestCount: 1, providerDurationMs: 10, normalizationDurationMs: 1,
    responseUsage: { inputTokens: 100, outputTokens: 50, textInputTokens: 100, imageInputTokens: 0,
      textOutputTokens: 0, imageOutputTokens: 50 } },
});
async function finishKnown(claim: Pending) {
  await spending.claimDispatch(claim.request);
  expect(await sessions.finishRequest(claim.next.eventId, knownResult(claim), claim.request.imageSpendExecution!)).toBe('handled');
}
async function policy() {
  const [row] = await control`select * from public.image_spend_policies where id = ${guard.IMAGE_SPEND_POLICY}`;
  return row;
}
async function ledger() { return control`select * from public.image_spend_requests order by created_at, id`; }

describe('cross-event image spending on disposable PostgreSQL', () => {
  it('installs a paused zero-allowance policy and treats missing policy as closed', async () => {
    expect(migrationDefaults).toMatchObject({ paused: true, stop_reason: 'not_reconciled',
      request_limit: 0, create_limit: 0, edit_limit: 0, requests_reserved: 0 });
    await control`delete from public.image_spend_policies`;
    expect(await spending.available()).toBe(false);
    await expect(reserve(await pending())).rejects.toMatchObject({ code: 'blocked' });
    expect(await ledger()).toHaveLength(0);
  });

  it('allows exactly one unresolved reservation across simultaneous events', async () => {
    const others = await Promise.all([createEvent(), createEvent(), createEvent()]);
    const claims = await Promise.all([event, ...others].map(item => pending(item)));
    const results = await Promise.allSettled(claims.map(reserve));
    expect(results.filter(result => result.status === 'fulfilled' && result.value)).toHaveLength(1);
    const denied = results.filter(result => result.status === 'rejected');
    expect(denied).toHaveLength(3);
    expect(denied.every(result => result.status === 'rejected' && result.reason.code === 'blocked')).toBe(true);
    expect(await policy()).toMatchObject({ requests_reserved: 1, creates_reserved: 1, edits_reserved: 0 });
    expect(await ledger()).toHaveLength(1);
    const rows = await control`select payload from public.customer_artwork_sessions`;
    expect(rows.reduce((count, row) => count + row.payload.attempts.length, 0)).toBe(1);
    expect(await spending.available()).toBe(false);
  });

  it.each([
    ['total', 2, 8, 8, ['create', 'edit'], 'create'],
    ['create', 16, 2, 8, ['create', 'create'], 'create'],
    ['edit', 16, 8, 2, ['edit', 'edit'], 'edit'],
  ] as const)('retains the lifetime %s ceiling after successful results across different events', async (_name, total, creates, edits, operations, deniedOperation) => {
    await control`update public.image_spend_policies set request_limit = ${total}, create_limit = ${creates}, edit_limit = ${edits}`;
    for (const operation of operations) {
      const claim = await pending(await createEvent(), operation);
      expect(await reserve(claim)).toBe(true);
      await finishKnown(claim);
    }
    await expect(reserve(await pending(await createEvent(), deniedOperation))).rejects.toMatchObject({ code: 'blocked' });
    const rows = await ledger();
    expect(rows).toHaveLength(2);
    expect(rows.every(row => row.state === 'completed')).toBe(true);
    expect((await policy()).requests_reserved).toBe(2);
  });

  it('does not consume counters or a permit when the per-event CAS loses', async () => {
    const stale = await pending();
    const updated = { ...stale.original, version: stale.original.version + 1 };
    expect(await sessions.compareAndSet(updated, stale.original.version)).toBe(true);
    expect(await reserve(stale)).toBe(false);
    expect(await policy()).toMatchObject({ requests_reserved: 0, creates_reserved: 0, edits_reserved: 0 });
    expect(await ledger()).toHaveLength(0);
    expect(await sessions.get(event.id)).toEqual(updated);
    expect(await reserve(await pending(event, 'create', updated))).toBe(true);
  });

  it('commits exactly one dispatch under concurrent duplicate workers', async () => {
    const claim = await pending();
    expect(await reserve(claim)).toBe(true);
    const workers = Array.from({ length: 4 }, () => ({ ...claim.request, imageSpendExecution: randomUUID() }));
    const results = await Promise.allSettled(workers.map(worker => spending.claimDispatch(worker)));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const denied = results.filter(result => result.status === 'rejected');
    expect(denied).toHaveLength(3);
    expect(denied.every(result => result.status === 'rejected' && result.reason.code === 'duplicate')).toBe(true);
    const winner = results.findIndex(result => result.status === 'fulfilled');
    expect((await ledger())[0]).toMatchObject({ state: 'dispatched', provider_calls: null,
      execution_id: workers[winner].imageSpendExecution });
    expect((await policy()).requests_reserved).toBe(1);
  });

  it.each([
    ['authorization unavailable', 0],
    ['aborted before authorization', null],
  ] as const)('fences a duplicate worker that reports %s while the dispatched winner is running', async (_reason, providerCalls) => {
    const claim = await pending();
    expect(await reserve(claim)).toBe(true);
    await spending.claimDispatch(claim.request);
    const losingExecution = randomUUID();
    const losingResult: CustomerArtworkAttempt = { ...claim.attempt, status: 'failed', completedAt: Date.now(),
      providerCalls, billing: 'unknown', failure: 'unknown' };
    // The loser can report an unavailable authorization or an early abort after
    // another worker has already committed dispatch. Its result must be fenced.
    expect(await sessions.finishRequest(event.id, losingResult, losingExecution)).toBe('handled');
    expect(await sessions.get(event.id)).toEqual(claim.next);
    expect((await ledger())[0]).toMatchObject({ state: 'dispatched', completed_at: null, provider_calls: null,
      execution_id: claim.request.imageSpendExecution });
    expect(await policy()).toMatchObject({ paused: false, requests_reserved: 1 });

    const winningResult = knownResult(claim);
    expect(await sessions.finishRequest(event.id, winningResult, claim.request.imageSpendExecution!)).toBe('handled');
    expect((await sessions.get(event.id))?.attempts[0]).toEqual(winningResult);
    expect((await ledger())[0]).toMatchObject({ state: 'completed', provider_calls: 1,
      execution_id: claim.request.imageSpendExecution });
    expect(await policy()).toMatchObject({ paused: false, requests_reserved: 1 });
    expect(await spending.available()).toBe(true);
    // A later retry of the loser's completion cannot overwrite the saved image.
    await sessions.finishRequest(event.id, losingResult, losingExecution);
    expect((await sessions.get(event.id))?.attempts[0]).toEqual(winningResult);
  });

  it('rechecks a persisted pause after reservation before allowing dispatch', async () => {
    const claim = await pending();
    expect(await reserve(claim)).toBe(true);
    await control`update public.image_spend_policies set paused = true, stop_reason = 'synthetic_operator_pause'`;
    await expect(spending.claimDispatch(claim.request)).rejects.toMatchObject({ code: 'blocked' });
    expect((await ledger())[0]).toMatchObject({ state: 'reserved', dispatched_at: null });
    expect((await policy()).requests_reserved).toBe(1);
  });

  it('rejects altered prompt or reference pixels without consuming the dispatch permit', async () => {
    const claim = await pending(event, 'edit');
    expect(await reserve(claim)).toBe(true);
    await expect(spending.claimDispatch({ ...claim.request, prompt: 'Changed after reservation' })).rejects.toMatchObject({ code: 'blocked' });
    await expect(spending.claimDispatch({ ...claim.request,
      referenceImages: [{ bytes: Buffer.from('different pixels'), mimeType: 'image/png' }] })).rejects.toMatchObject({ code: 'blocked' });
    expect((await ledger())[0].state).toBe('reserved');
    await spending.claimDispatch(claim.request);
    expect((await ledger())[0].state).toBe('dispatched');
  });

  it.each(['failed', 'ready'] as const)('persists a global stop for a %s outcome whose billing is unknown', async status => {
    const claim = await pending();
    expect(await reserve(claim)).toBe(true);
    await spending.claimDispatch(claim.request);
    await sessions.finishRequest(event.id, { ...claim.attempt, status, completedAt: Date.now(), providerCalls: 1,
      billing: 'unknown', ...(status === 'failed' ? { failure: 'provider' as const } : {}) }, claim.request.imageSpendExecution!);
    expect(await policy()).toMatchObject({ paused: true, stop_reason: 'provider_billing_unknown', requests_reserved: 1 });
    expect((await ledger())[0]).toMatchObject({ state: 'unknown', provider_calls: 1, usage: null });
    expect((await sessions.get(event.id))?.attempts[0].status).toBe(status);
    await expect(reserve(await pending(await createEvent()))).rejects.toMatchObject({ code: 'blocked' });
    // Clearing a switch alone cannot erase an unresolved historical charge.
    await control`update public.image_spend_policies set paused = false`;
    expect(await spending.available()).toBe(false);
    await expect(reserve(await pending(await createEvent()))).rejects.toMatchObject({ code: 'blocked' });
  });

  it('never expires or refunds a worker-death reservation, including after its event is deleted', async () => {
    const claim = await pending();
    expect(await reserve(claim)).toBe(true);
    await control`update public.image_spend_requests set created_at = now() - interval '30 days'`;
    expect(await spending.available()).toBe(false);
    const before = await sessions.get(event.id);
    const recovered = await artwork.recoverCustomerArtwork(before!, sessions, claim.attempt.startedAt + artwork.CUSTOMER_ARTWORK_JOB_MS + 1);
    expect(recovered.attempts[0].status).toBe('interrupted');
    expect((await ledger())[0].state).toBe('reserved');
    await control`delete from public.events where id = ${event.id}`;
    expect((await ledger())[0]).toMatchObject({ state: 'reserved', event_id: null });
    expect((await policy()).requests_reserved).toBe(1);
    await expect(reserve(await pending(await createEvent()))).rejects.toMatchObject({ code: 'blocked' });
  });

  it('saves the legitimate dispatched winner after read recovery marks its session interrupted without redispatch', async () => {
    const claim = await pending();
    expect(await reserve(claim)).toBe(true);
    await spending.claimDispatch(claim.request);
    const [dispatched] = await ledger();
    const recovered = await artwork.recoverCustomerArtwork((await sessions.get(event.id))!, sessions,
      claim.attempt.startedAt + artwork.CUSTOMER_ARTWORK_JOB_MS + 1);
    expect(recovered.attempts[0].status).toBe('interrupted');
    expect(recovered.version).toBe(claim.next.version + 1);
    expect((await ledger())[0]).toEqual(dispatched);
    expect(await spending.available()).toBe(false);

    // The original dispatched worker can finish late. Recovery did not create
    // another permit, refund the first claim, or start another provider request.
    const result = knownResult(claim);
    await sessions.finishRequest(event.id, result, claim.request.imageSpendExecution!);
    const saved = (await sessions.get(event.id))!;
    expect(saved.version).toBe(recovered.version + 1);
    expect(saved.attempts).toEqual([result]);
    const rows = await ledger();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ state: 'completed', provider_calls: 1,
      execution_id: claim.request.imageSpendExecution, dispatched_at: dispatched.dispatched_at });
    expect(await policy()).toMatchObject({ paused: false, requests_reserved: 1, creates_reserved: 1, edits_reserved: 0 });
    expect(await spending.available()).toBe(true);
  });

  it('rolls back the image result if ledger completion fails and keeps new spending blocked', async () => {
    const claim = await pending();
    expect(await reserve(claim)).toBe(true);
    await spending.claimDispatch(claim.request);
    await control.unsafe(`create function public.posy_test_fail_spend_completion() returns trigger language plpgsql as $$
      begin if new.state = 'completed' then raise exception 'synthetic ledger completion failure'; end if; return new; end $$;
      create trigger posy_test_fail_spend_completion before update on public.image_spend_requests
        for each row execute function public.posy_test_fail_spend_completion();`);
    await expect(sessions.finishRequest(event.id, knownResult(claim), claim.request.imageSpendExecution!)).rejects.toMatchObject({
      cause: { code: 'P0001', message: expect.stringContaining('synthetic ledger completion failure') },
    });
    expect(await sessions.get(event.id)).toEqual(claim.next);
    expect((await ledger())[0]).toMatchObject({ state: 'dispatched', completed_at: null, usage: null });
    expect((await policy()).requests_reserved).toBe(1);
    expect(await spending.available()).toBe(false);
    await expect(reserve(await pending(await createEvent()))).rejects.toMatchObject({ code: 'blocked' });
  });

  it('denies Data API roles and keeps both tables restricted to server access', async () => {
    for (const table of ['image_spend_policies', 'image_spend_requests']) {
      const qualified = `public.${table}`;
      const [security] = await control`select relrowsecurity from pg_class where oid = ${qualified}::regclass`;
      expect(security.relrowsecurity).toBe(true);
      const policies = await control`select permissive, roles, qual, with_check from pg_policies
        where schemaname = 'public' and tablename = ${table}`;
      expect(policies).toHaveLength(1);
      expect(policies[0]).toMatchObject({ permissive: 'RESTRICTIVE', qual: 'false', with_check: 'false' });
      for (const role of ['anon', 'authenticated']) {
        const [permissions] = await control`select has_table_privilege(${role}, ${qualified}, 'select') as can_read,
          has_table_privilege(${role}, ${qualified}, 'insert') as can_insert,
          has_table_privilege(${role}, ${qualified}, 'update') as can_update,
          has_table_privilege(${role}, ${qualified}, 'delete') as can_delete`;
        expect(Object.values(permissions)).toEqual([false, false, false, false]);
        await expect(control.begin(async tx => {
          await tx.unsafe(`set local role ${role}`);
          await tx.unsafe(`select * from ${qualified}`);
        })).rejects.toMatchObject({ code: '42501' });
      }
      const [server] = await control`select has_table_privilege('service_role', ${qualified}, 'select') as can_read,
        has_table_privilege('service_role', ${qualified}, 'insert') as can_insert,
        has_table_privilege('service_role', ${qualified}, 'update') as can_update,
        has_table_privilege('service_role', ${qualified}, 'delete') as can_delete`;
      expect(Object.values(server)).toEqual([true, true, true, true]);
    }
  });
});

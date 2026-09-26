// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api';
import { events } from '../shared/schema';
import type { PlusMembershipProof } from '../server/plusMembershipProof';
import type { ReservePlusLink } from '../server/plusLinkStore';
import { postgresIntegrationUrl } from '../script/postgres-test-config.mjs';

// Real transactions on the explicitly opted-in loopback-only disposable DB.
// No hosted URL fallback, Stripe request, email delivery, or provider call.
const target = postgresIntegrationUrl();
process.env.DATABASE_URL = target;
const network = vi.fn(async () => { throw new Error('Network forbidden in Plus inbox integration tests.'); });
vi.stubGlobal('fetch', network);
const control = postgres(target, { prepare: false, max: 8, connect_timeout: 3, idle_timeout: 2 });
let initialized = false;
let production: typeof import('../server/storage');
let store: InstanceType<typeof import('../server/plusLinkStore').DbPlusLinkStore>;
let memberships: InstanceType<typeof import('../server/plusMembership').DbPlusMembershipStore>;
const now = Math.floor(Date.now() / 3_600_000) * 3_600_000 + 1_000;
let clock = now;
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const codeHash = hash('synthetic HMAC fixture; no raw production code');
const proof = (extra: Partial<PlusMembershipProof> = {}): PlusMembershipProof => ({
  subscriptionId: 'sub_inbox_original', customerId: 'cus_inbox_original', planTier: 'plus_active', trialEndsAt: null,
  billingInterval: 'monthly', subscriptionCreatedAt: now - 100_000, observedAt: now, billingEmail: 'paid@example.invalid', ...extra,
});
function input(extra: Partial<ReservePlusLink> = {}): ReservePlusLink {
  const result = { id: randomUUID(), eventId: 1, requestKey: randomUUID(), recipient: 'paid@example.invalid',
    recipientHash: hash('paid@example.invalid'), ipHash: hash('synthetic ip'), now, expiresAt: now + 600_000, resendAt: now + 60_000, ...extra };
  if (extra.recipient && !extra.recipientHash) result.recipientHash = hash(extra.recipient);
  return result;
}

beforeAll(async () => {
  const [identity] = await control`select current_database() as name`;
  if (identity.name !== 'posy_integration') throw new Error('Unexpected integration database.');
  const existing = await control`select tablename from pg_tables where schemaname='public'`;
  if (existing.length) throw new Error('Use a fresh, empty disposable PostgreSQL database.');
  const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson({ events }));
  const migrations = await Promise.all([
    '20260926022655_verified_plus_memberships.sql', '20260926031348_plus_email_verifications.sql',
  ].map(name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8')));
  await control.begin(async tx => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const found = await tx`select rolname from pg_roles where rolname=${role}`;
      if (!found.length) await tx.unsafe(`create role ${role} nologin${role === 'service_role' ? ' bypassrls' : ''}`);
    }
    for (const statement of [...statements, ...migrations]) await tx.unsafe(statement);
  });
  initialized = true;
  production = await import('../server/storage');
  const { DbPlusLinkStore } = await import('../server/plusLinkStore');
  const { DbPlusMembershipStore } = await import('../server/plusMembership');
  store = new DbPlusLinkStore(production.db, () => clock);
  memberships = new DbPlusMembershipStore(production.db);
}, 30_000);

beforeEach(async () => {
  clock = now;
  await control.unsafe('truncate public.plus_link_challenges,public.plus_link_rate_buckets,public.event_plus_memberships,public.plus_memberships,public.events restart identity cascade');
  await production.db.insert(events).values(Array.from({ length: 65 }, (_, i) => ({ id: i + 1,
    ownerToken: `synthetic-inbox-owner-${i + 1}`, shareSlug: `synthetic-inbox-share-${i + 1}`,
    eventName: 'Synthetic inbox linking fixture', eventType: 'Birthday Party', createdAt: now })));
});
afterEach(async () => {
  if (initialized) {
    await control.unsafe('drop trigger if exists posy_test_fail_link on public.event_plus_memberships');
    await control.unsafe('drop function if exists public.posy_test_fail_link()');
    await control.unsafe('drop trigger if exists posy_test_hold_issuance on public.plus_link_challenges');
    await control.unsafe('drop function if exists public.posy_test_hold_issuance()');
  }
  expect(network).not.toHaveBeenCalled();
});
afterAll(async () => {
  if (production?.db.$client) await production.db.$client.end({ timeout: 3 });
  if (initialized) await control.unsafe('drop table public.plus_link_challenges,public.plus_link_rate_buckets,public.event_plus_memberships,public.plus_memberships,public.events cascade');
  await control.end({ timeout: 3 });
  vi.unstubAllGlobals();
});

async function sent(extra: Partial<ReservePlusLink> = {}, evidence = proof()) {
  const request = input(extra);
  const reserved = await store.reserve(request);
  expect(reserved?.created).toBe(true);
  expect(await store.prepareDelivery(request.id, evidence, codeHash, request.now)).toBe(true);
  await store.markDelivery(request.id, true, request.now);
  return request;
}
async function claimed(request: ReservePlusLink, at = request.now) {
  const execution = randomUUID();
  expect(await store.beginVerification({ eventId: request.eventId, id: request.id }, row => row.codeHash === codeHash, execution, at))
    .toMatchObject({ kind: 'claimed' });
  return execution;
}
async function row(id: string) { const [value] = await control`select * from public.plus_link_challenges where id=${id}::uuid`; return value; }
async function countBindings() { const [value] = await control`select count(*)::integer as count from public.event_plus_memberships`; return value.count; }

describe('billing inbox ownership on disposable PostgreSQL', () => {
  it('reserves one delivery for simultaneous identical request keys, without charging replayed rate buckets', async () => {
    const request = input();
    const results = await Promise.all(Array.from({ length: 6 }, () => store.reserve({ ...request, id: randomUUID() })));
    expect(results.filter(result => result?.created)).toHaveLength(1);
    expect(new Set(results.map(result => result?.challenge.id)).size).toBe(1);
    const buckets = await control`select count from public.plus_link_rate_buckets`;
    expect(buckets).toHaveLength(4);
    expect(buckets.every(bucket => bucket.count === 1)).toBe(true);
    const replay = await store.reserve({ ...request, id: randomUUID(), recipient: 'changed@example.invalid', recipientHash: hash('changed'),
      now: now + 60_000, expiresAt: now + 600_000, resendAt: now + 120_000 });
    expect(replay).toMatchObject({ created: false, challenge: { recipient: request.recipient } });
  });

  it('enforces recipient cooldown across events and invalidates an old code before a resend is delivered', async () => {
    const original = await sent();
    expect(await store.reserve(input({ eventId: 2 }))).toBeUndefined();
    const replacement = input({ now: now + 60_000, resendAt: now + 120_000 });
    expect((await store.reserve(replacement))?.created).toBe(true);
    expect((await row(original.id)).state).toBe('superseded');
    await store.markDelivery(original.id, true, now + 60_000);
    expect((await row(original.id)).state).toBe('superseded');
    expect(await store.beginVerification({ eventId: 1, id: original.id }, () => true, randomUUID(), now + 60_000)).toEqual({ kind: 'invalid' });
    expect((await store.readLatest(1, now + 60_000))?.id).toBe(replacement.id);
  });

  it('enforces recipient cooldown under a forced concurrent race across an hourly bucket boundary', async () => {
    const boundary = Math.floor(now / 3_600_000) * 3_600_000 + 3_600_000;
    const requests = [boundary - 1, boundary + 1].map((at, i) => input({ eventId: i + 1,
      now: at, expiresAt: at + 600_000, resendAt: at + 60_000 }));
    await control.unsafe(`create function public.posy_test_hold_issuance() returns trigger language plpgsql as $$
      begin perform pg_advisory_xact_lock(7821206,43); return new; end $$;
      create trigger posy_test_hold_issuance before insert on public.plus_link_challenges
        for each row execute function public.posy_test_hold_issuance();`);
    let pending!: Promise<Array<Awaited<ReturnType<typeof store.reserve>>>>;
    let waiting = 0;
    await control.begin(async tx => {
      await tx`select pg_advisory_xact_lock(7821206,43)`;
      pending = Promise.all(requests.map(request => store.reserve(request)));
      const deadline = performance.now() + 3_000;
      do {
        const [row] = await control`select count(*)::integer as waiting from pg_stat_activity
          where datname=current_database() and wait_event_type='Lock' and pid<>pg_backend_pid()`;
        waiting = row.waiting;
        if (waiting >= 2) break;
        await new Promise(resolve => setTimeout(resolve, 15));
      } while (performance.now() < deadline);
    });
    const results = await pending;
    expect(waiting).toBeGreaterThanOrEqual(2);
    expect(results.filter(result => result?.created)).toHaveLength(1);
    expect(results.filter(result => result === undefined)).toHaveLength(1);
    expect(await control`select id from public.plus_link_challenges`).toHaveLength(1);
  });

  it.each(['event', 'recipient'] as const)('enforces the durable three-per-hour %s ceiling across failed challenges and resends', async scope => {
    for (let i = 0; i < 3; i++) {
      const request = input({ eventId: scope === 'event' ? 1 : i + 1,
        recipient: scope === 'recipient' ? 'paid@example.invalid' : `synthetic-${i}@example.invalid`,
        now: now + i * 60_000, resendAt: now + (i + 1) * 60_000 });
      expect((await store.reserve(request))?.created).toBe(true);
      await store.markDelivery(request.id, false, request.now);
    }
    expect(await store.reserve(input({ eventId: scope === 'event' ? 1 : 4,
      recipient: scope === 'recipient' ? 'paid@example.invalid' : 'synthetic-fourth@example.invalid',
      now: now + 180_000, resendAt: now + 240_000 }))).toBeUndefined();
    const [bucket] = await control`select count from public.plus_link_rate_buckets where scope=${scope}`;
    expect(bucket.count).toBe(3);
  });

  it.each([['ip', 12], ['global', 60]] as const)('serializes the durable %s issuance ceiling across different events and recipients', async (scope, limit) => {
    const requests = Array.from({ length: limit + 1 }, (_, i) => input({ eventId: i + 1,
      recipient: `synthetic-${i}@example.invalid`, ipHash: hash(scope === 'ip' ? 'shared-ip' : `ip-${i}`) }));
    const results = await Promise.all(requests.map(value => store.reserve(value)));
    expect(results.filter(result => result?.created)).toHaveLength(limit);
    expect(results.filter(result => result === undefined)).toHaveLength(1);
    const [bucket] = await control`select count from public.plus_link_rate_buckets where scope=${scope} order by count desc limit 1`;
    expect(bucket.count).toBe(limit);
  }, 30_000);

  it('grants only one verification worker and consumes the code with its exact event binding', async () => {
    const request = await sent();
    const executions = Array.from({ length: 6 }, () => randomUUID());
    const results = await Promise.all(executions.map(execution => store.beginVerification(
      { eventId: 1, id: request.id }, item => item.codeHash === codeHash, execution, now)));
    const winner = results.findIndex(result => result.kind === 'claimed');
    expect(results.filter(result => result.kind === 'claimed')).toHaveLength(1);
    expect(await countBindings()).toBe(0);
    expect((await row(request.id)).attempts).toBe(5);
    expect(await store.finishVerification(request.id, 1, executions[winner], proof(), now)).toBe(true);
    expect((await row(request.id)).state).toBe('consumed');
    expect(await countBindings()).toBe(1);
    expect(await memberships.getEventAccess(1)).toMatchObject({ subscriptionId: proof().subscriptionId, planTier: 'plus_active' });
    expect(await memberships.getEventAccess(2)).toBeUndefined();
    expect(await store.beginVerification({ eventId: 1, id: request.id }, () => true, randomUUID(), now))
      .toEqual({ kind: 'invalid' });
  });

  it('requires a matching code, exact event and unexpired challenge for consumed replay', async () => {
    const request = await sent();
    const execution = await claimed(request);
    expect(await store.finishVerification(request.id, 1, execution, proof(), now)).toBe(true);
    expect(await store.beginVerification({ eventId: 2, id: request.id }, () => true, randomUUID(), now)).toEqual({ kind: 'invalid' });
    expect(await store.beginVerification({ eventId: 1, id: request.id }, () => false, randomUUID(), now)).toEqual({ kind: 'invalid' });
    expect(await store.beginVerification({ eventId: 1, id: request.id }, item => item.codeHash === codeHash, randomUUID(), now))
      .toMatchObject({ kind: 'consumed' });
    expect(await store.beginVerification({ eventId: 1, id: request.id }, () => true, randomUUID(), request.expiresAt))
      .toEqual({ kind: 'invalid' });
    expect((await row(request.id)).state).toBe('consumed');
  });

  it.each([
    [false, null, null],
    [true, null, 'paid@example.invalid'],
    [true, '   ', 'paid@example.invalid'],
    [true, 'existing-contact@example.invalid', 'existing-contact@example.invalid'],
  ] as const)('saves recovery email only with consent=%s and no existing nonempty contact (%s)', async (consent, prior, expected) => {
    await control`update public.events set captured_email=${prior} where id=1`;
    const request = await sent();
    const execution = await claimed(request);
    expect(await store.finishVerification(request.id, 1, execution, proof(), now, consent)).toBe(true);
    const [saved] = await control`select captured_email from public.events where id=1`;
    expect(saved.captured_email).toBe(expected);
  });

  it('does not acquire later recovery-email consent by replaying a consumed challenge', async () => {
    const request = await sent();
    const execution = await claimed(request);
    expect(await store.finishVerification(request.id, 1, execution, proof(), now, false)).toBe(true);
    expect(await store.finishVerification(request.id, 1, execution, proof(), now, true)).toBe(false);
    const [saved] = await control`select captured_email from public.events where id=1`;
    expect(saved.captured_email).toBeNull();
    expect((await row(request.id)).state).toBe('consumed');
  });

  it('allows at most five simultaneous guesses and counts malformed comparisons without reopening attempts', async () => {
    const request = await sent();
    const compare = vi.fn(() => { throw new Error('Synthetic malformed guess'); });
    const results = await Promise.all(Array.from({ length: 20 }, () => store.beginVerification(
      { eventId: 1, id: request.id }, compare, randomUUID(), now)));
    expect(results.every(result => result.kind === 'invalid')).toBe(true);
    expect(compare).toHaveBeenCalledTimes(5);
    expect(await row(request.id)).toMatchObject({ attempts: 5, state: 'failed' });
    expect(await store.beginVerification({ eventId: 1, id: request.id }, () => true, randomUUID(), now)).toEqual({ kind: 'invalid' });
    expect(await countBindings()).toBe(0);
  });

  it('returns the same active challenge shape after pending delivery failure and never starts work on reads', async () => {
    const request = input();
    await store.reserve(request);
    await store.markDelivery(request.id, false, now);
    const first = await store.readLatest(1, now);
    expect(first).toMatchObject({ id: request.id, state: 'failed', codeHash: null });
    expect(await store.readLatest(1, now)).toEqual(first);
    expect(await store.beginVerification({ eventId: 1, id: request.id }, () => true, randomUUID(), now)).toEqual({ kind: 'invalid' });
    expect((await store.reserve(request))?.created).toBe(false);
  });

  it.each(['pending', 'sending', 'failed'] as const)('counts five guesses for a %s challenge without enabling redemption', async state => {
    const request = input();
    await store.reserve(request);
    if (state === 'sending') await store.prepareDelivery(request.id, proof(), codeHash, now);
    if (state === 'failed') await store.markDelivery(request.id, false, now);
    const compare = vi.fn(() => false);
    const results = await Promise.all(Array.from({ length: 7 }, () => store.beginVerification(
      { eventId: 1, id: request.id }, compare, randomUUID(), now)));
    expect(results.every(result => result.kind === 'invalid')).toBe(true);
    expect(compare).toHaveBeenCalledTimes(5);
    expect(await row(request.id)).toMatchObject({ state: 'failed', attempts: 5 });
    expect(await countBindings()).toBe(0);
  });

  it('cannot finish a superseded verification or restore it with a late delivery acknowledgment', async () => {
    const request = await sent();
    const execution = await claimed(request);
    const replacement = input({ now: now + 60_000, resendAt: now + 120_000 });
    await store.reserve(replacement);
    expect(await store.finishVerification(request.id, 1, execution, proof(), now + 60_000)).toBe(false);
    expect((await row(request.id)).state).toBe('superseded');
    expect((await row(replacement.id)).state).toBe('pending');
    expect(await countBindings()).toBe(0);
    expect(await control`select * from public.plus_memberships`).toHaveLength(0);
  });

  it.each(['challenge', 'trial'] as const)('rechecks %s expiry during final binding and commits a failed challenge', async reason => {
    const evidence = proof(reason === 'trial' ? { planTier: 'plus_trial', trialEndsAt: now + 30_000 } : {});
    const request = await sent({}, evidence);
    const execution = await claimed(request);
    const at = reason === 'trial' ? now + 30_000 : request.expiresAt;
    expect(await store.finishVerification(request.id, 1, execution, evidence, at)).toBe(false);
    expect((await row(request.id)).state).toBe('failed');
    expect(await countBindings()).toBe(0);
    expect(await control`select * from public.plus_memberships`).toHaveLength(0);
  });

  it.each(['begin', 'finish'] as const)('checks fresh time after %s waits on a challenge lock rather than trusting entry time', async phase => {
    const request = await sent();
    const execution = phase === 'finish' ? await claimed(request) : randomUUID();
    let work!: Promise<unknown>;
    let waiting = false;
    await control.begin(async tx => {
      await tx`select id from public.plus_link_challenges where id=${request.id}::uuid for update`;
      work = phase === 'finish' ? store.finishVerification(request.id, 1, execution, proof(), now)
        : store.beginVerification({ eventId: 1, id: request.id }, () => true, execution, now);
      const deadline = performance.now() + 3_000;
      do {
        const [activity] = await control`select count(*)::integer as count from pg_stat_activity
          where datname=current_database() and wait_event_type='Lock' and pid<>pg_backend_pid()`;
        if (activity.count > 0) { waiting = true; break; }
        await new Promise(resolve => setTimeout(resolve, 15));
      } while (performance.now() < deadline);
      clock = request.expiresAt;
    });
    const outcome = await work;
    expect(waiting).toBe(true);
    expect(outcome).toEqual(phase === 'finish' ? false : { kind: 'invalid' });
    expect(await countBindings()).toBe(0);
    expect(await control`select * from public.plus_memberships`).toHaveLength(0);
    expect((await row(request.id)).state).toBe(phase === 'finish' ? 'failed' : 'sent');
  });

  it.each([0, 1])('cannot revive a cancellation whose observation is %sms newer than the supplied proof', async offset => {
    const request = await sent();
    const execution = await claimed(request);
    await memberships.reconcile({ ...proof(), planTier: 'plus_expired', observedAt: now + offset,
      source: 'subscription', sourceId: 'evt_synthetic_cancel' });
    expect(await store.finishVerification(request.id, 1, execution, proof(), now + 2, true)).toBe(false);
    const [membership] = await control`select * from public.plus_memberships`;
    expect(membership.plan_tier).toBe('plus_expired');
    expect(Number(membership.observed_at)).toBe(now + offset);
    expect((await row(request.id)).state).toBe('failed');
    expect(await countBindings()).toBe(0);
    expect((await control`select captured_email from public.events where id=1`)[0].captured_email).toBeNull();
  });

  it.each(['email', 'customer', 'subscription'] as const)('rejects changed %s identity after a code was delivered', async changed => {
    const request = await sent();
    const execution = await claimed(request);
    const evidence = proof(changed === 'email' ? { billingEmail: 'changed@example.invalid' }
      : changed === 'customer' ? { customerId: 'cus_changed' } : { subscriptionId: 'sub_changed' });
    expect(await store.finishVerification(request.id, 1, execution, evidence, now)).toBe(false);
    expect((await row(request.id)).state).toBe('failed');
    expect(await countBindings()).toBe(0);
    expect(await control`select * from public.plus_memberships`).toHaveLength(0);
  });

  it('preserves a different existing binding even when the inbox proves a newer purchase', async () => {
    const existing = proof({ subscriptionId: 'sub_existing', customerId: 'cus_existing', subscriptionCreatedAt: now - 200_000 });
    await memberships.reconcile({ ...existing, eventId: 1, source: 'checkout', sourceId: 'cs_existing' });
    const request = await sent();
    const execution = await claimed(request);
    expect(await store.finishVerification(request.id, 1, execution, proof(), now)).toBe(false);
    expect(await memberships.getEventAccess(1)).toMatchObject({ subscriptionId: 'sub_existing' });
    expect((await row(request.id)).state).toBe('failed');
    const rows = await control`select subscription_id from public.plus_memberships`;
    expect(rows).toEqual([{ subscription_id: 'sub_existing' }]);
  });

  it('rolls back membership and code consumption when the final binding insert fails', async () => {
    const request = await sent();
    const execution = await claimed(request);
    await control.unsafe(`create function public.posy_test_fail_link() returns trigger language plpgsql as $$
      begin raise exception 'synthetic binding failure'; end $$;
      create trigger posy_test_fail_link before insert on public.event_plus_memberships
      for each row execute function public.posy_test_fail_link();`);
    await expect(store.finishVerification(request.id, 1, execution, proof(), now, true)).rejects.toMatchObject({
      cause: { code: 'P0001', message: expect.stringContaining('synthetic binding failure') },
    });
    expect(await countBindings()).toBe(0);
    expect(await control`select * from public.plus_memberships`).toHaveLength(0);
    expect((await control`select captured_email from public.events where id=1`)[0].captured_email).toBeNull();
    expect(await row(request.id)).toMatchObject({ state: 'verifying', attempts: 1, execution_id: execution });
    await store.abortVerification(request.id, execution);
    expect((await row(request.id)).state).toBe('failed');
  });

  it('fences a failed duplicate worker from aborting or completing the legitimate verifier', async () => {
    const request = await sent();
    const execution = await claimed(request);
    const loser = randomUUID();
    await store.abortVerification(request.id, loser);
    expect(await store.finishVerification(request.id, 1, loser, proof(), now)).toBe(false);
    expect(await row(request.id)).toMatchObject({ state: 'verifying', execution_id: execution });
    expect(await store.finishVerification(request.id, 1, execution, proof(), now)).toBe(true);
    expect((await row(request.id)).state).toBe('consumed');
  });

  it('enables RLS and denies client-role access to both challenge and rate tables', async () => {
    for (const table of ['plus_link_challenges', 'plus_link_rate_buckets']) {
      const name = `public.${table}`;
      const [security] = await control`select relrowsecurity from pg_class where oid=${name}::regclass`;
      expect(security.relrowsecurity).toBe(true);
      for (const role of ['anon', 'authenticated', 'service_role']) {
        const [permissions] = await control`select has_table_privilege(${role},${name},'select') as r,
          has_table_privilege(${role},${name},'insert') as i,has_table_privilege(${role},${name},'update') as u,
          has_table_privilege(${role},${name},'delete') as d`;
        expect(Object.values(permissions)).toEqual(Array(4).fill(role === 'service_role'));
        if (role !== 'service_role') await expect(control.begin(async tx => {
          await tx.unsafe(`set local role ${role}`);
          await tx.unsafe(`select * from ${name}`);
        })).rejects.toMatchObject({ code: '42501' });
      }
    }
  });
});

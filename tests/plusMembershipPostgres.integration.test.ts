// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api';
import { events } from '../shared/schema';
import { postgresIntegrationUrl } from '../script/postgres-test-config.mjs';
import type { PlusMembershipReconciliation } from '../server/plusMembership';

const target = postgresIntegrationUrl();
process.env.DATABASE_URL = target;
const networkFetch = vi.fn(async () => { throw Error('Network calls forbidden in membership integration tests.'); });
vi.stubGlobal('fetch', networkFetch);
const control = postgres(target, { prepare: false, max: 4, connect_timeout: 3, idle_timeout: 2 });
let initialized = false;
let production: typeof import('../server/storage');
let store: InstanceType<typeof import('../server/plusMembership').DbPlusMembershipStore>;
const observation = Date.now();
const proof = (extra: Partial<PlusMembershipReconciliation> = {}): PlusMembershipReconciliation => ({
  subscriptionId: 'sub_original', customerId: 'cus_original', planTier: 'plus_active',
  trialEndsAt: null, billingInterval: 'monthly', subscriptionCreatedAt: observation - 10_000,
  observedAt: observation, eventId: 1, source: 'checkout', sourceId: 'cs_synthetic', ...extra,
});

beforeAll(async () => {
  const [identity] = await control`select current_database() as name`;
  if (identity.name !== 'posy_integration') throw Error('Unexpected test database.');
  const existing = await control`select tablename from pg_tables where schemaname='public'`;
  if (existing.length) throw Error('Use a fresh, empty disposable PostgreSQL database.');
  const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson({ events }));
  const migration = await readFile(new URL('../supabase/migrations/20260926022655_verified_plus_memberships.sql', import.meta.url), 'utf8');
  await control.begin(async tx => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const found = await tx`select rolname from pg_roles where rolname=${role}`;
      if (!found.length) await tx.unsafe(`create role ${role} nologin${role === 'service_role' ? ' bypassrls' : ''}`);
    }
    for (const statement of statements) await tx.unsafe(statement);
    await tx.unsafe(migration);
  });
  initialized = true;
  production = await import('../server/storage');
  const { DbPlusMembershipStore } = await import('../server/plusMembership');
  store = new DbPlusMembershipStore(production.db);
}, 30_000);

beforeEach(async () => {
  await control.unsafe('truncate public.event_plus_memberships, public.plus_memberships, public.events restart identity cascade');
  await production.db.insert(events).values([1, 2].map(id => ({ id, ownerToken: `owner-${id}`, shareSlug: `share-${id}`,
    eventName: 'Synthetic membership fixture', eventType: 'Birthday Party', capturedEmail: 'same@example.invalid', createdAt: observation })));
});

afterAll(async () => {
  expect(networkFetch).not.toHaveBeenCalled();
  if (production?.db.$client) await production.db.$client.end({ timeout: 3 });
  if (initialized) await control.unsafe('drop table public.event_plus_memberships, public.plus_memberships, public.events cascade');
  await control.end({ timeout: 3 });
  vi.unstubAllGlobals();
});

describe('exact Plus membership on disposable PostgreSQL', () => {
  it('does not grant another event with the same contact, and contact edits preserve the proven event', async () => {
    await store.reconcile(proof());
    expect((await store.getEventAccess(1))?.subscriptionId).toBe('sub_original');
    expect(await store.getEventAccess(2)).toBeUndefined();
    await control`update public.events set captured_email='corrected@example.invalid' where id=1`;
    expect((await store.getEventAccess(1))?.planTier).toBe('plus_active');
  });

  it('concurrent duplicate settlements create one membership/binding', async () => {
    await Promise.all(Array.from({ length: 6 }, () => store.reconcile(proof())));
    const [row] = await control`select (select count(*) from public.plus_memberships)::integer as memberships,
      (select count(*) from public.event_plus_memberships)::integer as bindings`;
    expect(row).toEqual({ memberships: 1, bindings: 1 });
  });

  it('updates canceled subscription by exact identity without affecting another subscription', async () => {
    await store.reconcile(proof());
    await store.reconcile(proof({ subscriptionId: 'sub_other', customerId: 'cus_other', eventId: 2 }));
    await store.reconcile(proof({ planTier: 'plus_expired', eventId: undefined, observedAt: observation + 1,
      source: 'subscription', sourceId: 'evt_canceled' }));
    expect((await store.getEventAccess(1))?.planTier).toBe('plus_expired');
    expect((await store.getEventAccess(2))?.planTier).toBe('plus_active');
  });

  it('older observations cannot revive membership and old purchase metadata cannot replace a newer binding', async () => {
    await store.reconcile(proof());
    await store.reconcile(proof({ planTier: 'plus_expired', observedAt: observation + 20 }));
    await store.reconcile(proof({ observedAt: observation + 10 }));
    expect((await store.getEventAccess(1))?.planTier).toBe('plus_expired');
    await store.reconcile(proof({ subscriptionId: 'sub_newer', customerId: 'cus_newer',
      subscriptionCreatedAt: observation - 5000, observedAt: observation + 30 }));
    await store.reconcile(proof({ observedAt: observation + 40 }));
    expect((await store.getEventAccess(1))?.subscriptionId).toBe('sub_newer');
  });

  it('refuses changed subscription identity and rolls back a membership when event binding fails', async () => {
    await store.reconcile(proof());
    await expect(store.reconcile(proof({ customerId: 'cus_unrelated', observedAt: observation + 1 }))).rejects.toThrow('identity changed');
    expect((await store.getEventAccess(1))?.customerId).toBe('cus_original');
    await expect(store.reconcile(proof({ subscriptionId: 'sub_missing', eventId: 999 }))).rejects.toThrow('could not be found');
    const rows = await control`select subscription_id from public.plus_memberships where subscription_id='sub_missing'`;
    expect(rows).toHaveLength(0);
  });

  it('fills unknown historical creation time from the exact subscription without changing its binding', async () => {
    await control`insert into public.plus_memberships values
      ('sub_original','cus_original','plus_active',null,'monthly',null,${observation-100})`;
    await control`insert into public.event_plus_memberships values
      (1,'sub_original',${observation-100},'historical_settlement','synthetic-historical-proof')`;
    await store.reconcile(proof({ subscriptionId: 'sub_other', customerId: 'cus_other',
      subscriptionCreatedAt: observation - 1000 }));
    expect((await store.getEventAccess(1))?.subscriptionId).toBe('sub_original');
    await store.reconcile(proof());
    const [row] = await control`select subscription_created_at from public.plus_memberships where subscription_id='sub_original'`;
    expect(Number(row.subscription_created_at)).toBe(observation - 10_000);
    expect((await store.getEventAccess(1))?.subscriptionId).toBe('sub_original');
  });

  it('does not bind expired trials and denies all client-role table operations', async () => {
    await store.reconcile(proof({ planTier: 'plus_trial', trialEndsAt: Date.now() - 1 }));
    expect(await store.getEventAccess(1)).toBeUndefined();
    for (const role of ['anon', 'authenticated']) {
      for (const table of ['plus_memberships', 'event_plus_memberships']) {
        for (const statement of [`select * from public.${table}`, `delete from public.${table}`,
          `insert into public.${table} default values`, `update public.${table} set ${table === 'plus_memberships' ? 'observed_at=0' : 'bound_at=0'}`]) {
          await expect(control.begin(async tx => { await tx.unsafe(`set local role ${role}`); await tx.unsafe(statement); })).rejects.toThrow(/permission denied/);
        }
      }
    }
    const rls = await control`select relname, relrowsecurity from pg_class where relname in ('plus_memberships','event_plus_memberships')`;
    expect(rls).toHaveLength(2);
    expect(rls.every(row => row.relrowsecurity)).toBe(true);
  });
});

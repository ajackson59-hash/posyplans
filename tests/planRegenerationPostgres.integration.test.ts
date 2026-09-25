// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';
import { generateDrizzleJson, generateMigration } from 'drizzle-kit/api';
import {
  events, guests, budgetItems, menuItems, shoppingListItems, timelineItems, masterPlannerGenerations,
} from '../shared/schema';
import type { Event, Guest } from '../shared/schema';
import type { PlanContent } from '../shared/planRegeneration';
import { postgresIntegrationUrl } from '../script/postgres-test-config.mjs';

// This suite is excluded from normal npm test. It never falls back to a hosted
// DATABASE_URL, never runs historical baseline migrations, and refuses to touch
// a nonempty public schema. CI supplies a dedicated disposable PostgreSQL service.
const target = postgresIntegrationUrl();
process.env.DATABASE_URL = target;
process.env.ANTHROPIC_API_KEY = 'forbidden-in-integration';
process.env.OPENAI_API_KEY = 'forbidden-in-integration';
vi.mock('@anthropic-ai/sdk', () => ({ default: class {
  constructor() { throw new Error('Provider clients are forbidden in PostgreSQL integration tests.'); }
} }));
const networkFetch = vi.fn(async () => { throw new Error('HTTP/provider calls are forbidden in PostgreSQL integration tests.'); });
vi.stubGlobal('fetch', networkFetch);

const control = postgres(target, { prepare: false, max: 5, connect_timeout: 3, idle_timeout: 2 });
const candidate: PlanContent = {
  eventIdentity: 'Synthetic replacement plan',
  budgetItems: [{ name: 'Replacement flowers', estimatedCost: 80 }],
  menuItems: [{ itemName: 'Replacement pasta' }],
  shoppingItems: [{ itemName: 'Replacement napkins' }],
  timelineItems: [{ title: 'Replacement setup', time: '10 AM' }],
};
let initialized = false;
let production: typeof import('../server/storage');
let regeneration: typeof import('../server/planRegenerationStore');
let execution: typeof import('../server/masterPlannerRunStore');
let normal: InstanceType<typeof import('../server/storage').DatabaseStorage>;
let store: InstanceType<typeof import('../server/planRegenerationStore').DbPlanRegenerationStore>;
let event: Event;
let guest: Guest;

beforeAll(async () => {
  const [identity] = await control`select current_database() as name`;
  if (identity.name !== 'posy_integration') throw new Error('Unexpected integration database.');
  const existing = await control`select tablename from pg_tables where schemaname = 'public'`;
  if (existing.length) throw new Error('Integration database is not empty. Use a fresh disposable PostgreSQL database.');

  // Generate only the production tables exercised here from the installed
  // shared schema. This is not a replay of the historical production baseline.
  const tables = { events, guests, budgetItems, menuItems, shoppingListItems, timelineItems, masterPlannerGenerations };
  const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(tables));
  expect(statements.length).toBeGreaterThan(0);
  const migration = await readFile(new URL('../supabase/migrations/20260925042025_staged_plan_regenerations.sql', import.meta.url), 'utf8');
  await control.begin(async tx => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      const found = await tx`select rolname from pg_roles where rolname = ${role}`;
      if (!found.length) await tx.unsafe(`create role ${role} nologin${role === 'service_role' ? ' bypassrls' : ''}`);
    }
    for (const statement of statements) await tx.unsafe(statement);
    await tx.unsafe(migration);
  });
  initialized = true;
  production = await import('../server/storage');
  regeneration = await import('../server/planRegenerationStore');
  execution = await import('../server/masterPlannerRunStore');
  normal = new production.DatabaseStorage();
  store = new regeneration.DbPlanRegenerationStore(production.db);
}, 30_000);

beforeEach(async () => {
  await control.unsafe('truncate public.plan_regenerations, public.master_planner_generations, public.guests, public.budget_items, public.menu_items, public.shopping_list_items, public.timeline_items, public.events restart identity cascade');
  const [created] = await production.db.insert(events).values({
    ownerToken: `synthetic-owner-${randomUUID()}`, shareSlug: `synthetic-${randomUUID()}`,
    eventName: 'Synthetic PostgreSQL fixture', eventType: 'Birthday Party',
    eventDate: '2026-10-17', themeName: 'Saved garden', estimatedGuestCount: 12,
    eventIdentity: 'Customer-edited original', draftStatus: 'ready', createdAt: Date.now(),
    inviteArtworkUrl: 'synthetic-retained-pixels', inviteIllustrationUrl: 'synthetic-retained-pixels',
    inviteStatus: 'published', inviteDesignConceptJson: '{"fontPairingId":"editorial-serif"}',
  }).returning();
  event = created;
  guest = await normal.createGuest(event.id, { name: 'Synthetic guest', partySize: 3 });
  await normal.createBudgetItem(event.id, { name: 'Existing deposit', estimatedCost: 300, depositPaid: 100, notes: 'Customer edit' });
  await normal.createMenuItem(event.id, { itemName: 'Family recipe', notes: 'No nuts' });
  await normal.createShoppingListItem(event.id, { itemName: 'Borrowed chairs', status: 'borrowing', isPacked: true });
  await normal.createTimelineItem(event.id, { title: 'Custom ceremony', assignedTo: 'Host', isDone: true });
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (initialized) {
    await control.unsafe('drop trigger if exists posy_test_fail_menu on public.menu_items');
    await control.unsafe('drop function if exists public.posy_test_fail_menu()');
  }
  expect(networkFetch).not.toHaveBeenCalled();
});

afterAll(async () => {
  if (production?.db.$client) await production.db.$client.end({ timeout: 3 });
  if (initialized) await control.unsafe('drop table public.plan_regenerations, public.master_planner_generations, public.guests, public.budget_items, public.menu_items, public.shopping_list_items, public.timeline_items, public.events cascade');
  await control.end({ timeout: 3 });
  vi.unstubAllGlobals();
});

async function ready(content = candidate) {
  const claim = await store.reserve(event.id, randomUUID());
  expect(claim.started).toBe(true);
  expect(await store.complete(event.id, claim.record.id, content)).toBe(true);
  return claim.record.id;
}

async function waitsOnLock(): Promise<boolean> {
  const deadline = performance.now() + 2000;
  do {
    const [row] = await control`select count(*)::integer as waiting from pg_stat_activity
      where datname = current_database() and wait_event_type = 'Lock' and pid <> pg_backend_pid()`;
    if (row.waiting > 0) return true;
    await new Promise(resolve => setTimeout(resolve, 15));
  } while (performance.now() < deadline);
  return false;
}

describe('production stores on disposable PostgreSQL', () => {
  it('reserves one worker under simultaneous duplicate and competing request keys', async () => {
    const key = randomUUID();
    const results = await Promise.all([
      store.reserve(event.id, key), store.reserve(event.id, key),
      store.reserve(event.id, randomUUID()), store.reserve(event.id, randomUUID()),
    ]);
    expect(results.filter(result => result.started)).toHaveLength(1);
    expect(new Set(results.map(result => result.record.id)).size).toBe(1);
    const [row] = await control`select count(*)::integer as count from public.plan_regenerations`;
    expect(row.count).toBe(1);
  });

  it('applies once under concurrent requests, archives the edited plan and preserves identity/artwork/guests', async () => {
    const before = await store.snapshot(event.id);
    const id = await ready();
    const results = await Promise.all([store.apply(event.id, id), store.apply(event.id, id)]);
    expect(results.every(result => result.state === 'applied')).toBe(true);
    expect(results[0].previous).toEqual(before);
    const after = await store.snapshot(event.id);
    expect(after.budgetItems.map(item => item.name)).toEqual(['Replacement flowers']);
    expect(after.menuItems.map(item => item.itemName)).toEqual(['Replacement pasta']);
    expect(after.shoppingItems.map(item => item.itemName)).toEqual(['Replacement napkins']);
    expect(after.timelineItems.map(item => item.title)).toEqual(['Replacement setup']);
    expect(await normal.getEventById(event.id)).toMatchObject({ ownerToken: event.ownerToken,
      shareSlug: event.shareSlug, inviteArtworkUrl: event.inviteArtworkUrl, inviteStatus: 'published',
      inviteDesignConceptJson: event.inviteDesignConceptJson, themeName: event.themeName });
    expect(await normal.listGuests(event.id)).toEqual([guest]);
  });

  it('rolls back all replacement deletes and inserts when a later PostgreSQL insertion fails', async () => {
    const before = await store.snapshot(event.id);
    const id = await ready({ ...candidate, menuItems: [{ itemName: 'Injected database failure' }] });
    // A real database trigger fails after the replacement deletes and budget
    // insertion, exercising transaction rollback rather than a mocked adapter.
    await control.unsafe(`create function public.posy_test_fail_menu() returns trigger language plpgsql as $$
      begin if new.item_name = 'Injected database failure' then raise exception 'synthetic insertion failure'; end if; return new; end $$;
      create trigger posy_test_fail_menu before insert on public.menu_items for each row execute function public.posy_test_fail_menu();`);
    await expect(store.apply(event.id, id)).rejects.toMatchObject({
      cause: { code: 'P0001', message: expect.stringContaining('synthetic insertion failure') },
    });
    expect(await store.snapshot(event.id)).toEqual(before);
    expect(await store.read(event.id)).toMatchObject({ id, state: 'ready', previous: null });
  });

  it('rejects a candidate after a customer changes a planning value', async () => {
    const id = await ready();
    const [budget] = await normal.listBudgetItems(event.id);
    await normal.updateBudgetItem(event.id, budget.id, { depositPaid: 150, notes: 'New customer edit' });
    const edited = await store.snapshot(event.id);
    await expect(store.apply(event.id, id)).rejects.toMatchObject({ code: 'plan_changed' });
    expect(await store.snapshot(event.id)).toEqual(edited);
  });

  it('rejects a candidate after the effective RSVP headcount changes', async () => {
    const id = await ready();
    expect((await store.read(event.id))?.base.resolvedGuestCount).toBe(3);
    await normal.updateGuest(event.id, guest.id, { rsvpStatus: 'yes', attendingCount: 2 });
    expect((await store.snapshot(event.id)).resolvedGuestCount).toBe(2);
    await expect(store.apply(event.id, id)).rejects.toMatchObject({ code: 'plan_changed' });
    expect((await normal.listGuests(event.id))[0].attendingCount).toBe(2);
  });

  it('waits for an event lock and checks committed edits before applying', async () => {
    const id = await ready();
    const [budget] = await normal.listBudgetItems(event.id);
    let applying: Promise<{ error: unknown }>;
    await control.begin(async tx => {
      await tx`select id from public.events where id = ${event.id} for update`;
      applying = store.apply(event.id, id).then(() => ({ error: null }), error => ({ error }));
      expect(await waitsOnLock()).toBe(true);
      await tx`update public.budget_items set notes = 'Concurrent committed edit' where id = ${budget.id}`;
    });
    expect((await applying!).error).toMatchObject({ code: 'plan_changed' });
    expect((await normal.listBudgetItems(event.id))[0].notes).toBe('Concurrent committed edit');
  });

  it('coordinates ordinary guest edits with the same real event-row lock', async () => {
    let editing: ReturnType<typeof normal.updateGuest>;
    await control.begin(async tx => {
      await tx`select id from public.events where id = ${event.id} for update`;
      editing = normal.updateGuest(event.id, guest.id, { partySize: 5 });
      expect(await waitsOnLock()).toBe(true);
    });
    expect((await editing!)?.partySize).toBe(5);
  });

  it('expires an initial worker without automatic redispatch and fences it after an explicit new claim', async () => {
    await normal.updateEventById(event.id, { draftStatus: 'none' });
    const claims = await Promise.all([normal.reserveInitialGeneration(event.id), normal.reserveInitialGeneration(event.id)]);
    expect(claims.filter(claim => claim.shouldStart)).toHaveLength(1);
    const first = claims.find(claim => claim.shouldStart)!.generation!;
    const later = first.reservedAt! + execution.INITIAL_GENERATION_CLAIM_TIMEOUT_MS + 1;
    vi.spyOn(Date, 'now').mockReturnValue(later);
    await normal.expireInitialGeneration(event.id);
    expect(await normal.reserveInitialGeneration(event.id)).toMatchObject({ ok: false, reason: 'interrupted', shouldStart: false });
    const next = await normal.reserveInitialGeneration(event.id, true);
    expect(next.shouldStart).toBe(true);
    expect(next.generation!.reservedAt).toBeGreaterThan(first.reservedAt!);
    const stale = new execution.MasterPlannerRunStore(event.id, first.id, first.reservedAt!, production.db, () => later);
    for (const write of [() => stale.assertActive(), () => stale.setStage('menu'),
      () => stale.completeStage('menu', { menuItems: [{ itemName: 'Late worker output' }] }),
      () => stale.fail('menu'), () => stale.finish()]) {
      await expect(write()).rejects.toBeInstanceOf(execution.InitialGenerationClaimLostError);
    }
    const active = new execution.MasterPlannerRunStore(event.id, next.generation!.id, next.generation!.reservedAt!, production.db, () => later);
    await active.completeStage('menu', { menuItems: [{ itemName: 'Current worker output' }] });
    await active.completeStage('menu', { menuItems: [{ itemName: 'Duplicate stage output' }] });
    expect((await normal.listMenuItems(event.id)).map(item => item.itemName)).toEqual(['Family recipe', 'Current worker output']);
    expect(JSON.parse((await normal.getGeneration(first.id))!.completedStages)).toEqual(['menu']);
  });

  it('denies client roles access while granting only server access to private candidates', async () => {
    await ready();
    const [table] = await control`select relrowsecurity from pg_class where oid = 'public.plan_regenerations'::regclass`;
    expect(table.relrowsecurity).toBe(true);
    for (const role of ['anon', 'authenticated']) {
      const [permissions] = await control`select has_table_privilege(${role}, 'public.plan_regenerations', 'select') as can_read,
        has_table_privilege(${role}, 'public.plan_regenerations', 'insert') as can_insert,
        has_table_privilege(${role}, 'public.plan_regenerations', 'update') as can_update,
        has_table_privilege(${role}, 'public.plan_regenerations', 'delete') as can_delete`;
      expect(Object.values(permissions)).toEqual([false, false, false, false]);
      await expect(control.begin(async tx => {
        await tx.unsafe(`set local role ${role}`);
        await tx`select * from public.plan_regenerations`;
      })).rejects.toMatchObject({ code: '42501' });
    }
    const [server] = await control`select has_table_privilege('service_role', 'public.plan_regenerations', 'select') as can_read,
      has_table_privilege('service_role', 'public.plan_regenerations', 'insert') as can_insert,
      has_table_privilege('service_role', 'public.plan_regenerations', 'update') as can_update,
      has_table_privilege('service_role', 'public.plan_regenerations', 'delete') as can_delete`;
    expect(Object.values(server)).toEqual([true, true, true, true]);
  });
});

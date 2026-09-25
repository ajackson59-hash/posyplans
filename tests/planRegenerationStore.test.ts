// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getTableColumns, getTableName, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { PlanContent } from '../shared/planRegeneration';

// No connection (including an accidentally inherited hosted DATABASE_URL) is
// opened. The transaction double rolls back mutations and requires every plan
// write to hold the parent lock. A local PostgreSQL integration run is still
// needed to validate actual row locks/DDL before the migration is deployed.
const holder = vi.hoisted(() => ({ database: null as any }));
vi.mock('postgres', () => ({ default: vi.fn(() => ({})) }));
vi.mock('drizzle-orm/postgres-js', () => ({
  drizzle: () => new Proxy({}, { get: (_, key) => holder.database[key].bind(holder.database) }),
}));
process.env.DATABASE_URL = 'postgres://unused-local-test/unused';
const { DatabaseStorage } = await import('../server/storage');
const { DbPlanRegenerationStore, PLAN_REGENERATION_IDLE_TIMEOUT_MS } = await import('../server/planRegenerationStore');
const { MasterPlannerRunStore, InitialGenerationClaimLostError, INITIAL_GENERATION_CLAIM_TIMEOUT_MS } = await import('../server/masterPlannerRunStore');

type Row = Record<string, any>;
const dialect = new PgDialect();
const camel = (value: string) => value.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
const clone = <T>(value: T): T => structuredClone(value);

function matches(condition: SQL | undefined, row: Row): boolean {
  if (!condition) return true;
  const query = dialect.sqlToQuery(condition);
  const comparisons = [...query.sql.matchAll(/"\w+"\."(\w+)" = \$(\d+)/g)];
  const sets = [...query.sql.matchAll(/"\w+"\."(\w+)" in \(([^)]+)\)/g)];
  if (!comparisons.length && !sets.length) throw new Error(`Unsupported test predicate: ${query.sql}`);
  return comparisons.every(([, column, index]) => row[camel(column)] === query.params[Number(index) - 1]) &&
    sets.every(([, column, items]) => [...items.matchAll(/\$(\d+)/g)]
      .some(([, index]) => row[camel(column)] === query.params[Number(index) - 1]));
}

class Query implements PromiseLike<Row[]> {
  table: any;
  condition?: SQL;
  lock = false;
  count = Infinity;
  ordering: SQL[] = [];
  valuesToWrite: Row[] = [];
  changes: Row = {};
  projection?: Row;
  constructor(private transaction: FakeTransaction, readonly operation: 'select' | 'insert' | 'update' | 'delete', table?: any) { this.table = table; }
  from(table: any) { this.table = table; return this; }
  where(condition: SQL) { this.condition = condition; return this; }
  for(mode: string) { expect(mode).toBe('update'); this.lock = true; return this; }
  limit(count: number) { this.count = count; return this; }
  orderBy(...ordering: SQL[]) { this.ordering = ordering; return this; }
  values(values: Row | Row[]) { this.valuesToWrite = Array.isArray(values) ? values : [values]; return this; }
  set(changes: Row) { this.changes = changes; return this; }
  returning() { return this; }
  then<T = Row[], U = never>(yes?: ((value: Row[]) => T | PromiseLike<T>) | null, no?: ((reason: unknown) => U | PromiseLike<U>) | null): PromiseLike<T | U> {
    return Promise.resolve().then(() => this.transaction.execute(this)).then(yes, no);
  }
}

class FakeTransaction {
  locked = new Set<number>();
  constructor(readonly database: TransactionDatabase) {}
  select(projection?: Row) { const q = new Query(this, 'select'); q.projection = projection; return q; }
  insert(table: any) { return new Query(this, 'insert', table); }
  update(table: any) { return new Query(this, 'update', table); }
  delete(table: any) { return new Query(this, 'delete', table); }
  execute(query: Query): Row[] {
    const table = getTableName(query.table);
    const rows = this.database.tables[table] ??= [];
    const matching = rows.filter(row => matches(query.condition, row));
    this.database.log.push({ table, operation: query.operation, lock: query.lock });
    if (query.lock) {
      expect(table).toBe('events');
      matching.forEach(row => this.locked.add(row.id));
    }
    if (query.operation === 'select') {
      for (const order of [...query.ordering].reverse()) {
        const sql = dialect.sqlToQuery(order).sql;
        const field = camel(sql.match(/"\w+"\."(\w+)"/)![1]);
        matching.sort((a, b) => a[field] === b[field] ? 0 : a[field] > b[field] ? -1 : 1);
      }
      return clone(matching.slice(0, query.count).map(row => query.projection
        ? Object.fromEntries(Object.keys(query.projection).map(key => [key, row[key]])) : row));
    }
    const changed = query.operation === 'insert' ? query.valuesToWrite : matching;
    changed.forEach(row => {
      const eventId = table === 'events' ? row.id : row.eventId;
      if (!this.locked.has(eventId)) throw new Error(`Write without parent lock: ${table}/${eventId}`);
    });
    if (this.database.failTable === table && query.operation === this.database.failOperation) throw new Error(`injected ${query.operation} failure`);
    if (query.operation === 'delete') {
      this.database.tables[table] = rows.filter(row => !matching.includes(row));
      return clone(matching);
    }
    if (query.operation === 'update') {
      matching.forEach(row => Object.assign(row, clone(query.changes)));
      return clone(matching);
    }
    const columns = getTableColumns(query.table);
    const defaults = Object.fromEntries(Object.entries(columns).map(([key, column]) =>
      [key, typeof column.default === 'object' ? null : column.default ?? null]));
    const inserted = query.valuesToWrite.map(value => ({
      ...defaults, id: ++this.database.sequence, ...clone(value),
    }));
    if (table === 'plan_regenerations') {
      for (const value of inserted) {
        if (rows.some(row => row.eventId === value.eventId && (row.requestId === value.requestId ||
          (['running', 'ready', 'failed'].includes(row.state) && ['running', 'ready', 'failed'].includes(value.state))))) {
          throw new Error('unique constraint violated');
        }
      }
    }
    rows.push(...inserted);
    return clone(inserted);
  }
}

class TransactionDatabase {
  tables: Record<string, Row[]>;
  sequence = 100;
  failTable: string | null = null;
  failOperation = 'insert';
  log: { table: string; operation: string; lock: boolean }[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  constructor() {
    this.tables = {
      events: [{ id: 1, eventName: 'Existing party', eventType: 'Birthday', eventDate: '2026-10-17',
        eventIdentity: 'Original identity', estimatedGuestCount: 20, vibeDescription: 'Warm', themeName: 'Garden',
        budgetCeiling: 500, budgetTotal: 500, location: 'Home', hostNames: 'Host', draftStatus: 'ready',
        ownerToken: 'secret-owner', shareSlug: 'guest-slug', capturedEmail: 'private@example.com',
        inviteArtworkUrl: 'data:image/png;base64,retained-art', inviteStatus: 'published', paletteColors: '["pink"]' },
        { id: 2, eventName: 'Other event' }],
      budget_items: [{ id: 10, eventId: 1, name: 'Customer caterer', actualCost: 220, notes: 'Deposit paid' }],
      menu_items: [{ id: 11, eventId: 1, itemName: 'Customer salad', notes: 'No nuts' }],
      shopping_list_items: [{ id: 12, eventId: 1, itemName: 'Owned cups', isPacked: true }],
      timeline_items: [{ id: 13, eventId: 1, title: 'Customer setup', isDone: true }],
      guests: [{ id: 14, eventId: 1, accessToken: 'guest-secret', name: 'Guest', partySize: 20, rsvpStatus: 'pending', attendingCount: null }],
      master_planner_generations: [], plan_regenerations: [],
    };
  }
  transaction<T>(callback: (tx: FakeTransaction) => Promise<T>): Promise<T> {
    const pending = this.queue.then(async () => {
      const before = clone(this.tables);
      try { return await callback(new FakeTransaction(this)); }
      catch (error) { this.tables = before; throw error; }
    });
    this.queue = pending.catch(() => undefined);
    return pending;
  }
}

const candidate: PlanContent = {
  eventIdentity: 'A fresh plan', budgetItems: [{ name: 'Replacement flowers', estimatedCost: 80 }],
  menuItems: [{ itemName: 'Replacement pasta' }], shoppingItems: [{ itemName: 'Replacement napkins' }],
  timelineItems: [{ title: 'Replacement setup', time: '10 AM' }],
};
let database: TransactionDatabase;
let store: InstanceType<typeof DbPlanRegenerationStore>;
let normal: InstanceType<typeof DatabaseStorage>;
let now: number;
let id: number;

beforeEach(() => {
  database = new TransactionDatabase();
  holder.database = database;
  now = 1_800_000_000_000;
  vi.spyOn(Date, 'now').mockImplementation(() => now);
  id = 0;
  store = new DbPlanRegenerationStore(database as any, () => now, () => `00000000-0000-4000-8000-${String(++id).padStart(12, '0')}`);
  normal = new DatabaseStorage();
});
afterEach(() => vi.restoreAllMocks());

describe('staged plan storage transaction contract', () => {
  it('claims one worker across duplicate request keys and simultaneous new request keys', async () => {
    const outcomes = await Promise.all([store.reserve(1, 'request-a'), store.reserve(1, 'request-a'), store.reserve(1, 'request-b')]);
    expect(outcomes.map(row => row.started)).toEqual([true, false, false]);
    expect(new Set(outcomes.map(row => row.record.id)).size).toBe(1);
    expect(database.tables.plan_regenerations).toHaveLength(1);
    expect(database.log[0]).toEqual({ table: 'events', operation: 'select', lock: true });
  });

  it('checkpoints and failures leave the complete current plan and invitation untouched', async () => {
    const before = clone(database.tables);
    const { record } = await store.reserve(1, 'a');
    expect(record.base.event).not.toHaveProperty('ownerToken');
    expect(record.base.event).not.toHaveProperty('capturedEmail');
    expect(record.base.event).not.toHaveProperty('inviteArtworkUrl');
    await store.checkpoint(1, record.id, 'budget', { eventIdentity: candidate.eventIdentity });
    await store.checkpoint(1, record.id, 'menu', { budgetItems: candidate.budgetItems });
    expect(await store.fail(1, record.id, 'Provider failed')).toBe(true);
    const failed = await store.read(1);
    expect(failed).toMatchObject({ state: 'failed', candidate: { eventIdentity: candidate.eventIdentity, budgetItems: candidate.budgetItems } });
    expect((await store.reserve(1, 'b')).started).toBe(false);
    for (const table of Object.keys(before).filter(name => name !== 'plan_regenerations')) expect(database.tables[table]).toEqual(before[table]);
    expect(await store.complete(1, record.id, candidate)).toBe(false);
  });

  it('applies once atomically, archives customer content, and retains artwork, invitation and guests', async () => {
    const before = clone(database.tables);
    const { record } = await store.reserve(1, 'a');
    await store.complete(1, record.id, candidate);
    expect(database.tables.budget_items).toEqual(before.budget_items);
    const [applied, replay] = await Promise.all([store.apply(1, record.id), store.apply(1, record.id)]);
    expect(applied.state).toBe('applied');
    expect(replay).toEqual(applied);
    expect(applied.previous!.budgetItems).toEqual(before.budget_items);
    expect(applied.previous!.menuItems).toEqual(before.menu_items);
    expect(applied.previous!.shoppingItems).toEqual(before.shopping_list_items);
    expect(applied.previous!.timelineItems).toEqual(before.timeline_items);
    expect(database.tables.budget_items).toHaveLength(1);
    expect(database.tables.budget_items[0].name).toBe('Replacement flowers');
    expect(database.tables.events).toEqual([{ ...before.events[0], eventIdentity: candidate.eventIdentity }, before.events[1]]);
    expect(database.tables.guests).toEqual(before.guests);
    expect((await store.reserve(1, 'a')).started).toBe(false);
    expect((await store.reserve(1, 'b')).started).toBe(true);
  });

  it('rolls back deletes, inserts, event changes and archive marker if any insertion fails', async () => {
    const { record } = await store.reserve(1, 'a');
    await store.complete(1, record.id, candidate);
    const before = clone(database.tables);
    database.failTable = 'shopping_list_items';
    await expect(store.apply(1, record.id)).rejects.toThrow('injected insert failure');
    expect(database.tables).toEqual(before);
    database.failTable = null;
    expect((await store.apply(1, record.id)).state).toBe('applied');
  });

  it('detects a customer edit made after generation, retaining both edited current plan and candidate', async () => {
    const { record } = await store.reserve(1, 'a');
    await store.complete(1, record.id, candidate);
    await normal.updateBudgetItem(1, 10, { notes: 'New customer instruction' });
    const before = clone(database.tables);
    await expect(store.apply(1, record.id)).rejects.toMatchObject({ code: 'plan_changed', status: 409 });
    expect(database.tables).toEqual(before);
  });

  it('captures the resolved guest count and rejects a candidate after a count-changing RSVP', async () => {
    const { record } = await store.reserve(1, 'a');
    expect(record.base.resolvedGuestCount).toBe(20);
    await store.complete(1, record.id, candidate);
    await normal.updateGuest(1, 14, { rsvpStatus: 'yes', attendingCount: 5, id: 999, eventId: 2 });
    expect(database.tables.guests[0]).toMatchObject({ id: 14, eventId: 1, attendingCount: 5 });
    expect((await store.snapshot(1)).resolvedGuestCount).toBe(5);
    const before = clone(database.tables);
    await expect(store.apply(1, record.id)).rejects.toMatchObject({ code: 'plan_changed', status: 409 });
    expect(database.tables).toEqual(before);
  });

  it('fences interrupted workers without automatic dispatch or losing the previous plan', async () => {
    const { record } = await store.reserve(1, 'a');
    await expect(store.discard(1, record.id)).rejects.toMatchObject({ code: 'regeneration_running' });
    now += PLAN_REGENERATION_IDLE_TIMEOUT_MS;
    expect((await store.read(1))!.state).toBe('failed');
    expect(await store.checkpoint(1, record.id, 'late', {})).toBe(false);
    expect(await store.complete(1, record.id, candidate)).toBe(false);
    expect((await store.reserve(1, 'b')).started).toBe(false);
    await store.discard(1, record.id);
    expect((await store.reserve(1, 'a')).started).toBe(false);
    expect((await store.reserve(1, 'b')).started).toBe(true);
  });

  it('checks timeout on worker writes even when no browser is polling', async () => {
    const { record } = await store.reserve(1, 'a');
    now += PLAN_REGENERATION_IDLE_TIMEOUT_MS;
    expect(await store.complete(1, record.id, candidate)).toBe(false);
    expect(database.tables.plan_regenerations[0].state).toBe('failed');
  });

  it('rejects incomplete candidates before changing live content or marking them ready', async () => {
    const { record } = await store.reserve(1, 'a');
    const before = clone(database.tables);
    await expect(store.complete(1, record.id, { ...candidate, budgetItems: [] })).rejects.toThrow('1–100 items');
    await expect(store.complete(1, record.id, { ...candidate, eventIdentity: ' ' })).rejects.toThrow('event identity');
    expect(database.tables).toEqual(before);
  });

  it('rejects cross-event operations and never copies candidate IDs or event IDs', async () => {
    const { record } = await store.reserve(1, 'a');
    await expect(store.complete(2, record.id, candidate)).rejects.toMatchObject({ code: 'regeneration_not_found' });
    await store.complete(1, record.id, { ...candidate, budgetItems: [{ ...candidate.budgetItems[0], id: 999, eventId: 2 } as any] });
    await store.apply(1, record.id);
    expect(database.tables.budget_items[0].eventId).toBe(1);
    expect(database.tables.budget_items[0].id).not.toBe(999);
  });
});

describe('ordinary planning writes share the event lock', () => {
  it('locks guest creation and deletion so guest-count snapshots are consistent', async () => {
    const created = await normal.createGuest(1, { name: 'Another', partySize: 3 });
    expect((await store.snapshot(1)).resolvedGuestCount).toBe(23);
    expect(await normal.deleteGuest(2, created.id)).toBe(false);
    expect(await normal.deleteGuest(1, created.id)).toBe(true);
    expect((await store.snapshot(1)).resolvedGuestCount).toBe(20);
  });
  it.each([
    ['Budget', 'budget_items', { name: 'New budget' }], ['Menu', 'menu_items', { itemName: 'New menu' }],
    ['ShoppingList', 'shopping_list_items', { itemName: 'New shopping' }], ['Timeline', 'timeline_items', { title: 'New timeline' }],
  ] as const)('locks all %s create, bulk, update and delete operations', async (section, table, item) => {
    const api = normal as any;
    const created = await api[`create${section}Item`](1, item);
    const bulk = await api[`create${section}ItemsBulk`](1, [item, item]);
    expect(bulk).toHaveLength(2);
    await api[`update${section}Item`](1, created.id, { notes: 'Updated', eventId: 2, id: 888 });
    expect(database.tables[table].find(row => row.id === created.id)).toMatchObject({ notes: 'Updated', eventId: 1 });
    expect(await api[`delete${section}Item`](2, created.id)).toBe(false);
    expect(await api[`delete${section}Item`](1, created.id)).toBe(true);
  });
});

describe('initial generation execution claim', () => {
  beforeEach(() => { database.tables.events[0].draftStatus = 'none'; });
  it('starts one initial worker when two requests race', async () => {
    const replies = await Promise.all([normal.reserveInitialGeneration(1), normal.reserveInitialGeneration(1)]);
    expect(replies.map(reply => reply.shouldStart)).toEqual([true, false]);
    expect(replies[0].generation!.id).toBe(replies[1].generation!.id);
    expect(database.tables.master_planner_generations).toHaveLength(1);
  });

  it.each(['reserved', 'failed'])('claims a %s attempt once and preserves its completed checkpoints', async state => {
    database.tables.master_planner_generations = [{ id: 50, eventId: 1, attemptNumber: 1, state,
      reservedAt: now, failedAt: 123, failedStage: 'menu', completedStages: '["theme","budget"]' }];
    expect(await normal.reserveInitialGeneration(1)).toEqual({ ok: false, reason: 'interrupted', shouldStart: false });
    const replies = await Promise.all([normal.reserveInitialGeneration(1, true), normal.reserveInitialGeneration(1, true)]);
    expect(replies.map(reply => reply.shouldStart)).toEqual([true, false]);
    expect(replies[0].generation).toMatchObject({ id: 50, state: 'running', failedAt: null, failedStage: null, completedStages: '["theme","budget"]' });
  });

  it('does not bypass a consumed or already-running attempt with another historical row', async () => {
    database.tables.master_planner_generations = [
      { id: 50, eventId: 1, attemptNumber: 1, state: 'running', reservedAt: now },
      { id: 51, eventId: 1, attemptNumber: 2, state: 'failed' },
    ];
    expect(await normal.reserveInitialGeneration(1)).toMatchObject({ shouldStart: false, generation: { id: 50 } });
    database.tables.master_planner_generations[0].state = 'consumed';
    expect(await normal.reserveInitialGeneration(1)).toEqual({ ok: false, reason: 'already_consumed', shouldStart: false });
  });

  it('expires an interrupted request without redispatch, including later ordinary POSTs', async () => {
    const first = await normal.reserveInitialGeneration(1);
    const oldClaim = first.generation!.reservedAt!;
    now += INITIAL_GENERATION_CLAIM_TIMEOUT_MS;
    expect(await normal.reserveInitialGeneration(1, true)).toEqual({ ok: false, reason: 'interrupted', shouldStart: false });
    expect(database.tables.events[0].draftStatus).toBe('failed_partial');
    expect(database.tables.master_planner_generations[0]).toMatchObject({ state: 'failed', failedStage: 'interrupted' });
    expect(await normal.reserveInitialGeneration(1)).toEqual({ ok: false, reason: 'interrupted', shouldStart: false });
    const explicit = await normal.reserveInitialGeneration(1, true);
    expect(explicit.shouldStart).toBe(true);
    expect(explicit.generation!.reservedAt).toBeGreaterThan(oldClaim);
    expect(explicit.generation!.id).toBe(first.generation!.id);
  });

  it('status polling can expire a claim but never reserves another execution', async () => {
    const first = await normal.reserveInitialGeneration(1);
    const oldClaim = first.generation!.reservedAt;
    now += INITIAL_GENERATION_CLAIM_TIMEOUT_MS;
    await normal.expireInitialGeneration(1);
    await normal.expireInitialGeneration(1);
    expect(database.tables.master_planner_generations).toHaveLength(1);
    expect(database.tables.master_planner_generations[0]).toMatchObject({ state: 'failed', reservedAt: oldClaim });
    expect(database.tables.events[0].draftStatus).toBe('failed_partial');
    expect((await normal.reserveInitialGeneration(1)).shouldStart).toBe(false);
  });

  it('does not downgrade a completed plan because of an obsolete duplicate ledger row', async () => {
    database.tables.events[0].draftStatus = 'ready';
    database.tables.master_planner_generations = [
      { id: 50, eventId: 1, state: 'running', reservedAt: now - INITIAL_GENERATION_CLAIM_TIMEOUT_MS },
      { id: 51, eventId: 1, state: 'consumed', reservedAt: now },
    ];
    await normal.expireInitialGeneration(1);
    expect(database.tables.events[0].draftStatus).toBe('ready');
  });

  it('preserves a ready plan even if its old ledger has no consumed marker', async () => {
    database.tables.events[0].draftStatus = 'ready';
    database.tables.master_planner_generations = [
      { id: 50, eventId: 1, state: 'running', reservedAt: now - INITIAL_GENERATION_CLAIM_TIMEOUT_MS },
    ];
    await normal.expireInitialGeneration(1);
    expect(database.tables.events[0].draftStatus).toBe('ready');
  });
});

describe('initial stage execution fencing', () => {
  beforeEach(() => { database.tables.events[0].draftStatus = 'none'; });
  async function claimed() {
    const reservation = await normal.reserveInitialGeneration(1);
    const generation = reservation.generation!;
    return { generation, run: new MasterPlannerRunStore(1, generation.id, generation.reservedAt!, database as any, () => now) };
  }

  it('commits each section and resume checkpoint once, including parallel section completion', async () => {
    const { run } = await claimed();
    await run.setStage('budget_menu');
    await Promise.all([
      run.completeStage('budget', { budgetItems: [{ name: 'Generated budget', estimatedCost: 200 }] }),
      run.completeStage('menu', { menuItems: [{ itemName: 'Generated menu' }] }),
      run.completeStage('budget', { budgetItems: [{ name: 'Duplicate budget' }] }),
    ]);
    expect(database.tables.events[0]).toMatchObject({ draftStatus: 'generating', draftStage: 'budget_menu' });
    expect(database.tables.budget_items.map(row => row.name)).toEqual(['Customer caterer', 'Generated budget']);
    expect(database.tables.menu_items.map(row => row.itemName)).toEqual(['Customer salad', 'Generated menu']);
    expect(JSON.parse(database.tables.master_planner_generations[0].completedStages)).toEqual(['budget', 'menu']);
  });

  it('rolls back a generated section and event patch if its checkpoint fails', async () => {
    const { run } = await claimed();
    const before = clone(database.tables);
    database.failTable = 'master_planner_generations';
    database.failOperation = 'update';
    await expect(run.completeStage('budget', {
      budgetItems: [{ name: 'Must roll back' }], event: { eventIdentity: 'Must roll back' },
    })).rejects.toThrow('injected update failure');
    expect(database.tables).toEqual(before);
    database.failTable = null;
    await run.completeStage('budget', { budgetItems: [{ name: 'Saved once' }] });
    expect(database.tables.budget_items.filter(row => row.name === 'Saved once')).toHaveLength(1);
  });

  it('blocks every late write after expiry without requiring a polling request', async () => {
    const { run } = await claimed();
    now += INITIAL_GENERATION_CLAIM_TIMEOUT_MS;
    const before = clone(database.tables);
    for (const action of [
      () => run.assertActive(), () => run.setStage('late'),
      () => run.completeStage('budget', { budgetItems: [{ name: 'Late output' }] }),
      () => run.fail('late'), () => run.finish(),
    ]) await expect(action()).rejects.toBeInstanceOf(InitialGenerationClaimLostError);
    expect(database.tables).toEqual(before);
  });

  it('fences the old worker after an explicit retry claims the same generation in the same millisecond', async () => {
    const { run, generation } = await claimed();
    await run.completeStage('theme', { event: { eventIdentity: 'Saved identity' } });
    await run.fail('budget_menu');
    const retry = await normal.reserveInitialGeneration(1, true);
    expect(retry.generation!.reservedAt).toBe(generation.reservedAt! + 1);
    const before = clone(database.tables);
    await expect(run.completeStage('budget', { budgetItems: [{ name: 'Old worker output' }] })).rejects.toBeInstanceOf(InitialGenerationClaimLostError);
    await expect(run.fail('late')).rejects.toBeInstanceOf(InitialGenerationClaimLostError);
    expect(database.tables).toEqual(before);
    const active = new MasterPlannerRunStore(1, generation.id, retry.generation!.reservedAt!, database as any, () => now);
    await active.completeStage('theme', { event: { eventIdentity: 'Duplicate identity' } });
    expect(database.tables.events[0].eventIdentity).toBe('Saved identity');
    await active.finish();
    expect(database.tables.events[0]).toMatchObject({ draftStatus: 'ready', draftStage: 'done' });
    expect(database.tables.master_planner_generations[0].state).toBe('consumed');
  });

  it('cannot publish stages for another event or change access/payment fields', async () => {
    const { run, generation } = await claimed();
    const other = new MasterPlannerRunStore(2, generation.id, generation.reservedAt!, database as any, () => now);
    await expect(other.setStage('theme')).rejects.toBeInstanceOf(InitialGenerationClaimLostError);
    await run.completeStage('theme', { event: { eventIdentity: 'Saved', ownerToken: 'wrong', shareSlug: 'wrong', capturedEmail: 'wrong', inviteStatus: 'draft' } });
    expect(database.tables.events[0]).toMatchObject({ eventIdentity: 'Saved', ownerToken: 'secret-owner', shareSlug: 'guest-slug', capturedEmail: 'private@example.com', inviteStatus: 'published' });
  });

  it('rolls back the final event-ready marker when consuming the generation fails', async () => {
    const { run } = await claimed();
    await run.setStage('checks');
    const before = clone(database.tables);
    database.failTable = 'master_planner_generations';
    database.failOperation = 'update';
    await expect(run.finish()).rejects.toThrow('injected update failure');
    expect(database.tables).toEqual(before);
  });
});

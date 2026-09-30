import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import type { Event } from '@shared/schema';
import type { PlusMembershipAccess } from '../server/plusMembership';
import type { PlanContent, PlanRegenerationRecord, PlanSnapshot } from '@shared/planRegeneration';
import type { PlanRegenerationStore } from '../server/planRegenerationStore';
vi.mock('../server/storage', () => ({ storage: {} }));
const { registerPlanRegenerationRoutes } = await import('../server/planRegenerationRoutes');
const { runPlanRegeneration, planRegenerationView } = await import('../server/planRegeneration');
const { snapshotEvent, planFingerprint } = await import('../server/planSnapshot');

const event = { id: 990074, ownerToken: 'offline-only-owner', capturedEmail: 'synthetic@example.invalid',
  eventName: 'Garden lunch', eventType: 'Birthday Party', eventDate: '2026-10-17', estimatedGuestCount: 12,
  vibeDescription: 'A relaxed garden lunch', themeName: 'Watercolor garden', draftStatus: 'ready',
  eventIdentity: 'Customer-edited identity', inviteArtworkUrl: 'retained-pixels', shareSlug: 'existing-guest-link',
  inviteStatus: 'published', inviteDesignConceptJson: '{"fontPairingId":"editorial-serif"}',
} as Event;
const source: PlanSnapshot = { event: snapshotEvent(event), resolvedGuestCount: 12,
  budgetItems: [{ id: 1, eventId: event.id, name: 'Paid catering', estimatedCost: 300, depositPaid: 100, notes: 'Customer edit' } as any],
  menuItems: [{ id: 2, eventId: event.id, itemName: 'Family recipe', notes: 'No nuts' } as any],
  shoppingItems: [{ id: 3, eventId: event.id, itemName: 'Borrowed chairs', status: 'borrowing', isPacked: true } as any],
  timelineItems: [{ id: 4, eventId: event.id, title: 'Custom ceremony', assignedTo: 'Host', isDone: true } as any] };

let row: PlanRegenerationRecord | null;
let live: PlanSnapshot;
let jobs: Array<() => Promise<void>>;
let tier: string;
let store: PlanRegenerationStore;
const providers = {
  identity: vi.fn(async () => ({ themeName: 'Ignored new theme', paletteColors: ['#000000'], eventIdentity: 'A fresh garden lunch' })),
  budget: vi.fn(async () => ({ items: [{ category: 'Food & Beverage', name: 'Lunch', estimatedCost: 120 }], suggestedTotal: 120, tip: '' })),
  menu: vi.fn(async () => ({ items: [{ course: 'Main Course', itemName: 'Garden sandwiches', source: 'Homemade', servesCount: 12, costEstimate: 40, dietaryTags: '', notes: '' }], tip: '' })),
  shopping: vi.fn(async () => ({ items: [{ category: 'Serving Supplies', itemName: 'Serving plates', quantity: '12', estimatedCost: 12, notes: '' }], tip: '' })),
};
function createRecord(): PlanRegenerationRecord {
  return { id: randomUUID(), eventId: event.id, requestId: randomUUID(), state: 'running', stage: null,
    error: null, createdAt: Date.now(), updatedAt: Date.now(), base: structuredClone(source), candidate: null, previous: null };
}
beforeEach(() => {
  row = null; live = structuredClone(source); jobs = []; tier = 'plus_active'; vi.clearAllMocks();
  store = {
    read: async () => structuredClone(row), snapshot: async () => structuredClone(live),
    reserve: vi.fn(async (_eventId, requestId) => {
      if (row) return { record: structuredClone(row), started: false };
      row = { ...createRecord(), requestId }; return { record: structuredClone(row), started: true };
    }),
    checkpoint: vi.fn(async (_eventId, _id, stage, candidate) => {
      if (!row || row.state !== 'running') return false;
      row = { ...row, stage, candidate: structuredClone(candidate) }; return true;
    }),
    complete: vi.fn(async (_eventId, _id, candidate) => {
      if (!row || row.state !== 'running') return false;
      row = { ...row, state: 'ready', stage: 'done', candidate: structuredClone(candidate) }; return true;
    }),
    fail: vi.fn(async (_eventId, _id, error) => { row = { ...row!, state: 'failed', error }; return true; }),
    apply: vi.fn(async () => { row = { ...row!, state: 'applied', previous: structuredClone(live) }; return row; }),
    discard: vi.fn(async () => { row = { ...row!, state: 'discarded' }; return row; }),
  };
});
function app() {
  const a = express(); a.use(express.json());
  registerPlanRegenerationRoutes(a, { store, providers, schedule: task => jobs.push(task),
    plusAccess: async () => tier ? { subscriptionId: 'sub_proven', customerId: 'cus_proven',
      planTier: tier, trialEndsAt: null, billingInterval: 'monthly' } as PlusMembershipAccess : undefined,
    events: {
    getEventByOwnerToken: async token => token === event.ownerToken ? event : undefined,
  } }); return a;
}
const path = '/api/events/owner/offline-only-owner/plan-regeneration';

describe('Plus regeneration HTTP boundary', () => {
  it('only an explicit eligible request schedules work; duplicate requests and reloads do not', async () => {
    const a = app();
    expect((await request(a).get(path)).body).toEqual({ eligible: true, operation: null });
    expect(jobs).toHaveLength(0);
    const input = { requestId: randomUUID() };
    const [first, duplicate] = await Promise.all([request(a).post(path).send(input), request(a).post(path).send(input)]);
    expect(first.status).toBe(202); expect(duplicate.status).toBe(202);
    expect(first.body.operation.id).toBe(duplicate.body.operation.id); expect(jobs).toHaveLength(1);
    await jobs.shift()!();
    const saved = await request(a).get(path);
    expect(saved.body.operation.state).toBe('ready'); expect(saved.body.operation.canApply).toBe(true);
    expect(saved.headers['cache-control']).toBe('private, no-store');
    expect(saved.text).not.toMatch(/ownerToken|capturedEmail|shareSlug|retained-pixels|depositPaid|Customer edit|requestId/);
    expect(live).toEqual(source); expect(store.apply).not.toHaveBeenCalled();
    for (const provider of Object.values(providers)) expect(provider).toHaveBeenCalledTimes(1);
    expect(providers.shopping.mock.calls[0][0]).toMatchObject({ menuItems: [{ itemName: 'Garden sandwiches' }] });
  });
  it.each(['spark', 'plus_expired'])('does not treat %s as regeneration entitlement', async value => {
    tier = value;
    expect((await request(app()).post(path).send({ requestId: randomUUID() })).status).toBe(403);
    expect(store.reserve).not.toHaveBeenCalled(); expect(jobs).toHaveLength(0);
  });
  it('does not let a captured email regenerate a plan without a proven membership', async () => {
    tier = '';
    expect((await request(app()).get(path)).body.eligible).toBe(false);
    expect((await request(app()).post(path).send({ requestId: randomUUID() })).status).toBe(403);
    expect(store.reserve).not.toHaveBeenCalled(); expect(jobs).toHaveLength(0);
  });
  it('rejects invalid requests and owner tokens without scheduling', async () => {
    const a = app();
    expect((await request(a).post(path).send({})).status).toBe(400);
    expect((await request(a).post(path.replace('offline-only-owner', 'wrong')).send({ requestId: randomUUID() })).status).toBe(404);
    expect(jobs).toHaveLength(0);
  });
  it('allows the owner to apply already-created work after subscription expiry', async () => {
    const a = app(); await request(a).post(path).send({ requestId: randomUUID() }); await jobs.shift()!(); tier = 'plus_expired';
    expect((await request(a).post(`${path}/${row!.id}/apply`).send({})).status).toBe(200);
    expect(store.apply).toHaveBeenCalledTimes(1); expect(jobs).toHaveLength(0);
  });
});

describe('isolated candidate orchestration', () => {
  it('preserves the entire edited plan on provider failure, and never starts later stages', async () => {
    row = createRecord(); providers.menu.mockRejectedValueOnce(new Error('Sensitive provider details'));
    await runPlanRegeneration(row, store, providers);
    expect(row.state).toBe('failed'); expect(row.candidate?.budgetItems).toHaveLength(1);
    expect(row.error).not.toContain('Sensitive'); expect(live).toEqual(source);
    expect(providers.shopping).not.toHaveBeenCalled(); expect(store.complete).not.toHaveBeenCalled();
    expect(providers.menu).toHaveBeenCalledWith(expect.anything(), { maxRetries: 0 });
  });
  it('stops before the next paid stage if its durable checkpoint is rejected', async () => {
    row = createRecord(); vi.mocked(store.checkpoint).mockResolvedValueOnce(false);
    await runPlanRegeneration(row, store, providers);
    expect(providers.identity).not.toHaveBeenCalled(); expect(store.complete).not.toHaveBeenCalled(); expect(live).toEqual(source);
  });
  it('detects customer planning changes, while unrelated artwork/publication changes cannot stale or alter the candidate', async () => {
    row = createRecord(); await runPlanRegeneration(row, store, providers);
    const unchanged = planRegenerationView(row, live); expect(unchanged.canApply).toBe(true);
    live.shoppingItems[0].isPacked = false;
    expect(planRegenerationView(row, live)).toMatchObject({ canApply: false, baseChanged: true });
    expect(snapshotEvent({ ...event, inviteArtworkUrl: 'new-kept-art', inviteStatus: 'draft' })).toEqual(source.event);
  });
  it('fingerprints row content independently of query row order and object key ordering', () => {
    const a = structuredClone(source); a.menuItems.push({ ...a.menuItems[0], id: 5 });
    const b = structuredClone(a); b.menuItems.reverse();
    expect(planFingerprint(a)).toBe(planFingerprint(b));
    b.budgetItems[0].depositPaid = 101; expect(planFingerprint(a)).not.toBe(planFingerprint(b));
  });
});

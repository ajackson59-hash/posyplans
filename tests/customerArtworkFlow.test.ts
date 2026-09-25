// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import type { Event } from '@shared/schema';
import { encodePng } from '../server/aiFirst/png';
import { claimCustomerArtwork, customerArtworkBriefHash, customerArtworkEventEnabled, customerArtworkView, emptyCustomerArtwork,
  finishCustomerArtwork, isKeptCustomerArtwork, recoverCustomerArtwork, selectCustomerArtwork, selectedCustomerArtwork,
  type CustomerArtworkSession, type CustomerArtworkStore } from '../server/customerArtwork';
vi.mock('../server/storage', () => ({ storage: {}, db: {} }));
vi.mock('../server/masterPlannerEntitlement', () => ({ getEntitlementSummary: vi.fn() }));
const { registerCustomerArtworkRoutes } = await import('../server/customerArtworkRoutes');
const { eventArtworkUrl } = await import('../server/eventArtwork');

class MemoryStore implements CustomerArtworkStore {
  rows = new Map<number, CustomerArtworkSession>();
  async get(id: number) { return structuredClone(this.rows.get(id)); }
  async create(row: CustomerArtworkSession) { if (!this.rows.has(row.eventId)) this.rows.set(row.eventId, structuredClone(row)); return (await this.get(row.eventId))!; }
  async compareAndSet(row: CustomerArtworkSession, version: number) {
    if (this.rows.get(row.eventId)?.version !== version) return false;
    this.rows.set(row.eventId, structuredClone(row)); return true;
  }
}
const env = { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'codex/launch-blockers', POSY_CUSTOMER_ARTWORK_FLOW: 'true',
  POSY_CUSTOMER_ARTWORK_EVENT_IDS: '99002', POSY_CUSTOMER_ARTWORK_GENERATION: 'true' };
const base = { id: 99002, ownerToken: 'synthetic-customer-owner', shareSlug: 'synthetic-share', eventName: 'Garden celebration', eventType: 'Celebration',
  vibeDescription: 'Watercolor: exactly three red birds with every tail visible; white peonies and sage. No balloons. Keep every detail at the end.',
  eventDate: 'September 23, 2026', themeName: '', paletteColors: '[]', estimatedGuestCount: 8, location: 'Garden', venueName: '',
  draftStatus: 'none', inviteStatus: 'draft', inviteDesignConceptJson: '{"fontPairingId":"editorial-serif"}' } as Event;
// Synthetic pixels test mechanics, never artwork quality or provider fidelity.
const bytes = encodePng({ width: 512, height: 768, rgb: Buffer.alloc(512 * 768 * 3, 150) });
let event: Event, store: MemoryStore, paid: boolean, jobs: Array<() => Promise<void>>;
const generate = vi.fn(async () => ({ bytes, dataUrl: `data:image/png;base64,${bytes.toString('base64')}`, durationMs: 12,
  telemetry: { outputFormat: 'jpeg' as const, providerRequestCount: 1, providerDurationMs: 10, normalizationDurationMs: 2,
    responseUsage: { inputTokens: 100, outputTokens: 50 } } }));
beforeEach(() => { event = { ...base }; store = new MemoryStore(); paid = false; jobs = []; generate.mockClear(); });
const owner = '/api/events/owner/synthetic-customer-owner';
function app(overrides: NodeJS.ProcessEnv = {}) {
  const app = express(); app.use(express.json());
  registerCustomerArtworkRoutes(app, { sessions: store, env: { ...env, ...overrides },
    events: { getEventByOwnerToken: async token => token === event.ownerToken ? event : undefined,
      updateEventById: async (_id, patch) => event = { ...event, ...patch } },
    unlocked: async () => paid, schedule: job => { jobs.push(job); },
    finish: (id, attempt, req, repo) => finishCustomerArtwork(id, attempt, req, repo, generate),
  });
  app.use((_req, res) => res.status(418).json({ legacy: true })); return app;
}
const first = (row: CustomerArtworkSession) => ({ requestKey: 'initial-test', version: row.version, briefHash: customerArtworkBriefHash(event) });
const selection = (row: CustomerArtworkSession, index = 0) => ({ version: row.version, briefHash: customerArtworkBriefHash(event),
  candidateId: row.attempts[index].id, imageHash: row.attempts[index].imageHash! });
const revision = (row: CustomerArtworkSession, index = 0, correction = 'Move the left bird inward; preserve the rest.') => ({
  requestKey: randomUUID(), version: row.version, briefHash: customerArtworkBriefHash(event), baseCandidateId: row.attempts[index].id,
  imageHash: row.attempts[index].imageHash!, correction,
});
async function ready() {
  const row = await store.create(emptyCustomerArtwork(event));
  const claim = await claimCustomerArtwork(event, row, first(row), store);
  await finishCustomerArtwork(event.id, claim.attempt, claim.request!, store, generate);
  return (await store.get(event.id))!;
}

it('keeps and revises an imported original through the customer HTTP routes within one remaining request', async () => {
  let row = await ready();
  const original = row.attempts[0];
  original.imageBase64 = original.sourceBase64!;
  original.imageHash = createHash('sha256').update(Buffer.from(original.sourceBase64!, 'base64')).digest('hex');
  original.providerCalls = 0;
  await store.compareAndSet(row, row.version);
  generate.mockClear();
  const server = app({ POSY_CUSTOMER_ARTWORK_EVALUATION_LIMITS: '{"99002":2}' });
  expect((await request(server).post(`${owner}/artwork/select`).send(selection(row))).status).toBe(200);
  row = (await store.get(event.id))!;
  const input = revision(row);
  expect((await request(server).post(`${owner}/artwork/revise`).send(input)).status).toBe(202);
  expect(jobs).toHaveLength(1);
  await jobs.shift()!();
  expect(generate).toHaveBeenCalledTimes(1);
  expect((generate.mock.calls[0] as unknown as [{ referenceImages: Array<{ bytes: Buffer }> }])[0]
    .referenceImages[0].bytes.equals(bytes)).toBe(true);
  row = (await store.get(event.id))!;
  expect(row.selectedId).toBe(original.id);
  expect((await request(server).post(`${owner}/artwork/revise`).send(revision(row))).status).toBe(429);
  expect((await request(server).post(`${owner}/artwork/select`).send(selection(row, 1))).status).toBe(200);
  expect((await request(server).get(`${owner}/artwork`)).body).toMatchObject({
    selectedId: row.attempts[1].id, requestsRemaining: 0, canContinue: true,
  });
});

describe('customer artwork durable request boundary', () => {
  it.each(['', '{}', 'null', '[]', 'invalid', '{"99003":2}', '{"99002":0}', '{"99002":5}',
    '{"99002":"2"}', '{"99002":1.5}', '{"99002":2,"bad":1}', '{"099002":2}'])(
    'rejects an absent event or invalid evaluation allowance before scheduling: %s', async limits => {
      const server = app({ POSY_CUSTOMER_ARTWORK_EVALUATION_LIMITS: limits });
      expect((await request(server).get(`${owner}/artwork`)).body.generationEnabled).toBe(false);
      expect((await request(server).post(`${owner}/prepayment-preview`).send({ email: 'offline@example.com' })).status).toBe(503);
      expect(jobs).toHaveLength(0); expect(generate).not.toHaveBeenCalled();
      expect((await store.get(event.id))?.attempts).toHaveLength(0);
    });
  it('enforces the scoped cap under concurrent revisions, retains replay/selection, and never resets on a new brief', async () => {
    const server = app({ POSY_CUSTOMER_ARTWORK_EVALUATION_LIMITS: '{"99002":2}' });
    expect((await request(server).post(`${owner}/prepayment-preview`).send({ email: 'offline@example.com' })).status).toBe(202);
    await jobs.shift()!();
    let row = (await store.get(event.id))!;
    const input = revision(row);
    const responses = await Promise.all([request(server).post(`${owner}/artwork/revise`).send(input),
      request(server).post(`${owner}/artwork/revise`).send(revision(row))]);
    expect(responses.filter(r => r.status === 202)).toHaveLength(1); expect(jobs).toHaveLength(1);
    const winning = (await store.get(event.id))!.attempts[1];
    await jobs.shift()!(); row = (await store.get(event.id))!;
    expect((await request(server).post(`${owner}/artwork/revise`).send(revision(row))).status).toBe(429);
    expect((await request(server).post(`${owner}/artwork/select`).send(selection(row, 1))).status).toBe(200);
    const closed = app({ POSY_CUSTOMER_ARTWORK_GENERATION: 'false', POSY_CUSTOMER_ARTWORK_EVALUATION_LIMITS: '{}' });
    expect((await request(closed).post(`${owner}/artwork/revise`).send({ ...input,
      requestKey: winning.requestKey, correction: winning.correction })).status).toBe(202);
    expect((await request(closed).get(`${owner}/artwork`)).body).toMatchObject({ generationEnabled: false, canContinue: true });
    event = { ...event, vibeDescription: 'Another full brief does not buy another allowance.' };
    expect((await request(server).post(`${owner}/prepayment-preview`).send({ email: 'offline@example.com' })).status).toBe(429);
    expect(generate).toHaveBeenCalledTimes(2); expect(jobs).toHaveLength(0);
  });
  it('keeps staff, existing events and Production separate; new Preview enrollment persists when rollout closes', () => {
    expect(customerArtworkEventEnabled(event, env)).toBe(true);
    expect(customerArtworkEventEnabled(event, { ...env, VERCEL_ENV: 'production' })).toBe(false);
    expect(customerArtworkEventEnabled(event, { ...env, POSY_CUSTOMER_ARTWORK_FLOW: 'false' })).toBe(false);
    expect(customerArtworkEventEnabled(event, { ...env, POSY_HUMAN_ARTWORK_REVIEW: 'true', POSY_HUMAN_ARTWORK_REVIEW_EVENT_IDS: '99002' })).toBe(false);
    expect(customerArtworkEventEnabled({ ...event, id: 99003 }, { ...env, POSY_CUSTOMER_ARTWORK_EVENT_IDS: '' })).toBe(false);
    expect(customerArtworkEventEnabled({ ...event, id: 99003, customerArtworkEnabled: true }, { ...env, POSY_CUSTOMER_ARTWORK_FLOW: 'false' })).toBe(true);
  });
  it('claims once across concurrent clicks; replay and read recovery never dispatch another request', async () => {
    const row = await store.create(emptyCustomerArtwork(event)), input = first(row);
    const claims = await Promise.allSettled([claimCustomerArtwork(event, row, input, store), claimCustomerArtwork(event, row, input, store)]);
    expect(claims.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    const current = (await store.get(event.id))!;
    expect((await claimCustomerArtwork(event, current, input, store)).request).toBeNull();
    const recovered = await recoverCustomerArtwork(current, store, Date.now() + 180001);
    expect(customerArtworkView(recovered, event, env).state).toBe('interrupted');
    await expect(claimCustomerArtwork(event, recovered, { ...first(recovered), requestKey: 'new' }, store)).rejects.toThrow();
    expect(generate).not.toHaveBeenCalled();
    // A late result may still be retained after timed read recovery, without buying again.
    const successful = claims.find(r => r.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof claimCustomerArtwork>>>;
    await finishCustomerArtwork(event.id, successful.value.attempt, successful.value.request!, store, generate);
    expect((await store.get(event.id))!.attempts[0].status).toBe('ready');
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it('edits the exact saved source with the complete brief and only the chosen branch’s correction history', async () => {
    let row = await ready();
    const original = row.attempts[0];
    expect(original.prompt).toContain(event.vibeDescription); expect(original.prompt).toContain(event.eventDate);
    const edit = await claimCustomerArtwork(event, row, revision(row, 0, 'Move only the left bird inward.'), store);
    expect(edit.request!.referenceImages![0].bytes.equals(bytes)).toBe(true);
    expect(edit.request!.maxTransientRetries).toBe(0); expect(edit.request!.prompt).toContain(event.vibeDescription);
    await finishCustomerArtwork(event.id, edit.attempt, edit.request!, store, generate);
    row = (await store.get(event.id))!;
    const branch = await claimCustomerArtwork(event, row, revision(row, 0, 'Brighten only the sage leaves.'), store);
    expect(branch.request!.prompt).not.toContain('Move only the left bird inward.');
    expect(branch.request!.prompt).toContain('Brighten only the sage leaves.');
    expect(branch.attempt.input?.reviewedImageHash).toBe(original.imageHash);
  });
  it('keeps the selected image through a failed edit, with no invented billing or automatic retry', async () => {
    let row = await ready(); row = await selectCustomerArtwork(event, row, selection(row), store);
    const chosen = selectedCustomerArtwork(row, event);
    const claim = await claimCustomerArtwork(event, row, revision(row), store);
    expect(customerArtworkView(claim.row, event, env).canContinue).toBe(false);
    const fail = vi.fn(async () => { throw new Error('unknown provider outcome'); });
    await finishCustomerArtwork(event.id, claim.attempt, claim.request!, store, fail);
    row = (await store.get(event.id))!;
    expect(selectedCustomerArtwork(row, event)).toBe(chosen);
    expect(customerArtworkView(row, event, env)).toMatchObject({ state: 'failed', canContinue: true, generationEnabled: false });
    expect(row.attempts[1].billing).toBe('unknown'); expect(fail).toHaveBeenCalledTimes(1);
  });
  it('bounds requests across changed briefs, preserves editable copy, and rejects stale choices and corrupt sources', async () => {
    let row = await ready(); row = await selectCustomerArtwork(event, row, selection(row), store);
    event = { ...event, eventName: 'Updated invitation title', eventDate: 'October 3, 2026', location: 'New address', estimatedGuestCount: 12 };
    expect(selectedCustomerArtwork(row, event)).toBeTruthy();
    const corrupt = structuredClone(row); corrupt.attempts[0].sourceBase64 = 'corrupt';
    await expect(claimCustomerArtwork(event, corrupt, revision(corrupt), store)).rejects.toThrow('verified');
    for (let n = 1; n < 4; n++) {
      event = { ...event, vibeDescription: base.vibeDescription + ` Revision of the artwork brief ${n}.` };
      const claim = await claimCustomerArtwork(event, row, { ...first(row), requestKey: randomUUID() }, store);
      await finishCustomerArtwork(event.id, claim.attempt, claim.request!, store, generate); row = (await store.get(event.id))!;
    }
    expect(customerArtworkView(row, event, env).requestsRemaining).toBe(0);
    await expect(selectCustomerArtwork(event, row, selection(row, 0), store)).rejects.toThrow();
    event = { ...event, vibeDescription: 'Yet another full artwork request' };
    await expect(claimCustomerArtwork(event, row, { ...first(row), requestKey: randomUUID() }, store)).rejects.toThrow('limit');
    expect(generate).toHaveBeenCalledTimes(4);
  });
});

describe('customer route integration', () => {
  it('connects create/read/keep/revise/revert/paid reuse without staff, duplicate spend, or exposing private source data', async () => {
    const a = app();
    expect((await request(a).post('/api/checkout/create-session').send({ returnToken: event.ownerToken })).status).toBe(409);
    for (let n = 0; n < 2; n++) expect((await request(a).post(owner + '/prepayment-preview').send({ email: 'fixture@example.test' })).status).toBe(n === 0 ? 202 : 200);
    expect(jobs).toHaveLength(1); await jobs.shift()!();
    const read = await request(a).get(owner + '/prepayment-preview/readiness');
    expect(read.body.kind).toBe('customer-artwork'); expect(read.body.checkoutAllowed).toBe(false);
    expect(read.text).not.toMatch(/sourceBase64|imageBase64|providerCalls|inputTokens|prompt/);
    const original = (await store.get(event.id))!;
    const asset = await request(a).get(read.body.customerArtwork.candidates[0].assetUrl);
    expect(asset.status).toBe(200); expect(asset.headers['cache-control']).toBe('private, no-store');
    expect(asset.body.equals(Buffer.from(original.attempts[0].imageBase64!, 'base64'))).toBe(true);
    expect((await request(a).post(owner + '/artwork/select').send(selection(original))).body.canContinue).toBe(true);
    let row = (await store.get(event.id))!;
    expect((await request(a).post(owner + '/invite/use-prepayment-preview').send(selection(row))).status).toBe(402);
    const change = revision(row);
    for (let n = 0; n < 2; n++) expect((await request(a).post(owner + '/artwork/revise').send(change)).status).toBe(202);
    expect(jobs).toHaveLength(1);
    expect((await request(a).post('/api/checkout/create-session').send({ returnToken: event.ownerToken })).status).toBe(409);
    await jobs.shift()!();
    row = (await store.get(event.id))!;
    expect(row.selectedId).toBe(original.attempts[0].id); // A revision never silently replaces the choice.
    await request(a).post(owner + '/artwork/select').send(selection(row, 1)); row = (await store.get(event.id))!;
    await request(a).post(owner + '/artwork/select').send(selection(row, 0)); row = (await store.get(event.id))!;
    expect((await request(a).post('/api/checkout/create-session').send({ returnToken: event.ownerToken })).status).toBe(418);
    expect((await request(a).post(owner + '/master-planner/generate').send({})).status).toBe(418);
    paid = true;
    expect((await request(a).post(owner + '/invite/use-prepayment-preview').send(selection(row))).status).toBe(200);
    expect(event.inviteArtworkUrl).toBe(selectedCustomerArtwork(row, event));
    expect(JSON.parse(event.inviteDesignConceptJson).fontPairingId).toBe('editorial-serif');
    expect(isKeptCustomerArtwork(row, event, event.inviteArtworkUrl)).toBe(true);
    expect((await request(a).patch(owner).send({ inviteArtworkUrl: eventArtworkUrl(event, 'inviteArtworkUrl'), inviteSubject: 'Edited copy' })).status).toBe(418);
    expect((await request(a).patch(owner).send({ inviteArtworkUrl: 'https://unselected.example/image.png' })).status).toBe(409);
    expect((await request(a).patch(owner + '/invite/live-design').send({ fontPairingId: 'editorial-serif' })).status).toBe(418);
    for (const path of ['/ai-first/generate', '/invite/generate-designs', '/invite/upload-artwork'])
      expect((await request(a).post(owner + path).send({})).status).toBe(409);
    for (let n = 0; n < 3; n++) await request(a).get(owner + '/prepayment-preview/readiness');
    expect(generate).toHaveBeenCalledTimes(2);
  });
  it('does not spend when switched off, on a changed image hash, or with another owner’s link', async () => {
    expect((await request(app({ POSY_CUSTOMER_ARTWORK_GENERATION: 'false' })).post(owner + '/prepayment-preview').send({ email: 'fixture@example.test' })).status).toBe(503);
    expect(jobs).toHaveLength(0);
    const row = await ready(), a = app();
    expect((await request(a).post(owner + '/artwork/revise').send({ ...revision(row), imageHash: '0'.repeat(64) })).status).toBe(409);
    expect((await request(a).get('/api/events/owner/wrong-owner/artwork')).status).toBe(404);
    expect((await request(a).get(owner + '/artwork/candidates/' + row.attempts[0].id + '?v=' + '0'.repeat(64))).status).toBe(404);
    expect(jobs).toHaveLength(0); expect(generate).toHaveBeenCalledTimes(1);
  });
  it('keeps an applied invitation available while a newer private selection or brief is being considered', async () => {
    let row = await ready(); row = await selectCustomerArtwork(event, row, selection(row), store);
    const applied = selectedCustomerArtwork(row, event)!;
    const edit = await claimCustomerArtwork(event, row, revision(row), store);
    await finishCustomerArtwork(event.id, edit.attempt, edit.request!, store, generate);
    row = (await store.get(event.id))!; row = await selectCustomerArtwork(event, row, selection(row, 1), store);
    event = { ...event, vibeDescription: 'A completely different scene; the old invite is still published.' };
    expect(selectedCustomerArtwork(row, event)).toBeNull();
    expect(isKeptCustomerArtwork(row, event, applied)).toBe(true);
    expect(isKeptCustomerArtwork(row, { ...event, ownerToken: 'rotated' }, applied)).toBe(false);
  });
});

// @vitest-environment node
import { createHash, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { encode } from 'jpeg-js';
import type { Event } from '@shared/schema';
import { customerArtworkBriefHash, emptyCustomerArtwork, selectedCustomerArtwork, type CustomerArtworkSession, type CustomerArtworkStore } from '../server/customerArtwork';
import { humanArtworkBrief } from '../server/humanArtworkReview';
import { registerCustomerArtworkRoutes } from '../server/customerArtworkRoutes';
vi.mock('../server/storage', () => ({ storage: {}, db: {} }));
vi.mock('../server/masterPlannerEntitlement', () => ({ getEntitlementSummary: vi.fn() }));
class MemoryStore implements CustomerArtworkStore {
  row?: CustomerArtworkSession;
  async spendingAvailable() { return false; }
  async get() { return structuredClone(this.row); }
  async create(row: CustomerArtworkSession) { this.row ??= structuredClone(row); return (await this.get())!; }
  async compareAndSet(row: CustomerArtworkSession, version: number) {
    if (this.row?.version !== version) return false;
    this.row = structuredClone(row); return true;
  }
  async reserveRequest() { throw Error('Uploads must not reserve provider requests'); }
  async finishRequest(): Promise<'unmanaged'> { throw Error('Uploads must not finish provider requests'); }
}
const base = { id: 99502, ownerToken: 'synthetic-upload-owner', customerArtworkEnabled: true,
  eventName: 'Original scene', eventType: 'Celebration', vibeDescription: 'The complete saved host request.',
  themeName: '', paletteColors: '[]', eventDate: 'October 17, 2026', draftStatus: 'none', inviteStatus: 'draft' } as Event;
const env = { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'codex/launch-blockers', POSY_CUSTOMER_ARTWORK_GENERATION: 'false', POSY_CUSTOMER_ARTWORK_EVALUATION_LIMITS: '{}' };
const owner = `/api/events/owner/${base.ownerToken}`;
const jpeg = encode({ width: 512, height: 768, data: Buffer.alloc(512 * 768 * 4, 150) }, 95).data;
const dataUrl = `data:image/jpeg;base64,${jpeg.toString('base64')}`;
let store: MemoryStore, event: Event, paid: boolean;
const network = vi.fn(async () => { throw Error('No external calls allowed'); });
beforeEach(async () => {
  vi.stubGlobal('fetch', network.mockClear()); store = new MemoryStore(); event = { ...base }; paid = false;
  const row = emptyCustomerArtwork(event);
  row.version = 2;
  row.attempts.push({ id: randomUUID(), requestKey: 'failed-create', briefHash: customerArtworkBriefHash(event), brief: humanArtworkBrief(event),
    operation: 'create', status: 'failed', failure: 'provider', billing: 'unknown', providerCalls: 1,
    startedAt: 1, completedAt: 2, prompt: 'private frozen prompt', model: 'gpt-image-2' });
  await store.create(row);
});
afterEach(() => { expect(network).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
function app() {
  const app = express(); app.use(express.json({ limit: '4mb' }));
  registerCustomerArtworkRoutes(app, { sessions: store, env,
    events: { getEventByOwnerToken: async token => token === event.ownerToken ? event : undefined,
      updateEventById: async (_id, patch) => event = { ...event, ...patch } },
    unlocked: async () => paid, schedule: () => { throw Error('No provider schedule allowed'); } });
  app.use((_req, res) => res.status(418).json({ reachedExistingPaymentOrPlannerGate: true })); return app;
}
const input = () => ({ requestKey: randomUUID(), version: store.row!.version, briefHash: customerArtworkBriefHash(event), dataUrl });
const selection = (view: any) => ({ version: view.version, briefHash: view.briefHash,
  candidateId: view.candidates.at(-1).id, imageHash: view.candidates.at(-1).imageHash });

describe('explicit owner upload during an image spending hold', () => {
  it('retains failure exactly, requires explicit selection, survives replay/reload, and keeps payment/application gates', async () => {
    const server = app(), before = structuredClone(store.row!.attempts);
    expect((await request(server).post('/api/checkout/create-session').send({ returnToken: event.ownerToken })).status).toBe(409);
    const body = input();
    const uploaded = await request(server).post(`${owner}/artwork/upload`).send(body);
    expect(uploaded.status).toBe(200);
    expect(uploaded.body).toMatchObject({ state: 'failed', canContinue: false, generationEnabled: false,
      selectedId: null, requestsRemaining: 0, uploadsRemaining: 2 });
    expect(uploaded.body.candidates).toHaveLength(1); expect(uploaded.body.candidates[0].operation).toBe('upload');
    expect(store.row!.attempts).toEqual(before);
    expect((await request(server).post(`${owner}/artwork/upload`).send(body)).body).toEqual(uploaded.body);
    expect(store.row!.uploads).toHaveLength(1);
    const unselected = await request(server).get(`${owner}/prepayment-preview/asset`);
    expect(unselected.status).toBe(200);
    expect(createHash('sha256').update(unselected.body).digest('hex')).toBe(uploaded.body.candidates[0].imageHash);
    const chosen = await request(server).post(`${owner}/artwork/select`).send(selection(uploaded.body));
    expect(chosen.body.canContinue).toBe(true);
    expect((await request(app()).get(`${owner}/artwork`)).body).toEqual(chosen.body);
    const image = await request(server).get(chosen.body.candidates[0].assetUrl);
    expect(image.status).toBe(200); expect(image.headers['content-type']).toContain('image/png');
    expect(createHash('sha256').update(image.body).digest('hex')).toBe(chosen.body.selectedHash);
    expect((await request(server).post('/api/checkout/create-session').send({ returnToken: event.ownerToken })).status).toBe(418);
    expect((await request(server).post(`${owner}/invite/use-prepayment-preview`).send(selection(chosen.body))).status).toBe(402);
    paid = true;
    expect((await request(server).post(`${owner}/invite/use-prepayment-preview`).send(selection(chosen.body))).status).toBe(200);
    expect(event.inviteArtworkUrl).toBe(selectedCustomerArtwork(store.row, event));
    expect(store.row!.attempts).toEqual(before);
    expect((await request(server).post(`${owner}/artwork/revise`).send({ ...selection(chosen.body), requestKey: randomUUID(),
      baseCandidateId: chosen.body.selectedId, correction: 'Change uploaded artwork' })).status).not.toBe(202);
  });
  it('saves the reviewed ready-made design only after explicit choice, retains the brief/failure, and rejects invented templates', async () => {
    const server=app(), before=structuredClone(store.row!.attempts);
    const body={version:store.row!.version,briefHash:customerArtworkBriefHash(event),requestKey:randomUUID(),templateId:'elegant-neutral'};
    expect((await request(server).post(`${owner}/artwork/template`).send({...body,templateId:'invented'})).status).toBe(400);
    const result=await request(server).post(`${owner}/artwork/template`).send(body);
    expect(result.status).toBe(200);expect(result.body.canContinue).toBe(false);
    expect(result.body.candidates[0].operation).toBe('template');expect(result.body.savedBrief).toBe(event.vibeDescription);
    expect((await request(server).post(`${owner}/artwork/template`).send(body)).body).toEqual(result.body);
    expect(store.row!.attempts).toEqual(before);expect(store.row!.uploads).toHaveLength(1);
    const kept=await request(server).post(`${owner}/artwork/select`).send(selection(result.body));
    expect(kept.body.canContinue).toBe(true);expect((await request(app()).get(`${owner}/artwork`)).body).toEqual(kept.body);
  });
  it('rejects unauthorized, stale, changed-brief, reused-key, malformed and undersized uploads without changing saved history', async () => {
    const server = app(), before = structuredClone(store.row);
    const attempts = [
      request(server).post('/api/events/owner/wrong-owner/artwork/upload').send(input()),
      request(server).post(`${owner}/artwork/upload`).send({ ...input(), version: 0 }),
      request(server).post(`${owner}/artwork/upload`).send({ ...input(), briefHash: 'f'.repeat(64) }),
      request(server).post(`${owner}/artwork/upload`).send({ ...input(), dataUrl: 'https://private.example/image' }),
      request(server).post(`${owner}/artwork/upload`).send({ ...input(), dataUrl: 'data:image/jpeg;base64,YmFk' }),
      request(server).post(`${owner}/artwork/upload`).send({ ...input(), dataUrl: `data:image/jpeg;base64,${encode({width:10,height:10,data:Buffer.alloc(400)},90).data.toString('base64')}` }),
    ];
    for (const response of await Promise.all(attempts)) expect([400,404,409]).toContain(response.status);
    expect(store.row).toEqual(before);
    const body=input(); await request(server).post(`${owner}/artwork/upload`).send(body);
    expect((await request(server).post(`${owner}/artwork/upload`).send({ ...body, dataUrl: 'data:image/jpeg;base64,YmFk' })).status).toBe(409);
    expect(store.row!.uploads).toHaveLength(1);
  });
  it('enforces upload capacity and serializes concurrent submissions without spending provider slots', async () => {
    const server=app(); const first=input();
    const results=await Promise.all([request(server).post(`${owner}/artwork/upload`).send(first),
      request(server).post(`${owner}/artwork/upload`).send({ ...first, requestKey: randomUUID() })]);
    expect(results.map(r=>r.status).sort()).toEqual([200,409]);
    for(let n=0;n<2;n++) expect((await request(server).post(`${owner}/artwork/upload`).send(input())).status).toBe(200);
    expect((await request(server).post(`${owner}/artwork/upload`).send(input())).status).toBe(429);
    expect(store.row!.attempts).toHaveLength(1); expect(store.row!.uploads).toHaveLength(3);
  });
  it('keeps any previously selected image until the upload is explicitly selected and blocks uploads during active work', async () => {
    const server=app(); const first=await request(server).post(`${owner}/artwork/upload`).send(input());
    const chosen=await request(server).post(`${owner}/artwork/select`).send(selection(first.body));
    const second=await request(server).post(`${owner}/artwork/upload`).send(input());
    expect(second.body.selectedId).toBe(chosen.body.selectedId); expect(second.body.canContinue).toBe(true);
    event.draftStatus='generating';
    expect((await request(server).post(`${owner}/artwork/upload`).send(input())).status).toBe(409);
    event.draftStatus='none'; store.row!.attempts[0].status='running';store.row!.attempts[0].startedAt=Date.now();
    expect((await request(server).post(`${owner}/artwork/upload`).send(input())).status).toBe(409);
  });
});

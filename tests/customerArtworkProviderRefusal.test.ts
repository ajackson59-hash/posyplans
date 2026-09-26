// @vitest-environment node
/** Real customer route, prompt builder, image adapter and failure persistence;
 * synthetic HTTP response and memory store only. Never calls an image provider. */
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Event } from '@shared/schema';
import type { CustomerArtworkSession, CustomerArtworkStore } from '../server/customerArtwork';
import { authorizeImageDispatch } from '../server/imageSpendGuard';
import { registerCustomerArtworkRoutes } from '../server/customerArtworkRoutes';

vi.mock('../server/storage', () => ({ storage: {}, db: {} }));
vi.mock('../server/masterPlannerEntitlement', () => ({ getEntitlementSummary: vi.fn() }));
vi.mock('../server/imageSpendGuard', async importOriginal => ({
  ...await importOriginal<typeof import('../server/imageSpendGuard')>(),
  authorizeImageDispatch: vi.fn(async () => {}),
}));

class MemoryStore implements CustomerArtworkStore {
  rows = new Map<number, CustomerArtworkSession>();
  async spendingAvailable() { return true; }
  async get(id: number) { return structuredClone(this.rows.get(id)); }
  async create(row: CustomerArtworkSession) {
    if (!this.rows.has(row.eventId)) this.rows.set(row.eventId, structuredClone(row));
    return (await this.get(row.eventId))!;
  }
  async compareAndSet(row: CustomerArtworkSession, version: number) {
    if (this.rows.get(row.eventId)?.version !== version) return false;
    this.rows.set(row.eventId, structuredClone(row)); return true;
  }
  async reserveRequest(row: CustomerArtworkSession, version: number) { return this.compareAndSet(row, version); }
  async finishRequest(): Promise<'unmanaged'> { return 'unmanaged'; }
}

const syntheticKey = 'synthetic-private-provider-key';
const privateMessage = 'Synthetic provider message that must not leave the adapter';
const providerRequestId = 'req_syntheticmoderation123456';
const event = {
  id: 99501, ownerToken: 'synthetic-refusal-owner', customerArtworkEnabled: true,
  eventName: 'Original garden dinner', eventType: 'Celebration',
  vibeDescription: 'An original garden dinner with exactly six place settings and ivory flowers. Photographic realism. No people or lettering.',
  eventDate: 'October 17, 2026', location: 'Synthetic private garden', venueName: '',
  themeName: '', paletteColors: '[]', estimatedGuestCount: 6, inviteStatus: 'draft', draftStatus: 'none',
} as unknown as Event;
const owner = `/api/events/owner/${event.ownerToken}`;
const env = { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'codex/launch-blockers',
  POSY_CUSTOMER_ARTWORK_GENERATION: 'true', POSY_CUSTOMER_ARTWORK_EVALUATION_LIMITS: '{"99501":2}' };
const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubEnv('OPENAI_API_KEY', syntheticKey);
  vi.stubGlobal('fetch', fetchMock.mockReset());
  vi.mocked(authorizeImageDispatch).mockClear();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('current customer initial-create moderation refusal', () => {
  it.each([
    { label: 'no retained category', categories: [], retained: [] },
    { label: 'safe category plus reflected private content', categories: ['violence', privateMessage, 'violence'], retained: ['violence'] },
  ])('persists $label privately and never redispatches after replay or reload', async ({ categories, retained }) => {
    const store = new MemoryStore();
    const reserve = vi.spyOn(store, 'reserveRequest');
    const updateEvent = vi.fn(async () => { throw Error('Refusal cannot change the event or its contact.'); });
    const legacyEffect = vi.fn();
    const jobs: Array<() => Promise<void>> = [];
    const makeApp = () => {
      const app = express(); app.use(express.json());
      registerCustomerArtworkRoutes(app, { sessions: store, env,
        events: { getEventByOwnerToken: async token => token === event.ownerToken ? event : undefined,
          updateEventById: updateEvent },
        unlocked: async () => false, schedule: job => jobs.push(job),
      });
      app.use((_req, res) => { legacyEffect(); res.status(418).json({ unexpectedLegacyEffect: true }); });
      return app;
    };
    let sentPrompt = '';
    fetchMock.mockImplementation(async (url, init) => {
      // Any unexpected external request fails the test rather than reaching a provider.
      expect(url).toBe('https://api.openai.com/v1/images/generations');
      expect(init?.method).toBe('POST');
      const body = JSON.parse(String(init?.body)); sentPrompt = body.prompt;
      expect(body).toMatchObject({ model: 'gpt-image-2', quality: 'medium', size: '1024x1536',
        n: 1, background: 'opaque', output_format: 'jpeg', output_compression: 100 });
      expect(body).not.toHaveProperty('moderation');
      expect(sentPrompt).toContain(event.vibeDescription);
      return new Response(JSON.stringify({ error: { type: 'image_generation_user_error', code: 'moderation_blocked',
        message: `${privateMessage}: ${syntheticKey} ${sentPrompt}`,
        moderation_details: { moderation_stage: 'output', categories },
      } }), { status: 400, headers: { 'x-request-id': providerRequestId } });
    });

    const app = makeApp();
    const initial = await request(app).post(`${owner}/prepayment-preview`).send({ email: 'synthetic@example.invalid' });
    expect(initial.status).toBe(202); expect(jobs).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();
    await jobs.shift()!();

    const persisted = (await store.get(event.id))!;
    expect(persisted.version).toBe(2); expect(persisted.attempts).toHaveLength(1);
    expect(persisted.selectedId).toBeUndefined(); expect(persisted.selections).toEqual([]);
    const failed = persisted.attempts[0];
    expect(failed).toMatchObject({ operation: 'create', status: 'failed', failure: 'provider',
      billing: 'unknown', providerCalls: 1, model: 'gpt-image-2', prompt: sentPrompt,
      diagnostics: { status: 400, code: 'moderation_blocked', type: 'image_generation_user_error',
        requestId: providerRequestId, moderationStage: 'output', moderationCategories: retained,
        model: 'gpt-image-2', quality: 'medium', size: '1024x1536', outputFormat: 'jpeg', operation: 'request',
        providerRequestCount: 1, providerDurationMs: expect.any(Number),
        promptSha256: createHash('sha256').update(sentPrompt).digest('hex') } });
    expect(failed.completedAt).toBeGreaterThanOrEqual(failed.startedAt);
    expect(failed.sourceBase64).toBeUndefined(); expect(failed.imageBase64).toBeUndefined();
    expect(failed.imageHash).toBeUndefined(); expect(failed.telemetry).toBeUndefined();
    expect(JSON.stringify(persisted)).not.toContain(privateMessage);
    expect(JSON.stringify(persisted)).not.toContain(syntheticKey);
    expect(reserve).toHaveBeenCalledTimes(1);
    expect(vi.mocked(authorizeImageDispatch)).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      imageSpendPermit: failed.id, imageSpendExecution: expect.any(String), maxTransientRetries: 0,
    }));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // A new Express instance simulates a returning client reading the same saved session.
    // The in-memory store tests route persistence, not the separate PostgreSQL policy.
    const returning = makeApp();
    const responses = [initial];
    for (const server of [app, returning]) {
      const view = await request(server).get(`${owner}/artwork`);
      const readiness = await request(server).get(`${owner}/prepayment-preview/readiness`);
      const replay = await request(server).post(`${owner}/prepayment-preview`).send({ email: 'synthetic@example.invalid' });
      expect(view.status).toBe(200);
      expect(view.body).toMatchObject({ state: 'failed', generationEnabled: false, canContinue: false,
        candidates: [], selectedId: null, supportReference: failed.id, requestsRemaining: 1 });
      expect(readiness.body).toMatchObject({ ready: false, checkoutAllowed: false, pollAfterMs: null,
        customerArtwork: { state: 'failed', generationEnabled: false, candidates: [] } });
      expect(replay.status).toBe(200); expect(replay.body).toEqual(readiness.body);
      responses.push(view, readiness, replay);
    }
    const asset = await request(returning).get(`${owner}/prepayment-preview/asset`);
    const checkout = await request(returning).post('/api/checkout/create-session').send({ returnToken: event.ownerToken });
    const planner = await request(returning).post(`${owner}/master-planner/generate`).send({});
    expect(asset.status).toBe(404); expect(checkout.status).toBe(409); expect(planner.status).toBe(409);
    responses.push(asset, checkout, planner);
    for (const response of responses) {
      expect(response.headers['cache-control']).toBe('private, no-store');
      expect(response.text).not.toMatch(/diagnostics|moderation_blocked|image_generation_user_error|moderationStage|moderationCategories|promptSha256|providerRequestCount|providerDurationMs|providerCalls|sourceBase64|imageBase64|responseUsage|FULL HOST BRIEF/);
      expect(response.text).not.toContain(providerRequestId);
      expect(response.text).not.toContain(syntheticKey); expect(response.text).not.toContain(privateMessage);
    }
    const warnings = JSON.stringify(vi.mocked(console.warn).mock.calls);
    expect(warnings).not.toContain(privateMessage); expect(warnings).not.toContain(syntheticKey); expect(warnings).not.toContain(sentPrompt);
    expect(await store.get(event.id)).toEqual(persisted);
    expect(reserve).toHaveBeenCalledTimes(1); expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(authorizeImageDispatch).toHaveBeenCalledTimes(1); expect(jobs).toHaveLength(0);
    expect(updateEvent).not.toHaveBeenCalled(); expect(legacyEffect).not.toHaveBeenCalled();
  });
});

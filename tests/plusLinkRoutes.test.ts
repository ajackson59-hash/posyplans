// @vitest-environment node
import { createHmac } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Event } from '../shared/schema';
import type { PlusMembershipProof } from '../server/plusMembershipProof';
import type { PlusLinkChallenge } from '../server/plusLinkStore';
import { registerPlusLinkRoutes, plusLinkCodeHash, type PlusLinkDependencies } from '../server/plusLinkRoutes';

const forbidden = vi.hoisted(() => ({ updateEvent: vi.fn(), logAnalyticsEvent: vi.fn(),
  setCapturedEmail: vi.fn(), reserveMasterPlannerGeneration: vi.fn(), createAiFirstJob: vi.fn() }));
vi.mock('../server/storage', () => ({ storage: forbidden }));

const NOW = 1_800_000_000_000;
const ID = 'b66c1388-90ed-4dfe-aa6d-772df6884917';
const REQUEST_KEY = 'd45b5a77-26c4-47a4-a338-e9110f896a13';
const OWNER = 'private-owner-capability';
const HOST = 'posy-preview-example.vercel.app';
const RECIPIENT = 'billing@example.invalid';
const SECRET = 'sk_test_synthetic_not_a_real_key';
const CODE = '00123456';
const PATH = `/api/events/owner/${OWNER}/plus-link`;
const secret = createHmac('sha256', SECRET).update('posy-plus-link:v1').digest();
function proof(): PlusMembershipProof {
  return { subscriptionId: 'sub_paid', customerId: 'cus_paid', planTier: 'plus_active', trialEndsAt: null,
    billingInterval: 'monthly', subscriptionCreatedAt: NOW - 86_400_000, observedAt: NOW, billingEmail: RECIPIENT };
}
function challenge(changes: Partial<PlusLinkChallenge> = {}): PlusLinkChallenge {
  const row: PlusLinkChallenge = { id: ID, eventId: 77, requestKey: REQUEST_KEY, recipient: RECIPIENT,
    recipientHash: 'a'.repeat(64), codeHash: null, subscriptionId: 'sub_paid', customerId: 'cus_paid',
    state: 'sent', attempts: 0, createdAt: NOW, expiresAt: NOW + 600_000, resendAt: NOW + 60_000,
    executionId: null, ...changes };
  row.codeHash = plusLinkCodeHash(secret, row, CODE);
  return row;
}
function setup() {
  type Store = NonNullable<PlusLinkDependencies['store']>;
  const store = {
    reserve: vi.fn<Store['reserve']>().mockImplementation(async p => ({ created: true,
      challenge: challenge({ ...p, createdAt: p.now, state: 'pending' }) })),
    prepareDelivery: vi.fn<Store['prepareDelivery']>().mockResolvedValue(true),
    markDelivery: vi.fn<Store['markDelivery']>().mockResolvedValue(undefined),
    readLatest: vi.fn<Store['readLatest']>().mockResolvedValue(undefined),
    beginVerification: vi.fn<Store['beginVerification']>().mockImplementation(async (_input, verify) => {
      const row = challenge(); return verify(row) ? { kind: 'claimed', challenge: row } : { kind: 'invalid' };
    }),
    finishVerification: vi.fn<Store['finishVerification']>().mockResolvedValue(true),
    abortVerification: vi.fn<Store['abortVerification']>().mockResolvedValue(undefined),
  };
  const savedEvent = { id: 77, ownerToken: OWNER, eventName: 'Saved private event',
    capturedEmail: 'contact@example.invalid', generatedPlan: { preserved: true } } as unknown as Event;
  const event = vi.fn<NonNullable<PlusLinkDependencies['event']>>().mockResolvedValue(savedEvent);
  const access = vi.fn<NonNullable<PlusLinkDependencies['access']>>().mockResolvedValue(undefined);
  const resolve = vi.fn<NonNullable<PlusLinkDependencies['proof']>['resolve']>().mockResolvedValue(proof());
  const refresh = vi.fn<NonNullable<PlusLinkDependencies['proof']>['refresh']>().mockResolvedValue(proof());
  const send = vi.fn<NonNullable<PlusLinkDependencies['send']>>().mockResolvedValue({ ok: true, providerId: 'synthetic-email' });
  const configured = vi.fn(() => true);
  const env: NodeJS.ProcessEnv = { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'codex/launch-blockers',
    VERCEL_BRANCH_URL: HOST, VERCEL_URL: HOST, STRIPE_SECRET_KEY: SECRET };
  const jobs: Array<() => Promise<void>> = [];
  const now = vi.fn(() => NOW);
  const schedule = vi.fn((job: () => Promise<void>) => { jobs.push(job); });
  const app = express(); app.use(express.json());
  registerPlusLinkRoutes(app, { store, event, access, proof: { resolve, refresh }, send,
    configured, env: () => env, now, schedule });
  const post = (action: 'request' | 'confirm') => request(app).post(`${PATH}/${action}`)
    .set('Host', HOST).set('Origin', `https://${HOST}`);
  const start = (body: unknown = { email: RECIPIENT, requestKey: REQUEST_KEY }) => post('request').send(body);
  const confirm = (body: unknown = { challengeId: ID, code: CODE }) => post('confirm').send(body);
  const drain = async () => { for (const job of jobs.splice(0)) await job(); };
  return { app, post, start, confirm, drain, jobs, store, event, savedEvent, access, resolve, refresh, send, configured, env, now, schedule };
}
const network = vi.fn(() => { throw Error('External calls forbidden in route tests.'); });
beforeEach(() => {
  network.mockClear(); Object.values(forbidden).forEach(mock => mock.mockReset());
  vi.stubGlobal('fetch', network); vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  expect(network).not.toHaveBeenCalled();
  Object.values(forbidden).forEach(mock => expect(mock).not.toHaveBeenCalled());
  vi.unstubAllGlobals(); vi.restoreAllMocks();
});
const publicResponse = (body: Record<string, unknown>) => { const { challengeId: _, ...rest } = body; return rest; };

describe('Plus link request boundary', () => {
  it.each(['production', 'wrong_branch', 'sender_unconfigured', 'missing_secret'])('fails closed when %s', async reason => {
    const test = setup();
    if (reason === 'production') test.env.VERCEL_ENV = 'production';
    if (reason === 'wrong_branch') test.env.VERCEL_GIT_COMMIT_REF = 'main';
    if (reason === 'sender_unconfigured') test.configured.mockReturnValue(false);
    if (reason === 'missing_secret') delete test.env.STRIPE_SECRET_KEY;
    expect((await test.start()).status).toBe(503);
    expect((await test.confirm()).status).toBe(503);
    expect(test.event).not.toHaveBeenCalled(); expect(test.store.reserve).not.toHaveBeenCalled();
    expect(test.resolve).not.toHaveBeenCalled(); expect(test.refresh).not.toHaveBeenCalled();
    expect(test.send).not.toHaveBeenCalled(); expect(test.schedule).not.toHaveBeenCalled();
  });

  it.each(['invalid-origin', 'cross-site', 'non-json'])('rejects %s before provider or storage work', async reason => {
    const test = setup();
    const send = (action: 'request' | 'confirm') => {
      const call = test.post(action);
      if (reason === 'invalid-origin') call.set('Origin', 'https://attacker.example');
      if (reason === 'cross-site') call.set('Sec-Fetch-Site', 'cross-site');
      if (reason === 'non-json') return call.type('form').send({ email: RECIPIENT });
      return call.send(action === 'request' ? { email: RECIPIENT, requestKey: REQUEST_KEY } : { challengeId: ID, code: CODE });
    };
    expect((await send('request')).status).toBe(403); expect((await send('confirm')).status).toBe(403);
    expect(test.event).not.toHaveBeenCalled(); expect(test.store.reserve).not.toHaveBeenCalled();
    expect(test.resolve).not.toHaveBeenCalled(); expect(test.refresh).not.toHaveBeenCalled(); expect(test.send).not.toHaveBeenCalled();
  });

  it('does not accept a forged matching Origin and Host outside the configured Preview', async () => {
    const test = setup();
    const result = await test.post('request').set('Host', 'attacker.example').set('Origin', 'https://attacker.example')
      .send({ email: RECIPIENT, requestKey: REQUEST_KEY });
    expect(result.status).toBe(403); expect(test.store.reserve).not.toHaveBeenCalled();
    expect(test.resolve).not.toHaveBeenCalled(); expect(test.send).not.toHaveBeenCalled();
  });

  it.each([{ email: 'invalid', requestKey: REQUEST_KEY }, { email: RECIPIENT, requestKey: 'bad' },
    { email: RECIPIENT, requestKey: REQUEST_KEY, subscriptionId: 'sub_injected' }])('rejects invalid request input %j', async body => {
    const test = setup(); expect((await test.start(body)).status).toBe(400);
    expect(test.store.reserve).not.toHaveBeenCalled(); expect(test.resolve).not.toHaveBeenCalled(); expect(test.send).not.toHaveBeenCalled();
  });

  it('requires the target owner capability and never exposes an unknown event', async () => {
    const test = setup(); test.event.mockResolvedValue(undefined);
    expect((await test.start()).status).toBe(404); expect((await test.confirm()).status).toBe(404);
    expect(test.store.reserve).not.toHaveBeenCalled(); expect(test.store.beginVerification).not.toHaveBeenCalled();
  });

  it('responds before asynchronous billing lookup or sending and publishes no private evidence', async () => {
    const test = setup(); const before = structuredClone(test.savedEvent);
    const response = await test.start({ email: ' BILLING@EXAMPLE.INVALID ', requestKey: REQUEST_KEY });
    expect(response.status).toBe(202); expect(response.body).toEqual({ ok: true,
      challengeId: expect.any(String), expiresAt: NOW + 600_000, resendAt: NOW + 60_000, message: expect.any(String) });
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers['referrer-policy']).toBe('no-referrer');
    expect(test.resolve).not.toHaveBeenCalled(); expect(test.send).not.toHaveBeenCalled();
    await test.drain();
    expect(test.resolve).toHaveBeenCalledWith('BILLING@EXAMPLE.INVALID');
    expect(test.send).toHaveBeenCalledWith({ to: RECIPIENT, code: expect.stringMatching(/^\d{8}$/), challengeId: response.body.challengeId });
    const delivery = test.send.mock.calls[0][0];
    const preparedHash = test.store.prepareDelivery.mock.calls[0][2];
    expect(preparedHash).toBe(plusLinkCodeHash(secret, challenge({ id: delivery.challengeId }), delivery.code));
    expect(test.store.markDelivery).toHaveBeenCalledWith(response.body.challengeId, true, NOW);
    expect(JSON.stringify(response.body)).not.toMatch(/billing@|sub_paid|cus_paid|private-owner/);
    expect(test.savedEvent).toEqual(before);
  });

  it('keeps rate-blocked and eligible response shape/message identical without provider work for the blocked request', async () => {
    const test = setup(); const accepted = await test.start();
    test.store.reserve.mockResolvedValue(undefined);
    const blocked = await test.start();
    expect(blocked.status).toBe(202); expect(publicResponse(blocked.body)).toEqual(publicResponse(accepted.body));
    expect(test.schedule).toHaveBeenCalledTimes(1); expect(test.resolve).not.toHaveBeenCalled(); expect(test.send).not.toHaveBeenCalled();
  });

  it('returns the same challenge on request replay without another job or delivery', async () => {
    const test = setup(); test.store.reserve.mockResolvedValue({ created: false, challenge: challenge() });
    const response = await test.start();
    expect(response.status).toBe(202); expect(response.body.challengeId).toBe(ID);
    expect(test.schedule).not.toHaveBeenCalled(); expect(test.resolve).not.toHaveBeenCalled(); expect(test.send).not.toHaveBeenCalled();
  });

  it.each(['no-proof', 'expired', 'proof-outage', 'prepare-refused'])('does not send after %s', async reason => {
    const test = setup(); const response = await test.start();
    if (reason === 'no-proof') test.resolve.mockResolvedValue(undefined);
    if (reason === 'expired') test.now.mockReturnValue(NOW + 600_000);
    if (reason === 'proof-outage') test.resolve.mockRejectedValue(Error('private provider error'));
    if (reason === 'prepare-refused') test.store.prepareDelivery.mockResolvedValue(false);
    await test.drain();
    expect(response.status).toBe(202); expect(test.send).not.toHaveBeenCalled();
    expect(test.store.finishVerification).not.toHaveBeenCalled();
    if (reason !== 'prepare-refused') expect(test.store.markDelivery).toHaveBeenCalledWith(response.body.challengeId, false, test.now());
    expect(JSON.stringify(response.body)).not.toContain('private provider error');
  });

  it.each(['rejected', 'missing-receipt', 'throws'])('keeps the 202 response neutral and marks failed delivery for %s', async reason => {
    const test = setup();
    if (reason === 'rejected') test.send.mockResolvedValue({ ok: false, error: 'private email failure' });
    if (reason === 'missing-receipt') test.send.mockResolvedValue({ ok: true });
    if (reason === 'throws') test.send.mockRejectedValue(Error('private email failure'));
    const response = await test.start(); await test.drain();
    expect(response.status).toBe(202); expect(test.send).toHaveBeenCalledTimes(1);
    expect(test.store.markDelivery).toHaveBeenCalledWith(response.body.challengeId, false, NOW);
    expect(JSON.stringify(response.body)).not.toContain('private email failure');
  });
});

describe('Plus link confirmation boundary', () => {
  it.each([{ challengeId: ID, code: '1234567' }, { challengeId: ID, code: 12345678 },
    { challengeId: 'not-a-uuid', code: CODE }, { challengeId: ID, code: CODE, subscriptionId: 'sub_injected' },
    { challengeId: ID, code: CODE, saveRecoveryEmail: 'true' }])('rejects invalid confirmation %j', async body => {
    const test = setup(); expect((await test.confirm(body)).status).toBe(400);
    expect(test.store.beginVerification).not.toHaveBeenCalled(); expect(test.refresh).not.toHaveBeenCalled(); expect(test.send).not.toHaveBeenCalled();
  });

  it('rejects a wrong code and a stored expired/exhausted challenge with the same response', async () => {
    const test = setup(); const wrong = await test.confirm({ challengeId: ID, code: '99999999' });
    test.store.beginVerification.mockResolvedValue({ kind: 'invalid' });
    const expired = await test.confirm();
    expect(wrong.status).toBe(400); expect(expired.status).toBe(400); expect(wrong.body).toEqual(expired.body);
    expect(test.refresh).not.toHaveBeenCalled(); expect(test.store.finishVerification).not.toHaveBeenCalled();
  });

  it('refreshes only the challenge identity and atomically finishes without any contact or planner action', async () => {
    const test = setup(); const before = structuredClone(test.savedEvent);
    const response = await test.confirm();
    expect(response.status).toBe(200); expect(response.body).toEqual({ ok: true, linked: true });
    expect(test.refresh).toHaveBeenCalledWith('sub_paid', 'cus_paid', RECIPIENT);
    expect(test.store.beginVerification).toHaveBeenCalledWith({ id: ID, eventId: 77 }, expect.any(Function), expect.any(String), NOW);
    expect(test.store.finishVerification).toHaveBeenCalledWith(ID, 77, expect.any(String), proof(), NOW, false);
    expect(test.resolve).not.toHaveBeenCalled(); expect(test.send).not.toHaveBeenCalled();
    expect(test.store.abortVerification).not.toHaveBeenCalled(); expect(test.savedEvent).toEqual(before);
  });

  it.each([undefined, false, true])('passes only the explicit recovery-email opt-in (%s) to the atomic binding', async saveRecoveryEmail => {
    const test = setup();
    const body = { challengeId: ID, code: CODE, ...(saveRecoveryEmail === undefined ? {} : { saveRecoveryEmail }) };
    expect((await test.confirm(body)).status).toBe(200);
    expect(test.store.finishVerification).toHaveBeenCalledWith(ID, 77, expect.any(String), proof(), NOW, saveRecoveryEmail === true);
    expect(test.send).not.toHaveBeenCalled();
  });

  it.each(['revoked', 'binding-conflict', 'missing-identity'])('aborts without linking after %s', async reason => {
    const test = setup();
    if (reason === 'revoked') test.refresh.mockResolvedValue(undefined);
    if (reason === 'binding-conflict') test.store.finishVerification.mockResolvedValue(false);
    if (reason === 'missing-identity') test.store.beginVerification.mockResolvedValue({ kind: 'claimed', challenge: challenge({ customerId: null }) });
    const response = await test.confirm();
    expect(response.status).toBe(400); expect(response.body.linked).toBeUndefined();
    expect(test.store.abortVerification).toHaveBeenCalledWith(ID, expect.any(String));
    if (reason !== 'binding-conflict') expect(test.store.finishVerification).not.toHaveBeenCalled();
  });

  it('allows consumed replay only while the same exact event-bound membership is active', async () => {
    const test = setup(); test.store.beginVerification.mockResolvedValue({ kind: 'consumed', challenge: challenge({ state: 'consumed' }) });
    test.access.mockResolvedValue(proof());
    expect((await test.confirm()).body).toEqual({ ok: true, linked: true });
    for (const membership of [undefined, { ...proof(), planTier: 'plus_expired' as const },
      { ...proof(), subscriptionId: 'sub_other' }, { ...proof(), planTier: 'plus_trial' as const, trialEndsAt: NOW }]) {
      test.access.mockResolvedValue(membership); expect((await test.confirm()).status).toBe(400);
    }
    expect(test.refresh).not.toHaveBeenCalled(); expect(test.store.finishVerification).not.toHaveBeenCalled();
    expect(test.send).not.toHaveBeenCalled();
  });

  it.each(['provider', 'finish', 'begin'])('returns a neutral service error after %s failure and releases the verification claim', async reason => {
    const test = setup(); const error = Error('private provider data and recipient');
    if (reason === 'provider') test.refresh.mockRejectedValue(error);
    if (reason === 'finish') test.store.finishVerification.mockRejectedValue(error);
    if (reason === 'begin') test.store.beginVerification.mockRejectedValue(error);
    const response = await test.confirm();
    expect(response.status).toBe(503); expect(JSON.stringify(response.body)).not.toContain(error.message);
    expect(test.store.abortVerification).toHaveBeenCalledWith(ID, expect.any(String));
    expect(test.send).not.toHaveBeenCalled();
  });
});

describe('saved Plus link status', () => {
  it('returns no contact, subscription identity, code hash, or delivery state', async () => {
    const test = setup(); test.access.mockResolvedValue(proof()); test.store.readLatest.mockResolvedValue(challenge());
    const response = await request(test.app).get(PATH);
    expect(response.body).toEqual({ enabled: true, linked: true,
      challenge: { id: ID, expiresAt: NOW + 600_000, resendAt: NOW + 60_000 } });
    expect(test.resolve).not.toHaveBeenCalled(); expect(test.refresh).not.toHaveBeenCalled(); expect(test.send).not.toHaveBeenCalled();
  });
  it('reports the disabled deployment without reading membership or challenge state', async () => {
    const test = setup(); test.env.VERCEL_ENV = 'production';
    const response = await request(test.app).get(PATH);
    expect(response.body).toEqual({ enabled: false, linked: false });
    expect(test.access).not.toHaveBeenCalled(); expect(test.store.readLatest).not.toHaveBeenCalled();
  });
});

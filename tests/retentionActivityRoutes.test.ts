// @vitest-environment node
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerRetentionActivityRoutes } from '../server/retentionActivityRoutes';

afterEach(() => vi.restoreAllMocks());
function fixture() {
  const store = { recordOwner: vi.fn(async () => true), recordGuest: vi.fn(async () => true) };
  const app = express(); app.use(express.json());
  registerRetentionActivityRoutes(app, store);
  const action = vi.fn((_req, res) => res.json({ completed: true }));
  app.all('/api/events/owner/:ownerToken/plan-regeneration', action);
  app.get('/api/events/owner/:ownerToken', action);
  app.get('/api/events/public/:shareSlug', action);
  app.post('/api/events/public/:shareSlug/guest/:guestToken/rsvp', action);
  app.post('/api/stripe/webhook', action);
  return { app, store, action };
}
describe('deliberate retention activity', () => {
  it('never records polling, public views or webhooks', async () => {
    const { app, store } = fixture();
    for (const path of ['/api/events/owner/host', '/api/events/owner/host/plan-regeneration', '/api/events/public/share'])
      expect((await request(app).get(path)).status).toBe(200);
    expect((await request(app).post('/api/stripe/webhook')).status).toBe(200);
    expect(store.recordOwner).not.toHaveBeenCalled(); expect(store.recordGuest).not.toHaveBeenCalled();
  });
  it('records before a deliberate owner action exactly once', async () => {
    const { app, store, action } = fixture();
    expect((await request(app).post('/api/events/owner/host/plan-regeneration')).status).toBe(200);
    expect(store.recordOwner).toHaveBeenCalledExactlyOnceWith('host', 'host_action');
    expect(store.recordOwner.mock.invocationCallOrder[0]).toBeLessThan(action.mock.invocationCallOrder[0]);
  });
  it('cannot start or replay provider work if recording is unavailable', async () => {
    const { app, store, action } = fixture();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    store.recordOwner.mockRejectedValue(new Error('query contains owner-secret'));
    const result = await request(app).post('/api/events/owner/owner-secret/plan-regeneration');
    expect(result.status).toBe(503); expect(result.body.code).toBe('event_activity_unavailable');
    expect(action).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('owner-secret');
    expect(result.text).not.toContain('owner-secret');
  });
  it('refuses unknown owner credentials before the action', async () => {
    const { app, store, action } = fixture(); store.recordOwner.mockResolvedValue(false);
    expect((await request(app).patch('/api/events/owner/missing/plan-regeneration')).status).toBe(404);
    expect(action).not.toHaveBeenCalled();
  });
  it('records visits without trusting supplied clocks or retention values', async () => {
    const { app, store } = fixture();
    const ok = await request(app).post('/api/events/owner/host/activity');
    expect(ok.status).toBe(204); expect(ok.headers['cache-control']).toContain('no-store');
    expect(store.recordOwner).toHaveBeenCalledExactlyOnceWith('host', 'host_visit');
    expect((await request(app).post('/api/events/owner/host/activity').send({ at: 0 })).status).toBe(400);
    expect(store.recordOwner).toHaveBeenCalledTimes(1);
  });
  it('limits guest activity to a valid RSVP request and leaves credential checking to the store', async () => {
    const { app, store } = fixture();
    await request(app).post('/api/events/public/share/guest/guest-token/rsvp').send({ status: 'invalid' });
    expect(store.recordGuest).not.toHaveBeenCalled();
    await request(app).post('/api/events/public/share/guest/guest-token/rsvp').send({ status: 'yes', attendingCount: 1 });
    expect(store.recordGuest).toHaveBeenCalledExactlyOnceWith('share', 'guest-token');
  });
});

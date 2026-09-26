// Local customer workflow fixture. Never imported by the app or deployed.
// DATABASE_URL=postgres://synthetic/unused npx tsx tools/qa/customer-artwork-fixture.ts
// No database, provider, payment or email operations. Pixels are test fixtures.
import express from 'express';
import { createServer } from 'node:http';
import type { Event } from '../../shared/schema';
import { encodePng } from '../../server/aiFirst/png';
import { registerCustomerArtworkRoutes } from '../../server/customerArtworkRoutes';
import { finishCustomerArtwork, type CustomerArtworkSession, type CustomerArtworkStore } from '../../server/customerArtwork';
import { setupVite } from '../../server/vite';
if (process.env.NODE_ENV === 'production' || process.env.VERCEL) throw Error('Local fixture only');
const env = { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'codex/launch-blockers', POSY_CUSTOMER_ARTWORK_GENERATION: 'true' };
let event = { id: 99002, ownerToken: 'synthetic-customer-flow', customerArtworkEnabled: true, eventName: 'Customer workflow fixture', eventType: 'Celebration',
  vibeDescription: 'Interface test only. Synthetic artwork verifies saving and revision controls; it is not a quality benchmark.',
  themeName: '', paletteColors: '[]', eventDate: 'September 23, 2026', location: '', venueName: '', estimatedGuestCount: 8,
  inviteDesignConceptJson: '{}', draftStatus: 'none', inviteStatus: 'draft' } as Event;
const rows = new Map<number, CustomerArtworkSession>();
const store: CustomerArtworkStore = {
  get: async id => structuredClone(rows.get(id)),
  create: async row => { if (!rows.has(row.eventId)) rows.set(row.eventId, structuredClone(row)); return structuredClone(rows.get(row.eventId)!); },
  compareAndSet: async (row, version) => { if (rows.get(row.eventId)?.version !== version) return false; rows.set(row.eventId, structuredClone(row)); return true; },
};
let calls = 0;
const app = express(), server = createServer(app); app.use(express.json());
registerCustomerArtworkRoutes(app, { sessions: store, env, events: {
  getEventByOwnerToken: async token => token === event.ownerToken ? event : undefined,
  updateEventById: async (_id, data) => event = { ...event, ...data },
}, unlocked: async () => false, schedule: job => { void job(); },
  finish: (id, attempt, req, repo) => finishCustomerArtwork(id, attempt, req, repo, async () => {
    calls++; await new Promise(resolve => setTimeout(resolve, 1500));
    if (attempt.correction?.includes('fail')) throw Error('Synthetic failure');
    const rgb = Buffer.alloc(512 * 768 * 3);
    for (let y = 0; y < 768; y++) for (let x = 0; x < 512; x++) {
      const inside = ((x - 256) ** 2 + (y - 384) ** 2) < (calls === 1 ? 180 : 140) ** 2;
      const c = inside ? [107, 126, 112] : [245, 238, 225];
      for (let n = 0; n < 3; n++) rgb[(y * 512 + x) * 3 + n] = c[n];
    }
    const bytes = encodePng({ width: 512, height: 768, rgb });
    return { bytes, dataUrl: 'data:image/png;base64,' + bytes.toString('base64'), durationMs: 1500 };
  }),
});
app.get('/api/checkout/config', (_req, res) => res.json({ configured: true }));
app.get('/api/events/owner/:token/master-planner/entitlement', (_req, res) => res.json({ canGenerate: false, emailCaptured: false, planTier: 'none' }));
app.get('/api/events/owner/:token', (_req, res) => res.json({ event }));
app.get('/api/fixture/status', (_req, res) => res.json({ syntheticCalls: calls, sessions: rows.size }));
app.use('/api', (_req, res) => res.status(409).json({ error: 'Local fixture: no payment, provider or email operations.' }));
await setupVite(server, app);
server.listen(4173, '0.0.0.0', () => console.log('Customer fixture at http://localhost:4173/draft-generating/synthetic-customer-flow'));

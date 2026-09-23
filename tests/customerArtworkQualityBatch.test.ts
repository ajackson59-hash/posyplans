// @vitest-environment node
/** Exercises real create/edit/keep routes with synthetic provider output only.
 * No visual scores, human approvals, browser timings or live costs are invented. */
import { afterEach, expect, it, vi } from 'vitest';
import { createHash, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import express from 'express';
import request from 'supertest';
import type { Event } from '@shared/schema';
import { encodePng } from '../server/aiFirst/png';
import { finishCustomerArtwork, type CustomerArtworkSession, type CustomerArtworkStore } from '../server/customerArtwork';
import type { ArtworkRequest } from '../server/aiFirst/artwork';
import { CUSTOMER_ARTWORK_QUALITY_CASES } from '../tools/qa/customer-artwork-quality-cases';
vi.mock('../server/storage', () => ({ storage: {}, db: {} }));
vi.mock('../server/masterPlannerEntitlement', () => ({ getEntitlementSummary: vi.fn() }));
const { registerCustomerArtworkRoutes } = await import('../server/customerArtworkRoutes');
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
afterEach(() => vi.unstubAllGlobals());

class MemoryStore implements CustomerArtworkStore {
  rows = new Map<number, CustomerArtworkSession>();
  async get(id: number) { return structuredClone(this.rows.get(id)); }
  async create(row: CustomerArtworkSession) {
    if (!this.rows.has(row.eventId)) this.rows.set(row.eventId, structuredClone(row));
    return (await this.get(row.eventId))!;
  }
  async compareAndSet(row: CustomerArtworkSession, expected: number) {
    if (this.rows.get(row.eventId)?.version !== expected) return false;
    this.rows.set(row.eventId, structuredClone(row)); return true;
  }
}

it('preserves all eight frozen briefs through two bounded customer requests, keep/revert/reload and no-spend replays', async () => {
  const network = vi.fn(async () => { throw new Error('This rehearsal forbids external requests'); });
  vi.stubGlobal('fetch', network);
  const records = [];
  for (const [index, item] of CUSTOMER_ARTWORK_QUALITY_CASES.entries()) {
    const event = { id: 99100 + index, ownerToken: `offline-batch-${index}`, customerArtworkEnabled: true,
      eventName: 'Private customer-flow quality evaluation', eventType: 'Celebration', themeName: '',
      eventDate: 'October 17, 2026', location: 'Private test venue', venueName: '', paletteColors: '[]',
      estimatedGuestCount: 6, vibeDescription: item.hostBrief, inviteStatus: 'draft', draftStatus: 'none',
    } as unknown as Event;
    const store = new MemoryStore(), scheduled: Array<() => Promise<void>> = [], inputs: ArtworkRequest[] = [];
    const generated = [120, 180].map(shade => encodePng({ width: 512, height: 768, rgb: Buffer.alloc(512 * 768 * 3, shade) }));
    const generate = vi.fn(async (input: ArtworkRequest) => {
      inputs.push(input);
      const bytes = generated[inputs.length - 1];
      if (!bytes) throw new Error('Rehearsal exceeded two requests');
      return { bytes, dataUrl: `data:image/png;base64,${bytes.toString('base64')}`, durationMs: 0 };
    });
    const env = { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'codex/launch-blockers',
      POSY_CUSTOMER_ARTWORK_GENERATION: 'true', POSY_CUSTOMER_ARTWORK_EVALUATION_LIMITS: JSON.stringify({ [event.id]: 2 }) };
    const app = express(); app.use(express.json());
    registerCustomerArtworkRoutes(app, { env, sessions: store,
      events: { getEventByOwnerToken: async token => token === event.ownerToken ? event : undefined,
        updateEventById: async () => { throw new Error('No event mutation expected'); } },
      schedule: job => scheduled.push(job), unlocked: async () => false,
      finish: (id, attempt, input, repo) => finishCustomerArtwork(id, attempt, input, repo, generate),
    });
    const path = `/api/events/owner/${event.ownerToken}`;
    expect(sha(item.hostBrief)).toBe(item.hostBriefSha256);
    expect((await request(app).post(`${path}/prepayment-preview`).send({ email: 'offline@example.com' })).status).toBe(202);
    expect(scheduled).toHaveLength(1); await scheduled.shift()!();
    let view = (await request(app).get(`${path}/artwork`)).body;
    const original = view.candidates[0];
    const choose = async (candidate: typeof original) => {
      view = (await request(app).get(`${path}/artwork`)).body;
      const chosen = await request(app).post(`${path}/artwork/select`).send({ version: view.version, briefHash: view.briefHash,
        candidateId: candidate.id, imageHash: candidate.imageHash });
      expect(chosen.status).toBe(200); view = chosen.body;
    };
    await choose(original);
    const edit = { requestKey: randomUUID(), version: view.version, briefHash: view.briefHash,
      baseCandidateId: original.id, imageHash: original.imageHash, correction: item.refinement };
    expect((await request(app).post(`${path}/artwork/revise`).send(edit)).status).toBe(202);
    expect(scheduled).toHaveLength(1); await scheduled.shift()!();
    view = (await request(app).get(`${path}/artwork`)).body;
    expect(view.selectedId).toBe(original.id); // Revision never silently replaces the kept choice.
    const edited = view.candidates[1];
    expect(inputs[0].referenceImages).toBeUndefined();
    expect(inputs[1].referenceImages![0].bytes.equals(generated[0])).toBe(true);
    for (const input of inputs) {
      expect(input.prompt).toContain(item.hostBrief);
      expect(input.prompt).toContain(event.eventDate); expect(input.prompt).toContain(event.location);
      expect(input).toMatchObject({ model: 'gpt-image-2', quality: 'medium', outputFormat: 'jpeg', maxTransientRetries: 0 });
    }
    expect(inputs[1].prompt).toContain(item.refinement);
    await choose(edited); await choose(original); await choose(edited);
    expect((await request(app).get(`${path}/artwork`)).body).toMatchObject({ selectedId: edited.id, requestsRemaining: 0, canContinue: true });
    const image = await request(app).get(edited.assetUrl);
    expect(image.status).toBe(200); expect(sha(image.body)).toBe(edited.imageHash);
    expect((await request(app).post(`${path}/artwork/revise`).send(edit)).status).toBe(202);
    expect((await request(app).post(`${path}/prepayment-preview`).send({ email: 'offline@example.com' })).status).toBe(200);
    expect((await request(app).post(`${path}/artwork/revise`).send({ ...edit, requestKey: randomUUID(), version: view.version })).status).toBe(429);
    expect(generate).toHaveBeenCalledTimes(2); expect(scheduled).toHaveLength(0);
    records.push({ ...item, liveEventId: null, status: 'offline-rehearsal-only', humanAssessment: null,
      imageQuality: null, browserDeliveryMs: null, liveProviderCalls: 0, actualCostUsd: null,
      initialPrompt: inputs[0].prompt, initialPromptSha256: sha(inputs[0].prompt),
      syntheticEditPrompt: inputs[1].prompt, syntheticEditPromptSha256: sha(inputs[1].prompt) });
  }
  expect(network).not.toHaveBeenCalled(); expect(records).toHaveLength(8);
  if (process.env.POSY_WRITE_CUSTOMER_FLOW_PREFLIGHT === '1') writeFileSync('tools/qa/CUSTOMER_ARTWORK_QUALITY_PREFLIGHT.json',
    JSON.stringify({ schemaVersion: 1, batchId: 'customer-flow-20260923', authorization: 'paid-allowance-not-yet-specified',
      scope: 'Preview only; fresh private events; no old allowances', maxCreateCalls: 8, maxEditCalls: 8,
      maxCriticCalls: 0, maxClassifierCalls: 0, proposedPlanningReserveUsd: 5, providerEnforcedDollarCap: false,
      referencePixels: 'synthetic in this rehearsal; exact retained source in a live edit', cases: records }, null, 2) + '\n');
});

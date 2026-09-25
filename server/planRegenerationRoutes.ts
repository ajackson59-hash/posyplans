import type { Express, Request, Response } from 'express';
import { waitUntil } from '@vercel/functions';
import { z } from 'zod';
import type { Event } from '@shared/schema';
import { storage } from './storage';
import { DbPlanRegenerationStore, PlanRegenerationStoreError, type PlanRegenerationStore } from './planRegenerationStore';
import { defaultPlanRegenerationProviders, planRegenerationView, runPlanRegeneration, type PlanRegenerationDeps } from './planRegeneration';

export interface PlanRegenerationRouteDeps {
  store?: PlanRegenerationStore;
  events?: Pick<typeof storage, 'getEventByOwnerToken' | 'getEmailEntitlement'>;
  providers?: PlanRegenerationDeps;
  schedule?: (job: () => Promise<void>) => void;
}

export function registerPlanRegenerationRoutes(app: Express, deps: PlanRegenerationRouteDeps = {}): void {
  const repo = deps.store ?? new DbPlanRegenerationStore();
  const events = deps.events ?? storage;
  const providers = deps.providers ?? defaultPlanRegenerationProviders;
  const schedule = deps.schedule ?? (task => {
    const job = task();
    try { waitUntil(job); } catch { void job.catch(() => {}); }
  });
  async function eligible(event: Event): Promise<boolean> {
    if (event.draftStatus !== 'ready' || !event.capturedEmail) return false;
    const entitlement = await events.getEmailEntitlement(event.capturedEmail);
    return entitlement?.planTier === 'plus_active'
      || (entitlement?.planTier === 'plus_trial' && !!entitlement.trialEndsAt && entitlement.trialEndsAt > Date.now());
  }
  async function respond(res: Response, event: Event, status = 200) {
    const [allowed, operation] = await Promise.all([eligible(event), repo.read(event.id)]);
    return res.status(status).json({ eligible: allowed,
      operation: operation ? planRegenerationView(operation, await repo.snapshot(event.id)) : null });
  }
  function owner(handler: (req: Request, res: Response, event: Event) => Promise<unknown>) {
    return async (req: Request, res: Response) => {
      res.set('Cache-Control', 'private, no-store');
      try {
        const event = await events.getEventByOwnerToken(String(req.params.ownerToken));
        if (!event) return res.status(404).json({ error: 'Event not found.' });
        return await handler(req, res, event);
      } catch (error) {
        if (error instanceof PlanRegenerationStoreError)
          return res.status(error.status).json({ error: error.message, code: error.code });
        return res.status(503).json({ error: 'We could not confirm your saved plan. Refresh to check its status before trying again.' });
      }
    };
  }
  const root = '/api/events/owner/:ownerToken/plan-regeneration';
  app.get(root, owner(async (_req, res, event) => respond(res, event)));
  app.post(root, owner(async (req, res, event) => {
    const input = z.object({ requestId: z.string().uuid() }).strict().safeParse(req.body);
    if (!input.success) return res.status(400).json({ error: 'A request ID is required to safely create a new plan.' });
    if (!await eligible(event)) return res.status(403).json({ error: 'An active Plus membership and a completed plan are required to regenerate.' });
    const claim = await repo.reserve(event.id, input.data.requestId);
    if (claim.started) schedule(() => runPlanRegeneration(claim.record, repo, providers));
    return respond(res, event, 202);
  }));
  for (const action of ['apply', 'discard'] as const) {
    app.post(`${root}/:id/${action}`, owner(async (req, res, event) => {
      const id = z.string().uuid().safeParse(req.params.id);
      if (!id.success) return res.status(400).json({ error: 'Invalid saved plan.' });
      // Applying already-generated content costs nothing and remains available
      // to its owner even if their subscription has subsequently expired.
      await repo[action](event.id, id.data);
      return respond(res, event);
    }));
  }
}

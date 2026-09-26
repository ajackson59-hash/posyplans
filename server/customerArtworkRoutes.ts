import type { Express, Request, Response, NextFunction } from 'express';
import { waitUntil } from '@vercel/functions';
import { z } from 'zod';
import type { Event } from '@shared/schema';
import { storage } from './storage';
import { getEntitlementSummary } from './masterPlannerEntitlement';
import { ownerEventView, restoreEventArtworkReferences, eventArtworkFields, storedEventArtwork } from './eventArtwork';
import { DbCustomerArtworkStore } from './customerArtworkStore';
import { streamArtwork } from './artworkResponse';
import { CustomerArtworkError, claimCustomerArtwork, currentCustomerCandidate, customerArtworkBriefHash,
  customerArtworkApplication, customerArtworkEventEnabled, customerArtworkGenerationEnabled, customerArtworkRequestLimit, customerArtworkView, emptyCustomerArtwork,
  finishCustomerArtwork, recoverCustomerArtwork, selectCustomerArtwork, selectedCustomerArtwork,
  type CustomerArtworkRequestInput, type CustomerArtworkSession, type CustomerArtworkStore } from './customerArtwork';

interface Dependencies {
  sessions?: CustomerArtworkStore; env?: NodeJS.ProcessEnv;
  events?: Pick<typeof storage, 'getEventByOwnerToken' | 'updateEventById'>;
  unlocked?: (id: number) => Promise<boolean>;
  finish?: typeof finishCustomerArtwork;
  schedule?: (task: () => Promise<void>) => void;
}
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const revisionInput = z.object({ requestKey: z.string().uuid(), version: z.number().int().min(0), briefHash: hashSchema,
  baseCandidateId: z.string().uuid(), imageHash: hashSchema, correction: z.string().trim().min(5).max(2000) }).strict();
const selectionInput = z.object({ version: z.number().int().min(0), briefHash: hashSchema,
  candidateId: z.string().uuid(), imageHash: hashSchema }).strict();

export function registerCustomerArtworkRoutes(app: Express, deps: Dependencies = {}) {
  const sessions = deps.sessions ?? new DbCustomerArtworkStore();
  const events = deps.events ?? storage;
  const env = () => deps.env ?? process.env;
  const enabled = (event: Event) => customerArtworkEventEnabled(event, env());
  const unlocked = deps.unlocked ?? (async (id: number) => !!(await getEntitlementSummary(id))?.canGenerate);
  const schedule = deps.schedule ?? (task => { const job = task(); try { waitUntil(job); } catch { void job.catch(() => {}); } });
  const current = async (event: Event) => recoverCustomerArtwork((await sessions.get(event.id)) ?? emptyCustomerArtwork(event), sessions);
  const view = (row: CustomerArtworkSession, event: Event) => customerArtworkView(row, event, env());
  const readiness = (row: CustomerArtworkSession, event: Event) => {
    const artwork = view(row, event);
    return { ready: artwork.candidates.length > 0, kind: artwork.candidates.length ? 'customer-artwork' : 'none',
      generationState: artwork.state === 'generating' ? 'generating' : artwork.candidates.length ? 'ready' : 'idle',
      pollAfterMs: artwork.state === 'generating' ? 2500 : null, checkoutAllowed: artwork.canContinue,
      customerArtwork: artwork, namedReference: null, savedBrief: artwork.savedBrief };
  };
  const privateResponse = (res: Response) => {
    res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
  };
  const owner = (handler: (req: Request, res: Response, event: Event) => Promise<unknown>, legacy = false) =>
    async (req: Request, res: Response, next: NextFunction) => {
      privateResponse(res);
      try {
        const event = await events.getEventByOwnerToken(String(req.params.ownerToken));
        if (!event || !enabled(event)) return legacy ? next() : res.status(404).json({ error: 'Artwork not found' });
        await handler(req, res, event);
      }
      catch (error) {
        if (res.headersSent) return next(error);
        if (error instanceof CustomerArtworkError) return res.status(error.status).json({ error: error.message });
        // No provider response, raw prompt, credential or image may enter logs/JSON.
        return res.status(503).json({ error: 'We could not confirm that request. Refresh to check your saved artwork before trying again.' });
      }
    };
  const dispatch = async (event: Event, row: CustomerArtworkSession, input: CustomerArtworkRequestInput) => {
    // Replayed requests are read-only, including when the spend switch was turned off.
    if (!row.attempts.some(a => a.requestKey === input.requestKey)
      && (!customerArtworkGenerationEnabled(env()) || customerArtworkRequestLimit(event, env()) === 0))
      throw new CustomerArtworkError('Artwork creation is temporarily unavailable. Your saved images are still here.', 503);
    const claim = await claimCustomerArtwork(event, row, input, sessions, env());
    if (claim.request) {
      try { schedule(() => (deps.finish ?? finishCustomerArtwork)(event.id, claim.attempt, claim.request!, sessions)); }
      catch { /* Retain the claim; timed read recovery must not dispatch it again. */ }
    }
    return claim.row;
  };

  app.get('/api/events/owner/:ownerToken/artwork', owner(async (_req, res, event) => res.json(view(await current(event), event))));
  app.get('/api/events/owner/:ownerToken/prepayment-preview/readiness', owner(async (_req, res, event) => res.json(readiness(await current(event), event)), true));
  app.post('/api/events/owner/:ownerToken/prepayment-preview', owner(async (req, res, event) => {
    const email = z.object({ email: z.string().trim().email() }).strict().safeParse(req.body);
    if (!email.success) throw new CustomerArtworkError('Enter a valid email address.', 400);
    // Email is provisional here, as in the existing paywall. This action must not
    // change ownership, send a message or overwrite Stripe's verified identity.
    let row = await sessions.create(emptyCustomerArtwork(event));
    row = await recoverCustomerArtwork(row, sessions);
    const briefHash = customerArtworkBriefHash(event);
    // Returning to the same first-look action never buys a second first image.
    if (row.attempts.some(a => a.briefHash === briefHash)) return res.json(readiness(row, event));
    row = await dispatch(event, row, { requestKey: `initial:${briefHash}`, version: row.version, briefHash });
    return res.status(202).json(readiness(row, event));
  }, true));
  app.post('/api/events/owner/:ownerToken/artwork/revise', owner(async (req, res, event) => {
    const input = revisionInput.safeParse(req.body);
    if (!input.success) throw new CustomerArtworkError('Describe the change to your saved image in 5–2,000 characters.', 400);
    const row = await dispatch(event, await current(event), input.data);
    return res.status(202).json(view(row, event));
  }));
  app.post('/api/events/owner/:ownerToken/artwork/select', owner(async (req, res, event) => {
    const input = selectionInput.safeParse(req.body);
    if (!input.success) throw new CustomerArtworkError('Open the image before keeping it.', 400);
    return res.json(view(await selectCustomerArtwork(event, await current(event), input.data, sessions), event));
  }));
  app.get('/api/events/owner/:ownerToken/artwork/candidates/:id', owner(async (req, res, event) => {
    const row = await current(event), candidate = currentCustomerCandidate(row, event, String(req.params.id));
    if (!candidate || req.query.v !== candidate.imageHash) throw new CustomerArtworkError('That image is no longer available for these details.', 404);
    return streamArtwork(res, Buffer.from(candidate.imageBase64!, 'base64'));
  }));
  app.get('/api/events/owner/:ownerToken/prepayment-preview/asset', owner(async (_req, res, event) => {
    const row = await current(event);
    const chosen = currentCustomerCandidate(row, event, row.selectedId) ?? [...row.attempts].reverse().map(a => currentCustomerCandidate(row, event, a.id)).find(Boolean);
    if (!chosen) throw new CustomerArtworkError('Your artwork is not ready yet.', 404);
    return streamArtwork(res, Buffer.from(chosen.imageBase64!, 'base64'));
  }, true));
  app.post('/api/events/owner/:ownerToken/invite/use-prepayment-preview', owner(async (req, res, event) => {
    const row = await current(event), chosen = selectedCustomerArtwork(row, event);
    if (!chosen || !view(row, event).canContinue) throw new CustomerArtworkError('Keep an image before adding it to your invitation.');
    const input = selectionInput.safeParse(req.body);
    if (!input.success || input.data.version !== row.version || input.data.candidateId !== row.selectedId
      || input.data.imageHash !== view(row, event).selectedHash || input.data.briefHash !== customerArtworkBriefHash(event))
      throw new CustomerArtworkError('Your kept image changed. Refresh before applying it.');
    if (!await unlocked(event.id)) throw new CustomerArtworkError('Unlock this event first.', 402);
    if (event.draftStatus === 'generating') throw new CustomerArtworkError('Your plan is being saved. Please wait before applying artwork.');
    const updated = await events.updateEventById(event.id, customerArtworkApplication(event, chosen));
    return res.json({ event: ownerEventView(updated), reusedExistingArtwork: true });
  }, true));
  app.post('/api/events/owner/:ownerToken/master-planner/generate', async (req, res, next) => {
    const event = await events.getEventByOwnerToken(String(req.params.ownerToken));
    if (!event || !enabled(event)) return next();
    privateResponse(res);
    try {
      if (!view(await current(event), event).canContinue) return res.status(409).json({ error: 'Keep your artwork before building your plan.' });
      return next();
    } catch { return res.status(503).json({ error: 'We could not confirm your saved artwork. Please refresh.' }); }
  });
  // The normal checkout and planner still enforce payment. These additional
  // gates ensure they receive the customer's selected current image.
  app.post('/api/checkout/create-session', async (req, res, next) => {
    const event = typeof req.body?.returnToken === 'string' && await events.getEventByOwnerToken(req.body.returnToken.trim());
    if (!event || !enabled(event)) return next();
    privateResponse(res);
    try {
      if (!view(await current(event), event).canContinue) return res.status(409).json({ error: 'Keep your artwork before continuing to checkout.' });
      return next();
    } catch { return res.status(503).json({ error: 'We could not confirm your saved artwork. Please refresh.' }); }
  });
  app.use('/api/events/owner/:ownerToken', async (req, res, next) => {
    if (!['POST', 'PATCH', 'PUT'].includes(req.method)) return next();
    const event = await events.getEventByOwnerToken(String(req.params.ownerToken));
    if (!event || !enabled(event)) return next();
    // Unrelated event/style/text edits still use their existing save paths.
    // Legacy generation and raw artwork PATCH must not bypass this budget or
    // replace the customer's selected pixels outside the saved-image flow.
    const unsafeRoute = req.path.startsWith('/ai-first') || req.path.startsWith('/prepayment-preview')
      || (req.path.startsWith('/invite/') && !['/invite/generate-tone', '/invite/suite', '/invite/live-design', '/invite/concept-palette'].includes(req.path));
    let unsafeFields = false;
    if (req.path === '/') {
      try {
        const restored = { ...event, ...restoreEventArtworkReferences(event, req.body ?? {}) };
        unsafeFields = eventArtworkFields.some(field => storedEventArtwork(restored, field) !== storedEventArtwork(event, field))
          || Object.keys(req.body ?? {}).some(k => k.startsWith('prePaymentPreview'));
      } catch { unsafeFields = true; }
    }
    if (unsafeRoute || unsafeFields) { privateResponse(res); return res.status(409).json({ error: 'Use your saved artwork controls to change this image.' }); }
    return next();
  });
}

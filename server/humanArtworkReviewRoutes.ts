import type { Express, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { waitUntil } from '@vercel/functions';
import { isDeepStrictEqual } from 'node:util';
import type { Event } from '@shared/schema';
import { storage } from './storage';
import { getEntitlementSummary } from './masterPlannerEntitlement';
import { ownerEventView } from './eventArtwork';
import { DbHumanArtworkReviewStore } from './humanArtworkReviewStore';
import { HUMAN_REVIEW_CHECKS, MAX_HUMAN_ARTWORK_CORRECTIONS, HumanArtworkCorrectionError, humanReviewEnabled, humanReviewEventEnabled, reviewerAuthorized, humanArtworkBrief, humanArtworkBriefHash,
  requestHumanArtwork, requestHumanArtworkCorrection, prepareHumanArtworkRequest, generateHumanArtwork, decideHumanArtwork, isCurrentHumanApproval,
  type HumanArtworkReview, type HumanArtworkReviewStore } from './humanArtworkReview';
import { humanArtworkReviewPage } from './humanArtworkReviewPage';

interface Dependencies {
  reviews?: HumanArtworkReviewStore; events?: Pick<typeof storage, 'getEventByOwnerToken' | 'updateEventById'>;
  env?: NodeJS.ProcessEnv; unlocked?: (id: number) => Promise<boolean>;
  generate?: typeof generateHumanArtwork; schedule?: (task: () => Promise<void>) => void;
}
const publicRow = (r: HumanArtworkReview) => ({ id: r.id, eventId: r.eventId, brief: r.brief, briefHash: r.briefHash,
  state: r.state, version: r.version, imageHash: r.imageHash, createdAt: r.createdAt, updatedAt: r.updatedAt, history: r.history,
  correctionsRemaining: Math.max(0, MAX_HUMAN_ARTWORK_CORRECTIONS - r.history.filter(h => h.action === 'correction-queued').length),
  previousCandidates: r.history.filter(h => h.action === 'correction-queued').map(h => ({ version: h.candidateVersion, imageHash: h.imageHash })) });
export function registerHumanArtworkReviewRoutes(app: Express, deps: Dependencies = {}) {
  const reviews = deps.reviews ?? new DbHumanArtworkReviewStore(), events = deps.events ?? storage;
  const env = () => deps.env ?? process.env;
  const enabled = (event: Event) => humanReviewEventEnabled(event, env());
  const unlocked = deps.unlocked ?? (async (id: number) => !!(await getEntitlementSummary(id))?.canGenerate);
  const schedule = deps.schedule ?? (task => { const job = task(); try { waitUntil(job); } catch { void job.catch(() => {}); } });
  const current = (event: Event) => reviews.current(event.id, humanArtworkBriefHash(event));
  const privateResponse = (res: Response) => { res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('Referrer-Policy', 'no-referrer'); };
  const readiness = (event: Event, row?: HumanArtworkReview) => {
    const approved = isCurrentHumanApproval(row, event);
    return { ready: approved, kind: approved ? 'approved-image' : 'none',
      generationState: approved ? 'ready' : row && ['queued','generating','review'].includes(row.state) ? 'generating' : 'idle',
      pollAfterMs: row && !approved ? 15000 : null, humanReview: true,
      reviewState: row?.state === 'queued' && row.previousCandidates?.length ? 'correction-queued' : row?.state ?? 'not-requested',
      checkoutAllowed: approved, imageGenerationEnabled: false, automaticReferenceResolutionEnabled: false,
      savedBrief: event.vibeDescription, namedReference: null, failureReason: null };
  };
  const owner = (handler: (req: Request, res: Response, event: Event) => Promise<unknown>) =>
    async (req: Request, res: Response, next: NextFunction) => {
      if (!humanReviewEnabled(env())) return next();
      const event = await events.getEventByOwnerToken(String(req.params.ownerToken));
      if (!event || !enabled(event)) return next();
      privateResponse(res); await handler(req,res,event);
    };
  const staff = (handler: (req: Request, res: Response) => Promise<unknown>) =>
    async (req: Request, res: Response) => {
      privateResponse(res);
      if (!humanReviewEnabled(env())) return res.status(404).json({ error: 'Not found' });
      if (!reviewerAuthorized(req.headers.authorization, env())) return res.status(401).json({ error: 'Reviewer access required' });
      await handler(req,res);
    };
  app.get('/artwork-review', (_req,res) => {
    privateResponse(res);
    if (!humanReviewEnabled(env())) return res.status(404).send('Not found');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    return res.type('html').send(humanArtworkReviewPage);
  });
  app.get('/api/staff/artwork-reviews', staff(async (_req,res) => {
    const rows = await reviews.list(); const visible = [];
    for (const row of rows) {
      const event = await events.getEventByOwnerToken(row.ownerToken);
      if (event && enabled(event)) visible.push({ ...publicRow(row), stale: row.briefHash !== humanArtworkBriefHash(event) });
    }
    return res.json({ reviews: visible, generationEnabled: env().POSY_HUMAN_ARTWORK_GENERATION === 'true' });
  }));
  app.get('/api/staff/artwork-reviews/:id/asset', staff(async (req,res) => {
    const row = await reviews.get(String(req.params.id));
    const event = row && await events.getEventByOwnerToken(row.ownerToken);
    if (!row?.imageBase64 || !event || !enabled(event)) return res.status(404).json({ error: 'No candidate' });
    res.setHeader('X-Content-Type-Options','nosniff'); return res.type('png').send(Buffer.from(row.imageBase64,'base64'));
  }));
  app.get('/api/staff/artwork-reviews/:id/previous/:version/asset', staff(async (req,res) => {
    const row = await reviews.get(String(req.params.id));
    const event = row && await events.getEventByOwnerToken(row.ownerToken);
    const previous = /^\d+$/.test(String(req.params.version)) && row?.previousCandidates?.find(c => c.version === Number(req.params.version));
    if (!previous || !previous.imageBase64 || !event || !enabled(event)) return res.status(404).json({ error: 'No retained candidate' });
    res.setHeader('X-Content-Type-Options','nosniff'); return res.type('png').send(Buffer.from(previous.imageBase64,'base64'));
  }));
  app.post('/api/staff/artwork-reviews/:id/correction', staff(async (req,res) => {
    const input = z.object({ version: z.number().int(), imageHash: z.string().regex(/^[a-f0-9]{64}$/),
      briefHash: z.string().regex(/^[a-f0-9]{64}$/), note: z.string().trim().min(5).max(2000) }).strict().safeParse(req.body);
    if (!input.success) return res.status(400).json({ error: 'Describe the required corrections.' });
    const row = await reviews.get(String(req.params.id)); const event = row && await events.getEventByOwnerToken(row.ownerToken);
    if (!row || !event || !enabled(event)) return res.status(404).json({ error: 'Not found' });
    try { return res.json(publicRow(await requestHumanArtworkCorrection(row,event,reviews,input.data,env().POSY_ARTWORK_REVIEWER_ID!))); }
    catch (error) { return res.status(409).json({ error: error instanceof HumanArtworkCorrectionError ? error.message : 'Unable to save the correction. Refresh before trying again.' }); }
  }));
  app.post('/api/staff/artwork-reviews/:id/generate', staff(async (req,res) => {
    if (env().POSY_HUMAN_ARTWORK_GENERATION !== 'true') return res.status(409).json({ error: 'Paid generation is not enabled for this Preview.' });
    const input = z.object({ confirmOneImage: z.literal(true), version: z.number().int(), briefHash: z.string() }).strict().safeParse(req.body);
    const row = await reviews.get(String(req.params.id)); const event = row && await events.getEventByOwnerToken(row.ownerToken);
    if (!input.success || !row || !event || !enabled(event) || row.state !== 'queued' || input.data.version !== row.version
      || input.data.briefHash !== row.briefHash || row.briefHash !== humanArtworkBriefHash(event)
      || !isDeepStrictEqual(row.brief, humanArtworkBrief(event))) return res.status(409).json({ error: 'Request changed or already claimed' });
    try { prepareHumanArtworkRequest(row); }
    catch (error) { return res.status(409).json({ error: error instanceof HumanArtworkCorrectionError ? error.message : 'Unable to verify saved artwork.' }); }
    schedule(async () => { try { await (deps.generate ?? generateHumanArtwork)(row,reviews,env().POSY_ARTWORK_REVIEWER_ID!); } catch { /* CAS loser never dispatches. */ } });
    return res.status(202).json({ state: 'queued', message: 'One generation scheduled. Refresh for its retained status.' });
  }));
  app.post('/api/staff/artwork-reviews/:id/decision', staff(async (req,res) => {
    const input = z.object({ decision: z.enum(['approved','rejected']), version: z.number().int(), imageHash: z.string().regex(/^[a-f0-9]{64}$/),
      briefHash: z.string().regex(/^[a-f0-9]{64}$/), checks: z.array(z.enum(HUMAN_REVIEW_CHECKS)), note: z.string().trim().min(5).max(2000) }).strict().safeParse(req.body);
    if (!input.success) return res.status(400).json({ error: 'Complete the review and leave a note.' });
    const row = await reviews.get(String(req.params.id)); const event = row && await events.getEventByOwnerToken(row.ownerToken);
    if (!row || !event || !enabled(event)) return res.status(404).json({ error: 'Not found' });
    try { return res.json(publicRow(await decideHumanArtwork(row,event,reviews,input.data,env().POSY_ARTWORK_REVIEWER_ID!))); }
    catch { return res.status(409).json({ error: 'Review incomplete or changed. Reload before deciding.' }); }
  }));
  app.get('/api/events/owner/:ownerToken/prepayment-preview/readiness', owner(async (_req,res,event) => res.json(readiness(event,await current(event)))));
  app.post('/api/events/owner/:ownerToken/prepayment-preview', owner(async (req,res,event) => {
    const parsed = z.object({ email: z.string().trim().email() }).strict().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Enter a valid email address.' });
    // Queueing never pays for generation, sends email, or creates an approval.
    const row = await requestHumanArtwork(event,reviews);
    await events.updateEventById(event.id,{ capturedEmail: parsed.data.email.toLowerCase() });
    return res.status(202).json(readiness(event,row));
  }));
  app.get('/api/events/owner/:ownerToken/prepayment-preview/asset', owner(async (_req,res,event) => {
    const row = await current(event);
    if (!isCurrentHumanApproval(row,event)) return res.status(404).json({ error: 'Artwork is awaiting human approval.' });
    return res.type('png').send(Buffer.from(row.imageBase64,'base64'));
  }));
  app.post('/api/events/owner/:ownerToken/invite/use-prepayment-preview', owner(async (_req,res,event) => {
    const row = await current(event);
    if (!isCurrentHumanApproval(row,event)) return res.status(409).json({ error: 'Current artwork needs human approval.' });
    if (!await unlocked(event.id)) return res.status(402).json({ error: 'Unlock this event first.' });
    const url = `data:image/png;base64,${row.imageBase64}`;
    const updated = await events.updateEventById(event.id,{ inviteArtworkUrl:url,inviteIllustrationUrl:url,customInviteImageUrl:'',inviteDesignConceptJson:'{}' });
    return res.json({ event: ownerEventView(updated), reusedExistingArtwork:true });
  }));
  app.post('/api/events/owner/:ownerToken/master-planner/generate', async (req,res,next) => {
    if (!humanReviewEnabled(env())) return next();
    const event = await events.getEventByOwnerToken(String(req.params.ownerToken));
    if (!event || !enabled(event)) return next();
    privateResponse(res);
    if (!isCurrentHumanApproval(await current(event),event)) return res.status(409).json({ error:'Current artwork needs human approval before planning.' });
    return next();
  });
  // Enforce on the server too: hiding a checkout button is not an access boundary.
  app.post('/api/checkout/create-session', async (req,res,next) => {
    if (!humanReviewEnabled(env()) || typeof req.body?.returnToken !== 'string') return next();
    const event = await events.getEventByOwnerToken(req.body.returnToken.trim());
    if (!event || !enabled(event)) return next();
    privateResponse(res);
    if (!isCurrentHumanApproval(await current(event),event)) return res.status(409).json({ code:'artwork_review_pending',error:'Your artwork needs human approval before checkout.' });
    return next();
  });
  app.use('/api/events/owner/:ownerToken', async (req,res,next) => {
    if (!humanReviewEnabled(env()) || !['POST','PATCH','PUT'].includes(req.method)) return next();
    const event = await events.getEventByOwnerToken(String(req.params.ownerToken));
    if (!event || !enabled(event)) return next();
    const unsafeRoute = req.path.startsWith('/ai-first') || req.path.startsWith('/prepayment-preview')
      || (req.path.startsWith('/invite/') && !['/invite/generate-tone','/invite/suite'].includes(req.path));
    const unsafeFields = req.path === '/' && Object.keys(req.body ?? {}).some(k => /^(inviteArtwork|inviteIllustration|customInvite|inviteDesignConcept|prePaymentPreview)/.test(k));
    if (unsafeRoute || unsafeFields) { privateResponse(res); return res.status(409).json({ error:'Artwork changes require a new human review.' }); }
    return next();
  });
}

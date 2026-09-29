import type { Express, Response } from 'express';
import { rsvpSubmitSchema } from '@shared/schema';
import { DbRetentionActivityStore, type RetentionActivityStore } from './retentionActivityStore';

function unavailable(res: Response) {
  // Do not include the exception: it may contain a query and bearer credential.
  console.error('[retention-activity] activity record unavailable; action not started');
  return res.status(503).json({ error: 'We could not save this action yet. Please try again.',
    code: 'event_activity_unavailable' });
}

/** Register before event routes. Recording happens before an action handler:
 * failure cannot turn a completed provider call into a retryable response.
 * Deploy the additive migration first. No silent fail-open tracking gap. */
export function registerRetentionActivityRoutes(app: Express, store: RetentionActivityStore = new DbRetentionActivityStore()): void {
  app.use('/api/events/owner/:ownerToken', async (req, res, next) => {
    if (!['POST','PATCH','DELETE'].includes(req.method) || req.path === '/activity') return next();
    res.set('Cache-Control', 'private, no-store');
    try {
      if (!await store.recordOwner(String(req.params.ownerToken), 'host_action'))
        return res.status(404).json({ error: 'Event not found.' });
      return next();
    } catch { return unavailable(res); }
  });

  app.post('/api/events/owner/:ownerToken/activity', async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    // Client timestamps and retention controls are never accepted.
    if (req.body && Object.keys(req.body).length) return res.status(400).json({ error: 'Invalid activity request.' });
    try {
      if (!await store.recordOwner(String(req.params.ownerToken), 'host_visit'))
        return res.status(404).json({ error: 'Event not found.' });
      return res.status(204).end();
    } catch { return unavailable(res); }
  });

  app.post('/api/events/public/:shareSlug/guest/:guestToken/rsvp', async (req, res, next) => {
    // Invalid or unverified public requests must not keep an event alive.
    if (!rsvpSubmitSchema.safeParse(req.body).success) return next();
    try {
      await store.recordGuest(String(req.params.shareSlug), String(req.params.guestToken));
      return next(); // Existing route owns authorization, validation and response.
    } catch { return unavailable(res); }
  });
}

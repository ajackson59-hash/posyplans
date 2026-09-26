import type { Express, Request, Response } from 'express';
import { createHmac, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { waitUntil } from '@vercel/functions';
import { z } from 'zod';
import type { Event } from '@shared/schema';
import { getEmailConfiguration, sendPlusLinkCodeEmail } from './email';
import { getEventPlusAccess, hasActivePlusMembership, type PlusMembershipAccess } from './plusMembership';
import { plusMembershipProofResolver, type PlusMembershipProofResolver } from './plusMembershipProof';
import { DbPlusLinkStore, type PlusLinkChallenge } from './plusLinkStore';

const DURATION = 10 * 60_000;
const RESEND_WAIT = 60_000;
const requestInput = z.object({ email: z.string().trim().email().max(254), requestKey: z.string().uuid() }).strict();
const confirmInput = z.object({ challengeId: z.string().uuid(), code: z.string().regex(/^\d{8}$/),
  saveRecoveryEmail: z.boolean().optional() }).strict();
const MESSAGE = 'If an active Plus membership uses this billing email, a code is on its way. Enter it here to connect this event. You do not need to purchase again.';
const INVALID = 'We could not verify that code. Check the latest email or request a new code after the wait shown. Your event is unchanged.';

export interface PlusLinkDependencies {
  store?: Pick<DbPlusLinkStore, 'reserve' | 'prepareDelivery' | 'markDelivery' | 'readLatest' | 'beginVerification' | 'finishVerification' | 'abortVerification'>;
  event?: (ownerToken: string) => Promise<Event | undefined>;
  access?: (eventId: number) => Promise<PlusMembershipAccess | undefined>;
  proof?: PlusMembershipProofResolver;
  send?: typeof sendPlusLinkCodeEmail;
  configured?: () => boolean;
  env?: () => NodeJS.ProcessEnv;
  now?: () => number;
  schedule?: (job: () => Promise<void>) => void;
}

export function plusLinkEnabled(env: NodeJS.ProcessEnv) {
  return env.VERCEL_ENV === 'preview' && env.VERCEL_GIT_COMMIT_REF === 'codex/launch-blockers';
}
function key(env: NodeJS.ProcessEnv): Buffer {
  const secret = env.STRIPE_SECRET_KEY?.trim();
  if (!secret || secret.length < 16) throw Error('Verification unavailable');
  // A separate cryptographic domain avoids introducing another launch secret.
  // Stripe-key rotation safely invalidates outstanding short-lived codes.
  return createHmac('sha256', secret).update('posy-plus-link:v1').digest();
}
function digest(secret: Buffer, fields: unknown[]): string {
  return createHmac('sha256', secret).update(JSON.stringify(fields)).digest('hex');
}
export function plusLinkCodeHash(secret: Buffer, row: Pick<PlusLinkChallenge, 'id' | 'eventId' | 'recipient' | 'subscriptionId' | 'customerId'>, code: string): string {
  return digest(secret, ['code', row.id, row.eventId, row.recipient, row.subscriptionId, row.customerId, code]);
}
function equalHash(actual: string | null, expected: string): boolean {
  return !!actual && /^[a-f0-9]{64}$/.test(actual) && timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
}
function privateResponse(res: Response) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}
function browserRequestAllowed(req: Request, env: NodeJS.ProcessEnv): boolean {
  if (!req.is('application/json') || req.get('sec-fetch-site') === 'cross-site') return false;
  const origin = req.get('origin');
  if (!origin) return true; // Same bearer-authorized API also supports direct clients.
  try {
    const source = new URL(origin);
    if (source.origin !== origin || source.username || source.password) return false;
    const configuredOrigins = [env.PUBLIC_APP_ORIGIN, env.VERCEL_URL && `https://${env.VERCEL_URL}`,
      env.VERCEL_BRANCH_URL && `https://${env.VERCEL_BRANCH_URL}`].filter((value): value is string => !!value);
    return configuredOrigins.some(value => {
      try {
        const trusted = new URL(value);
        return trusted.protocol === 'https:' && !trusted.username && !trusted.password && trusted.origin === source.origin;
      } catch { return false; }
    });
  }
  catch { return false; }
}
function clientIp(req: Request, env: NodeJS.ProcessEnv): string {
  // Vercel supplies this header; raw caller X-Forwarded-For is never used.
  const platformIp = env.VERCEL === '1' ? req.get('x-vercel-forwarded-for')?.trim() : undefined;
  return platformIp && isIP(platformIp) ? platformIp : req.socket.remoteAddress || 'unknown';
}

/** A code grants only one explicit target-event binding. No login session,
 * contact overwrite, purchase, analytics or planner dispatch is performed.
 * An explicit opt-in may fill an empty recovery email with the proven inbox. */
export function registerPlusLinkRoutes(app: Express, dependencies: PlusLinkDependencies = {}) {
  const repo = dependencies.store ?? new DbPlusLinkStore();
  const resolveEvent = dependencies.event ?? (async owner => (await import('./storage')).storage.getEventByOwnerToken(owner));
  const access = dependencies.access ?? getEventPlusAccess;
  const proof = dependencies.proof ?? plusMembershipProofResolver;
  const send = dependencies.send ?? sendPlusLinkCodeEmail;
  const env = dependencies.env ?? (() => process.env);
  const now = dependencies.now ?? Date.now;
  const configured = dependencies.configured ?? (() => getEmailConfiguration().productionSenderConfigured
    && !!env().STRIPE_PRICE_ID_ANNUAL && !!env().STRIPE_PRICE_ID_MONTHLY);
  const schedule = dependencies.schedule ?? (job => {
    const task = job();
    try { waitUntil(task); } catch { void task.catch(() => {}); }
  });
  const available = () => {
    if (!plusLinkEnabled(env()) || !configured()) return false;
    try { key(env()); return true; } catch { return false; }
  };
  const path = '/api/events/owner/:ownerToken/plus-link';
  const owner = async (req: Request, res: Response) => {
    privateResponse(res);
    const event = await resolveEvent(String(req.params.ownerToken));
    if (!event) res.status(404).json({ error: 'Event not found.' });
    return event;
  };

  app.get(path, async (req, res) => {
    try {
      const event = await owner(req, res);
      if (!event) return;
      if (!available()) return res.json({ enabled: false, linked: false });
      const [membership, challenge] = await Promise.all([access(event.id), repo.readLatest(event.id, now())]);
      return res.json({ enabled: true, linked: hasActivePlusMembership(membership, now()),
        ...(challenge ? { challenge: { id: challenge.id, expiresAt: challenge.expiresAt, resendAt: challenge.resendAt } } : {}) });
    } catch { return res.status(503).json({ error: 'Plus verification is temporarily unavailable. Your event is saved.' }); }
  });

  app.post(`${path}/request`, async (req, res) => {
    privateResponse(res);
    if (!browserRequestAllowed(req, env())) return res.status(403).json({ error: 'Open this event in Posy to verify access.' });
    const parsed = requestInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Enter a valid billing email address.' });
    if (!available()) return res.status(503).json({ error: 'Plus verification is temporarily unavailable. Your event is saved.' });
    try {
      const event = await owner(req, res);
      if (!event) return;
      const timestamp = now(), secret = key(env());
      const recipient = parsed.data.email.toLowerCase();
      const id = randomUUID();
      const proposal = { id, eventId: event.id, requestKey: parsed.data.requestKey, recipient,
        recipientHash: digest(secret, ['recipient', recipient]), ipHash: digest(secret, ['ip', clientIp(req, env())]),
        now: timestamp, expiresAt: timestamp + DURATION, resendAt: timestamp + RESEND_WAIT };
      const reservation = await repo.reserve(proposal);
      const response = reservation?.challenge ?? proposal;
      res.status(202).json({ ok: true, challengeId: response.id, expiresAt: response.expiresAt,
        resendAt: response.resendAt, message: MESSAGE });
      if (!reservation?.created) return;
      schedule(async () => {
        try {
          const verified = await proof.resolve(parsed.data.email);
          if (!verified || now() >= proposal.expiresAt) {
            await repo.markDelivery(id, false, now()); return;
          }
          const code = String(randomInt(0, 100_000_000)).padStart(8, '0');
          const claim = { id, eventId: event.id, recipient, subscriptionId: verified.subscriptionId, customerId: verified.customerId };
          if (!await repo.prepareDelivery(id, verified, plusLinkCodeHash(secret, claim, code), now())) return;
          const delivery = await send({ to: recipient, code, challengeId: id });
          await repo.markDelivery(id, delivery.ok && !!delivery.providerId, now());
        } catch {
          // No retry on uncertain delivery. A new explicit request is bounded
          // by the same durable event, recipient, IP and global limits.
          try { await repo.markDelivery(id, false, now()); } catch { /* Pending state still cannot authorize. */ }
          console.warn('[plus-link] Verification preparation did not complete.');
        }
      });
    } catch {
      if (!res.headersSent) return res.status(503).json({ error: 'Plus verification is temporarily unavailable. Your event is saved.' });
    }
  });

  app.post(`${path}/confirm`, async (req, res) => {
    privateResponse(res);
    if (!browserRequestAllowed(req, env())) return res.status(403).json({ error: 'Open this event in Posy to verify access.' });
    const parsed = confirmInput.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: INVALID });
    if (!available()) return res.status(503).json({ error: 'Plus verification is temporarily unavailable. Your event is saved.' });
    let executionId: string | undefined;
    try {
      const event = await owner(req, res);
      if (!event) return;
      const secret = key(env());
      executionId = randomUUID();
      const verification = await repo.beginVerification({ eventId: event.id, id: parsed.data.challengeId },
        row => equalHash(row.codeHash, plusLinkCodeHash(secret, row, parsed.data.code)), executionId, now());
      if (verification.kind === 'invalid') return res.status(400).json({ error: INVALID });
      if (verification.kind === 'consumed') {
        const membership = await access(event.id);
        return membership?.subscriptionId === verification.challenge.subscriptionId && hasActivePlusMembership(membership, now())
          ? res.json({ ok: true, linked: true }) : res.status(400).json({ error: INVALID });
      }
      const row = verification.challenge;
      const verified = row.subscriptionId && row.customerId
        ? await proof.refresh(row.subscriptionId, row.customerId, row.recipient) : undefined;
      if (!verified || !await repo.finishVerification(row.id, event.id, executionId, verified, now(), parsed.data.saveRecoveryEmail === true)) {
        await repo.abortVerification(row.id, executionId);
        return res.status(400).json({ error: INVALID });
      }
      return res.json({ ok: true, linked: true });
    } catch {
      if (executionId) {
        try { await repo.abortVerification(parsed.data.challengeId, executionId); } catch { /* Fail closed. */ }
      }
      return res.status(503).json({ error: 'We could not confirm Plus access. Check the saved status before requesting another code.' });
    }
  });
}

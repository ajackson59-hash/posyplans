import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import type { db } from './storage';
import type { PlusMembershipProof } from './plusMembershipProof';
import { hasActivePlusMembership } from './plusMembership';

export interface PlusLinkChallenge {
  id: string; eventId: number; requestKey: string; recipient: string; recipientHash: string;
  codeHash: string | null; subscriptionId: string | null; customerId: string | null;
  state: 'pending' | 'sending' | 'sent' | 'verifying' | 'consumed' | 'failed' | 'superseded';
  attempts: number; createdAt: number; expiresAt: number; resendAt: number; executionId: string | null;
}
export type Challenge = PlusLinkChallenge;
export interface ReservePlusLink {
  id: string; eventId: number; requestKey: string; recipient: string; recipientHash: string;
  ipHash: string; now: number; expiresAt: number; resendAt: number;
}
type Row = Record<string, unknown>;
type Executor = Pick<typeof db, 'execute'>;
const uuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const digest = (v: string) => /^[a-f0-9]{64}$/.test(v);
const epoch = (v: number) => Number.isSafeInteger(v) && v >= 0;
const key = (v: string) => createHash('sha256').update(`posy-plus-link:${v}`).digest('hex');
const challenge = (r: Row): PlusLinkChallenge => ({ id: String(r.id), eventId: Number(r.event_id),
  requestKey: String(r.request_key), recipient: String(r.recipient), recipientHash: String(r.recipient_hash),
  codeHash: r.code_hash === null ? null : String(r.code_hash), subscriptionId: r.subscription_id === null ? null : String(r.subscription_id),
  customerId: r.customer_id === null ? null : String(r.customer_id), state: r.state as PlusLinkChallenge['state'],
  attempts: Number(r.attempts), createdAt: Number(r.created_at), expiresAt: Number(r.expires_at),
  resendAt: Number(r.resend_at), executionId: r.execution_id === null ? null : String(r.execution_id) });
function validProof(proof: PlusMembershipProof, now: number) {
  return /^sub_[A-Za-z0-9_]+$/.test(proof.subscriptionId) && /^cus_[A-Za-z0-9_]+$/.test(proof.customerId)
    && epoch(proof.subscriptionCreatedAt) && epoch(proof.observedAt) && proof.observedAt <= now
    && ['monthly','annual'].includes(proof.billingInterval) && hasActivePlusMembership(proof, now);
}
class RejectedVerification extends Error {}

/** Provider calls never run inside these transactions. Issuance is serialized
 * by a stable global advisory lock. Binding takes subscription, event, challenge locks in
 * the same order as settled checkout; it never replaces another subscription. */
export class DbPlusLinkStore {
  constructor(private readonly database?: Pick<typeof db, 'execute' | 'transaction'>,
    private readonly clock?: () => number) {}
  private async connection() { return this.database ?? (await import('./storage')).db; }
  private async currentTime(connection: Executor, supplied: number): Promise<number> {
    if (this.clock) return Math.max(supplied, this.clock());
    // clock_timestamp advances while a transaction waits on a lock; now() does
    // not. Explicit clock injection is reserved for deterministic local tests.
    const [row] = await connection.execute(sql`select floor(extract(epoch from clock_timestamp()) * 1000)::bigint as now`);
    return Math.max(supplied, Number(row.now));
  }

  async reserve(input: ReservePlusLink): Promise<{ challenge: PlusLinkChallenge; created: boolean } | undefined> {
    if (!uuid(input.id) || !uuid(input.requestKey) || !Number.isSafeInteger(input.eventId) || input.eventId < 1
      || !digest(input.recipientHash) || !digest(input.ipHash) || !epoch(input.now) || !epoch(input.expiresAt)
      || !epoch(input.resendAt) || input.expiresAt <= input.now || input.resendAt < input.now + 60_000
      || input.recipient !== input.recipient.trim().toLowerCase() || input.recipient.length > 320
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.recipient)) return undefined;
    const scopes = [ ['global', key('global'), 60], ['event', key(`event:${input.eventId}`), 3],
      ['recipient', input.recipientHash, 3], ['ip', input.ipHash, 12] ] as const;
    return (await this.connection()).transaction(async tx => {
      // Cooldowns span hour boundaries. Lock the issuance namespace itself,
      // rather than relying only on the changing hourly bucket's row lock.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('posy-plus-link-issuance'),1)`);
      const found = await tx.execute(sql`select id from public.events where id=${input.eventId} for update`);
      if (!found.length) return undefined;
      const currentTime = await this.currentTime(tx, input.now);
      const bucket = Math.floor(currentTime / 3_600_000) * 3_600_000;
      // Exact request-key replays return before evaluating or consuming
      // issuance limits; the global namespace serializes every hourly bucket.
      await tx.execute(sql`insert into public.plus_link_rate_buckets(scope,key_hash,bucket_start)
        values('global',${scopes[0][1]},${bucket}) on conflict do nothing`);
      await tx.execute(sql`select count from public.plus_link_rate_buckets
        where scope='global' and key_hash=${scopes[0][1]} and bucket_start=${bucket} for update`);
      const replay = await tx.execute(sql`select * from public.plus_link_challenges
        where event_id=${input.eventId} and request_key=${input.requestKey}::uuid`);
      if (replay[0]) return { challenge: challenge(replay[0]), created: false };
      if (input.expiresAt <= currentTime) return undefined;
      const cooling = await tx.execute(sql`select id from public.plus_link_challenges
        where (event_id=${input.eventId} or recipient_hash=${input.recipientHash}) and resend_at>${currentTime} limit 1`);
      if (cooling.length) return undefined;
      for (const [scope, hash, limit] of scopes) {
        await tx.execute(sql`insert into public.plus_link_rate_buckets(scope,key_hash,bucket_start)
          values(${scope},${hash},${bucket}) on conflict do nothing`);
        const [row] = await tx.execute(sql`select count from public.plus_link_rate_buckets
          where scope=${scope} and key_hash=${hash} and bucket_start=${bucket} for update`);
        if (Number(row.count) >= limit) return undefined;
      }
      for (const [scope, hash] of scopes) await tx.execute(sql`update public.plus_link_rate_buckets set count=count+1
        where scope=${scope} and key_hash=${hash} and bucket_start=${bucket}`);
      await tx.execute(sql`update public.plus_link_challenges set state='superseded'
        where event_id=${input.eventId} and state not in ('consumed','superseded')`);
      const [created] = await tx.execute(sql`insert into public.plus_link_challenges
        (id,event_id,request_key,recipient,recipient_hash,created_at,expires_at,resend_at)
        values(${input.id}::uuid,${input.eventId},${input.requestKey}::uuid,${input.recipient},${input.recipientHash},
          ${currentTime},${input.expiresAt},${Math.max(input.resendAt, currentTime + 60_000)}) returning *`);
      return { challenge: challenge(created), created: true };
    });
  }

  async prepareDelivery(id: string, proof: PlusMembershipProof, codeHash: string, now: number): Promise<boolean> {
    if (!uuid(id) || !digest(codeHash)) return false;
    return (await this.connection()).transaction(async tx => {
      await tx.execute(sql`select id from public.plus_link_challenges where id=${id}::uuid for update`);
      const currentTime = await this.currentTime(tx, now);
      if (!validProof(proof, currentTime)) return false;
      const rows = await tx.execute(sql`update public.plus_link_challenges
        set state='sending',code_hash=${codeHash},subscription_id=${proof.subscriptionId},customer_id=${proof.customerId}
        where id=${id}::uuid and state='pending' and expires_at>${currentTime} and recipient=${proof.billingEmail.trim().toLowerCase()} returning id`);
      return rows.length === 1;
    });
  }
  async markDelivery(id: string, accepted: boolean, now: number): Promise<void> {
    if (!uuid(id)) return;
    await (await this.connection()).execute(sql`update public.plus_link_challenges set state=${accepted ? 'sent' : 'failed'}
      where id=${id}::uuid and (state='sending' or (state='pending' and ${!accepted})) and expires_at>${now}`);
  }
  async readLatest(eventId: number, now: number): Promise<PlusLinkChallenge | undefined> {
    const [row] = await (await this.connection()).execute(sql`select * from public.plus_link_challenges
      where event_id=${eventId} and state not in ('consumed','superseded') and expires_at>${now}
      order by created_at desc,id desc limit 1`);
    return row ? challenge(row) : undefined;
  }
  async beginVerification(input: { eventId: number; id: string }, verify: (row: PlusLinkChallenge) => boolean,
    executionId: string, now: number): Promise<{ kind: 'claimed' | 'consumed'; challenge: PlusLinkChallenge } | { kind: 'invalid' }> {
    if (!uuid(input.id) || !uuid(executionId)) return { kind: 'invalid' };
    return (await this.connection()).transaction(async tx => {
      const [row] = await tx.execute(sql`select * from public.plus_link_challenges where id=${input.id}::uuid
        and event_id=${input.eventId} for update`);
      if (!row) return { kind: 'invalid' };
      const current = challenge(row);
      const currentTime = await this.currentTime(tx, now);
      if (current.state === 'superseded' || current.expiresAt <= currentTime || current.attempts >= 5) return { kind: 'invalid' };
      await tx.execute(sql`update public.plus_link_challenges set attempts=attempts+1 where id=${input.id}::uuid`);
      let matches = false;
      try { matches = verify(current); } catch { /* Malformed comparisons still consume a guess. */ }
      // Wrong guesses must not reveal delivery state or poison a worker that
      // already owns verification. Consumed replay still requires the code.
      if (current.state === 'consumed') return matches
        ? { kind: 'consumed', challenge: { ...current, attempts: current.attempts + 1 } } : { kind: 'invalid' };
      if (current.state === 'verifying') return { kind: 'invalid' };
      const claimed = matches && current.state === 'sent';
      const [updated] = await tx.execute(sql`update public.plus_link_challenges set
        state=${claimed ? 'verifying' : current.attempts === 4 ? 'failed' : current.state},
        execution_id=${claimed ? executionId : null}::uuid where id=${input.id}::uuid returning *`);
      return claimed ? { kind: 'claimed', challenge: challenge(updated) } : { kind: 'invalid' };
    });
  }
  async abortVerification(id: string, executionId: string): Promise<void> {
    if (!uuid(id) || !uuid(executionId)) return;
    await (await this.connection()).execute(sql`update public.plus_link_challenges set state='failed'
      where id=${id}::uuid and state='verifying' and execution_id=${executionId}::uuid`);
  }
  async finishVerification(id: string, eventId: number, executionId: string, proof: PlusMembershipProof, now: number,
    saveRecoveryEmail = false): Promise<boolean> {
    if (!uuid(id) || !uuid(executionId) || !validProof(proof, Math.max(now, proof.observedAt))) {
      await this.abortVerification(id, executionId); return false;
    }
    return (await this.connection()).transaction(async outer => {
      try {
        // The savepoint rolls back every membership/binding change on a rejected
        // proof, while the outer transaction can commit the failed challenge.
        return await outer.transaction(async tx => {
          await tx.execute(sql`insert into public.plus_memberships
            (subscription_id,customer_id,plan_tier,trial_ends_at,billing_interval,subscription_created_at,observed_at)
            values(${proof.subscriptionId},${proof.customerId},${proof.planTier},${proof.trialEndsAt},${proof.billingInterval},
              ${proof.subscriptionCreatedAt},${proof.observedAt}) on conflict(subscription_id) do nothing`);
          const [membership] = await tx.execute(sql`select * from public.plus_memberships
            where subscription_id=${proof.subscriptionId} for update`);
          const found = await tx.execute(sql`select id from public.events where id=${eventId} for update`);
          const [stored] = await tx.execute(sql`select * from public.plus_link_challenges
            where id=${id}::uuid and event_id=${eventId} for update`);
          const currentTime = await this.currentTime(tx, now);
          if (!found.length || !stored) throw new RejectedVerification();
          const current = challenge(stored);
          if (!validProof(proof, currentTime) || current.state !== 'verifying' || current.executionId !== executionId || current.expiresAt <= currentTime
            || current.subscriptionId !== proof.subscriptionId || current.customerId !== proof.customerId
            || current.recipient !== proof.billingEmail.trim().toLowerCase()
            || membership.customer_id !== proof.customerId
            || (membership.subscription_created_at !== null && Number(membership.subscription_created_at) !== proof.subscriptionCreatedAt))
            throw new RejectedVerification();
          if (Number(membership.observed_at) < proof.observedAt) await tx.execute(sql`update public.plus_memberships
            set plan_tier=${proof.planTier},trial_ends_at=${proof.trialEndsAt},billing_interval=${proof.billingInterval},
              subscription_created_at=${proof.subscriptionCreatedAt},observed_at=${proof.observedAt}
            where subscription_id=${proof.subscriptionId}`);
          const [latest] = await tx.execute(sql`select plan_tier,trial_ends_at from public.plus_memberships where subscription_id=${proof.subscriptionId}`);
          if (!hasActivePlusMembership({ subscriptionId: proof.subscriptionId, customerId: proof.customerId,
            planTier: latest.plan_tier as 'plus_active' | 'plus_trial' | 'plus_expired',
            trialEndsAt: latest.trial_ends_at === null ? null : Number(latest.trial_ends_at), billingInterval: proof.billingInterval }, currentTime))
            throw new RejectedVerification();
          const [binding] = await tx.execute(sql`select subscription_id from public.event_plus_memberships where event_id=${eventId}`);
          if (binding && binding.subscription_id !== proof.subscriptionId) throw new RejectedVerification();
          await tx.execute(sql`insert into public.event_plus_memberships(event_id,subscription_id,bound_at,source,source_id)
            values(${eventId},${proof.subscriptionId},${currentTime},'email_verification',${id}) on conflict(event_id) do nothing`);
          // Consent is supplied explicitly by the confirm request. Ownership of
          // this inbox is already proven; a different saved contact is retained.
          if (saveRecoveryEmail) await tx.execute(sql`update public.events set captured_email=${current.recipient}
            where id=${eventId} and (captured_email is null or trim(captured_email)='')`);
          await tx.execute(sql`update public.plus_link_challenges set state='consumed' where id=${id}::uuid`);
          return true;
        });
      } catch (error) {
        if (!(error instanceof RejectedVerification)) throw error;
        await outer.execute(sql`update public.plus_link_challenges set state='failed'
          where id=${id}::uuid and event_id=${eventId} and state='verifying' and execution_id=${executionId}::uuid`);
        return false;
      }
    });
  }
}

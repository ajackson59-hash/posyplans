import { sql } from 'drizzle-orm';
import { db } from './storage';
import type { ArtworkRequest } from './aiFirst/artwork';
import type { CustomerArtworkAttempt, CustomerArtworkSession } from './customerArtwork';
import { ImageSpendGuardError, imageSpendDispatchEnabled, imageSpendFingerprint, imageSpendPolicyId, imageSpendUuid, productionImageConcurrency } from './imageSpendGuard';

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Policy = { paused: boolean; request_limit: number; create_limit: number; edit_limit: number;
  requests_reserved: number; creates_reserved: number; edits_reserved: number };

/** Short database transactions only. Provider work happens after commit. All
 * writers take policy then session locks in that order. No automatic refunds,
 * expiring reservations, environment-derived budget resets or client grants. */
export class DbImageSpendStore {
  constructor(private readonly database: Pick<typeof db, 'transaction' | 'execute'> = db,
    private readonly env: NodeJS.ProcessEnv = process.env) {}

  private get policyId() {
    const id = imageSpendPolicyId(this.env);
    if (!id) throw new ImageSpendGuardError('blocked');
    return id;
  }
  private capacity(eventId?: number, operation?: 'create' | 'edit', excluding?: string) {
    const id = this.policyId;
    if (this.env.VERCEL_ENV === 'production') {
      // Production never inherits a Preview moderation/billing continuation.
      // Unknown outcomes retain their charge and stop new work. Concurrent,
      // known in-flight requests are bounded separately from the lifetime cap.
      return sql`not exists(select 1 from public.image_spend_requests where policy_id=${id} and state='unknown')
        and (select count(*) from public.image_spend_requests where policy_id=${id}
          and state in ('reserved','dispatched')
          and (${excluding ?? null}::uuid is null or id<>${excluding ?? null}::uuid)) < ${productionImageConcurrency(this.env)}`;
    }
    return sql`not exists(select 1 from public.image_spend_requests where policy_id=${id}
      and (${excluding ?? null}::uuid is null or id<>${excluding ?? null}::uuid)
      and (state in ('reserved','dispatched') or (state='unknown' and not
        public.image_spend_unknown_continuable(id,${eventId ?? null},${operation ?? null},${!!excluding}))))`;
  }

  private async policy(tx: Transaction): Promise<Policy> {
    const [row] = await tx.execute(sql`select * from public.image_spend_policies where id=${this.policyId} for update`);
    if (!row) throw new ImageSpendGuardError('blocked');
    return row as unknown as Policy;
  }
  private async unresolved(tx: Transaction, eventId?: number, operation?: 'create' | 'edit', excluding?: string) {
    const [row] = await tx.execute(sql`select ${this.capacity(eventId, operation, excluding)} as available`);
    return row?.available !== true;
  }
  async available(eventId?: number): Promise<boolean> {
    if (!imageSpendDispatchEnabled(this.env)) return false;
    try {
      const [row] = await this.database.execute(sql`select not paused and requests_reserved < request_limit
        and (creates_reserved < create_limit or edits_reserved < edit_limit)
        and ${this.capacity(eventId)} as available
        from public.image_spend_policies where id=${this.policyId}`);
      return row?.available === true;
    } catch { return false; } // Missing migration/connectivity cannot enable spending.
  }
  async reserve(row: CustomerArtworkSession, expected: number, attempt: CustomerArtworkAttempt, request: ArtworkRequest): Promise<boolean> {
    if (!imageSpendDispatchEnabled(this.env) || request.maxTransientRetries !== 0 || request.imageSpendPermit !== attempt.id) throw new ImageSpendGuardError('blocked');
    return this.database.transaction(async tx => {
      const policy = await this.policy(tx);
      if (policy.paused || policy.requests_reserved >= policy.request_limit || await this.unresolved(tx, row.eventId, attempt.operation)
        || (attempt.operation === 'create' ? policy.creates_reserved >= policy.create_limit : policy.edits_reserved >= policy.edit_limit))
        throw new ImageSpendGuardError('blocked');
      const changed = await tx.execute(sql`update public.customer_artwork_sessions set version=${row.version},payload=${JSON.stringify(row)}::jsonb
        where event_id=${row.eventId} and version=${expected} returning event_id`);
      if (!changed.length) return false;
      await tx.execute(sql`insert into public.image_spend_requests(id,policy_id,event_id,operation,model,fingerprint,state)
        values(${attempt.id}::uuid,${this.policyId},${row.eventId},${attempt.operation},${request.model ?? 'gpt-image-2'},${imageSpendFingerprint(request)},'reserved')`);
      await tx.execute(sql`update public.image_spend_policies set requests_reserved=requests_reserved+1,
        creates_reserved=creates_reserved+${attempt.operation === 'create' ? 1 : 0},
        edits_reserved=edits_reserved+${attempt.operation === 'edit' ? 1 : 0},updated_at=now() where id=${this.policyId}`);
      return true;
    });
  }
  async claimDispatch(request: ArtworkRequest): Promise<void> {
    if (!imageSpendDispatchEnabled(this.env) || request.maxTransientRetries !== 0 || !imageSpendUuid(request.imageSpendPermit)
      || !imageSpendUuid(request.imageSpendExecution)) throw new ImageSpendGuardError('blocked');
    await this.database.transaction(async tx => {
      const policy = await this.policy(tx);
      const [permit] = await tx.execute(sql`select * from public.image_spend_requests where id=${request.imageSpendPermit}::uuid
        and policy_id=${this.policyId} for update`);
      if (!permit) throw new ImageSpendGuardError('blocked');
      if (permit.state !== 'reserved') throw new ImageSpendGuardError('duplicate');
      if (policy.paused || permit.fingerprint !== imageSpendFingerprint(request)
        || permit.model !== (request.model ?? 'gpt-image-2')) throw new ImageSpendGuardError('blocked');
      if (await this.unresolved(tx, permit.event_id == null ? undefined : Number(permit.event_id), permit.operation as 'create' | 'edit', request.imageSpendPermit))
        throw new ImageSpendGuardError('blocked');
      await tx.execute(sql`update public.image_spend_requests set state='dispatched',dispatched_at=now(),execution_id=${request.imageSpendExecution}::uuid
        where id=${request.imageSpendPermit}::uuid`);
    });
  }
  async finish(eventId: number, finished: CustomerArtworkAttempt, executionId: string): Promise<void> {
    await this.database.transaction(async tx => {
      await this.policy(tx);
      const [permit] = await tx.execute(sql`select * from public.image_spend_requests
        where id=${finished.id}::uuid and policy_id=${this.policyId} and event_id=${eventId} for update`);
      if (!permit || !['reserved','dispatched'].includes(String(permit.state))) return;
      // Even a loser whose authorization timed out must not poison a live
      // winner. Only the worker that committed dispatch owns its outcome.
      if (permit.state === 'dispatched' && permit.execution_id !== executionId) return;
      const [stored] = await tx.execute(sql`select payload from public.customer_artwork_sessions where event_id=${eventId} for update`);
      const latest = stored?.payload as CustomerArtworkSession | undefined;
      if (!latest || !latest.attempts.some(a => a.id === finished.id && ['running','interrupted'].includes(a.status))) return;
      const usage = finished.telemetry?.responseUsage;
      const known = permit.state === 'dispatched' && finished.providerCalls === 1 && !!usage
        && [usage.inputTokens, usage.outputTokens, usage.textInputTokens, usage.imageInputTokens].every(n => Number.isSafeInteger(n) && n >= 0)
        && usage.outputTokens > 0;
      const noDispatch = permit.state === 'reserved' && finished.providerCalls === 0;
      const state = known ? 'completed' : noDispatch ? 'blocked' : 'unknown';
      const next = { ...latest, version: latest.version + 1,
        attempts: latest.attempts.map(a => a.id === finished.id ? finished : a) };
      await tx.execute(sql`update public.customer_artwork_sessions set version=${next.version},payload=${JSON.stringify(next)}::jsonb
        where event_id=${eventId}`);
      await tx.execute(sql`update public.image_spend_requests set state=${state},completed_at=now(),
        provider_calls=${finished.providerCalls},usage=${known ? JSON.stringify(usage) : null}::jsonb where id=${finished.id}::uuid`);
      if (!known || finished.status !== 'ready') await tx.execute(sql`update public.image_spend_policies set paused=true,
        stop_reason=${noDispatch ? 'dispatch_blocked' : known ? 'image_failed' : 'provider_billing_unknown'},updated_at=now() where id=${this.policyId}`);
    });
  }
}

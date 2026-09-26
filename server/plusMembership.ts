import { sql } from 'drizzle-orm';
import type { db } from './storage';

export interface PlusMembershipAccess {
  subscriptionId: string;
  customerId: string;
  planTier: 'plus_active' | 'plus_trial' | 'plus_expired';
  trialEndsAt: number | null;
  billingInterval: string | null;
}

export interface PlusMembershipReconciliation extends PlusMembershipAccess {
  subscriptionCreatedAt: number;
  observedAt: number;
  eventId?: number;
  source: 'checkout' | 'subscription';
  sourceId: string;
}

export function hasActivePlusMembership(access: PlusMembershipAccess | undefined, now = Date.now()): boolean {
  return access?.planTier === 'plus_active'
    || (access?.planTier === 'plus_trial' && !!access.trialEndsAt && access.trialEndsAt > now);
}

type MembershipRow = {
  subscription_id: string; customer_id: string; plan_tier: PlusMembershipAccess['planTier'];
  trial_ends_at: number | string | null; billing_interval: string | null;
  subscription_created_at: number | string | null; observed_at: number | string;
};
function access(row: MembershipRow): PlusMembershipAccess {
  return { subscriptionId: row.subscription_id, customerId: row.customer_id, planTier: row.plan_tier,
    trialEndsAt: row.trial_ends_at === null ? null : Number(row.trial_ends_at), billingInterval: row.billing_interval };
}

/** Membership authority is private and keyed by the exact Stripe subscription.
 * A contact address, even one present in email_entitlements, is never authority.
 * This store deliberately has no method accepting an email or client token. */
export class DbPlusMembershipStore {
  constructor(private readonly database?: Pick<typeof db, 'execute' | 'transaction'>) {}

  private async connection() { return this.database ?? (await import('./storage')).db; }

  async getEventAccess(eventId: number): Promise<PlusMembershipAccess | undefined> {
    const rows = await (await this.connection()).execute<MembershipRow>(sql`
      select m.* from public.event_plus_memberships b
      join public.plus_memberships m on m.subscription_id = b.subscription_id
      where b.event_id = ${eventId}`);
    return rows[0] ? access(rows[0]) : undefined;
  }

  /** Call only after server-side Stripe retrieval and settled-payment checks.
   * Status updates and the original-event binding commit together. Older
   * observations cannot revive a canceled membership; an old subscription's
   * webhook cannot overwrite an event bound to a newer purchase. */
  async reconcile(input: PlusMembershipReconciliation): Promise<void> {
    if (!/^sub_[A-Za-z0-9_]+$/.test(input.subscriptionId) || !/^cus_[A-Za-z0-9_]+$/.test(input.customerId)
      || !['plus_active', 'plus_trial', 'plus_expired'].includes(input.planTier)
      || !['checkout', 'subscription'].includes(input.source) || !input.sourceId
      || !Number.isSafeInteger(input.subscriptionCreatedAt) || input.subscriptionCreatedAt < 0
      || !Number.isSafeInteger(input.observedAt) || input.observedAt < 0
      || (input.eventId !== undefined && (!Number.isSafeInteger(input.eventId) || input.eventId < 1))) {
      throw new Error('Invalid trusted Plus settlement.');
    }
    await (await this.connection()).transaction(async tx => {
      await tx.execute(sql`insert into public.plus_memberships
        (subscription_id, customer_id, plan_tier, trial_ends_at, billing_interval, subscription_created_at, observed_at)
        values (${input.subscriptionId}, ${input.customerId}, ${input.planTier}, ${input.trialEndsAt},
          ${input.billingInterval}, ${input.subscriptionCreatedAt}, ${input.observedAt})
        on conflict (subscription_id) do update set
          plan_tier = excluded.plan_tier, trial_ends_at = excluded.trial_ends_at,
          billing_interval = excluded.billing_interval, observed_at = excluded.observed_at,
          subscription_created_at = excluded.subscription_created_at
        where plus_memberships.customer_id = excluded.customer_id
          and (plus_memberships.subscription_created_at is null
            or plus_memberships.subscription_created_at = excluded.subscription_created_at)
          and (plus_memberships.observed_at < excluded.observed_at
            or (plus_memberships.observed_at = excluded.observed_at and excluded.plan_tier = 'plus_expired'))`);
      const rows = await tx.execute<MembershipRow>(sql`
        select * from public.plus_memberships where subscription_id = ${input.subscriptionId} for update`);
      const current = rows[0];
      if (!current || current.customer_id !== input.customerId
        || (current.subscription_created_at !== null && Number(current.subscription_created_at) !== input.subscriptionCreatedAt)) {
        throw new Error('Plus subscription identity changed.');
      }
      if (input.eventId === undefined || !hasActivePlusMembership(access(current))) return;
      const event = await tx.execute(sql`select id from public.events where id = ${input.eventId} for update`);
      if (!event.length) throw new Error('The purchased event could not be found.');
      const prior = await tx.execute<{ subscription_id: string; subscription_created_at: string | number | null }>(sql`
        select b.subscription_id, m.subscription_created_at from public.event_plus_memberships b
        join public.plus_memberships m on m.subscription_id = b.subscription_id where b.event_id = ${input.eventId}`);
      if (prior[0]?.subscription_id === input.subscriptionId) return;
      // Historical evidence can prove an original binding without recording
      // Stripe's creation timestamp. Do not guess its ordering against another
      // purchase; a trusted reconciliation of that exact subscription fills it.
      if (prior[0] && (prior[0].subscription_created_at === null
        || Number(prior[0].subscription_created_at) >= input.subscriptionCreatedAt)) return;
      await tx.execute(sql`insert into public.event_plus_memberships
        (event_id, subscription_id, bound_at, source, source_id)
        values (${input.eventId}, ${input.subscriptionId}, ${input.observedAt}, ${input.source}, ${input.sourceId})
        on conflict (event_id) do update set subscription_id = excluded.subscription_id,
          bound_at = excluded.bound_at, source = excluded.source, source_id = excluded.source_id`);
    });
  }
}

export const getEventPlusAccess = (eventId: number) => new DbPlusMembershipStore().getEventAccess(eventId);
export const reconcilePlusMembership = (input: PlusMembershipReconciliation) => new DbPlusMembershipStore().reconcile(input);

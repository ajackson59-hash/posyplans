import { sql } from 'drizzle-orm';
import type { criticalDb } from './criticalDb';

export interface RetentionActivityStore {
  recordOwner(ownerToken: string, kind: 'host_visit' | 'host_action'): Promise<boolean>;
  recordGuest(shareSlug: string, guestToken: string): Promise<boolean>;
}

/** Only explicit request entry points call this store. Ordinary reads, provider
 * work and settlement webhooks must remain free of retention side effects. */
export class DbRetentionActivityStore implements RetentionActivityStore {
  constructor(private readonly database?: Pick<typeof criticalDb, 'execute'>) {}
  private async connection() { return this.database ?? (await import('./criticalDb')).criticalDb; }

  async recordOwner(ownerToken: string, kind: 'host_visit' | 'host_action'): Promise<boolean> {
    const rows = await (await this.connection()).execute(sql`
      insert into public.event_retention_activity(event_id,last_activity_at,first_recorded_at,last_activity_kind)
      select id, statement_timestamp(), statement_timestamp(), ${kind}
      from public.events where owner_token = ${ownerToken}
      on conflict (event_id) do update set
        last_activity_at = greatest(event_retention_activity.last_activity_at, excluded.last_activity_at),
        last_activity_kind = case when excluded.last_activity_at >= event_retention_activity.last_activity_at
          then excluded.last_activity_kind else event_retention_activity.last_activity_kind end
      returning event_id`);
    return rows.length === 1;
  }

  async recordGuest(shareSlug: string, guestToken: string): Promise<boolean> {
    const rows = await (await this.connection()).execute(sql`
      insert into public.event_retention_activity(event_id,last_activity_at,first_recorded_at,last_activity_kind)
      select e.id, statement_timestamp(), statement_timestamp(), 'guest_rsvp'
      from public.events e join public.guests g on g.event_id = e.id
      where e.share_slug = ${shareSlug} and e.invite_status <> 'draft' and g.access_token = ${guestToken}
      on conflict (event_id) do update set
        last_activity_at = greatest(event_retention_activity.last_activity_at, excluded.last_activity_at),
        last_activity_kind = case when excluded.last_activity_at >= event_retention_activity.last_activity_at
          then excluded.last_activity_kind else event_retention_activity.last_activity_kind end
      returning event_id`);
    return rows.length === 1;
  }
}

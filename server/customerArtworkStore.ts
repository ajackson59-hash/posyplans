import { sql } from 'drizzle-orm';
import { db } from './storage';
import type { CustomerArtworkSession, CustomerArtworkStore } from './customerArtwork';

/** One durable lifetime budget per event, not per brief or browser session. */
export class DbCustomerArtworkStore implements CustomerArtworkStore {
  async get(eventId: number) {
    const rows = await db.execute(sql`select payload from public.customer_artwork_sessions where event_id=${eventId}`);
    return rows[0]?.payload as CustomerArtworkSession | undefined;
  }
  async create(row: CustomerArtworkSession) {
    await db.execute(sql`insert into public.customer_artwork_sessions(event_id,version,payload)
      values(${row.eventId},${row.version},${JSON.stringify(row)}::jsonb) on conflict(event_id) do nothing`);
    return (await this.get(row.eventId))!;
  }
  async compareAndSet(row: CustomerArtworkSession, expected: number) {
    const rows = await db.execute(sql`update public.customer_artwork_sessions set version=${row.version},payload=${JSON.stringify(row)}::jsonb
      where event_id=${row.eventId} and version=${expected} returning event_id`);
    return rows.length === 1;
  }
}

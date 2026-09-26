import { sql } from 'drizzle-orm';
import { db } from './storage';
import type { CustomerArtworkSession, CustomerArtworkStore, CustomerArtworkAttempt } from './customerArtwork';
import type { ArtworkRequest } from './aiFirst/artwork';
import { imageSpendGuardEnabled } from './imageSpendGuard';
import { DbImageSpendStore } from './imageSpendStore';

/** One durable lifetime budget per event, not per brief or browser session. */
export class DbCustomerArtworkStore implements CustomerArtworkStore {
  constructor(private readonly database: typeof db = db, private readonly env: () => NodeJS.ProcessEnv = () => process.env) {}
  async get(eventId: number) {
    const rows = await this.database.execute(sql`select payload from public.customer_artwork_sessions where event_id=${eventId}`);
    return rows[0]?.payload as CustomerArtworkSession | undefined;
  }
  async create(row: CustomerArtworkSession) {
    await this.database.execute(sql`insert into public.customer_artwork_sessions(event_id,version,payload)
      values(${row.eventId},${row.version},${JSON.stringify(row)}::jsonb) on conflict(event_id) do nothing`);
    return (await this.get(row.eventId))!;
  }
  async compareAndSet(row: CustomerArtworkSession, expected: number) {
    const rows = await this.database.execute(sql`update public.customer_artwork_sessions set version=${row.version},payload=${JSON.stringify(row)}::jsonb
      where event_id=${row.eventId} and version=${expected} returning event_id`);
    return rows.length === 1;
  }
  async spendingAvailable(eventId?: number) {
    return !imageSpendGuardEnabled(this.env()) || new DbImageSpendStore(this.database).available(eventId);
  }
  async reserveRequest(row: CustomerArtworkSession, expected: number, attempt: CustomerArtworkAttempt, request: ArtworkRequest) {
    return imageSpendGuardEnabled(this.env())
      ? new DbImageSpendStore(this.database).reserve(row, expected, attempt, request)
      : this.compareAndSet(row, expected);
  }
  async finishRequest(eventId: number, attempt: CustomerArtworkAttempt, executionId: string): Promise<'handled' | 'unmanaged'> {
    if (!imageSpendGuardEnabled(this.env())) return 'unmanaged';
    await new DbImageSpendStore(this.database).finish(eventId, attempt, executionId);
    return 'handled';
  }
}

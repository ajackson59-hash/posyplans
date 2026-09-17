import { sql } from 'drizzle-orm';
import { db } from './storage';
import type { HumanArtworkReview, HumanArtworkReviewStore } from './humanArtworkReview';

/** Private server-only table. Optimistic versions and unique brief keys prevent double dispatch/approval. */
export class DbHumanArtworkReviewStore implements HumanArtworkReviewStore {
  async create(row: HumanArtworkReview) {
    await db.execute(sql`insert into public.human_artwork_reviews(id,event_id,brief_hash,state,version,payload)
      values(${row.id},${row.eventId},${row.briefHash},${row.state},${row.version},${JSON.stringify(row)}::jsonb)
      on conflict (event_id,brief_hash) do nothing`);
    return (await this.current(row.eventId, row.briefHash))!;
  }
  async get(id: string) {
    const rows = await db.execute(sql`select payload from public.human_artwork_reviews where id=${id}`);
    return rows[0]?.payload as HumanArtworkReview | undefined;
  }
  async current(eventId: number, briefHash: string) {
    const rows = await db.execute(sql`select payload from public.human_artwork_reviews where event_id=${eventId} and brief_hash=${briefHash}`);
    return rows[0]?.payload as HumanArtworkReview | undefined;
  }
  async list() {
    const rows = await db.execute(sql`select payload - 'sourceBase64' - 'imageBase64' - 'generation' as payload from public.human_artwork_reviews
      order by case when state in ('queued','generating','review') then 0 else 1 end, created_at asc limit 100`);
    return rows.map(r => r.payload as HumanArtworkReview);
  }
  async compareAndSet(row: HumanArtworkReview, expected: number) {
    const rows = await db.execute(sql`update public.human_artwork_reviews set state=${row.state},version=${row.version},payload=${JSON.stringify(row)}::jsonb
      where id=${row.id} and event_id=${row.eventId} and brief_hash=${row.briefHash} and version=${expected} returning id`);
    return rows.length === 1;
  }
}

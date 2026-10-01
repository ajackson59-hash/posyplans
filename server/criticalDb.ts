import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is not set. Add the Supabase pooled connection string to your environment.");
}

/**
 * Small, latency-sensitive entry routes use one connection per warm Vercel
 * function. The general application client remains unchanged, but Start
 * Planning and Find My Event no longer create a default multi-connection pool
 * merely to insert or read a few metadata columns.
 *
 * Supabase's transaction pooler does not support prepared statements, so
 * prepare stays disabled. Short connection/idle limits prevent a stalled cold
 * start from occupying a pooled connection indefinitely.
 */
const criticalSql = postgres(process.env.DATABASE_URL, {
  prepare: false,
  max: 1,
  connect_timeout: 10,
  idle_timeout: 20,
  max_lifetime: 300,
});

export const criticalDb = drizzle(criticalSql);

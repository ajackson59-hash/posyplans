// One-off script to apply the Phase 1 Master Planner schema deltas directly
// via SQL, bypassing drizzle-kit push's interactive rename-detection prompt
// (which requires a TTY not available in this environment). Idempotent —
// safe to run more than once.
import Database from "better-sqlite3";

const sqlite = new Database("data.db");
sqlite.pragma("journal_mode = WAL");

function columnExists(table, column) {
  const rows = sqlite.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some((r) => r.name === column);
}

function addColumnIfMissing(table, column, ddl) {
  if (columnExists(table, column)) {
    console.log(`  skip: ${table}.${column} already exists`);
    return;
  }
  sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  console.log(`  added: ${table}.${column}`);
}

console.log("Applying events table deltas...");
addColumnIfMissing("events", "estimated_guest_count", "estimated_guest_count integer");
addColumnIfMissing("events", "budget_ceiling", "budget_ceiling integer");
addColumnIfMissing("events", "vibe_description", "vibe_description text NOT NULL DEFAULT ''");
addColumnIfMissing("events", "event_identity", "event_identity text NOT NULL DEFAULT ''");
addColumnIfMissing("events", "draft_status", "draft_status text NOT NULL DEFAULT 'none'");
addColumnIfMissing("events", "draft_stage", "draft_stage text");
addColumnIfMissing("events", "captured_email", "captured_email text");
addColumnIfMissing("events", "email_captured_at", "email_captured_at integer");

console.log("Creating master_planner_generations table if missing...");
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS master_planner_generations (
    id integer PRIMARY KEY AUTOINCREMENT,
    event_id integer NOT NULL,
    attempt_number integer NOT NULL DEFAULT 1,
    kind text NOT NULL DEFAULT 'free_first_draft',
    state text NOT NULL DEFAULT 'reserved',
    reserved_at integer,
    consumed_at integer,
    failed_at integer,
    completed_stages text NOT NULL DEFAULT '[]',
    failed_stage text
  )
`);

console.log("Creating email_entitlements table if missing...");
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS email_entitlements (
    id integer PRIMARY KEY AUTOINCREMENT,
    email text NOT NULL UNIQUE,
    plan_tier text NOT NULL DEFAULT 'spark',
    trial_started_at integer,
    trial_ends_at integer,
    stripe_customer_id text,
    stripe_subscription_id text,
    additional_drafts_used integer NOT NULL DEFAULT 0,
    created_at integer NOT NULL,
    updated_at integer NOT NULL
  )
`);

console.log("Done.");
sqlite.close();

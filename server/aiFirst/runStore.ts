// Durable generation-run state.
//
// This is the fix for two of the confirmed defects together, because they
// were really one defect wearing two faces: "active generation" protection
// and "idempotency for a given run id" were both a `Map<number, number>` (or
// `Map<string, LedgerEntry>`) living in one server process's memory. That is
// correct exactly as long as there is exactly one process and it never
// restarts — false on Vercel, where every invocation can land on a different
// instance, and false locally the moment a client retries after a dropped
// connection.
//
// The fix is a row per run, claimed with TWO independent atomic constraints
// (see shared/schema.ts and migrations/0001_reliability_repair_run_authority.sql
// for the real DB DDL, not comments):
//
//   1. A unique index on runId. "Duplicate click, same run id" and
//      "duplicate request reaching a second server instance, same run id"
//      are the same code path: both are a second attempt to claim a row
//      that already exists.
//
//   2. A PARTIAL unique index on (eventId) WHERE status = 'active' AND
//      terminal = false. This is what closes the gap a prior pass of this
//      repair left open: two instances racing with DIFFERENT run ids for
//      the SAME event both pass a naive `hasActiveRun` check followed by an
//      unconditional `claim`, because neither runId collides with the
//      other's. Only a second, independent constraint on eventId — not on
//      runId — makes "this event already has a non-terminal active run" a
//      fact the store itself refuses to duplicate, regardless of which run
//      id either request used. claim() reports that case as
//      "active-elsewhere", distinct from "duplicate" (same run id).
//
// A run's lifecycle is: claim() (active) -> zero or more progress()/
// fallback() calls -> exactly one of complete() or fail(), which sets
// `terminal: true`. `terminal` is what the client-side EOF check in
// aiFirstSession.ts is really asking the server to have recorded: if the
// stream ends and the row is not terminal, the run did not finish and must
// be reported as a failure, never treated as success by omission. It is
// also what frees the per-event slot: once a run is terminal, the partial
// index above no longer counts it, so a genuinely new run can be claimed.

export type RunStatus = "active" | "completed" | "failed";

/** Safely exceeds Vercel's 120-second function ceiling without permanent locks. */
export const RUN_LEASE_MS = 5 * 60 * 1000;
export const RUN_LEASE_EXPIRED_ERROR = "lease-expired";

export interface GenerationRunRecord {
  runId: string;
  eventId: number;
  ownerToken: string;
  status: RunStatus;
  progressMessage: string;
  completedCount: number;
  fallbackCount: number;
  errorMessage: string | null;
  terminal: boolean;
  createdAt: number;
  updatedAt: number;
}

export type ClaimResult =
  | { outcome: "claimed"; record: GenerationRunRecord }
  /** Another request already holds (or finished) this exact run id. */
  | { outcome: "duplicate"; record: GenerationRunRecord }
  /**
   * This event already has a different, non-terminal run active. The
   * requested runId was never created — there is no row for it, so callers
   * must not treat `record` as "their" run, only as the reason they were
   * refused.
   */
  | { outcome: "active-elsewhere"; record: GenerationRunRecord };

export interface AiFirstRunStore {
  /** Atomically creates the run row, or reports why it could not. */
  claim(input: { runId: string; eventId: number; ownerToken: string; now?: number }): Promise<ClaimResult>;
  get(runId: string): Promise<GenerationRunRecord | undefined>;
  updateProgress(runId: string, message: string, now?: number): Promise<void>;
  incrementCompleted(runId: string, by?: number, now?: number): Promise<void>;
  incrementFallback(runId: string, by?: number, now?: number): Promise<void>;
  complete(runId: string, now?: number): Promise<void>;
  fail(runId: string, errorMessage: string, now?: number): Promise<void>;
  /** True when this event already has a run claimed and not yet terminal. */
  hasActiveRun(eventId: number, now?: number): Promise<boolean>;
}

/**
 * In-memory implementation. Used by tests, and it is deliberately built to
 * model BOTH database constraints claim() depends on, not just the runId
 * one: `claim()` here does a synchronous, single-turn scan for an existing
 * row with the same runId (models the runId unique index) and, failing
 * that, for any OTHER non-terminal active row on the same event (models the
 * partial unique index on eventId). Because there is no `await` between
 * those checks and the `Map.set` that follows, this is atomic within one
 * process the same way the two real unique indexes are atomic across many —
 * a test against this store exercises the identical decision the database
 * makes, not a simplification of it.
 */
export class InMemoryRunStore implements AiFirstRunStore {
  private rows = new Map<string, GenerationRunRecord>();

  private expireStaleForEvent(eventId: number, now: number): void {
    for (const row of Array.from(this.rows.values())) {
      if (
        row.eventId === eventId &&
        row.status === "active" &&
        !row.terminal &&
        row.updatedAt < now - RUN_LEASE_MS
      ) {
        row.status = "failed";
        row.terminal = true;
        row.errorMessage = RUN_LEASE_EXPIRED_ERROR;
        row.updatedAt = now;
      }
    }
  }

  async claim(input: { runId: string; eventId: number; ownerToken: string; now?: number }): Promise<ClaimResult> {
    const now = input.now ?? Date.now();
    this.expireStaleForEvent(input.eventId, now);

    // Constraint 1: the runId unique index.
    const existingSameRun = this.rows.get(input.runId);
    if (existingSameRun) return { outcome: "duplicate", record: { ...existingSameRun } };

    // Constraint 2: the partial unique index on eventId WHERE active AND
    // not terminal. Checked before the write, in the same synchronous pass,
    // so nothing can interleave between this check and the `rows.set` below
    // — the in-memory analogue of both constraints being enforced by one
    // database transaction's index checks.
    for (const row of Array.from(this.rows.values())) {
      if (row.eventId === input.eventId && row.status === "active" && !row.terminal) {
        return { outcome: "active-elsewhere", record: { ...row } };
      }
    }

    const record: GenerationRunRecord = {
      runId: input.runId,
      eventId: input.eventId,
      ownerToken: input.ownerToken,
      status: "active",
      progressMessage: "",
      completedCount: 0,
      fallbackCount: 0,
      errorMessage: null,
      terminal: false,
      createdAt: now,
      updatedAt: now,
    };
    this.rows.set(input.runId, record);
    return { outcome: "claimed", record: { ...record } };
  }

  async get(runId: string): Promise<GenerationRunRecord | undefined> {
    const row = this.rows.get(runId);
    return row ? { ...row } : undefined;
  }

  async updateProgress(runId: string, message: string, now = Date.now()): Promise<void> {
    const row = this.rows.get(runId);
    if (!row) return;
    row.progressMessage = message;
    row.updatedAt = now;
  }

  async incrementCompleted(runId: string, by = 1, now = Date.now()): Promise<void> {
    const row = this.rows.get(runId);
    if (!row) return;
    row.completedCount += by;
    row.updatedAt = now;
  }

  async incrementFallback(runId: string, by = 1, now = Date.now()): Promise<void> {
    const row = this.rows.get(runId);
    if (!row) return;
    row.fallbackCount += by;
    row.updatedAt = now;
  }

  async complete(runId: string, now = Date.now()): Promise<void> {
    const row = this.rows.get(runId);
    if (!row) return;
    row.status = "completed";
    row.terminal = true;
    row.updatedAt = now;
  }

  async fail(runId: string, errorMessage: string, now = Date.now()): Promise<void> {
    const row = this.rows.get(runId);
    if (!row) return;
    row.status = "failed";
    row.errorMessage = errorMessage;
    row.terminal = true;
    row.updatedAt = now;
  }

  async hasActiveRun(eventId: number, now = Date.now()): Promise<boolean> {
    this.expireStaleForEvent(eventId, now);
    for (const row of Array.from(this.rows.values())) {
      if (row.eventId === eventId && row.status === "active" && !row.terminal) return true;
    }
    return false;
  }

  get all(): GenerationRunRecord[] {
    return Array.from(this.rows.values()).map((r) => ({ ...r }));
  }
}

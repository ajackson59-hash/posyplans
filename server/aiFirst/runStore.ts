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
// The fix is a row per run, written with a unique constraint on `runId`. The
// client mints `runId` once per logical run (a fresh generate click, not a
// fresh HTTP retry of the same click) and sends it on every request for that
// run. "Duplicate click, same run id" and "duplicate request reaching a
// second server instance" become the same code path: both are a second
// attempt to claim a row that already exists, so the guard is a single
// atomic write — `claim()` — rather than a check-then-act race that two
// instances can both pass.
//
// A run's lifecycle is: claim() (active) -> zero or more progress()/
// fallback() calls -> exactly one of complete() or fail(), which sets
// `terminal: true`. `terminal` is what the client-side EOF check in
// aiFirstSession.ts is really asking the server to have recorded: if the
// stream ends and the row is not terminal, the run did not finish and must
// be reported as a failure, never treated as success by omission.

export type RunStatus = "active" | "completed" | "failed";

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
  | { outcome: "duplicate"; record: GenerationRunRecord };

export interface AiFirstRunStore {
  /** Atomically creates the run row, or returns the existing one. */
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
 * In-memory implementation. Used by tests, and it is deliberately built the
 * same way the DB-backed one is (claim-or-return, keyed by runId) so a test
 * against this store exercises the same race-closing logic the DB unique
 * constraint provides — a Map's `has`-then-`set` is atomic in a single
 * event-loop turn, which is the in-process analogue of a DB unique index.
 */
export class InMemoryRunStore implements AiFirstRunStore {
  private rows = new Map<string, GenerationRunRecord>();

  async claim(input: { runId: string; eventId: number; ownerToken: string; now?: number }): Promise<ClaimResult> {
    const now = input.now ?? Date.now();
    const existing = this.rows.get(input.runId);
    if (existing) return { outcome: "duplicate", record: { ...existing } };
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
    // The write itself: one Map.set, no await between the `has` check above
    // and this, so no other call on this process can interleave.
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
    for (const row of Array.from(this.rows.values())) {
      if (row.eventId === eventId && row.status === "active" && !row.terminal) return true;
    }
    void now;
    return false;
  }

  get all(): GenerationRunRecord[] {
    return Array.from(this.rows.values()).map((r) => ({ ...r }));
  }
}

// Cost controls. The distinction these tests defend is between *money* and
// *host intent*: an automatic retry is billed but is not something the host
// did, and reuse or apply are things the host did that cost nothing. Getting
// that wrong is how a ceiling starts blocking people who are not spending.

import { beforeEach, describe, expect, it } from "vitest";
import {
  CircuitBreaker,
  BREAKER_COOLDOWN_MS,
  BREAKER_FAILURE_THRESHOLD,
  InMemoryUsageStore,
  MAX_ARTWORK_CONCURRENCY,
  MAX_CONCURRENT_GENERATIONS_PER_EVENT,
  RATE_LIMITS,
  RateLimiter,
  ceilingsForTier,
  guardGeneration,
  monthStart,
  onAnomaly,
  tierLabel,
} from "../server/aiFirst/usage";

const usage = (over: Partial<{ eventBilled: number; monthlyBilled: number; activeGenerations: number }> = {}) => ({
  eventBilled: 0,
  monthlyBilled: 0,
  activeGenerations: 0,
  ...over,
});

const guard = (input: Partial<Parameters<typeof guardGeneration>[0]> = {}) =>
  guardGeneration({
    eventId: 1,
    email: "host@example.com",
    tier: "spark" as never,
    usage: usage(),
    requested: 8,
    killSwitch: false,
    ...input,
  });

describe("entitlements", () => {
  it("uses the live Spark and Plus ceilings", () => {
    expect(ceilingsForTier("spark" as never)).toEqual({ eventSoft: 12, eventHard: 12, monthlySoft: 12, monthlyHard: 12 });
    expect(ceilingsForTier("plus_active" as never)).toEqual({
      eventSoft: 24,
      eventHard: 40,
      monthlySoft: 48,
      monthlyHard: 80,
    });
    expect(ceilingsForTier("plus_trial" as never)).toEqual(ceilingsForTier("plus_active" as never));
  });

  it("never says Free", () => {
    for (const tier of [undefined, "", "free", "spark", "plus_trial", "plus_active", "nonsense"]) {
      expect(tierLabel(tier as never)).not.toBe("Free");
      expect(["Spark", "Plus"]).toContain(tierLabel(tier as never));
    }
  });
});

describe("ceilings", () => {
  it("stops a Spark event at 12 billed images", () => {
    expect(guard({ usage: usage({ eventBilled: 11 }) }).allowed).toBe(true);
    const denied = guard({ usage: usage({ eventBilled: 12 }) });
    expect(denied.allowed).toBe(false);
    expect(denied.denial).toBe("event-ceiling");
  });

  it("warns a Plus event past 24 and stops it at 40", () => {
    const soft = guard({ tier: "plus_active" as never, usage: usage({ eventBilled: 25 }) });
    expect(soft.allowed).toBe(true);
    expect(soft.warnings.length).toBeGreaterThan(0);

    const hard = guard({ tier: "plus_active" as never, usage: usage({ eventBilled: 40 }) });
    expect(hard.allowed).toBe(false);
    expect(hard.denial).toBe("event-ceiling");
  });

  it("stops a Plus month at 80", () => {
    const denied = guard({ tier: "plus_active" as never, usage: usage({ monthlyBilled: 80 }) });
    expect(denied.allowed).toBe(false);
    expect(denied.denial).toBe("monthly-ceiling");
  });

  it("tells the host their existing directions are still usable", () => {
    const denied = guard({ usage: usage({ eventBilled: 12 }) });
    expect(denied.message.toLowerCase()).toContain("already");
  });

  it("never mentions credits", () => {
    const messages = [
      guard({ usage: usage({ eventBilled: 12 }) }).message,
      guard({ killSwitch: true }).message,
      guard({ usage: usage({ activeGenerations: 2 }) }).message,
    ];
    for (const message of messages) expect(message.toLowerCase()).not.toContain("credit");
  });
});

describe("guard precedence", () => {
  it("puts the kill switch above everything, including a support override", () => {
    const result = guard({ killSwitch: true, supportOverride: { by: "support", reason: "vip" } });
    expect(result.allowed).toBe(false);
    expect(result.denial).toBe("kill-switch");
  });

  it("lets a logged support override past a hard ceiling", () => {
    const seen: string[] = [];
    const off = onAnomaly((a) => seen.push(a.kind));
    const result = guard({ usage: usage({ eventBilled: 999 }), supportOverride: { by: "support", reason: "goodwill" } });
    off();
    expect(result.allowed).toBe(true);
    expect(seen).toContain("support-override");
  });

  it("caps concurrent generations per event at two", () => {
    expect(MAX_CONCURRENT_GENERATIONS_PER_EVENT).toBe(2);
    const result = guard({ usage: usage({ activeGenerations: 2 }) });
    expect(result.allowed).toBe(false);
    expect(result.denial).toBe("concurrency");
  });

  it("rate limits before any spend", () => {
    const limiter = new RateLimiter();
    let last = guard({ limiter });
    for (let i = 1; i < RATE_LIMITS.event.limit + 2; i += 1) last = guard({ limiter });
    expect(last.allowed).toBe(false);
    expect(last.denial).toBe("rate-limited");
  });

  it("opens the circuit after repeated provider failures and probes after the cooldown", () => {
    const opened = Date.now();
    const breaker = new CircuitBreaker();
    for (let i = 0; i < BREAKER_FAILURE_THRESHOLD; i += 1) breaker.recordFailure(opened);
    expect(breaker.stateAt(opened)).toBe("open");
    expect(breaker.allows(opened)).toBe(false);
    expect(guard({ breaker }).denial).toBe("circuit-open");

    // One probe gets through once the cooldown has elapsed.
    const later = opened + BREAKER_COOLDOWN_MS + 1;
    expect(breaker.allows(later)).toBe(true);
    expect(breaker.stateAt(later)).toBe("half-open");

    breaker.recordSuccess();
    expect(breaker.stateAt(later)).toBe("closed");
  });
});

describe("ledger", () => {
  let store: InMemoryUsageStore;
  beforeEach(() => {
    store = new InMemoryUsageStore();
  });

  const entry = (over: Record<string, unknown> = {}) => ({
    eventId: 1,
    email: "host@example.com",
    reason: "initial" as const,
    billed: true,
    automatic: false,
    costUsdMicros: 40_000,
    createdAt: Date.now(),
    ...over,
  });

  it("counts billed images but not reuse or apply", async () => {
    await store.record(entry());
    await store.record(entry({ reason: "quality-retry", automatic: true }));
    await store.record(entry({ reason: "reuse", billed: false, costUsdMicros: 0 }));
    await store.record(entry({ reason: "apply", billed: false, costUsdMicros: 0 }));

    const snapshot = await store.snapshot(1, "host@example.com", monthStart());
    expect(snapshot.eventBilled).toBe(2);
    expect(snapshot.monthlyBilled).toBe(2);
  });

  it("records an automatic retry as spend that is not a host action", async () => {
    await store.record(entry({ reason: "quality-retry", automatic: true }));
    const [row] = store.all;
    expect(row.billed).toBe(true);
    expect(row.automatic).toBe(true);
  });

  it("keeps a reused preview usable after the ceiling is reached", async () => {
    for (let i = 0; i < 12; i += 1) await store.record(entry());
    const snapshot = await store.snapshot(1, "host@example.com", monthStart());
    expect(guard({ usage: snapshot }).allowed).toBe(false);
    // Reuse and apply are not billed, so they never consult the guard.
    await store.record(entry({ reason: "reuse", billed: false, costUsdMicros: 0 }));
    const after = await store.snapshot(1, "host@example.com", monthStart());
    expect(after.eventBilled).toBe(12);
  });

  it("finds an entry by its idempotency key", async () => {
    await store.record(entry({ idempotencyKey: "run-1-direction-0" }));
    expect(await store.findByIdempotencyKey("run-1-direction-0")).toBeDefined();
    expect(await store.findByIdempotencyKey("nope")).toBeUndefined();
  });
});

it("holds artwork concurrency at two", () => {
  expect(MAX_ARTWORK_CONCURRENCY).toBe(2);
});

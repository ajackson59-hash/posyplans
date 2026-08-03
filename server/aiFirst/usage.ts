// Spend controls for AI-first artwork.
//
// Everything here runs BEFORE the provider call. A ceiling checked after the
// image comes back is not a ceiling, it is a receipt.
//
// The distinction the whole file turns on: a *billed image* is money, a
// *host action* is intent, and they are not the same event. An automatic
// quality retry is money without intent — it must count against spend and
// never against what the host is allowed to ask for. Reuse and apply are
// intent without money — they must never be blocked by a spend ceiling,
// which is what makes "existing previews remain usable after ceilings" true.

import type { PlanTier } from "@shared/schema";

/* ── Entitlements ────────────────────────────────────────────────────── */

export interface Ceilings {
  /** Hard stop for billed images on one event. */
  eventHard: number;
  /** Warn-and-continue for billed images on one event. */
  eventSoft: number;
  /** Hard stop for billed images across a calendar month, per email. */
  monthlyHard: number;
  monthlySoft: number;
}

const SPARK: Ceilings = { eventSoft: 12, eventHard: 12, monthlySoft: 12, monthlyHard: 12 };
const PLUS: Ceilings = { eventSoft: 24, eventHard: 40, monthlySoft: 48, monthlyHard: 80 };

/**
 * Plus entitlements apply while a trial is running as well as while the
 * subscription is active. An expired Plus falls back to Spark, never to a
 * "Free" tier — that label is obsolete and must not surface anywhere.
 */
export function ceilingsForTier(tier: PlanTier | undefined): Ceilings {
  return tier === "plus_trial" || tier === "plus_active" ? PLUS : SPARK;
}

export function tierLabel(tier: PlanTier | undefined): "Spark" | "Plus" {
  return tier === "plus_trial" || tier === "plus_active" ? "Plus" : "Spark";
}

/* ── Concurrency ─────────────────────────────────────────────────────── */

export const MAX_CONCURRENT_GENERATIONS_PER_EVENT = 2;
/** Requirement 2's cap on parallel artwork inside a single run. */
export const MAX_ARTWORK_CONCURRENCY = 2;

/* ── Rate limiting ───────────────────────────────────────────────────── */

export interface RateLimitRule {
  limit: number;
  windowMs: number;
}

export const RATE_LIMITS: Record<"event" | "token" | "ip", RateLimitRule> = {
  event: { limit: 6, windowMs: 60 * 60 * 1000 },
  token: { limit: 12, windowMs: 60 * 60 * 1000 },
  ip: { limit: 30, windowMs: 60 * 60 * 1000 },
};

/** Fixed-window counter. In-process by design — see the note in guard(). */
export class RateLimiter {
  private hits = new Map<string, number[]>();

  check(scope: keyof typeof RATE_LIMITS, key: string, now = Date.now()): boolean {
    const rule = RATE_LIMITS[scope];
    const id = `${scope}:${key}`;
    const recent = (this.hits.get(id) ?? []).filter((t) => now - t < rule.windowMs);
    if (recent.length >= rule.limit) {
      this.hits.set(id, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(id, recent);
    return true;
  }

  reset(): void {
    this.hits.clear();
  }
}

/* ── Circuit breaker ─────────────────────────────────────────────────── */

export const BREAKER_FAILURE_THRESHOLD = 5;
export const BREAKER_COOLDOWN_MS = 2 * 60 * 1000;

/**
 * Opens after consecutive provider failures so a broken upstream cannot be
 * paid for once per request. Half-opens after the cooldown: one probe gets
 * through, and its result either closes the breaker or re-opens it.
 */
export class CircuitBreaker {
  private failures = 0;
  private openedAt: number | null = null;

  stateAt(now = Date.now()): "closed" | "open" | "half-open" {
    if (this.openedAt === null) return "closed";
    return now - this.openedAt >= BREAKER_COOLDOWN_MS ? "half-open" : "open";
  }

  get state(): "closed" | "open" | "half-open" {
    return this.stateAt();
  }

  allows(now = Date.now()): boolean {
    return this.stateAt(now) !== "open";
  }

  recordSuccess(): void {
    this.failures = 0;
    this.openedAt = null;
  }

  recordFailure(now = Date.now()): void {
    this.failures += 1;
    if (this.failures >= BREAKER_FAILURE_THRESHOLD) this.openedAt = now;
  }
}

/* ── Anomaly hooks ───────────────────────────────────────────────────── */

export type AnomalyKind =
  | "event-soft-ceiling"
  | "event-hard-ceiling"
  | "monthly-soft-ceiling"
  | "monthly-hard-ceiling"
  | "circuit-open"
  | "kill-switch"
  | "support-override";

export interface Anomaly {
  kind: AnomalyKind;
  eventId: number;
  email?: string;
  detail: string;
  at: number;
}

export type AnomalyHook = (anomaly: Anomaly) => void;

const hooks: AnomalyHook[] = [];

export function onAnomaly(hook: AnomalyHook): () => void {
  hooks.push(hook);
  return () => {
    const i = hooks.indexOf(hook);
    if (i >= 0) hooks.splice(i, 1);
  };
}

export function emitAnomaly(anomaly: Anomaly): void {
  for (const hook of [...hooks]) {
    try {
      hook(anomaly);
    } catch {
      // A misbehaving observer must not fail the request it is observing.
    }
  }
}

/* ── The guard ───────────────────────────────────────────────────────── */

export type GuardDenial =
  | "kill-switch"
  | "circuit-open"
  | "rate-limited"
  | "concurrency"
  | "event-ceiling"
  | "monthly-ceiling";

export interface UsageSnapshot {
  /** Billed images already charged to this event. */
  eventBilled: number;
  /** Billed images charged to this email in the current calendar month. */
  monthlyBilled: number;
  /** Runs currently in flight for this event. */
  activeGenerations: number;
}

export interface GuardInput {
  eventId: number;
  email?: string;
  tier?: PlanTier;
  usage: UsageSnapshot;
  /** How many billed images this run intends to buy. */
  requested: number;
  killSwitch: boolean;
  breaker?: CircuitBreaker;
  limiter?: RateLimiter;
  ownerToken?: string;
  ip?: string;
  /** Logged, and only ever set by a support tool — never by a host. */
  supportOverride?: { reason: string; by: string };
  now?: number;
}

export interface GuardResult {
  allowed: boolean;
  denial?: GuardDenial;
  /** Host-readable, safe to render. Never mentions "Free" or credits. */
  message?: string;
  /** Soft-ceiling notices. Allowed stays true. */
  warnings: string[];
  ceilings: Ceilings;
  /** How many billed images this run may actually buy. */
  allowance: number;
}

export function guardGeneration(input: GuardInput): GuardResult {
  const now = input.now ?? Date.now();
  const ceilings = ceilingsForTier(input.tier);
  const warnings: string[] = [];
  const label = tierLabel(input.tier);

  const deny = (denial: GuardDenial, message: string, kind?: AnomalyKind): GuardResult => {
    if (kind) {
      emitAnomaly({ kind, eventId: input.eventId, email: input.email, detail: message, at: now });
    }
    return { allowed: false, denial, message, warnings, ceilings, allowance: 0 };
  };

  // The kill switch outranks everything, including a support override: it
  // exists precisely for the case where no image should be bought at all.
  // Studio designs and existing previews are unaffected because neither
  // path reaches this guard.
  if (input.killSwitch) {
    return deny(
      "kill-switch",
      "New invitation artwork is paused right now. The Posy collection and your saved designs are still available.",
      "kill-switch",
    );
  }

  if (input.breaker && !input.breaker.allows()) {
    return deny(
      "circuit-open",
      "The illustration service is having trouble. Please try again shortly — the Posy collection is still available.",
      "circuit-open",
    );
  }

  if (input.usage.activeGenerations >= MAX_CONCURRENT_GENERATIONS_PER_EVENT) {
    return deny("concurrency", "This event already has invitation directions being created. Let those finish first.");
  }

  if (input.limiter) {
    const checks: [keyof typeof RATE_LIMITS, string | undefined][] = [
      ["event", String(input.eventId)],
      ["token", input.ownerToken],
      ["ip", input.ip],
    ];
    for (const [scope, key] of checks) {
      if (key && !input.limiter.check(scope, key, now)) {
        return deny("rate-limited", "That is a lot of invitation directions in a short time. Please try again shortly.");
      }
    }
  }

  if (input.supportOverride) {
    emitAnomaly({
      kind: "support-override",
      eventId: input.eventId,
      email: input.email,
      detail: `override by ${input.supportOverride.by}: ${input.supportOverride.reason}`,
      at: now,
    });
    return { allowed: true, warnings, ceilings, allowance: input.requested };
  }

  const eventRemaining = ceilings.eventHard - input.usage.eventBilled;
  if (eventRemaining <= 0) {
    return deny(
      "event-ceiling",
      `This event has reached its ${label} limit for new invitation artwork. The directions you have already are still yours to use.`,
      "event-hard-ceiling",
    );
  }

  const monthlyRemaining = input.email ? ceilings.monthlyHard - input.usage.monthlyBilled : Number.POSITIVE_INFINITY;
  if (monthlyRemaining <= 0) {
    return deny(
      "monthly-ceiling",
      `You have reached this month's ${label} limit for new invitation artwork. Everything you have already created is still available.`,
      "monthly-hard-ceiling",
    );
  }

  if (input.usage.eventBilled + input.requested > ceilings.eventSoft && ceilings.eventSoft < ceilings.eventHard) {
    warnings.push(`This event is past its usual ${label} allowance for new artwork.`);
    emitAnomaly({
      kind: "event-soft-ceiling",
      eventId: input.eventId,
      email: input.email,
      detail: `${input.usage.eventBilled} billed images on this event`,
      at: now,
    });
  }
  if (
    input.email &&
    input.usage.monthlyBilled + input.requested > ceilings.monthlySoft &&
    ceilings.monthlySoft < ceilings.monthlyHard
  ) {
    warnings.push(`You are past your usual ${label} allowance for new artwork this month.`);
    emitAnomaly({
      kind: "monthly-soft-ceiling",
      eventId: input.eventId,
      email: input.email,
      detail: `${input.usage.monthlyBilled} billed images this month`,
      at: now,
    });
  }

  return {
    allowed: true,
    warnings,
    ceilings,
    allowance: Math.max(0, Math.min(input.requested, eventRemaining, monthlyRemaining)),
  };
}

/* ── Ledger ──────────────────────────────────────────────────────────── */

export interface LedgerEntry {
  eventId: number;
  email?: string;
  reason: "initial" | "quality-retry" | "reuse" | "apply";
  billed: boolean;
  automatic: boolean;
  conceptFingerprint?: string;
  previewId?: string;
  reuseOf?: string;
  idempotencyKey?: string;
  costUsdMicros: number;
  createdAt: number;
}

export interface AiFirstUsageStore {
  record(entry: LedgerEntry): Promise<void>;
  findByIdempotencyKey(key: string): Promise<LedgerEntry | undefined>;
  snapshot(eventId: number, email: string | undefined, monthStart: number): Promise<UsageSnapshot>;
}

export function monthStart(now = Date.now()): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
}

export class InMemoryUsageStore implements AiFirstUsageStore {
  private entries: LedgerEntry[] = [];
  private active = new Map<number, number>();

  async record(entry: LedgerEntry): Promise<void> {
    this.entries.push({ ...entry });
  }

  async findByIdempotencyKey(key: string): Promise<LedgerEntry | undefined> {
    return this.entries.find((e) => e.idempotencyKey === key);
  }

  async snapshot(eventId: number, email: string | undefined, from: number): Promise<UsageSnapshot> {
    return {
      eventBilled: this.entries.filter((e) => e.eventId === eventId && e.billed).length,
      monthlyBilled: email
        ? this.entries.filter((e) => e.email === email && e.billed && e.createdAt >= from).length
        : 0,
      activeGenerations: this.active.get(eventId) ?? 0,
    };
  }

  beginRun(eventId: number): void {
    this.active.set(eventId, (this.active.get(eventId) ?? 0) + 1);
  }

  endRun(eventId: number): void {
    this.active.set(eventId, Math.max(0, (this.active.get(eventId) ?? 0) - 1));
  }

  get all(): LedgerEntry[] {
    return [...this.entries];
  }
}

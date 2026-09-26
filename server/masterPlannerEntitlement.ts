// The AI Master Planner's entitlement gate (Design Spec §4.3 / Engineering
// Breakdown §4.1-4.3): decides whether a given event is allowed to spend its
// one free first draft, and tracks resumable progress through a crash or a
// closed browser tab without ever double-spending that free draft.
//
// Reservation and execution ownership are protected by a database event-row
// lock. Reloads and simultaneous tabs observe the same running generation.

import { storage } from "./storage";
import { getEventPlusAccess, hasActivePlusMembership } from './plusMembership';
import type { MasterPlannerGeneration, GenerationKind, Event } from "@shared/schema";

export interface ReservationResult {
  ok: boolean;
  reason?: "already_consumed" | "interrupted";
  generation?: MasterPlannerGeneration;
  shouldStart: boolean;
}

/** Reserves a fresh free-draft generation slot for this event, or resumes an
 *  existing reserved/failed one so a retry can pick up from its last
 *  completed stage instead of starting over. Refuses if the free draft has
 *  already been fully consumed (Phase 5's paid-additional-draft gating is
 *  out of scope here). */
export async function reserveOrResumeFreeDraft(eventId: number, allowResume = false): Promise<ReservationResult> {
  return storage.reserveInitialGeneration(eventId, allowResume);
}

export async function markGenerationConsumed(generationId: number): Promise<void> {
  await storage.updateGeneration(generationId, { state: "consumed", consumedAt: Date.now() });
}

export async function markGenerationFailed(generationId: number, failedStage: string): Promise<void> {
  await storage.updateGeneration(generationId, { state: "failed", failedAt: Date.now(), failedStage });
}

/** Appends a fine-grained stage name (e.g. "theme", "budget", "menu") to the
 *  generation's resume ledger. Idempotent — safe to call even if the stage
 *  is already recorded. */
export async function markStageCompleted(generationId: number, stage: string): Promise<void> {
  const generation = await storage.getGeneration(generationId);
  const completed: string[] = generation ? safeParseStages(generation.completedStages) : [];
  if (!completed.includes(stage)) {
    completed.push(stage);
    await storage.updateGeneration(generationId, { completedStages: JSON.stringify(completed) });
  }
}

export function safeParseStages(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === "string") : [];
  } catch {
    return [];
  }
}

// Paid-access gate for starting a draft. Since the free tier was retired,
// an event may only generate a plan if it has bought Spark (a one-time
// unlock stamped on the event) or a trusted settlement binds this event to an
// active Plus subscription. Contact email never grants access. The plus_trial branch is vestigial — trials were
// removed from checkout — but kept safe so any legacy trialing entitlement
// still resolves correctly.
export interface DraftAccess {
  ok: boolean;
  reason?: "needs_payment" | "already_used";
}

export async function canGenerateDraft(eventId: number): Promise<DraftAccess> {
  const event = await storage.getEventById(eventId);
  if (!event) return { ok: false, reason: "needs_payment" };

  if (event.sparkUnlockedAt) return { ok: true };

  if (hasActivePlusMembership(await getEventPlusAccess(event.id))) return { ok: true };

  return { ok: false, reason: "needs_payment" };
}

export interface EntitlementSummary {
  // The event's numeric id, so a client holding only the ownerToken (which is
  // all the entitlement route is keyed by) can address the eventId-scoped
  // /email-capture route without a second round trip.
  eventId: number;
  freeDraftState: Event["draftStatus"];
  emailCaptured: boolean;
  planTier: string;
  trialEndsAt: number | null;
  gatedActionsAvailable: boolean;
  // Whether this specific event bought its one-time Spark unlock.
  sparkUnlocked: boolean;
  // Whether the event may start a draft right now (Spark unlock OR active
  // Plus) — the single flag the paywall UI keys off of.
  canGenerate: boolean;
}

/** Read-only summary for the GET .../entitlement route. Reflects the
 *  event's own draft lifecycle and its proven membership binding. It never
 *  discloses whether an arbitrary captured address has a subscription. */
export async function getEntitlementSummary(eventId: number): Promise<EntitlementSummary | undefined> {
  const event = await storage.getEventById(eventId);
  if (!event) return undefined;

  const entitlement = await getEventPlusAccess(event.id);
  const planTier = entitlement?.planTier ?? "spark";
  const trialEndsAt = entitlement?.trialEndsAt ?? null;
  const gatedActionsAvailable = hasActivePlusMembership(entitlement);
  const sparkUnlocked = !!event.sparkUnlockedAt;

  return {
    eventId: event.id,
    freeDraftState: event.draftStatus,
    emailCaptured: !!event.capturedEmail,
    planTier,
    trialEndsAt,
    gatedActionsAvailable,
    sparkUnlocked,
    canGenerate: sparkUnlocked || gatedActionsAvailable,
  };
}

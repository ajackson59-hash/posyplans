// AI-first invitation routes.
//
// Mounted unconditionally but gated per request, not at mount time: the flag
// is read from the environment on every call so a kill switch takes effect
// without a redeploy. With the flag off every route here answers 404, which
// is indistinguishable from the routes not existing — the live experience is
// unchanged by default.
//
// Nothing in this file touches the existing invite routes. Studio themes,
// apply-concept, apply-theme and the Words/Style/Envelope editor all keep
// working exactly as before whether the flag is on or off.

import type { Express, Request, Response } from "express";
import { registerStyleSourceRoutes } from "./styleSourceRoutes";
import { readFeatureFlags } from "@shared/featureFlags";
import { AI_FIRST_CONCEPT_KEY, themeFromSnapshot, type AiFirstSnapshot } from "@shared/aiFirstTheme";
import { OVERLAY_COVERAGE, validateLayoutBeforeGeneration } from "@shared/aiFirstLayout";
import { buildThemedConcept, themeCopyForEvent } from "@shared/themeCatalog";
import { deriveThemeDna } from "@shared/themeDna";
import { computeEventDna } from "@shared/eventDna";
import { buildEventBrief, briefIsSufficient, SINGLE_BRIEF_QUESTION } from "./brief";
import { runAiFirstPipeline, type PipelineEvent, type PipelineInput, type RunSummary } from "./pipeline";
import {
  applyPreview,
  assetHashOf,
  cleanupPreviews,
  conceptFingerprint,
  previewAssetUrl,
  previewIdFor,
  resolvePreviewAssetBytes,
  savePreview,
  type AiFirstPreviewStore,
} from "./previewStore";
import {
  CircuitBreaker,
  RateLimiter,
  ceilingsForTier,
  guardGeneration,
  monthStart,
  tierLabel,
  type AiFirstUsageStore,
} from "./usage";
import { INVITATION_ASK_POSY_ACTIONS, resolveAskPosyAction } from "./askPosy";
import type { AiFirstRunStore } from "./runStore";
import type { AiFirstArtworkAttemptStore } from "./artworkAttemptStore";
import { readAiFirstArtworkModel, readAiFirstDirectionLimit } from "./config";
import { hostFacingGenerationError } from "@shared/aiFirstStream";
import {
  checkAiFirstModelReadiness,
  type AiFirstModelReadiness,
  type ProviderReadinessInput,
} from "./providerReadiness";
import {
  runConceptOnlyProof,
  type ConceptOnlyProofInput,
  type ConceptOnlyProofResult,
} from "./conceptOnlyProof";
import { extractInspirationNotes } from "../inviteDesignAi";
import { customerVisiblePreviewBytes } from "../prePaymentPreviewQuality";
import { runTier1Checks } from "./tier1";
import { runVisionGate, type VisionGateInput, type VisionVerdict } from "./visionGate";
import { briefForHostDirection } from "./conceptPreflight";

/** One breaker and one limiter per process, shared by every event. */
const breaker = new CircuitBreaker();
const limiter = new RateLimiter();

/**
 * Paid-access gate for spending on artwork. Mirrors the same rule the
 * legacy Master Planner route enforces (server/masterPlannerEntitlement.ts,
 * canGenerateDraft): an event may only trigger a BILLED generation if it
 * has bought its one-time Spark unlock, or the host's captured email holds
 * an active or trialing Plus subscription. Before this check existed, this
 * route had no payment gate at all — only kill-switch, rate-limit, and
 * circuit-breaker checks, none of which look at who is paying. An
 * anonymous, unpaid, un-emailed visitor could (and, confirmed in
 * production on event 76, did) trigger real provider spend and publish a
 * live invitation for $0. This must run before guardGeneration/the run
 * claim, so a non-paying request never reaches rate-limit or provider
 * logic and never becomes a "near miss" the host can retry into spend.
 */
function hasGenerationEntitlement(
  event: { sparkUnlockedAt?: number | null },
  entitlement: { planTier: string; trialEndsAt?: number | null } | undefined,
): boolean {
  if (event.sparkUnlockedAt) return true;
  if (entitlement?.planTier === "plus_active") return true;
  if (entitlement?.planTier === "plus_trial" && !!entitlement.trialEndsAt && entitlement.trialEndsAt > Date.now()) {
    return true;
  }
  return false;
}

export interface AiFirstDeps {
  storage: {
    getEventByOwnerToken(token: string): Promise<any>;
    updateEventByOwnerToken(token: string, data: Record<string, unknown>): Promise<any>;
    getEmailEntitlement(email: string): Promise<{ planTier: string; trialEndsAt?: number | null } | undefined>;
    listMenuItems(eventId: number): Promise<any[]>;
    listBudgetItems(eventId: number): Promise<any[]>;
    listGuests(eventId: number): Promise<any[]>;
  };
  previewStore: AiFirstPreviewStore;
  usageStore: AiFirstUsageStore & { beginRun?(id: number): void; endRun?(id: number): void };
  /** Durable run/idempotency state. Required for real spend to be safe across instances. */
  runStore: AiFirstRunStore;
  /** Durable retention of every billed provider result (accepted AND rejected), for protected review. */
  artworkAttemptStore: AiFirstArtworkAttemptStore;
  env?: Record<string, string | undefined>;
  /** Test-only seam; Production omits it and uses the real pipeline. */
  runPipeline?: (input: PipelineInput) => Promise<RunSummary>;
  /** Test seam for the protected, non-generative provider metadata checks. */
  checkModelReadiness?: (input: ProviderReadinessInput) => Promise<AiFirstModelReadiness>;
  /** Test seam for the protected concept-only proof. No image generator exists in this input. */
  runConceptProof?: (input: ConceptOnlyProofInput) => Promise<ConceptOnlyProofResult>;
  /** Test seam for the text/vision-only design-inspiration analysis. */
  analyzeInspiration?: (images: string[]) => Promise<string>;
  /** Test seam for re-reviewing retained pixels without another image call. */
  reviewRetainedArtwork?: (input: VisionGateInput) => Promise<VisionVerdict>;
}

function readInspirationImages(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.startsWith("data:image/"))
    .slice(0, 3);
}

/** The response stream, not request-body completion, owns SSE lifetime. */
export function abortOnUnexpectedResponseClose(res: Response, controller: AbortController): void {
  res.on("close", () => {
    if (!res.writableEnded) controller.abort(new Error("The invitation generation connection closed."));
  });
}

export function registerAiFirstRoutes(app: Express, deps: AiFirstDeps): void {
  registerStyleSourceRoutes(app, deps);
  const env = () => deps.env ?? process.env;
  const flags = () => readFeatureFlags(env());

  /**
   * Read-only and unflagged: the client needs to know which experience to
   * render, and answering 404 here would leave it guessing.
   */
  app.get("/api/feature-flags", (_req, res) => {
    res.json(flags());
  });

  /** Refuses every AI-first route while the flag is off. */
  const gated = (handler: (req: Request, res: Response) => Promise<void> | void) => {
    return async (req: Request, res: Response) => {
      if (!flags().aiFirstInvitations) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      await handler(req, res);
    };
  };

  /**
   * The named pre-payment canary intentionally runs while the broader
   * AI-first invitation flag remains off. Its retained evidence still needs
   * the same owner-scoped audit/recheck surface on the two certified Preview
   * branches; otherwise paid pixels can be retained but never reviewed.
   * Everywhere else keeps the existing AI-first flag boundary.
   */
  const retainedEvidenceGated = (handler: (req: Request, res: Response) => Promise<void> | void) => {
    return async (req: Request, res: Response) => {
      const environment = env();
      const certifiedNamedPreview = environment.VERCEL_ENV === "preview"
        && ["fix/launch-qa-find-my-event-label", "codex/launch-blockers"]
          .includes(environment.VERCEL_GIT_COMMIT_REF || "");
      if (!flags().aiFirstInvitations && !certifiedNamedPreview) {
        res.status(404).json({ error: "Not found" });
        return;
      }
      await handler(req, res);
    };
  };

  /**
   * Reviewer diagnostics exist only on Vercel Preview, use the event's secret
   * owner token as their authorization boundary, and require the generation
   * kill switch to be ON. Production and local requests receive 404 so this
   * surface cannot become an accidentally supported public API.
   */
  const previewOwnerReview = (
    handler: (req: Request, res: Response, event: any, ownerToken: string) => Promise<void> | void,
  ) =>
    gated(async (req, res) => {
      if (env().VERCEL_ENV !== "preview") {
        res.status(404).json({ error: "Not found" });
        return;
      }
      const ownerToken = String(req.params.ownerToken);
      const event = await deps.storage.getEventByOwnerToken(ownerToken);
      if (!event) {
        res.status(404).json({ error: "Event not found" });
        return;
      }
      if (!flags().invitationGenerationKillSwitch) {
        res.status(409).json({
          error: "Preview readiness review requires invitation generation to remain paused.",
          denial: "kill-switch-required",
        });
        return;
      }
      await handler(req, res, event, ownerToken);
    });

  /**
   * Non-generative provider readiness. Both calls retrieve model metadata;
   * neither endpoint can create a concept or image.
   */
  app.get(
    "/api/events/owner/:ownerToken/ai-first/review/readiness",
    previewOwnerReview(async (_req, res) => {
      let artworkModel;
      try {
        artworkModel = readAiFirstArtworkModel(env());
      } catch (error) {
        res.status(503).json({ error: (error as Error).message, denial: "invalid-provider-configuration" });
        return;
      }
      const providers = await (deps.checkModelReadiness ?? checkAiFirstModelReadiness)({
        env: env(),
        artworkModel,
      });
      const directionLimit = readAiFirstDirectionLimit(env());
      const automaticRetryDisabled = flags().aiFirstDisableAutomaticRetry;
      const canaryControlsReady =
        artworkModel === "gpt-image-2" && directionLimit === 1 && automaticRetryDisabled;
      res.json({
        ready: providers.ready && canaryControlsReady,
        environment: "preview",
        killSwitch: true,
        canaryControlsReady,
        directionLimit,
        automaticRetryDisabled,
        artworkModel,
        providers,
        imageProviderCalls: 0,
        billedArtworkAttempts: 0,
      });
    }),
  );

  /**
   * The real four-concept prompt and zero-image quartet gate, exposed only as
   * an explicitly confirmed Preview reviewer proof. This path cannot claim a
   * run, reserve usage, write an artwork attempt, or receive an image
   * generator. Its returned zero counters are structural facts, not estimates.
   */
  app.post(
    "/api/events/owner/:ownerToken/ai-first/review/concept-proof",
    previewOwnerReview(async (req, res, event) => {
      if (req.body?.confirmConceptOnly !== true) {
        res.status(400).json({
          error: "Set confirmConceptOnly to true to run the text-only Preview proof.",
          denial: "concept-proof-confirmation-required",
        });
        return;
      }

      const [menuItems, budgetItems, guests] = await Promise.all([
        deps.storage.listMenuItems(event.id),
        deps.storage.listBudgetItems(event.id),
        deps.storage.listGuests(event.id),
      ]);
      const brief = buildEventBrief({
        event,
        dna: computeEventDna({ eventType: event.eventType, menuItems, budgetItems }).scores,
        guestCount: guests.length > 0 ? guests.length : null,
        vibeAnswer: typeof req.body?.feeling === "string" ? req.body.feeling : undefined,
        inspirationNotes: typeof req.body?.inspirationNotes === "string" ? req.body.inspirationNotes : undefined,
      });

      try {
        const proof = await (deps.runConceptProof ?? runConceptOnlyProof)({
          brief,
          direction: typeof req.body?.direction === "string" ? req.body.direction : undefined,
        });
        res.json({
          ...proof,
          environment: "preview",
          killSwitch: true,
          runClaimed: false,
        });
      } catch (error) {
        res.status(503).json({
          error: (error as Error).message,
          denial: "concept-proof-failed",
          environment: "preview",
          killSwitch: true,
          runClaimed: false,
          imageProviderCalls: 0,
          billedArtworkAttempts: 0,
        });
      }
    }),
  );

  app.get(
    "/api/events/owner/:ownerToken/ai-first/status",
    gated(async (req, res) => {
      const requestFlags = flags();
      const event = await deps.storage.getEventByOwnerToken(String(req.params.ownerToken));
      if (!event) {
        res.status(404).json({ error: "Event not found" });
        return;
      }
      const email = event.capturedEmail ?? undefined;
      const entitlement = email ? await deps.storage.getEmailEntitlement(email) : undefined;
      const tier = entitlement?.planTier as never;
      const usage = await deps.usageStore.snapshot(event.id, email, monthStart());
      // The durable run row, not the process-memory counter, decides whether
      // this event already has an active generation — correct even when this
      // request lands on a different instance than the one running it.
      const activeGenerations = (await deps.runStore.hasActiveRun(event.id)) ? 1 : usage.activeGenerations;
      res.json({
        plan: tierLabel(tier),
        ceilings: ceilingsForTier(tier),
        usage: { ...usage, activeGenerations },
        killSwitch: requestFlags.invitationGenerationKillSwitch,
        // The client renders the reviewer control only when the server—not a
        // build-time browser assumption—proves this is a paused Vercel
        // Preview. The review endpoints repeat both checks before doing work.
        previewReviewAvailable:
          env().VERCEL_ENV === "preview" && requestFlags.invitationGenerationKillSwitch,
        directionLimit: readAiFirstDirectionLimit(env()),
        automaticRetryDisabled: requestFlags.aiFirstDisableAutomaticRetry,
        // A reload or return visit must not turn a later cost-bearing run
        // back into an unqualified one-click action. The server enforces the
        // same fact on POST; this field lets the UI explain it beforehand.
        additionalGenerationConfirmationRequired: usage.eventBilled > 0,
        // The one question a thin brief is allowed to ask, and only then.
        briefQuestion: briefIsSufficient(event) ? null : SINGLE_BRIEF_QUESTION,
        askPosyActions: INVITATION_ASK_POSY_ACTIONS,
      });
    }),
  );

  /**
   * Turns up to three host-selected images into a compact, reusable art brief.
   * This is a vision/text analysis only: it cannot claim a generation run,
   * reserve image usage or call the artwork provider. The resulting notes live
   * in the parent-owned AI session and are sent with the host's next explicit
   * create/update request.
   */
  app.post(
    "/api/events/owner/:ownerToken/ai-first/inspiration",
    gated(async (req, res) => {
      const requestFlags = flags();
      const event = await deps.storage.getEventByOwnerToken(String(req.params.ownerToken));
      if (!event) {
        res.status(404).json({ error: "Event not found" });
        return;
      }
      if (requestFlags.invitationGenerationKillSwitch) {
        res.status(403).json({
          error: "Design inspiration analysis is paused right now.",
          denial: "kill-switch",
          paused: true,
        });
        return;
      }
      const images = readInspirationImages(req.body?.inspirationImages);
      if (images.length === 0) {
        res.status(400).json({ error: "Add at least one design inspiration image." });
        return;
      }
      try {
        const inspirationNotes = await (deps.analyzeInspiration ?? extractInspirationNotes)(images);
        if (!inspirationNotes.trim()) {
          res.status(422).json({ error: "Posy couldn't read a usable design direction from those images." });
          return;
        }
        res.json({ inspirationNotes, imageProviderCalls: 0, billedArtworkAttempts: 0 });
      } catch {
        res.status(502).json({ error: "Posy couldn't read that design inspiration right now." });
      }
    }),
  );

  /**
   * Durable run status, for recovery after an unexpected stream termination.
   * The client's EOF-without-terminal-event case reports failure immediately
   * (see aiFirstSession.ts), but this route lets a reload or a support tool
   * ask "what actually happened to that run" from the source of truth rather
   * than the dropped connection.
   */
  app.get(
    "/api/events/owner/:ownerToken/ai-first/run/:runId",
    gated(async (req, res) => {
      const event = await deps.storage.getEventByOwnerToken(String(req.params.ownerToken));
      if (!event) {
        res.status(404).json({ error: "Event not found" });
        return;
      }
      const run = await deps.runStore.get(String(req.params.runId));
      if (!run || run.eventId !== event.id || run.ownerToken !== req.params.ownerToken) {
        res.status(404).json({ error: "Run not found" });
        return;
      }
      res.json({
        runId: run.runId,
        status: run.status,
        progressMessage: run.progressMessage,
        completedCount: run.completedCount,
        fallbackCount: run.fallbackCount,
        errorMessage: run.errorMessage,
        terminal: run.terminal,
      });
    }),
  );

  /**
   * Server-Sent Events. Each pipeline event is forwarded verbatim, so what
   * the host sees advancing is the run itself rather than a timer.
   */
  app.post(
    "/api/events/owner/:ownerToken/ai-first/generate",
    gated(async (req, res) => {
      const ownerToken = String(req.params.ownerToken);
      const event = await deps.storage.getEventByOwnerToken(ownerToken);
      if (!event) {
        res.status(404).json({ error: "Event not found" });
        return;
      }

      // The kill switch is checked first and unconditionally, before the run
      // is even claimed: when it is on, this route must invoke zero provider
      // functions and return a clear paused response, with nothing durable
      // written for this attempt.
      // Capture the request's configuration once. Reading the same flags at
      // multiple points made the audit harder and allowed no proof that the
      // allowance calculation and pipeline used one coherent snapshot.
      const requestFlags = flags();

      if (requestFlags.invitationGenerationKillSwitch) {
        res.status(403).json({
          error: "New invitation artwork is paused right now. The Posy collection and your saved designs are still available.",
          denial: "kill-switch",
          paused: true,
        });
        return;
      }

      // "Help me choose" is advice, not artwork generation. The client
      // handles it locally, but this server-side stop makes that zero-spend
      // promise true even if a stale or hand-crafted client posts the action.
      const requestedAction = INVITATION_ASK_POSY_ACTIONS.find((action) => action.id === req.body?.action);
      if (requestedAction?.advisory) {
        res.status(400).json({
          error: "Help me choose gives on-screen guidance and does not create new artwork.",
          denial: "advisory-only",
        });
        return;
      }

      // Idempotency, enforced before provider spend: the client mints one
      // runId per logical run and resends it on every request for that run.
      // A missing runId is a client bug, not a request this route can safely
      // treat as a fresh run — there would be nothing to de-duplicate against.
      const runId = typeof req.body?.runId === "string" ? req.body.runId.trim() : "";
      if (!runId) {
        res.status(400).json({ error: "A runId is required to start invitation generation." });
        return;
      }

      // A replay of an existing logical run is idempotent and never needs a
      // new-spend confirmation. Return its durable truth before evaluating
      // whether a genuinely NEW run would require confirmation.
      const existingRun = await deps.runStore.get(runId);
      if (existingRun) {
        const sameEvent = existingRun.eventId === event.id && existingRun.ownerToken === ownerToken;
        res.status(409).json({
          error: sameEvent ? "This invitation run already exists." : "That run id is unavailable.",
          denial: "duplicate",
          ...(sameEvent
            ? {
                run: {
                  runId: existingRun.runId,
                  status: existingRun.status,
                  progressMessage: existingRun.progressMessage,
                  completedCount: existingRun.completedCount,
                  fallbackCount: existingRun.fallbackCount,
                  terminal: existingRun.terminal,
                },
              }
            : {}),
        });
        return;
      }

      const email = event.capturedEmail ?? undefined;
      const entitlement = email ? await deps.storage.getEmailEntitlement(email) : undefined;

      // Paid-access gate: zero provider calls, zero rate-limit consumption,
      // and no run claimed for an event that hasn't bought Spark or an
      // active/trialing Plus subscription. This is the fix for the
      // confirmed production paywall bypass (QA report, B2): previously
      // nothing before this point checked payment at all — an anonymous,
      // unpaid, un-emailed visitor could trigger a fully billed generation.
      if (!hasGenerationEntitlement(event, entitlement)) {
        res.status(402).json({
          error: "This event needs Spark or Plus to generate invitation artwork.",
          denial: "needs-payment",
        });
        return;
      }

      const tier = entitlement?.planTier as never;
      const usage = await deps.usageStore.snapshot(event.id, email, monthStart());
      // The durable row is the authority on "is a generation already active
      // for this event", not the in-process counter — correct across restarts
      // and across every Vercel instance, not just this one.
      const hasActiveRun = await deps.runStore.hasActiveRun(event.id);

      // A terminal run releases the active-run lock, so a later click can
      // otherwise mint a separate run id and incur separate provider spend.
      // Once an event has bought any artwork, every later run is refused
      // unless the host made the explicit, two-step confirmation the client
      // sends here. This check happens before model validation, run claim or
      // provider access and is therefore a zero-call denial.
      if (usage.eventBilled > 0 && req.body?.confirmAdditionalGeneration !== true) {
        res.status(409).json({
          error: "Confirm before starting another invitation generation. No image call was made.",
          denial: "additional-generation-confirmation-required",
          confirmationRequired: true,
        });
        return;
      }

      let artworkModel;
      try {
        artworkModel = readAiFirstArtworkModel(env());
      } catch (err) {
        // Configuration is validated before the run is claimed or any
        // provider path can be reached. Never silently fall back and spend.
        res.status(503).json({ error: (err as Error).message, denial: "invalid-provider-configuration" });
        return;
      }
      const configuredDirectionLimit = readAiFirstDirectionLimit(env());
      const requestedDirectionCount = Number(req.body?.directionCount);
      const directionLimit = Number.isInteger(requestedDirectionCount) && requestedDirectionCount > 0
        ? Math.min(configuredDirectionLimit, requestedDirectionCount)
        : configuredDirectionLimit;
      const maxAttemptsPerDirection = requestFlags.aiFirstDisableAutomaticRetry ? 1 : 2;

      const action = resolveAskPosyAction(req.body?.action, req.body);
      const guard = guardGeneration({
        eventId: event.id,
        email,
        tier,
        usage: { ...usage, activeGenerations: hasActiveRun ? Math.max(usage.activeGenerations, 1) : usage.activeGenerations },
        requested: directionLimit * maxAttemptsPerDirection,
        killSwitch: false, // already handled above, unconditionally
        breaker,
        limiter,
        ownerToken,
        ip: req.ip,
      });
      if (!guard.allowed) {
        res.status(guard.denial === "rate-limited" ? 429 : 403).json({
          error: guard.message,
          denial: guard.denial,
          plan: tierLabel(tier),
        });
        return;
      }

      // Load every zero-cost brief dependency before taking the durable run
      // lease. If storage is unavailable, no run is claimed and there is no
      // five-minute stale lock that could encourage a second paid attempt.
      const [menuItems, budgetItems, guests] = await Promise.all([
        deps.storage.listMenuItems(event.id),
        deps.storage.listBudgetItems(event.id),
        deps.storage.listGuests(event.id),
      ]);
      const brief = buildEventBrief({
        event,
        dna: computeEventDna({ eventType: event.eventType, menuItems, budgetItems }).scores,
        guestCount: guests.length > 0 ? guests.length : null,
        vibeAnswer: typeof req.body?.feeling === "string" ? req.body.feeling : undefined,
        inspirationNotes: typeof req.body?.inspirationNotes === "string" ? req.body.inspirationNotes : undefined,
      });

      // Atomic claim, enforced by TWO independent DB constraints (see
      // shared/schema.ts): a plain unique index on runId, and a PARTIAL
      // unique index on eventId for non-terminal active rows. This is what
      // makes "duplicate click, same run id", "duplicate request reaching a
      // separate server instance with the same run id", AND "a separate
      // server instance racing with a DIFFERENT run id for the same event"
      // all fail here rather than any of them reaching the pipeline twice.
      const claim = await deps.runStore.claim({ runId, eventId: event.id, ownerToken });
      if (claim.outcome === "duplicate" || claim.outcome === "active-elsewhere") {
        // Not an error: replay the run's current durable state as a single
        // JSON response rather than starting a second SSE stream. The client
        // is expected to already be reading the first stream (or to poll
        // /run/:runId if it is not); this response exists so a genuinely
        // duplicated request — the double-click, the second instance with the
        // same run id, or a second instance racing with a different run id
        // for the same event — gets a well-formed answer instead of a second
        // billed run. `denial` distinguishes the two cases for callers that
        // care (a different-run-id caller has no runId of its own to poll).
        res.status(409).json({
          error:
            claim.outcome === "duplicate"
              ? "This invitation run is already in progress."
              : "This event already has an invitation run in progress.",
          denial: claim.outcome,
          run: {
            runId: claim.record.runId,
            status: claim.record.status,
            progressMessage: claim.record.progressMessage,
            completedCount: claim.record.completedCount,
            fallbackCount: claim.record.fallbackCount,
            terminal: claim.record.terminal,
          },
        });
        return;
      }

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      const send = (event: PipelineEvent) => {
        if (res.destroyed || res.writableEnded) return;
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      };
      for (const warning of guard.warnings) {
        send({ type: "warning", message: warning, at: Date.now() });
      }

      const controller = new AbortController();
      // Request "close" also fires during normal request-body completion in
      // some Node/Express paths. The response is the SSE lifetime authority:
      // abort only when it closes before an intentional res.end().
      abortOnUnexpectedResponseClose(res, controller);
      deps.usageStore.beginRun?.(event.id);

      try {
        await (deps.runPipeline ?? runAiFirstPipeline)({
          eventId: event.id,
          email,
          brief,
          direction: action.direction,
          avoidConceptNames: action.avoidConceptNames,
          keepConstraints: action.keepConstraints,
          previewStore: deps.previewStore,
          usageStore: deps.usageStore,
          allowance: guard.allowance,
          sink: send,
          breaker,
          ocr: true,
          signal: controller.signal,
          runId,
          ownerToken,
          runStore: deps.runStore,
          artworkAttemptStore: deps.artworkAttemptStore,
          disableAutomaticRetry: requestFlags.aiFirstDisableAutomaticRetry,
          directionLimit,
          artworkModel,
        });
      } catch (err) {
        const rawMessage = (err as Error).message;
        const message = hostFacingGenerationError(rawMessage);
        if (message !== rawMessage) {
          console.warn(`AI-first run ${runId} rejected its artwork: ${rawMessage}`);
        }
        try {
          // Durable truth first. If this write fails, do not lie to the
          // client with a terminal event the source of truth did not record.
          await deps.runStore.fail(runId, message);
          send({ type: "error", message, at: Date.now() });
        } catch (persistenceError) {
          console.error("Failed to persist AI-first run failure", persistenceError);
        }
      } finally {
        deps.usageStore.endRun?.(event.id);
        if (!res.destroyed && !res.writableEnded) res.end();
      }
    }),
  );

  /**
   * Restores every accepted/adapted direction after a refresh or return
   * visit. The preview store is the ordinary host-safe store: rejected
   * provider attempts never enter it, and the response exposes only the
   * owner-scoped asset route rather than stored bytes.
   */
  app.get(
    "/api/events/owner/:ownerToken/ai-first/approved-designs",
    gated(async (req, res) => {
      const ownerToken = String(req.params.ownerToken);
      const event = await deps.storage.getEventByOwnerToken(ownerToken);
      if (!event) {
        res.status(404).json({ error: "Event not found" });
        return;
      }

      const records = (await deps.previewStore.listForEvent(event.id))
        .slice()
        .sort((a, b) => b.createdAt - a.createdAt);
      let appliedPreviewId: string | null = null;
      try {
        const storedConcept = JSON.parse(String(event.inviteDesignConceptJson || "null"));
        const snapshot = storedConcept?.[AI_FIRST_CONCEPT_KEY] as Partial<AiFirstSnapshot> | undefined;
        appliedPreviewId = typeof snapshot?.previewId === "string" ? snapshot.previewId : null;
      } catch {
        appliedPreviewId = null;
      }

      res.json({
        appliedPreviewId,
        directions: records.map((record, index) => ({
          index,
          concept: record.concept,
          source: record.source,
          previewId: record.previewId,
          assetHash: record.assetHash,
          illustrationUrl: previewAssetUrl(ownerToken, record.previewId),
          overlay: record.concept.minOverlay,
          artworkOpacity: validateLayoutBeforeGeneration(record.concept).artworkOpacity,
          attempts: [],
          reusedPreview: true,
          msFromStart: 0,
        })),
      });
    }),
  );

  /**
   * "Use this design". Applies the exact approved bytes: the preview is
   * looked up by its event-scoped id, its stored hash is verified against
   * the one the client approved, and no image provider is called.
   */
  app.post(
    "/api/events/owner/:ownerToken/ai-first/apply",
    gated(async (req, res) => {
      const event = await deps.storage.getEventByOwnerToken(String(req.params.ownerToken));
      if (!event) {
        res.status(404).json({ error: "Event not found" });
        return;
      }

      const previewId = typeof req.body?.previewId === "string" ? req.body.previewId : "";
      const expectedAssetHash = typeof req.body?.assetHash === "string" ? req.body.assetHash : undefined;
      const applied = await applyPreview(deps.previewStore, event.id, previewId, expectedAssetHash);
      if (!applied.ok || !applied.record) {
        res.status(applied.failure === "asset-hash-mismatch" ? 409 : 404).json({
          error:
            applied.failure === "asset-hash-mismatch"
              ? "That artwork no longer matches the version you approved. Preview it again before applying."
              : "That preview is no longer available.",
        });
        return;
      }

      const record = applied.record;
      const snapshot: AiFirstSnapshot = {
        concept: record.concept,
        previewId: record.previewId,
        assetHash: record.assetHash,
        artworkUrl: record.assetUrl,
        artworkOpacity: typeof req.body?.artworkOpacity === "number" ? req.body.artworkOpacity : undefined,
        source: record.source,
      };
      const { theme } = themeFromSnapshot(snapshot);
      // The applied concept is an ordinary themed concept plus the snapshot
      // that lets the renderer rebuild this synthetic theme on a later load.
      // A generated theme carries catalogue sample copy so its preview can be
      // rendered in isolation. Never persist those sample dates, venues or
      // RSVP lines onto a real event: seed the same event-aware copy used by
      // the curated-theme apply route.
      const appliedConcept = {
        ...buildThemedConcept(theme, { copy: themeCopyForEvent(theme, event) }),
        [AI_FIRST_CONCEPT_KEY]: snapshot,
      };
      const dna = deriveThemeDna(appliedConcept);

      const currentSubject = String(event.inviteSubject || "").trim();
      const inviteSubject = !currentSubject || /^you(?:'|’)re invited!?$/i.test(currentSubject)
        ? String(event.eventName || "").trim()
        : currentSubject;

      const updated = await deps.storage.updateEventByOwnerToken(String(req.params.ownerToken), {
        inviteDesignConceptJson: JSON.stringify(appliedConcept),
        // Match the applied card to the event preview while preserving copy a
        // host deliberately customized in the wording editor.
        inviteSubject,
        inviteIllustrationUrl: record.assetUrl,
        paletteColors: JSON.stringify(appliedConcept.paletteColors),
        // Use the palette's lightest paper tone for the physical envelope.
        // The first palette slot is often the near-black headline ink; using
        // it as paper made otherwise elegant directions feel heavy and flat.
        envelopeColor: dna.backgroundColor,
        envelopeLinerPattern: dna.linerPattern,
        stampStyle: dna.stampStyle,
      });
      if (!updated) {
        res.status(404).json({ error: "Event not found" });
        return;
      }

      // Recorded so the ledger shows the apply happened, explicitly unbilled.
      await deps.usageStore.record({
        eventId: event.id,
        email: event.capturedEmail ?? undefined,
        reason: "apply",
        billed: false,
        automatic: false,
        conceptFingerprint: record.conceptFingerprint,
        previewId: record.previewId,
        costUsdMicros: 0,
        createdAt: Date.now(),
      });

      res.json({ event: updated, previewId: record.previewId, assetHash: record.assetHash });
    }),
  );

  /**
   * Serves a preview's stored bytes directly, so nothing upstream of this
   * route ever has to carry a `data:` URL. Owner-scoped like every other
   * route here: the previewId alone is not treated as a public handle, it
   * is looked up within the event the ownerToken resolves to.
   *
   * Cache-Control is `private`, not `public`: this URL embeds the event's
   * ownerToken, so a shared cache (a CDN, a corporate proxy) must never be
   * allowed to store and replay this response to a different client. Only
   * the requesting browser's own cache may keep it — `immutable` still
   * applies there, since the bytes at a given previewId never change.
   */
  app.get(
    "/api/events/owner/:ownerToken/ai-first/preview/:previewId/asset",
    gated(async (req, res) => {
      const event = await deps.storage.getEventByOwnerToken(String(req.params.ownerToken));
      if (!event) {
        res.status(404).json({ error: "Event not found" });
        return;
      }
      const record = await deps.previewStore.findByPreviewId(event.id, String(req.params.previewId));
      if (!record) {
        res.status(404).json({ error: "That preview is no longer available." });
        return;
      }
      const asset = await resolvePreviewAssetBytes(record);
      if (!asset) {
        res.status(404).json({ error: "That preview's artwork could not be found." });
        return;
      }
      res.writeHead(200, {
        "Content-Type": asset.contentType,
        "Cache-Control": "private, max-age=31536000, immutable",
        "Content-Length": String(asset.bytes.length),
      });
      res.end(asset.bytes);
    }),
  );

  /**
   * Protected reviewer evidence: every billed image result for this event,
   * accepted and rejected alike, WITHOUT embedding any image bytes in the
   * JSON — this listing stays small no matter how large or how many the
   * underlying images are. Gated the same way apply/status already are —
   * by the event's own ownerToken — so this is not a new public diagnostic
   * surface, it is the same owner-auth boundary the rest of the AI-first
   * routes already enforce, applied to a new kind of record. Ordinary user
   * routes (status, generate, apply) never reference this store, so a
   * rejected image cannot reach a host or a guest through them.
   */
  app.get(
    "/api/events/owner/:ownerToken/ai-first/review/attempts",
    retainedEvidenceGated(async (req, res) => {
      const ownerToken = String(req.params.ownerToken);
      const event = await deps.storage.getEventByOwnerToken(ownerToken);
      if (!event) {
        res.status(404).json({ error: "Event not found" });
        return;
      }
      const rows = await deps.artworkAttemptStore.listForOwner(event.id, ownerToken);
      res.json({
        attempts: rows.map((row) => ({
          id: row.id,
          directionIndex: row.directionIndex,
          attempt: row.attempt,
          status: row.status,
          runId: row.runId,
          idempotencyKey: row.idempotencyKey,
          assetHash: row.assetHash,
          // The binary route below serves the actual bytes; this listing
          // never does, however small or large the underlying image is.
          assetUrl: `/api/events/owner/${ownerToken}/ai-first/review/attempts/${row.id}/asset`,
          previewId: row.previewId,
          conceptName: row.concept.conceptName,
          failureCodes: row.failureCodes,
          tier1Findings: row.tier1Findings,
          visionScores: row.visionScores,
          reviewEvidence: row.reviewEvidence ?? null,
          model: row.model,
          quality: row.quality,
          size: row.size,
          costUsdMicros: row.costUsdMicros,
          costEstimateStatus: row.reviewEvidence?.calibration
            ? "review-only-cost-in-calibration-evidence"
            : row.reviewEvidence?.styleSource
            ? "source-review-excludes-original-art-and-critic-cost"
            : row.reviewEvidence?.composition
            ? "composition-only-excludes-source-art-and-review"
            : row.size ? "image-output-only-model-size-estimate" : "legacy-unverified",
          createdAt: row.createdAt,
        })),
      });
    }),
  );

  /**
   * Binary asset for one protected review attempt (accepted or rejected).
   * Owner-scoped exactly like the listing above and the ordinary preview
   * asset route; never a public diagnostic endpoint. Cached `private`, not
   * `public`: this URL is reachable only with the event's ownerToken, and a
   * rejected image must never be able to end up in a shared/CDN cache.
   */
  app.get(
    "/api/events/owner/:ownerToken/ai-first/review/attempts/:id/asset",
    retainedEvidenceGated(async (req, res) => {
      const ownerToken = String(req.params.ownerToken);
      const event = await deps.storage.getEventByOwnerToken(ownerToken);
      if (!event) {
        res.status(404).json({ error: "Event not found" });
        return;
      }
      const row = await deps.artworkAttemptStore.findById(event.id, ownerToken, String(req.params.id));
      if (!row) {
        res.status(404).json({ error: "That review attempt is no longer available." });
        return;
      }
      const bytes = Buffer.from(row.assetBytesBase64, "base64");
      res.writeHead(200, {
        "Content-Type": "image/png",
        // Owner-private: content-addressed by id, so long-lived caching is
        // safe in the requesting browser's own cache, but never in a shared
        // one — this is protected evidence, not a public asset.
        "Cache-Control": "private, max-age=31536000, immutable",
        "Content-Length": String(bytes.length),
      });
      res.end(bytes);
    }),
  );

  /**
   * Re-runs today's quality gates against bytes already paid for and retained.
   * This endpoint can never reach the image provider: Tier 1 is deterministic,
   * Tier 2 is a semantic review of the same bytes, and a pass creates only an
   * owner-private preview. Applying that preview remains a separate host act.
   *
   * Confirmation plus the expected content hash binds the request to one
   * exact rejected asset. The content-addressed preview id makes a replay
   * idempotent and prevents a second vision call after a successful review.
   */
  app.post(
    "/api/events/owner/:ownerToken/ai-first/review/attempts/:id/recheck",
    retainedEvidenceGated(async (req, res) => {
      const ownerToken = String(req.params.ownerToken);
      const event = await deps.storage.getEventByOwnerToken(ownerToken);
      if (!event) {
        res.status(404).json({ error: "Event not found" });
        return;
      }
      if (req.body?.confirmRetainedReview !== true) {
        res.status(400).json({
          error: "Set confirmRetainedReview to true to review the retained artwork.",
          denial: "retained-review-confirmation-required",
          imageProviderCalls: 0,
          billedArtworkAttempts: 0,
        });
        return;
      }

      const row = await deps.artworkAttemptStore.findById(event.id, ownerToken, String(req.params.id));
      if (!row) {
        res.status(404).json({ error: "That review attempt is no longer available." });
        return;
      }
      if (row.status !== "rejected") {
        res.status(409).json({
          error: "Only rejected retained artwork can be re-reviewed.",
          denial: "attempt-not-rejected",
          imageProviderCalls: 0,
          billedArtworkAttempts: 0,
        });
        return;
      }
      // Private compositor research must not become customer artwork through
      // the older retained-image promotion route, even after a critic pass.
      if (row.model === "posy-review-calibration-v1" || row.reviewEvidence?.calibration ||
          row.model === "posy-scene-compositor-v1" || row.reviewEvidence?.composition ||
          row.model === "posy-style-source-v1" || row.reviewEvidence?.styleSource) {
        res.status(409).json({
          error: "Composed scenes are private research and are not enabled for customer use.",
          denial: "scene-promotion-disabled",
          imageProviderCalls: 0,
          billedArtworkAttempts: 0,
        });
        return;
      }
      if (typeof req.body?.expectedAssetHash !== "string" || req.body.expectedAssetHash !== row.assetHash) {
        res.status(409).json({
          error: "The retained artwork hash does not match the confirmed asset.",
          denial: "asset-hash-mismatch",
          imageProviderCalls: 0,
          billedArtworkAttempts: 0,
        });
        return;
      }

      const bytes = Buffer.from(row.assetBytesBase64, "base64");
      if (assetHashOf(bytes) !== row.assetHash) {
        res.status(409).json({
          error: "The retained artwork bytes failed integrity verification.",
          denial: "retained-asset-integrity",
          imageProviderCalls: 0,
          billedArtworkAttempts: 0,
        });
        return;
      }

      const fingerprint = conceptFingerprint(row.concept);
      const expectedPreviewId = previewIdFor(event.id, fingerprint, row.assetHash);
      const existing = await deps.previewStore.findByPreviewId(event.id, expectedPreviewId);
      if (existing) {
        res.json({
          previewId: existing.previewId,
          assetHash: existing.assetHash,
          assetUrl: previewAssetUrl(ownerToken, existing.previewId),
          concept: existing.concept,
          reused: true,
          imageProviderCalls: 0,
          billedArtworkAttempts: 0,
        });
        return;
      }

      let reviewedBytes: Buffer;
      try {
        reviewedBytes = customerVisiblePreviewBytes(bytes);
      } catch (error) {
        res.status(422).json({
          error: `The retained artwork could not be prepared for customer review: ${error instanceof Error ? error.message : String(error)}`,
          denial: "retained-artwork-preview-unavailable",
          imageProviderCalls: 0,
          billedArtworkAttempts: 0,
        });
        return;
      }

      const [menuItems, budgetItems, guests] = await Promise.all([
        deps.storage.listMenuItems(event.id),
        deps.storage.listBudgetItems(event.id),
        deps.storage.listGuests(event.id),
      ]);
      const baseBrief = buildEventBrief({
        event,
        dna: computeEventDna({ eventType: event.eventType, menuItems, budgetItems }).scores,
        guestCount: guests.length > 0 ? guests.length : null,
      });
      const direction = [row.concept.conceptName, row.concept.description, row.concept.art.prompt].join(" ");
      const effectiveBrief = briefForHostDirection(baseBrief, direction);
      const tier1 = runTier1Checks({
        // Match the pre-payment path exactly: judge the standalone 560px
        // teaser customers receive, without invitation text-placement rules.
        bytes: reviewedBytes,
        concept: row.concept,
        brief: effectiveBrief,
        overlayCoverage: OVERLAY_COVERAGE[row.concept.minOverlay],
        artworkOpacity: 1,
        layoutApplied: false,
        ocr: env().NODE_ENV === "production",
      });
      if (!tier1.passed) {
        res.status(422).json({
          error: "The retained artwork still fails Posy's deterministic quality checks.",
          denial: "tier1-quality-rejected",
          failureCodes: Array.from(
            new Set(tier1.findings.filter((finding) => finding.critical).map((finding) => finding.code)),
          ),
          tier1Findings: tier1.findings,
          imageProviderCalls: 0,
          billedArtworkAttempts: 0,
        });
        return;
      }

      const vision = await (deps.reviewRetainedArtwork ?? runVisionGate)({
        bytes: reviewedBytes,
        concept: row.concept,
        brief: effectiveBrief,
        reviewMode: "teaser",
      });
      if (vision.unavailable) {
        res.status(503).json({
          error: "The semantic artwork review is temporarily unavailable.",
          denial: "vision-review-unavailable",
          notes: vision.notes,
          imageProviderCalls: 0,
          billedArtworkAttempts: 0,
        });
        return;
      }
      if (!vision.passed) {
        res.status(422).json({
          error: "The retained artwork did not meet Posy's semantic quality standard.",
          denial: "vision-quality-rejected",
          failureCodes: vision.failureCodes,
          scores: vision.scores,
          requiredPresent: vision.requiredPresent,
          excludedFound: vision.excludedFound,
          notes: vision.notes,
          imageProviderCalls: 0,
          billedArtworkAttempts: 0,
        });
        return;
      }

      const saved = await savePreview({
        store: deps.previewStore,
        eventId: event.id,
        concept: row.concept,
        bytes,
        assetUrl: `data:image/png;base64,${bytes.toString("base64")}`,
        source: "ai-generated",
      });
      res.json({
        previewId: saved.record.previewId,
        assetHash: saved.record.assetHash,
        assetUrl: previewAssetUrl(ownerToken, saved.record.previewId),
        concept: saved.record.concept,
        reused: saved.reused,
        scores: vision.scores,
        requiredPresent: vision.requiredPresent,
        excludedFound: vision.excludedFound,
        notes: vision.notes,
        imageProviderCalls: 0,
        billedArtworkAttempts: 0,
      });
    }),
  );

  /**
   * Sweeps unused previews older than seven days. Promoted assets survive
   * indefinitely. Idempotent, so a cron can call it as often as it likes.
   */
  app.post(
    "/api/ai-first/cleanup-previews",
    gated(async (_req, res) => {
      const result = await cleanupPreviews(deps.previewStore);
      res.json(result);
    }),
  );
}

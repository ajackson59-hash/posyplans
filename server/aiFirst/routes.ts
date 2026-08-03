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
import { readFeatureFlags } from "@shared/featureFlags";
import { AI_FIRST_CONCEPT_KEY, themeFromSnapshot, type AiFirstSnapshot } from "@shared/aiFirstTheme";
import { buildThemedConcept } from "@shared/themeCatalog";
import { deriveThemeDna } from "@shared/themeDna";
import { computeEventDna } from "@shared/eventDna";
import { buildEventBrief, briefIsSufficient, SINGLE_BRIEF_QUESTION } from "./brief";
import { runAiFirstPipeline, type PipelineEvent, type PipelineInput, type RunSummary } from "./pipeline";
import { applyPreview, cleanupPreviews, resolvePreviewAssetBytes, type AiFirstPreviewStore } from "./previewStore";
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

/** One breaker and one limiter per process, shared by every event. */
const breaker = new CircuitBreaker();
const limiter = new RateLimiter();

export interface AiFirstDeps {
  storage: {
    getEventByOwnerToken(token: string): Promise<any>;
    updateEventByOwnerToken(token: string, data: Record<string, unknown>): Promise<any>;
    getEmailEntitlement(email: string): Promise<{ planTier: string } | undefined>;
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
}

/** The response stream, not request-body completion, owns SSE lifetime. */
export function abortOnUnexpectedResponseClose(res: Response, controller: AbortController): void {
  res.on("close", () => {
    if (!res.writableEnded) controller.abort(new Error("The invitation generation connection closed."));
  });
}

export function registerAiFirstRoutes(app: Express, deps: AiFirstDeps): void {
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

  app.get(
    "/api/events/owner/:ownerToken/ai-first/status",
    gated(async (req, res) => {
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
        killSwitch: flags().invitationGenerationKillSwitch,
        directionLimit: readAiFirstDirectionLimit(env()),
        // The one question a thin brief is allowed to ask, and only then.
        briefQuestion: briefIsSufficient(event) ? null : SINGLE_BRIEF_QUESTION,
        askPosyActions: INVITATION_ASK_POSY_ACTIONS,
      });
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
      if (flags().invitationGenerationKillSwitch) {
        res.status(403).json({
          error: "New invitation artwork is paused right now. The Posy collection and your saved designs are still available.",
          denial: "kill-switch",
          paused: true,
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

      const email = event.capturedEmail ?? undefined;
      const entitlement = email ? await deps.storage.getEmailEntitlement(email) : undefined;
      const tier = entitlement?.planTier as never;
      const usage = await deps.usageStore.snapshot(event.id, email, monthStart());
      // The durable row is the authority on "is a generation already active
      // for this event", not the in-process counter — correct across restarts
      // and across every Vercel instance, not just this one.
      const hasActiveRun = await deps.runStore.hasActiveRun(event.id);

      let artworkModel;
      try {
        artworkModel = readAiFirstArtworkModel(env());
      } catch (err) {
        // Configuration is validated before the run is claimed or any
        // provider path can be reached. Never silently fall back and spend.
        res.status(503).json({ error: (err as Error).message, denial: "invalid-provider-configuration" });
        return;
      }
      const directionLimit = readAiFirstDirectionLimit(env());
      const maxAttemptsPerDirection = flags().aiFirstDisableAutomaticRetry ? 1 : 2;

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

      // Everything the model needs is derived from data the host already
      // gave the app. Requirement 3's point: never re-ask a Concierge user.
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
          disableAutomaticRetry: flags().aiFirstDisableAutomaticRetry,
          directionLimit,
          artworkModel,
        });
      } catch (err) {
        const message = (err as Error).message;
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
      const appliedConcept = { ...buildThemedConcept(theme), [AI_FIRST_CONCEPT_KEY]: snapshot };
      const dna = deriveThemeDna(appliedConcept);

      const updated = await deps.storage.updateEventByOwnerToken(String(req.params.ownerToken), {
        inviteDesignConceptJson: JSON.stringify(appliedConcept),
        inviteIllustrationUrl: record.assetUrl,
        paletteColors: JSON.stringify(appliedConcept.paletteColors),
        envelopeColor: dna.primaryColor,
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
    gated(async (req, res) => {
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
          model: row.model,
          quality: row.quality,
          size: row.size,
          costUsdMicros: row.costUsdMicros,
          costEstimateStatus: row.size ? "model-size-priced" : "legacy-unverified",
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
    gated(async (req, res) => {
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

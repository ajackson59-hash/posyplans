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
import { runAiFirstPipeline, type PipelineEvent } from "./pipeline";
import { applyPreview, cleanupPreviews, type AiFirstPreviewStore } from "./previewStore";
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
  env?: Record<string, string | undefined>;
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
      res.json({
        plan: tierLabel(tier),
        ceilings: ceilingsForTier(tier),
        usage,
        killSwitch: flags().invitationGenerationKillSwitch,
        // The one question a thin brief is allowed to ask, and only then.
        briefQuestion: briefIsSufficient(event) ? null : SINGLE_BRIEF_QUESTION,
        askPosyActions: INVITATION_ASK_POSY_ACTIONS,
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
      const event = await deps.storage.getEventByOwnerToken(String(req.params.ownerToken));
      if (!event) {
        res.status(404).json({ error: "Event not found" });
        return;
      }

      const email = event.capturedEmail ?? undefined;
      const entitlement = email ? await deps.storage.getEmailEntitlement(email) : undefined;
      const tier = entitlement?.planTier as never;
      const usage = await deps.usageStore.snapshot(event.id, email, monthStart());

      const action = resolveAskPosyAction(req.body?.action, req.body);
      const guard = guardGeneration({
        eventId: event.id,
        email,
        tier,
        usage,
        // Four directions, each allowed one retry.
        requested: 8,
        killSwitch: flags().invitationGenerationKillSwitch,
        breaker,
        limiter,
        ownerToken: String(req.params.ownerToken),
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
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      };
      for (const warning of guard.warnings) {
        send({ type: "warning", message: warning, at: Date.now() });
      }

      const controller = new AbortController();
      req.on("close", () => controller.abort());
      deps.usageStore.beginRun?.(event.id);

      try {
        await runAiFirstPipeline({
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
        });
      } catch (err) {
        send({ type: "error", message: (err as Error).message, at: Date.now() });
      } finally {
        deps.usageStore.endRun?.(event.id);
        res.end();
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

import type { Express, Request, Response } from "express";
import { z } from "zod";
import type { AiFirstDeps } from "./routes";
import { mediumFeasibilityPage } from "./mediumFeasibilityPage";
import { FEASIBILITY_DATASET, FEASIBILITY_OWNER_EVENT, FEASIBILITY_PAID_ENABLED, FEASIBILITY_POLICY_HASH,
  feasibilityPreflight, feasibilityTeaser, runMediumFeasibility } from "./mediumFeasibility";

const bodySchema = z.object({ confirmBoundedFeasibility: z.literal(true), policyHash: z.literal(FEASIBILITY_POLICY_HASH) }).strict();
/** Owner 41 on the existing draft Preview branch only. No customer preview store is supplied. */
export function registerMediumFeasibilityRoutes(app: Express, deps: Pick<AiFirstDeps, "storage" | "artworkAttemptStore" | "env">) {
  const root = "/api/events/owner/:ownerToken/ai-first/review/medium-feasibility";
  const protect = (handler: (req: Request, res: Response, owner: { id: number; ownerToken: string }, env: Record<string, string | undefined>) => Promise<void>) =>
    async (req: Request, res: Response) => {
      res.setHeader("Cache-Control", "private, no-store");
      const env = deps.env ?? process.env;
      if (env.VERCEL_ENV !== "preview" || env.VERCEL_GIT_COMMIT_REF !== "codex/launch-blockers") {
        res.status(404).json({ error: "Not found" }); return;
      }
      try {
        const ownerToken = String(req.params.ownerToken), event = await deps.storage.getEventByOwnerToken(ownerToken);
        if (!event || event.id !== FEASIBILITY_OWNER_EVENT || event.ownerToken !== ownerToken) {
          res.status(404).json({ error: "Not found" }); return;
        }
        await handler(req, res, { id: event.id, ownerToken }, env);
      } catch {
        if (!res.headersSent) res.status(503).json({ error: "Private feasibility unavailable; never retry a claimed case" });
      }
    };
  app.get(`${root}/study`, protect(async (_req, res) => {
    res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src blob:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
    res.type("html").send(mediumFeasibilityPage);
  }));
  app.post(`${root}/:id/browser-observation`, protect(async (req, res, owner) => {
    const parsed = z.object({ reviewedAssetHash: z.string().regex(/^[a-f0-9]{64}$/), browserLoadedMs: z.number().finite().min(0).max(600_000) }).strict().safeParse(req.body);
    if (!parsed.success || !deps.artworkAttemptStore.recordOnce) { res.status(400).json({ error: "Invalid browser observation" }); return; }
    const row = await deps.artworkAttemptStore.findById(owner.id, owner.ownerToken, String(req.params.id));
    const evidence = row?.reviewEvidence;
    if (!row || evidence?.feasibility?.stage !== "completed" || evidence.feasibility.datasetId !== FEASIBILITY_DATASET ||
        parsed.data.reviewedAssetHash !== evidence.reviewedAssetHash) { res.status(409).json({ error: "Completed reviewed image required" }); return; }
    feasibilityTeaser(row);
    const saved = await deps.artworkAttemptStore.recordOnce({ ...row, bytes: Buffer.from(row.assetBytesBase64, "base64"),
      idempotencyKey: `${FEASIBILITY_DATASET}:${evidence.feasibility.caseId}:browser-observed`,
      reviewEvidence: { ...evidence, feasibility: { ...evidence.feasibility, stage: "browser-observed",
        browserLoadedMs: parsed.data.browserLoadedMs, humanReview: "pending" } } });
    if (!saved.record) { res.status(503).json({ error: "Observation retention unavailable" }); return; }
    res.json({ recorded: saved.created, scope: "owner-private-study-page", customerFlowVerified: false, humanReview: "pending" });
  }));
  app.get(root, protect(async (_req, res, owner, env) => {
    const preflight = await feasibilityPreflight(deps.artworkAttemptStore, owner, env.VERCEL_GIT_COMMIT_SHA ?? "unknown");
    res.json({ ...preflight, providerKeysConfigured: { openai: Boolean(env.OPENAI_API_KEY?.trim()),
      anthropic: Boolean(env.ANTHROPIC_API_KEY?.trim()) }, modelAccess: "requires-separate-non-generative-model-check" });
  }));
  app.post(`${root}/:caseId`, protect(async (req, res, owner, env) => {
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "Confirm the frozen bounded policy" }); return; }
    const controller = new AbortController();
    const close = () => { if (!res.writableEnded) controller.abort(); };
    res.on("close", close);
    try {
      const result = await runMediumFeasibility({ store: deps.artworkAttemptStore, owner,
        deploymentSha: env.VERCEL_GIT_COMMIT_SHA ?? "", caseId: String(req.params.caseId),
        policyHash: parsed.data.policyHash, paidEnabled: FEASIBILITY_PAID_ENABLED, signal: controller.signal });
      res.status(result.kind === "blocked" ? 409 : 200).json(result);
    } finally { res.off("close", close); }
  }));
  app.get(`${root}/:id/teaser`, protect(async (req, res, owner) => {
    const row = await deps.artworkAttemptStore.findById(owner.id, owner.ownerToken, String(req.params.id));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    const bytes = feasibilityTeaser(row);
    res.setHeader("Content-Type", "image/png"); res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Length", String(bytes.length)); res.end(bytes);
  }));
}

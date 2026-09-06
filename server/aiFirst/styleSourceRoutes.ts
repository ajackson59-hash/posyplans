import type { Express, Request, Response } from "express";
import { z } from "zod";
import type { AiFirstDeps } from "./routes";
import { prepareRetainedStyleSource, retainStyleSource, reviewRetainedStyleSource, sourceManifest } from "./styleSourceReview";

const uploadSchema = z.object({ sourceBase64: z.string().min(1).max(4_400_000)
  .regex(/^[A-Za-z0-9+/]*={0,2}$/).refine(value => value.length % 4 === 0) }).strict();
const reviewSchema = z.object({ confirmOneVisionCall: z.literal(true),
  expectedAssetHash: z.literal(sourceManifest.sourceSha256) }).strict();

/** Private operations only. No customer preview store or image provider. */
export function registerStyleSourceRoutes(app: Express, deps: Pick<AiFirstDeps, "storage" | "artworkAttemptStore" | "env">) {
  const root = "/api/events/owner/:ownerToken/ai-first/review/style-source";
  const protect = (handler: (req: Request, res: Response, owner: { id: number; ownerToken: string }) => Promise<void>) =>
    async (req: Request, res: Response) => {
      res.setHeader("Cache-Control", "private, no-store");
      const env = deps.env ?? process.env;
      if (env.VERCEL_ENV !== "preview" || env.VERCEL_GIT_COMMIT_REF !== "codex/launch-blockers") {
        res.status(404).json({ error: "Not found" }); return;
      }
      try {
        const ownerToken = String(req.params.ownerToken);
        const event = await deps.storage.getEventByOwnerToken(ownerToken);
        if (!event || event.ownerToken !== ownerToken || !Number.isSafeInteger(event.id) || event.id < 1) {
          res.status(404).json({ error: "Not found" }); return;
        }
        await handler(req, res, { id: event.id, ownerToken });
      } catch {
        // No source bytes, SDK error, credential or database query in logs/JSON.
        if (!res.headersSent) res.status(503).json({ error: "Private source operation unavailable" });
      }
    };

  app.post(root, protect(async (req, res, owner) => {
    const body = uploadSchema.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: "Invalid source upload" }); return; }
    // A server-owned manifest binds the upload to the exact style-approved
    // PNG. No customer-supplied hashes, approval fields, profiles or URLs.
    const bytes = Buffer.from(body.data.sourceBase64, "base64");
    if (bytes.toString("base64") !== body.data.sourceBase64) {
      res.status(400).json({ error: "Invalid source encoding" }); return;
    }
    const retained = await retainStyleSource(bytes, owner, deps.artworkAttemptStore);
    res.status(retained.created ? 201 : 200).json({ sourceId: sourceManifest.id,
      attemptId: retained.record.id, sourceHash: retained.record.assetHash,
      teaserHash: retained.teaserHash, imageProviderCalls: 0, criticRequests: 0,
      qualityReview: "pending", customerActivation: "disabled", reused: !retained.created });
  }));

  app.get(`${root}/:id/asset`, protect(async (req, res, owner) => {
    if (req.query.variant !== undefined && !["source", "teaser"].includes(String(req.query.variant))) {
      res.status(400).json({ error: "Invalid source variant" }); return;
    }
    const row = await deps.artworkAttemptStore.findById(owner.id, owner.ownerToken, String(req.params.id));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    const prepared = prepareRetainedStyleSource(row);
    const bytes = req.query.variant === "source" ? prepared.original : prepared.teaser;
    res.setHeader("Content-Type", "image/png");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Length", String(bytes.length));
    res.end(bytes);
  }));

  app.post(`${root}/:id/review`, protect(async (req, res, owner) => {
    const body = reviewSchema.safeParse(req.body);
    if (!body.success) { res.status(400).json({ error: "Confirm one review of the exact source hash" }); return; }
    const row = await deps.artworkAttemptStore.findById(owner.id, owner.ownerToken, String(req.params.id));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    const controller = new AbortController();
    const close = () => { if (!res.writableEnded) controller.abort(); };
    res.on("close", close);
    try {
      const result = await reviewRetainedStyleSource(row, { attemptStore: deps.artworkAttemptStore,
        environment: (deps.env ?? process.env).VERCEL_ENV, confirmOneVisionCall: true, signal: controller.signal });
      res.status(result.kind === "blocked" ? 409 : 200).json(result);
    } finally { res.off("close", close); }
  }));
}

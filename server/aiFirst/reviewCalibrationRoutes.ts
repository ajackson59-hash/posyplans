import type { Express } from "express";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import type { AiFirstDeps } from "./routes";
import { CALIBRATION_CASES, CALIBRATION_OWNER_EVENT, runReviewCalibration, type CalibrationCaseId } from "./reviewCalibration";

const requestSchema = z.object({ confirmOneVisionCall: z.literal(true),
  sourceBase64: z.string().min(4).max(2_100_000).regex(/^[A-Za-z0-9+/]*={0,2}$/)
    .refine(value => value.length % 4 === 0) }).strict();

/** Fixed owner, fixed controls, four global claims; never a general review API. */
export function registerReviewCalibrationRoutes(app: Express,
  deps: Pick<AiFirstDeps, "storage" | "artworkAttemptStore" | "env"> & { calibrationClient?: Anthropic }) {
  app.post("/api/events/owner/:ownerToken/ai-first/review/calibration/:caseId", async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    const environment = deps.env ?? process.env;
    if (environment.VERCEL_ENV !== "preview" || environment.VERCEL_GIT_COMMIT_REF !== "codex/launch-blockers") {
      res.status(404).json({ error: "Not found" }); return;
    }
    try {
      const ownerToken = String(req.params.ownerToken);
      const event = await deps.storage.getEventByOwnerToken(ownerToken);
      if (!event || event.id !== CALIBRATION_OWNER_EVENT || event.ownerToken !== ownerToken ||
          !Object.hasOwn(CALIBRATION_CASES, String(req.params.caseId))) {
        res.status(404).json({ error: "Not found" }); return;
      }
      const parsed = requestSchema.safeParse(req.body);
      if (!parsed.success) { res.status(400).json({ error: "Confirm one review of a fixed reference control" }); return; }
      const bytes = Buffer.from(parsed.data.sourceBase64, "base64");
      if (bytes.toString("base64") !== parsed.data.sourceBase64) {
        res.status(400).json({ error: "Invalid source encoding" }); return;
      }
      const controller = new AbortController();
      const close = () => { if (!res.writableEnded) controller.abort(); };
      res.on("close", close);
      try {
        const result = await runReviewCalibration({ caseId: String(req.params.caseId) as CalibrationCaseId,
          bytes, owner: { id: event.id, ownerToken }, environment, store: deps.artworkAttemptStore,
          client: deps.calibrationClient, signal: controller.signal });
        res.status(result.kind === "blocked" ? 409 : 200).json(result);
      } finally { res.off("close", close); }
    } catch {
      if (!res.headersSent) res.status(503).json({ error: "Private calibration unavailable; a claimed case cannot be retried" });
    }
  });
}

import type { Express } from "express";
import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import type { AiFirstDeps } from "./routes";
import { CALIBRATION_CASES, CONSISTENCY_CASES, REFERENCE_COMPARISON_CASES, CALIBRATION_OWNER_EVENT, runReviewCalibration, type CalibrationCaseId, type CalibrationDataset } from "./reviewCalibration";

const requestSchema = z.object({ confirmOneVisionCall: z.literal(true),
  sourceBase64: z.string().min(4).max(2_100_000).regex(/^[A-Za-z0-9+/]*={0,2}$/)
    .refine(value => value.length % 4 === 0) }).strict();
const referenceRequestSchema = requestSchema.extend({ referenceSourcesBase64: z.array(requestSchema.shape.sourceBase64).length(2) }).strict();

/** Fixed owner and controls; four original or eight consistency claims; never a general review API. */
export function registerReviewCalibrationRoutes(app: Express,
  deps: Pick<AiFirstDeps, "storage" | "artworkAttemptStore" | "env"> & { calibrationClient?: Anthropic },
  dataset?: CalibrationDataset) {
  const caseSet = dataset === "references-v1" ? REFERENCE_COMPARISON_CASES : dataset === "consistency-v1" ? CONSISTENCY_CASES : CALIBRATION_CASES;
  const path = dataset === "references-v1" ? "reference-comparison" : dataset === "consistency-v1" ? "consistency-calibration" : "calibration";
  app.post(`/api/events/owner/:ownerToken/ai-first/review/${path}/:caseId`, async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    const environment = deps.env ?? process.env;
    if (environment.VERCEL_ENV !== "preview" || environment.VERCEL_GIT_COMMIT_REF !== "codex/launch-blockers") {
      res.status(404).json({ error: "Not found" }); return;
    }
    try {
      const ownerToken = String(req.params.ownerToken);
      const event = await deps.storage.getEventByOwnerToken(ownerToken);
      if (!event || event.id !== CALIBRATION_OWNER_EVENT || event.ownerToken !== ownerToken ||
          !Object.hasOwn(caseSet, String(req.params.caseId))) {
        res.status(404).json({ error: "Not found" }); return;
      }
      const parsed = (dataset === "references-v1" ? referenceRequestSchema : requestSchema).safeParse(req.body);
      if (!parsed.success) { res.status(400).json({ error: "Confirm one review of a fixed reference control" }); return; }
      const bytes = Buffer.from(parsed.data.sourceBase64, "base64");
      const sources = "referenceSourcesBase64" in parsed.data ? parsed.data.referenceSourcesBase64 as string[] : [];
      if (sources.some(value => Buffer.from(value, "base64").toString("base64") !== value)) {
        res.status(400).json({ error: "Invalid reference encoding" }); return;
      }
      if (bytes.toString("base64") !== parsed.data.sourceBase64) {
        res.status(400).json({ error: "Invalid source encoding" }); return;
      }
      const controller = new AbortController();
      const close = () => { if (!res.writableEnded) controller.abort(); };
      res.on("close", close);
      try {
        const result = await runReviewCalibration({ dataset, caseId: String(req.params.caseId) as CalibrationCaseId,
          bytes, owner: { id: event.id, ownerToken }, environment, store: deps.artworkAttemptStore,
          referenceSources: sources.map(value => Buffer.from(value, "base64")),
          client: deps.calibrationClient, signal: controller.signal });
        res.status(result.kind === "blocked" ? 409 : 200).json(result);
      } finally { res.off("close", close); }
    } catch {
      if (!res.headersSent) res.status(503).json({ error: "Private calibration unavailable; a claimed case cannot be retried" });
    }
  });
}

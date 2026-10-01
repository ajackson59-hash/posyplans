import express from "express";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import request from "supertest";
import { readPngSize } from "../../server/aiFirst/png";
import type { Event } from "../../shared/schema";
import { registerPrePaymentPreviewQualityRoutes } from "../../server/prePaymentPreviewQualityRoutes";
import { markApprovedPreview } from "../../server/prePaymentPreviewImage";
import { InMemoryArtworkAttemptStore } from "../../server/aiFirst/artworkAttemptStore";

const file = process.env.POSY_QA_ARTWORK_PATH;
if (!file) throw new Error("Set POSY_QA_ARTWORK_PATH to an existing saved PNG");
const source = `data:image/png;base64,${readFileSync(file).toString("base64")}`;
const events = new Map(["legacy", "detail"].map((profile, index) => {
  const ownerToken = `qa-resolution-${profile}`;
  return [ownerToken, {
    id: 9100 + index, ownerToken, eventName: "Saved artwork resolution check",
    eventType: "Artwork evaluation", eventDate: "2026-09-15", themeName: "",
    vibeDescription: "Existing synthetic artwork for resolution verification only",
    paletteColors: "[]", prePaymentPreviewAttempts: 1, sparkUnlockedAt: null,
    prePaymentPreviewUsedAt: Date.now(),
    prePaymentPreviewUrl: markApprovedPreview(source, profile === "detail" ? "detail-v1" : "legacy"),
  } as unknown as Event];
}));
const noMutation = async (): Promise<never> => { throw new Error("Read-only QA fixture"); };
const app = express();
app.use((req, res, next) => {
  if (req.method !== "GET") { res.status(405).json({ error: "Read-only QA fixture" }); return; }
  next();
});
app.get("/api/checkout/config", (_req, res) => { res.json({ configured: false }); });
app.get("/api/events/owner/:ownerToken/master-planner/entitlement", (req, res) => {
  res.json({ eventId: events.get(req.params.ownerToken)?.id, canGenerate: false,
    planTier: "free", emailCaptured: false, freeDraftState: "none", sparkUnlocked: false });
});
registerPrePaymentPreviewQualityRoutes(app, {
  store: { getEventByOwnerToken: async token => events.get(token), updateEventById: noMutation,
    reservePrePaymentPreview: noMutation, completePrePaymentPreview: noMutation },
  artworkAttemptStore: new InMemoryArtworkAttemptStore(), isUnlocked: async () => false,
  mode: () => "quality-image", autoNamedEnabled: () => false,
  generate: noMutation, classifyNamedReference: noMutation,
  schedule: () => { throw new Error("Read-only QA fixture"); },
});
const capture = process.env.POSY_QA_CAPTURE_DIR;
if (capture) {
  mkdirSync(capture, { recursive: true });
  const responses: Record<string, unknown> = {};
  const measurements = [];
  for (const profile of ["legacy", "detail"]) {
    for (const suffix of ["prepayment-preview/asset", "prepayment-preview/readiness", "master-planner/entitlement"]) {
      const path = `/api/events/owner/qa-resolution-${profile}/${suffix}`;
      const res = await request(app).get(path);
      if (res.status !== 200) throw new Error(`QA route failed: ${suffix}`);
      if (suffix.endsWith("asset")) {
        const bytes = res.body as Buffer;
        responses[path] = { dataUrl: `data:image/png;base64,${bytes.toString("base64")}`, mime: "image/png" };
        writeFileSync(join(capture, `${profile}.png`), bytes);
        measurements.push({ profile, dimensions: readPngSize(bytes), bytes: bytes.length,
          sha256: createHash("sha256").update(bytes).digest("hex") });
      } else responses[path] = { json: res.body };
    }
  }
  responses["/api/checkout/config"] = { json: { configured: false } };
  writeFileSync(join(capture, "route-responses.json"), JSON.stringify(responses));
  writeFileSync(join(capture, "route-measurements.json"), JSON.stringify(measurements, null, 2));
  console.log(JSON.stringify(measurements));
} else app.listen(5200, "127.0.0.1", () => console.log("Read-only preview resolution fixture on 5200"));

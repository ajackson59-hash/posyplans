// @vitest-environment node
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { InMemoryArtworkAttemptStore } from "../server/aiFirst/artworkAttemptStore";
import registration from "../server/separatedResearchRegistration.json";
vi.mock("../server/storage", () => ({ storage: {} }));
vi.mock("../server/db", () => ({ db: {} }));
vi.mock("../server/separatedResearchStudy", () => ({ runSeparatedResearchStudy: vi.fn() }));
import { runSeparatedResearchStudy } from "../server/separatedResearchStudy";
import { registerPrePaymentPreviewQualityRoutes } from "../server/prePaymentPreviewQualityRoutes";
const run = vi.mocked(runSeparatedResearchStudy);
const path = "/api/events/owner/offline-owner/prepayment-preview/separated-research/fidelity-c01";
const body = { mode: "preflight", expectedReviewedHash: registration.requests[0].imageHash, candidateBase64: Buffer.from("offline").toString("base64") };
let owner: any;
beforeEach(() => {
  vi.stubEnv("VERCEL_ENV", "preview"); vi.stubEnv("VERCEL_GIT_COMMIT_REF", "codex/launch-blockers");
  owner = { id: 61, ownerToken: "offline-owner" }; run.mockReset();
  run.mockResolvedValue({ kind: "preflight", providerCalls: 0, customerActivation: "disabled" } as any);
});
afterEach(() => vi.unstubAllEnvs());
function app() {
  const a = express(); a.use(express.json({ limit: "4mb" }));
  registerPrePaymentPreviewQualityRoutes(a, { store: { getEventByOwnerToken: async (token: string) => token === "offline-owner" ? owner : undefined } as any,
    artworkAttemptStore: new InMemoryArtworkAttemptStore() });
  return a;
}
it("offers owner-only private preflight and passes no client-controlled registration or transport", async () => {
  const result = await request(app()).post(path).send(body);
  expect(result.status).toBe(200); expect(result.headers["cache-control"]).toBe("private, no-store");
  expect(run).toHaveBeenCalledTimes(1); expect(run.mock.calls[0]).toHaveLength(4);
  expect(run.mock.calls[0][3]).toMatchObject({ preflightOnly: true, closeOnly: false, candidate: Buffer.from("offline") });
});
it.each(["production", "wrong-branch", "wrong-owner", "wrong-event", "unknown-request"])("hides route for %s", async mode => {
  if (mode === "production") vi.stubEnv("VERCEL_ENV", "production");
  if (mode === "wrong-branch") vi.stubEnv("VERCEL_GIT_COMMIT_REF", "main");
  if (mode === "wrong-event") owner.id = 41;
  const url = mode === "wrong-owner" ? path.replace("offline-owner", "unknown") : mode === "unknown-request" ? path.replace("fidelity-c01", "craft-elsa") : path;
  expect((await request(app()).post(url).send(body)).status).toBe(404); expect(run).not.toHaveBeenCalled();
});
it.each(["confirmation", "hash", "extra-field", "encoding"])("rejects invalid %s without calling runner", async mode => {
  const b: any = { ...body };
  if (mode === "confirmation") b.mode = "review";
  if (mode === "hash") b.expectedReviewedHash = "changed";
  if (mode === "extra-field") b.authorizationStatus = "approved";
  if (mode === "encoding") b.candidateBase64 += " ";
  expect((await request(app()).post(path).send(b)).status).toBe(400); expect(run).not.toHaveBeenCalled();
});
it("requires confirmation for paid review and returns stopped/blocked states without retrying", async () => {
  run.mockResolvedValue({ kind: "blocked", reason: "separated-study-closed", customerActivation: "disabled" } as any);
  expect((await request(app()).post(path).send({ ...body, mode: "review", confirmOneVisionCall: true })).status).toBe(409);
  expect(run).toHaveBeenCalledTimes(1);
});

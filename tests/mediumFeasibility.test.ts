import express from "express";
import { Script } from "node:vm";
import { mediumFeasibilityPage } from "../server/aiFirst/mediumFeasibilityPage";
import request from "supertest";
import type Anthropic from "@anthropic-ai/sdk";
import { describe, it, expect, vi } from "vitest";
import { FEASIBILITY_POLICY_HASH, FEASIBILITY_PAID_ENABLED, feasibilityPreflight, feasibilityHash, feasibilityTeaser,
  runMediumFeasibility, type FeasibilityDependencies } from "../server/aiFirst/mediumFeasibility";
import { MEDIUM_FEASIBILITY_CASES } from "../server/aiFirst/mediumFeasibilityCases";
import { registerMediumFeasibilityRoutes } from "../server/aiFirst/mediumFeasibilityRoutes";
import { registerAiFirstRoutes } from "../server/aiFirst/routes";
import { InMemoryArtworkAttemptStore } from "../server/aiFirst/artworkAttemptStore";
import { encodePng, readPngSize } from "../server/aiFirst/png";
import { customerVisiblePreviewBytes } from "../server/prePaymentPreviewQuality";

const owner = { id: 41, ownerToken: "private-fixture-owner" };
const env = { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "codex/launch-blockers", VERCEL_GIT_COMMIT_SHA: "a".repeat(40) };
// These plain local pixels exercise accounting and byte identity, never visual quality.
const bytes = encodePng({ width: 1024, height: 1536, rgb: new Uint8Array(1024 * 1536 * 3).fill(150) });
function setup(options: { malformedCritic?: boolean; badCast?: boolean; unknownUsage?: boolean } = {}) {
  const store = new InMemoryArtworkAttemptStore();
  const create = vi.fn(async (body: any) => {
    if (body.model.includes("haiku")) return { stop_reason: "end_turn", usage: { input_tokens: 100, output_tokens: 50 },
      content: [{ type: "text", text: JSON.stringify({ named: true, label: body.messages[0].content.includes("Frozen") ? "Frozen" : "Moana",
        subjects: options.badCast ? ["Elsa", "Olaf"] : body.messages[0].content.includes("Frozen") ? ["Elsa", "Anna"] : ["Moana", "Maui"] }) }] };
    const scores = { textLogoWatermarkFree: 5, artifactFree: 5, premiumFinish: 5, briefFidelity: 5, compositionQuality: 5, ageAppropriate: 5 };
    return { stop_reason: "end_turn", usage: { input_tokens: 500, output_tokens: 400 }, content: [{ type: "text", text:
      options.malformedCritic ? "not-json" : JSON.stringify({ ...scores,
        requiredPresent: (body.output_config.format.schema.properties.requiredPresent.items.properties.requirement.enum ?? [])
          .map((requirement: string) => ({ requirement, present: true, evidence: "Located local test fixture" })),
        excludedFound: [], notes: "Test fixture only", dimensionAssessments: Object.fromEntries(Object.keys(scores).map(k =>
          [k, { status: "clear", criterion: "none", location: "Full canvas", observation: "Located fixture evidence" }])),
        teaserChecks: { milestone: { correct: true, evidence: "No numeral requested" }, identity: { accurate: true, evidence: "Fixture" },
          purchase: { wouldCreatePurchaseDesire: true, evidence: "Fixture" } } }) }] };
  });
  const generateImage = vi.fn(async () => ({ bytes, dataUrl: `data:image/png;base64,${bytes.toString("base64")}`, durationMs: 40_000,
    telemetry: { outputFormat: "jpeg" as const, providerRequestCount: 1, providerDurationMs: 39_900, normalizationDurationMs: 100,
      ...(options.unknownUsage ? {} : { responseUsage: { inputTokens: 100, outputTokens: 1000, textInputTokens: 100,
        imageInputTokens: 0, textOutputTokens: null, imageOutputTokens: null } }) } }));
  const args = (index = 0): FeasibilityDependencies => ({ store, owner, deploymentSha: env.VERCEL_GIT_COMMIT_SHA,
    caseId: MEDIUM_FEASIBILITY_CASES[index].trialId, policyHash: FEASIBILITY_POLICY_HASH, paidEnabled: true,
    generateImage, client: { messages: { create } } as unknown as Anthropic,
    runTier1: () => ({ passed: true, findings: [], salientRegions: [], durationMs: 0 }) });
  return { store, create, generateImage, args };
}

describe("bounded private medium feasibility", () => {
  it("serves valid private study controls with no automatic generation on page load", () => {
    const script = mediumFeasibilityPage.match(/<script type="module">([\s\S]*?)<\/script>/)![1];
    expect(() => new Script("(async()=>{" + script + "})")).not.toThrow();
    expect(mediumFeasibilityPage).toContain('<button id="run" disabled>');
    expect(script.indexOf("method:'POST'")).toBeGreaterThan(script.indexOf("run.addEventListener('click'"));
  });
  it("prepares all eight complete briefs without provider calls or durable mutations", async () => {
    const s = setup(); const result = await feasibilityPreflight(s.store, owner, env.VERCEL_GIT_COMMIT_SHA);
    expect(result.inputs).toHaveLength(8); expect(result.inputs.filter(i => !i.finalPrompt)).toHaveLength(2);
    for (const i of result.inputs) { expect(i.prompt).toContain(i.hostBrief); expect(feasibilityHash(i.hostBrief)).toBe(i.hostBriefSha256); }
    expect(result.paidEnabled).toBe(false); expect(s.store.all).toHaveLength(0);
    expect(s.create).not.toHaveBeenCalled(); expect(s.generateImage).not.toHaveBeenCalled();
  });
  it("completes exactly eight sequential trials with eight renders, eight single reviews and two classifications", async () => {
    const s = setup();
    for (let i = 0; i < 8; i++) {
      const result = await runMediumFeasibility(s.args(i));
      expect(result.kind).toBe("completed");
      if (result.kind === "completed") {
        expect(result.evidence.humanReview).toBe("pending"); expect(result.evidence.browserLoadedMs).toBeNull();
        expect(result.evidence.criticRequests).toBe(1); expect(result.evidence.imageProviderRequests).toBe(1);
        expect(result.evidence.prompt).toContain(MEDIUM_FEASIBILITY_CASES[i].hostBrief);
        const row = await s.store.findById(owner.id, owner.ownerToken, result.recordId);
        expect(feasibilityTeaser(row!)).toEqual(customerVisiblePreviewBytes(bytes));
        expect(readPngSize(feasibilityTeaser(row!))).toEqual({ width: 373, height: 560 });
      }
      expect((await runMediumFeasibility(s.args(i))).kind).toBe("blocked");
    }
    expect(s.generateImage).toHaveBeenCalledTimes(8); expect(s.create).toHaveBeenCalledTimes(10);
    for (const [body, options] of s.create.mock.calls as any) expect(options.maxRetries).toBe(0);
    for (const [payload] of s.generateImage.mock.calls as any) {
      expect(payload.quality).toBe("medium"); expect(payload.maxTransientRetries).toBe(0); expect(payload.referenceImages).toBeUndefined();
    }
    expect(s.store.all.every(r => r.status === "rejected" && r.previewId === null)).toBe(true);
  });
  it("permits only one dispatch under concurrent requests and rejects out-of-order cases", async () => {
    const s = setup(); expect((await runMediumFeasibility(s.args(1))).kind).toBe("blocked");
    const results = await Promise.all([runMediumFeasibility(s.args()), runMediumFeasibility(s.args())]);
    expect(results.filter(r => r.kind === "completed")).toHaveLength(1);
    expect(s.generateImage).toHaveBeenCalledTimes(1); expect(s.create).toHaveBeenCalledTimes(1);
  });
  it("retains the paid source and stops the cohort on unknown image accounting", async () => {
    const s = setup({ unknownUsage: true }); expect((await runMediumFeasibility(s.args())).kind).toBe("stopped");
    expect(s.store.all.some(r => r.assetHash === feasibilityHash(bytes))).toBe(true);
    expect(s.create).not.toHaveBeenCalled(); expect((await runMediumFeasibility(s.args(1))).kind).toBe("blocked");
    expect((await runMediumFeasibility(s.args())).kind).toBe("blocked");
  });
  it("makes no JSON repair request and stops after malformed review", async () => {
    const s = setup({ malformedCritic: true }); expect((await runMediumFeasibility(s.args())).kind).toBe("stopped");
    expect(s.create).toHaveBeenCalledTimes(1); expect((await runMediumFeasibility(s.args(1))).kind).toBe("blocked");
  });
  it("requires the exact Frozen cast before buying its image", async () => {
    const s = setup({ badCast: true }); await runMediumFeasibility(s.args());
    expect((await runMediumFeasibility(s.args(1))).kind).toBe("stopped"); expect(s.generateImage).toHaveBeenCalledTimes(1);
    expect((await runMediumFeasibility(s.args(2))).kind).toBe("blocked");
  });
  it("cannot spend after a claim failure or review after a source-retention failure", async () => {
    for (const stage of ["claimed", "generated"]) {
      const s = setup(); const real = s.store.recordOnce.bind(s.store);
      s.store.recordOnce = async input => { if (input.reviewEvidence?.feasibility?.stage === stage) throw new Error("database unavailable"); return real(input); };
      expect(["blocked", "stopped"]).toContain((await runMediumFeasibility(s.args())).kind);
      expect(s.generateImage).toHaveBeenCalledTimes(stage === "claimed" ? 0 : 1); expect(s.create).not.toHaveBeenCalled();
      expect((await runMediumFeasibility(s.args(1))).kind).toBe("blocked");
    }
  });
  it("keeps quality failures in the cohort, without buying a replacement or blocking the next scheduled case", async () => {
    const s = setup(); const args = s.args(); args.runTier1 = () => ({ passed: false, findings: [{ code: "text-detected", critical: true, message: "fixture lettering" }], salientRegions: [], durationMs: 0 });
    const failed = await runMediumFeasibility(args); expect(failed.kind).toBe("completed");
    if (failed.kind === "completed") expect(failed.evidence.outcome).toBe("quality-fail");
    expect((await runMediumFeasibility(args)).kind).toBe("blocked"); expect((await runMediumFeasibility(s.args(1))).kind).toBe("completed");
    expect(s.generateImage).toHaveBeenCalledTimes(2);
  });
  it("keeps paid HTTP operations disabled and hides all routes from Production and other owners", async () => {
    const s = setup(); expect(FEASIBILITY_PAID_ENABLED).toBe(false);
    const build = (environment = env) => { const app = express(); app.use(express.json());
      registerMediumFeasibilityRoutes(app, { env: environment, artworkAttemptStore: s.store,
        storage: { getEventByOwnerToken: async (token: string) => token === owner.ownerToken ? owner : { id: 42, ownerToken: token } } as any }); return app; };
    const root = `/api/events/owner/${owner.ownerToken}/ai-first/review/medium-feasibility`;
    expect((await request(build()).get(root)).status).toBe(200);
    expect((await request(build()).post(`${root}/${MEDIUM_FEASIBILITY_CASES[0].trialId}`).send({ confirmBoundedFeasibility: true, policyHash: FEASIBILITY_POLICY_HASH })).body.reason).toBe("fresh-paid-allowance-required");
    expect((await request(build({ ...env, VERCEL_ENV: "production" })).get(root)).status).toBe(404);
    expect((await request(build()).get(root.replace(owner.ownerToken, "other-owner"))).status).toBe(404);
    expect(s.store.all).toHaveLength(0);
  });
  it("rejects hash changes and promotion of private feasibility rows before any critic call", async () => {
    const s = setup(); const result = await runMediumFeasibility(s.args()); if (result.kind !== "completed") throw new Error("fixture failed");
    const row = await s.store.findById(owner.id, owner.ownerToken, result.recordId);
    expect(() => feasibilityTeaser({ ...row!, assetHash: "b".repeat(64) })).toThrow("source-hash-mismatch");
    const app = express(); app.use(express.json());
    registerAiFirstRoutes(app, { env, artworkAttemptStore: s.store, storage: { getEventByOwnerToken: async () => owner },
      reviewRetainedArtwork: async () => { throw new Error("Private study cannot be re-reviewed for promotion"); } } as any);
    const response = await request(app).post(`/api/events/owner/${owner.ownerToken}/ai-first/review/attempts/${result.recordId}/recheck`)
      .send({ confirmRetainedReview: true, expectedAssetHash: row!.assetHash });
    expect(response.status).toBe(409); expect(response.body.denial).toBe("scene-promotion-disabled");
  });
});

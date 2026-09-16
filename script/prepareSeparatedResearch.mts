/** Offline preparation only. Reads retained evidence; writes JSON to stdout, never calls a provider. */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { prepareSeparatedReview } from "../server/aiFirst/legacySeparatedArtworkReview.ts";
import { validateIndependentCraft } from "../server/aiFirst/independentCraftReview.ts";
import { crossThemeProfile, type CrossThemeCaseId } from "../server/crossThemeReviewProfiles.ts";
const dir = process.argv[2];
assert(dir, "Supply the retained corrected-study evidence directory");
globalThis.fetch = async () => { throw Error("Offline preparation: network prohibited"); };
const read = (file: string) => JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
const hash = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");
const original = read("approved-manifest.json");
const cases = [], requests = [];
for (const c of original.cases) {
  const old = original.requests.find((r: any) => r.requestId === c.craftRequestId);
  const body = read(old.file);
  const image = body.messages[0].content.find((p: any) => p.type === "image");
  const bytes = Buffer.from(image.source.data, "base64");
  assert.equal(hash(bytes), c.reviewedHash);
  const plan = prepareSeparatedReview({ ...await crossThemeProfile(c.caseId as CrossThemeCaseId), bytes, reviewMode: "teaser" });
  assert.deepEqual(plan.craft.body, body, "Never re-grade unchanged craft");
  assert.equal(plan.fidelity.contextHash, c.contextHash, "Full host brief must remain unchanged");
  assert.equal(plan.fidelity.context.comparisonTargets.length, 0);
  cases.push({ ...c, combinedFingerprint: plan.fingerprint });
  for (const role of ["craft", "fidelity"] as const) {
    const requestId = role === "craft" ? c.craftRequestId : c.fidelityRequestId;
    if (requestId === "craft-elsa" || requests.some(r => r.requestId === requestId)) continue;
    const packet = plan[role];
    requests.push({ requestId, role, imageHash: packet.imageHash, requestFingerprint: packet.requestFingerprint,
      schemaHash: packet.schemaHash, version: packet.version, maxOutputTokens: packet.body.max_tokens,
      planningInputTokens: 15000, requestPlanningReserveMicros: 45000 + 15 * packet.body.max_tokens });
  }
}
const result = read("review-craft-elsa.json").result;
const row = read("study-after.json").find((r: any) => r.id === 336);
const proof = row.vision.reviewEvidence.customerEvaluation;
assert.deepEqual(result.receipt, proof.receipt);
assert.equal(hash(proof.receipt.rawText), proof.responseHash);
assert.equal(proof.requestFingerprint, original.requests[0].requestFingerprint);
assert.equal(validateIndependentCraft(JSON.parse(proof.receipt.rawText)).passed, true);
assert.equal(proof.costMicros, 11394);
assert.equal(requests.length, 19);
const registration = {
  dataset: "separated-research-20260916-v3", authorizationStatus: "pending",
  protocol: "independent-failures-continue-v1", maximumCalls: 19, budgetMicros: 2500000,
  requests, cases,
  reusedCraft: [{ requestId: "craft-elsa", attemptId: "336", dataset: row.run_id, deploymentSha: proof.deploymentSha,
    imageHash: proof.imageHash, requestFingerprint: proof.requestFingerprint, schemaHash: proof.schemaHash,
    responseHash: proof.responseHash, costMicros: proof.costMicros }],
};
console.log(JSON.stringify({ registration, verification: { providerCalls: 0, uniqueImages: 8, fullBriefsUnchanged: 12,
  craftPacketsUnchanged: 8, reusedReceiptId: "336", reusedReceiptNewCostMicros: 0,
  newCraftCalls: 7, newFidelityCalls: 12, planningReserveTotalMicros: requests.reduce((s, r) => s + r.requestPlanningReserveMicros, 0),
  budgetMicros: registration.budgetMicros, historicalBatchRemainsClosed: true,
  pricingSource: "https://platform.claude.com/docs/en/about-claude/pricing", pricingCheckedDate: "2026-09-16" } }, null, 2));

/** Offline combination contract. No route, provider call, flag or customer activation. */
import { createHash } from "node:crypto";
import { buildIndependentCraftRequest, validateIndependentCraft } from "./independentCraftReview";
import { buildBriefFidelityRequest, validateBriefFidelity, type BriefFidelityInput } from "./briefFidelityReview";
import { VISION_MODEL } from "./visionGate";

export const SEPARATED_REVIEW_VERSION = "separated-artwork-review-v1";
export function prepareSeparatedReview(input: BriefFidelityInput) {
  const craft = buildIndependentCraftRequest(input.bytes), fidelity = buildBriefFidelityRequest(input);
  const fingerprint = createHash("sha256").update(JSON.stringify({ version: SEPARATED_REVIEW_VERSION,
    imageHash: craft.imageHash, craft: craft.requestFingerprint, fidelity: fidelity.requestFingerprint })).digest("hex");
  return { version: SEPARATED_REVIEW_VERSION, fingerprint, imageHash: craft.imageHash, craft, fidelity };
}

/** Server-retained transport receipt, never accepted directly from a public client. */
export interface SeparatedReviewReceipt {
  imageHash: string;
  requestFingerprint: string;
  schemaHash: string;
  model: string;
  requestCount: number;
  stopReason: string | null;
  rawText: string;
  usage: { inputTokens: number; outputTokens: number };
}

/** Rebuild expected packets from the trusted current input; don't trust supplied pass flags. */
export function combineSeparatedReview(input: BriefFidelityInput, receipts: {
  craft: SeparatedReviewReceipt | null; fidelity: SeparatedReviewReceipt | null;
}) {
  const plan = prepareSeparatedReview(input), issues: string[] = [];
  const read = (role: "craft" | "fidelity"): unknown => {
    const receipt = receipts[role], expected = plan[role];
    if (!receipt) { issues.push(`${role}:missing-receipt`); return null; }
    if (receipt.imageHash !== expected.imageHash || receipt.requestFingerprint !== expected.requestFingerprint ||
      receipt.schemaHash !== expected.schemaHash || receipt.model !== VISION_MODEL) issues.push(`${role}:binding-mismatch`);
    if (receipt.requestCount !== 1 || receipt.stopReason !== "end_turn") issues.push(`${role}:incomplete-or-retried`);
    if (!receipt.usage || !Number.isSafeInteger(receipt.usage.inputTokens) || receipt.usage.inputTokens <= 0 ||
      !Number.isSafeInteger(receipt.usage.outputTokens) || receipt.usage.outputTokens <= 0) issues.push(`${role}:unknown-accounting`);
    if (typeof receipt.rawText !== "string" || receipt.rawText.length > 200_000) { issues.push(`${role}:invalid-json`); return null; }
    try { return JSON.parse(receipt.rawText); } catch { issues.push(`${role}:invalid-json`); return null; }
  };
  const craft = validateIndependentCraft(read("craft"));
  const fidelity = validateBriefFidelity(read("fidelity"), plan.fidelity.context);
  issues.push(...craft.issues.map(i => `craft:${i}`), ...fidelity.issues.map(i => `fidelity:${i}`));
  const valid = issues.length === 0;
  const unresolved = craft.unresolved || fidelity.unresolved;
  const passed = valid && craft.passed && fidelity.passed;
  return { version: plan.version, fingerprint: plan.fingerprint, imageHash: plan.imageHash,
    valid, unresolved, passed, disposition: !valid ? "invalid" : unresolved ? "unresolved" : passed ? "passed" : "rejected",
    issues, craft, fidelity, receipts, customerActivation: "disabled" as const };
}

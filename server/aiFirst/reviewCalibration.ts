/** Fixed reference controls. No generation, customer approval or event mutation. */
import { createHash, randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import type { Event } from "@shared/schema";
import { buildQualityLockedPreviewBrief, customerVisiblePreviewBytes } from "../prePaymentPreviewQuality";
import { REVIEW_CALIBRATION_MODEL, type AiFirstArtworkAttemptStore, type ArtworkAttemptInput } from "./artworkAttemptStore";
import { sceneBriefDigest } from "./sceneComposition";
import { runVisionGate, visionCostUsd, type VisionVerdict } from "./visionGate";

export const CALIBRATION_DATASET = "identity-reference-controls-20260906-v1";
export const CALIBRATION_OWNER_EVENT = 41;
export const CALIBRATION_SOURCE = "https://www.netflix.com/tudum/articles/kpop-demon-hunters-cast";
const REVIEWER_VERSION = "551349f0b6bc759d109919c9f87d1da53334e305";
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const assets = {
  rumi: { sourceHash: "534d23bee02f125a69eebcac35bf0c8c25b658195928a530853b42529ec6ddb5",
    reviewedHash: "d1250022eb248fe16bc22f4d99d1c0ead19b88fc5a79179d122347138babaa88" },
  zoey: { sourceHash: "206292495edee079a83a4614e70e114567d1a952fbe13bc416d397c06c3d7863",
    reviewedHash: "43f2f3cd39d23c8cad05357920e4fcc40023634d8130534e9a8aac6f1666f2e6" },
} as const;

// Expectations stay outside the model request. Both profiles receive the same
// two-character reference notes, including on intentionally mismatched cases.
export const CALIBRATION_CASES = {
  "rumi-matched": { ...assets.rumi, requested: "Rumi", expectedIdentity: true },
  "rumi-mismatched": { ...assets.rumi, requested: "Zoey", expectedIdentity: false },
  "zoey-matched": { ...assets.zoey, requested: "Zoey", expectedIdentity: true },
  "zoey-mismatched": { ...assets.zoey, requested: "Rumi", expectedIdentity: false },
} as const;
export type CalibrationCaseId = keyof typeof CALIBRATION_CASES;
const REFERENCE_NOTES = `Character descriptions established from Netflix's official cast article and its labeled animated stills. Rumi: swept-up purple hair continuing into a long, thick braid; sharply defined dark eyebrows; a yellow performance jacket with contrasting dark trim. Zoey: dark hair with short blunt bangs and gathered braided sections; a turquoise cropped stage top with dark patterned trim; dangling earrings. Both are distinct animated members of HUNTR/X in KPop Demon Hunters. These descriptions identify the characters, not which character is present in the submitted pixels. Source provenance: ${CALIBRATION_SOURCE}`;

export async function calibrationProfile(caseId: CalibrationCaseId) {
  const control = CALIBRATION_CASES[caseId];
  const requiredIdentity = `${control.requested} from KPop Demon Hunters is visibly recognizable in the animated right-hand panel`;
  const { brief, concept } = await buildQualityLockedPreviewBrief({
    eventName: "Character portrait study", eventType: "Editorial portrait", themeName: "", paletteColors: "[]",
    vibeDescription: `An intentional editorial diptych: a photographic adult portrait on the left and a stylized 3D animated portrait of ${control.requested} from KPop Demon Hunters on the right. Preserve the mixed photographic and animated treatment.`,
  } as Event, REFERENCE_NOTES, null);
  brief.visualIdentityOverride = `${control.requested} from KPop Demon Hunters`;
  brief.requirements = { required: [`[VISIBLE NAMED IDENTITY] ${requiredIdentity}`], preferred: [], excluded: [] };
  return { brief, concept, requiredIdentity };
}

export async function runReviewCalibration(input: {
  caseId: CalibrationCaseId;
  bytes: Buffer;
  owner: { id: number; ownerToken: string };
  environment: NodeJS.ProcessEnv;
  store: AiFirstArtworkAttemptStore;
  client?: Anthropic;
  signal?: AbortSignal;
  timeoutMs?: number;
}) {
  const { owner, store, environment } = input;
  const control = CALIBRATION_CASES[input.caseId];
  if (environment.VERCEL_ENV !== "preview" || environment.VERCEL_GIT_COMMIT_REF !== "codex/launch-blockers" ||
      owner.id !== CALIBRATION_OWNER_EVENT || !owner.ownerToken || !store.recordOnce || !control || input.signal?.aborted) {
    return { kind: "blocked" as const, reason: "calibration-not-authorized" };
  }
  if (hash(input.bytes) !== control.sourceHash) return { kind: "blocked" as const, reason: "source-integrity" };
  const reviewed = customerVisiblePreviewBytes(input.bytes);
  if (hash(reviewed) !== control.reviewedHash) return { kind: "blocked" as const, reason: "reviewed-pixel-integrity" };
  const { brief, concept, requiredIdentity } = await calibrationProfile(input.caseId);
  const profileDigest = sceneBriefDigest(brief);
  const runId = `review-calibration-${randomUUID()}`;
  const key = `${CALIBRATION_DATASET}:${input.caseId}`;
  const calibration = { datasetId: CALIBRATION_DATASET, caseId: input.caseId, stage: "claimed" as const,
    profileDigest, sourceUrl: CALIBRATION_SOURCE, expectedIdentity: control.expectedIdentity,
    identityCorrect: null, deploymentSha: environment.VERCEL_GIT_COMMIT_SHA ?? null,
    reviewerVersion: REVIEWER_VERSION, imageProviderCalls: 0 as const, criticRequests: null,
    criticCostUsdMicrosFromUsage: null, customerActivation: "disabled" as const };
  const base: ArtworkAttemptInput = { eventId: owner.id, ownerToken: owner.ownerToken, runId,
    directionIndex: Object.keys(CALIBRATION_CASES).indexOf(input.caseId), attempt: 0,
    status: "rejected", previewId: null, bytes: input.bytes, concept,
    model: REVIEW_CALIBRATION_MODEL, quality: "not-applicable", size: null, costUsdMicros: 0,
    failureCodes: ["calibration-only-no-customer-approval"], tier1Findings: [], visionScores: null };
  const evidence = { version: 1 as const, reviewedAssetHash: control.reviewedHash,
    verdict: null, generationDurationMs: 0, calibration };
  // Four fixed global keys, claimed before dispatch. Restarts, another owner,
  // timeouts and redeployments cannot reset the four-call authorization.
  const claim = await store.recordOnce({ ...base, idempotencyKey: `${key}:claim`, reviewEvidence: evidence });
  if (!claim.created) return { kind: "blocked" as const, reason: "case-already-claimed" };
  if (!claim.record || claim.record.runId !== runId || claim.record.assetHash !== control.sourceHash ||
      claim.record.eventId !== owner.id || claim.record.ownerToken !== owner.ownerToken) {
    return { kind: "blocked" as const, reason: "claim-retention-failed" };
  }
  const controller = new AbortController();
  const cancel = () => controller.abort();
  input.signal?.addEventListener("abort", cancel, { once: true });
  const timeout = input.timeoutMs ?? 45_000;
  const timer = setTimeout(cancel, Number.isFinite(timeout) ? Math.max(1, Math.min(45_000, timeout)) : 45_000);
  let verdict: VisionVerdict;
  try {
    if (input.signal?.aborted) cancel();
    verdict = await runVisionGate({ bytes: reviewed, brief, concept, client: input.client,
      reviewMode: "teaser", maxFormatRepairs: 0, signal: controller.signal });
  } finally { clearTimeout(timer); input.signal?.removeEventListener("abort", cancel); }
  const observed = verdict.requiredPresent.find(row => row.requirement === requiredIdentity);
  const identityCorrect = !verdict.unavailable && !controller.signal.aborted && !input.signal?.aborted &&
    verdict.requestCount === 1 && verdict.teaserChecks?.identity.required === true &&
    verdict.teaserChecks.identity.accurate === control.expectedIdentity &&
    observed?.present === control.expectedIdentity && !!observed.evidence?.trim();
  const finalEvidence = { ...evidence, verdict, calibration: { ...calibration, stage: "completed" as const,
    identityCorrect, criticRequests: verdict.requestCount ?? 0,
    criticCostUsdMicrosFromUsage: verdict.unavailable ? null : Math.round(visionCostUsd(verdict.usage) * 1_000_000) } };
  const result = await store.recordOnce({ ...base, idempotencyKey: `${key}:result`, attempt: 1,
    visionScores: verdict.scores, reviewEvidence: finalEvidence });
  if (!result.created || !result.record || result.record.runId !== runId ||
      result.record.eventId !== owner.id || result.record.ownerToken !== owner.ownerToken ||
      result.record.assetHash !== control.sourceHash || result.record.status !== "rejected" || result.record.previewId) {
    return { kind: "blocked" as const, reason: "result-retention-failed" };
  }
  return { kind: "calibrated" as const, caseId: input.caseId, attemptId: result.record.id,
    sourceHash: control.sourceHash, reviewedHash: control.reviewedHash,
    expectedIdentity: control.expectedIdentity, identityCorrect, verdict,
    criticCostUsdMicrosFromUsage: finalEvidence.calibration.criticCostUsdMicrosFromUsage,
    imageProviderCalls: 0, criticRequests: verdict.requestCount ?? 0, customerActivation: "disabled" };
}

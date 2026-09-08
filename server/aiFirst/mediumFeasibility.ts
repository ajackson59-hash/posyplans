import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import type { Event } from "@shared/schema";
import { MEDIUM_FEASIBILITY_CASES } from "./mediumFeasibilityCases";
import type { AiFirstArtworkAttemptStore, ArtworkAttemptRecord } from "./artworkAttemptStore";
import { ArtworkNormalizationError, generateArtwork, sizeForAspect, type ArtworkGenerator, type ArtworkResult } from "./artwork";
import { readPngSize } from "./png";
import type { runTier1Checks } from "./tier1";
import { runVisionGate, type VisionVerdict } from "./visionGate";
import { buildQualityLockedPreviewBrief, customerVisiblePreviewBytes, detectNamedCreativeReference,
  detectNamedCreativeReferenceSync, generateQualityLockedPreview, type NamedCreativeReference } from "../prePaymentPreviewQuality";

export const FEASIBILITY_DATASET = "medium-feasibility-20260906-v1";
/** Deliberately disabled until the owner approves a new, concrete paid allowance. */
export const FEASIBILITY_PAID_ENABLED = false;
export const FEASIBILITY_OWNER_EVENT = 41;
export const feasibilityHash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
export const FEASIBILITY_POLICY = {
  datasetId: FEASIBILITY_DATASET, cases: MEDIUM_FEASIBILITY_CASES,
  imageModel: "gpt-image-2", quality: "medium", size: "1024x1536", imageRequests: 8,
  criticModel: "claude-sonnet-4-6", maxCriticRequests: 8, maxFormatRepairs: 0,
  classifierModel: "claude-haiku-4-5-20251001", maxClassifierRequests: 2,
  maxTransientRetries: 0, referenceImages: 0, highSiblings: 0, replacements: 0,
  failureCeilingMs: 150_000, customerActivation: "disabled", humanReview: "pending",
  releaseBenchmark: false, budgetReserveUsd: 2,
} as const;
export const FEASIBILITY_POLICY_HASH = feasibilityHash(JSON.stringify(FEASIBILITY_POLICY));

type Stage = "claimed" | "classification-claimed" | "classified" | "image-claimed" | "generated" | "review-claimed" | "completed" | "browser-observed";
type Usage = { inputTokens: number; outputTokens: number };
export interface FeasibilityEvidence {
  datasetId: string; caseId: string; policyHash: string; briefHash: string;
  deploymentSha: string; stage: Stage; customerActivation: "disabled"; humanReview: "pending";
  outcome: "pending" | "automated-pass" | "quality-fail" | "stopped";
  prompt: string | null; promptHash: string | null; resolvedIdentity: string | null;
  classifierRequests: number | null; imageProviderRequests: number | null; criticRequests: number | null;
  classifierUsage: Usage | null; criticUsage: Usage | null;
  imageUsage: NonNullable<ArtworkResult["telemetry"]>["responseUsage"] | null;
  /** Conservative image-output upper estimate when output token modalities are absent. Never an invoice total. */
  imageCostUsdMicrosUpperEstimate: number | null;
  criticCostUsdMicrosFromUsage: number | null; classifierCostUsdMicrosFromUsage: number | null;
  submittedAt: number; elapsedMs: number; classifierMs: number; generationMs: number; criticMs: number;
  persistenceMs: number; browserLoadedMs: number | null; stopReason: string | null;
}
const eventFor = (index: number): Event => ({ id: 0, eventName: "Artwork feasibility study", eventType: "Artwork study",
  themeName: "", vibeDescription: MEDIUM_FEASIBILITY_CASES[index].hostBrief, paletteColors: "[]" } as Event);
const finiteUsage = (value: any): Usage | null => value && [value.input_tokens, value.output_tokens]
  .every(n => Number.isSafeInteger(n) && n >= 0) ? { inputTokens: value.input_tokens, outputTokens: value.output_tokens } : null;

/** Exact current prompt builder, capture-only: no provider is reachable. Two payloads await paid classification. */
export async function feasibilityPreflight(store: AiFirstArtworkAttemptStore, owner: { id: number; ownerToken: string }, deploymentSha: string) {
  if (!store.recordOnce) throw new Error("durable-claims-unavailable");
  const rows = await store.listForOwner(owner.id, owner.ownerToken);
  const inputs = [];
  for (let index = 0; index < MEDIUM_FEASIBILITY_CASES.length; index++) {
    const item = MEDIUM_FEASIBILITY_CASES[index]; let prompt = "";
    await generateQualityLockedPreview(eventFor(index), { quality: "medium", maxCandidates: 1, parallelCandidates: false,
      allowTargetedCorrection: false, generateImage: async request => {
        assertRequest(request, item.hostBrief); prompt = request.prompt; throw new Error("OFFLINE_CAPTURE_ONLY");
      }, runVision: async () => { throw new Error("Preflight cannot review images"); } });
    if (!prompt || feasibilityHash(item.hostBrief) !== item.hostBriefSha256) throw new Error("frozen-input-drift");
    inputs.push({ ...item, prompt, promptHash: feasibilityHash(prompt), finalPrompt: item.classifierSubjects.length === 0,
      classification: item.classifierSubjects.length ? "fresh-classification-required-before-image" : "zero-call-curated-or-original" });
  }
  return { datasetId: FEASIBILITY_DATASET, policyHash: FEASIBILITY_POLICY_HASH, deploymentSha,
    paidEnabled: FEASIBILITY_PAID_ENABLED, physicalImageRequests: 0, physicalCriticRequests: 0, physicalClassifierRequests: 0,
    customerActivation: "disabled", inputs, records: rows.filter(r => r.reviewEvidence?.feasibility?.datasetId === FEASIBILITY_DATASET)
      .map(r => ({ id: r.id, assetHash: r.assetHash, evidence: r.reviewEvidence?.feasibility })) };
}
function assertRequest(request: Parameters<ArtworkGenerator>[0], hostBrief: string) {
  if (!request.prompt.includes(hostBrief) || request.model !== "gpt-image-2" || request.quality !== "medium" ||
      request.maxTransientRetries !== 0 || request.referenceImages?.length || request.outputFormat !== "jpeg" ||
      sizeForAspect(request.aspectRatio) !== "1024x1536") throw new Error("frozen-image-request-drift");
}

export interface FeasibilityDependencies {
  store: AiFirstArtworkAttemptStore; owner: { id: number; ownerToken: string };
  deploymentSha: string; caseId: string; policyHash: string; paidEnabled: boolean;
  signal?: AbortSignal; generateImage?: ArtworkGenerator; client?: Anthropic;
  /** Tests only; routes never inject a deterministic-check replacement. */
  runTier1?: typeof runTier1Checks;
}

/** One fixed case, in order. Every dispatch has its own durable claim; no response or crash is retryable. */
export async function runMediumFeasibility(input: FeasibilityDependencies) {
  const blocked = (reason: string) => ({ kind: "blocked" as const, reason });
  if (!input.paidEnabled) return blocked("fresh-paid-allowance-required");
  if (input.owner.id !== FEASIBILITY_OWNER_EVENT || input.policyHash !== FEASIBILITY_POLICY_HASH ||
      !/^[a-f0-9]{40}$/.test(input.deploymentSha)) return blocked("owner-policy-or-deployment-mismatch");
  const index = MEDIUM_FEASIBILITY_CASES.findIndex(c => c.trialId === input.caseId);
  if (index < 0 || !input.store.recordOnce) return blocked("fixed-case-or-durable-store-required");
  const item = MEDIUM_FEASIBILITY_CASES[index];
  const rows = await input.store.listForOwner(input.owner.id, input.owner.ownerToken);
  const cohort = rows.filter(r => r.reviewEvidence?.feasibility?.datasetId === FEASIBILITY_DATASET);
  if (cohort.some(r => r.reviewEvidence?.feasibility?.caseId === item.trialId)) return blocked("case-already-claimed");
  for (const earlier of MEDIUM_FEASIBILITY_CASES.slice(0, index)) {
    const completed = cohort.find(r => r.reviewEvidence?.feasibility?.caseId === earlier.trialId && r.reviewEvidence.feasibility.stage === "completed");
    const evidence = completed?.reviewEvidence?.feasibility;
    if (!evidence || !["automated-pass", "quality-fail"].includes(evidence.outcome) || evidence.policyHash !== FEASIBILITY_POLICY_HASH ||
        evidence.deploymentSha !== input.deploymentSha) return blocked("previous-case-incomplete-stopped-or-different-deployment");
  }
  const signal = input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(150_000)]) : AbortSignal.timeout(150_000);
  const event = eventFor(index), started = Date.now();
  let prepared = await buildQualityLockedPreviewBrief(event);
  let original = Buffer.alloc(0), reviewedHash: string | null = null, verdict: VisionVerdict | null = null;
  let generation: ArtworkResult | undefined;
  const evidence: FeasibilityEvidence = { datasetId: FEASIBILITY_DATASET, caseId: item.trialId, policyHash: FEASIBILITY_POLICY_HASH,
    briefHash: item.hostBriefSha256, deploymentSha: input.deploymentSha, stage: "claimed", customerActivation: "disabled",
    humanReview: "pending", outcome: "pending", prompt: null, promptHash: null, resolvedIdentity: null,
    classifierRequests: 0, imageProviderRequests: 0, criticRequests: 0, classifierUsage: null, criticUsage: null, imageUsage: null,
    imageCostUsdMicrosUpperEstimate: 0, criticCostUsdMicrosFromUsage: 0, classifierCostUsdMicrosFromUsage: 0,
    submittedAt: started, elapsedMs: 0, classifierMs: 0, generationMs: 0, criticMs: 0, persistenceMs: 0,
    browserLoadedMs: null, stopReason: null };
  const persist = async (stage: Stage, failureCodes: string[] = []) => {
    const before = Date.now(); evidence.stage = stage; evidence.elapsedMs = before - started;
    const saved = await input.store.recordOnce!({ eventId: input.owner.id, ownerToken: input.owner.ownerToken,
      idempotencyKey: `${FEASIBILITY_DATASET}:${item.trialId}:${stage}`, runId: FEASIBILITY_DATASET,
      directionIndex: index, attempt: 1, status: "rejected", previewId: null, bytes: original,
      concept: prepared.concept, failureCodes, tier1Findings: [], visionScores: verdict?.scores ?? null,
      model: "gpt-image-2", quality: "medium", size: "1024x1536", costUsdMicros: 0,
      reviewEvidence: { version: 1, reviewedAssetHash: reviewedHash, verdict,
        generationDurationMs: generation?.durationMs ?? 0, generationTelemetry: generation?.telemetry,
        feasibility: structuredClone(evidence) } });
    if (!saved.created || !saved.record) throw new Error("durable-claim-or-retention-failed");
    const readback = await input.store.findById(input.owner.id, input.owner.ownerToken, saved.record.id);
    if (!readback || readback.assetHash !== feasibilityHash(original) ||
        feasibilityHash(Buffer.from(readback.assetBytesBase64, "base64")) !== readback.assetHash ||
        JSON.stringify(readback.reviewEvidence?.feasibility) !== JSON.stringify(evidence)) throw new Error("retention-readback-mismatch");
    evidence.persistenceMs += Date.now() - before;
    return readback;
  };
  // A conflicting insert cannot enter the provider path. Errors deliberately do not expose SDK requests/credentials.
  try { await persist("claimed"); } catch { return blocked("durable-claim-or-retention-failed"); }
  let stopReason: string | null = null;
  try {
    signal.throwIfAborted();
    let named: NamedCreativeReference | null = detectNamedCreativeReferenceSync(item.hostBrief);
    const client = input.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0 });
    if (item.classifierSubjects.length) {
      evidence.classifierRequests = null; evidence.classifierCostUsdMicrosFromUsage = null;
      await persist("classification-claimed"); signal.throwIfAborted();
      let dispatches = 0; const t = Date.now();
      const classifier = { messages: { create: async (body: any, options: any) => {
        if (++dispatches !== 1 || options?.maxRetries !== 0 || body.max_tokens !== 350 ||
          body.model !== FEASIBILITY_POLICY.classifierModel || body.messages[0]?.content !== item.hostBrief) throw new Error("classifier-request-drift");
        const response = await client.messages.create(body, { ...options, maxRetries: 0 }).catch(() => { throw new Error("Private provider request unavailable"); });
        evidence.classifierRequests = dispatches; evidence.classifierUsage = finiteUsage(response.usage);
        return response;
      } } } as unknown as Anthropic;
      named = await detectNamedCreativeReference(item.hostBrief, { client: classifier, signal, requireResolvedClassification: true, bypassCache: true });
      evidence.classifierMs = Date.now() - t;
      if (dispatches !== 1 || !evidence.classifierUsage) throw new Error("classifier-accounting-unknown");
      evidence.classifierCostUsdMicrosFromUsage = evidence.classifierUsage.inputTokens + evidence.classifierUsage.outputTokens * 5;
      // Classifier may provide the property label; its cast must exactly match the frozen host request.
      const cast = named?.requirements.filter(r => r.includes("is independently recognizable through canonical")) ?? [];
      if (!named || cast.length !== item.classifierSubjects.length || item.classifierSubjects.some(subject =>
        !cast.some(r => r.startsWith(`${subject} is independently recognizable`)))) throw new Error("classifier-cast-drift");
      evidence.resolvedIdentity = named.label;
      prepared = await buildQualityLockedPreviewBrief(event, "", named);
      await persist("classified");
    } else evidence.resolvedIdentity = named?.label ?? null;
    const result = await generateQualityLockedPreview(event, {
      quality: "medium", maxCandidates: 1, parallelCandidates: false, allowTargetedCorrection: false, namedReference: named, signal, runTier1: input.runTier1,
      generateImage: async request => {
        assertRequest(request, item.hostBrief);
        if (evidence.imageProviderRequests !== 0) throw new Error("image-request-limit");
        evidence.prompt = request.prompt; evidence.promptHash = feasibilityHash(request.prompt);
        evidence.imageProviderRequests = null; evidence.imageCostUsdMicrosUpperEstimate = null;
        await persist("image-claimed"); signal.throwIfAborted();
        try { generation = await (input.generateImage ?? generateArtwork)(request); }
        catch (error) {
          if (error instanceof ArtworkNormalizationError) { generation = error.result; original = generation.bytes; await persist("generated", ["normalization-unavailable"]); }
          throw new Error("image-provider-or-normalization-unavailable");
        }
        original = generation.bytes; evidence.generationMs = generation.durationMs;
        evidence.imageProviderRequests = generation.telemetry?.providerRequestCount ?? null;
        evidence.imageUsage = generation.telemetry?.responseUsage ?? null;
        // Preserve the paid source BEFORE any normalizer, critic or accounting check can fail.
        await persist("generated");
        if (evidence.imageProviderRequests !== 1 || !evidence.imageUsage) throw new Error("image-accounting-unknown");
        const u = evidence.imageUsage;
        evidence.imageCostUsdMicrosUpperEstimate = u.textInputTokens * 5 + u.imageInputTokens * 8 + u.outputTokens * 30;
        const dimensions = readPngSize(original);
        if (!dimensions || dimensions.width !== 1024 || dimensions.height !== 1536) throw new Error("source-dimensions-drift");
        reviewedHash = feasibilityHash(customerVisiblePreviewBytes(original));
        return generation;
      },
      runVision: async request => {
        if (evidence.criticRequests !== 0 || feasibilityHash(request.bytes) !== reviewedHash || request.referenceImages?.length) throw new Error("critic-request-or-hash-drift");
        evidence.criticRequests = null; evidence.criticCostUsdMicrosFromUsage = null;
        await persist("review-claimed"); signal.throwIfAborted();
        let dispatches = 0;
        const critic = { messages: { create: async (body: any, options: any) => {
          if (++dispatches !== 1 || options?.maxRetries !== 0 || body.model !== FEASIBILITY_POLICY.criticModel) throw new Error("critic-request-limit");
          const response = await client.messages.create(body, { ...options, maxRetries: 0 }).catch(() => { throw new Error("Private provider request unavailable"); });
          evidence.criticRequests = dispatches; evidence.criticUsage = finiteUsage(response.usage);
          return response;
        } } } as unknown as Anthropic;
        verdict = await runVisionGate({ ...request, client: critic, maxFormatRepairs: 0, referenceImages: undefined });
        evidence.criticMs = verdict.durationMs;
        if (dispatches !== 1 || verdict.requestCount !== 1 || !evidence.criticUsage) throw new Error("critic-accounting-unknown");
        evidence.criticCostUsdMicrosFromUsage = evidence.criticUsage.inputTokens * 3 + evidence.criticUsage.outputTokens * 15;
        if (verdict.unavailable) throw new Error("critic-unavailable");
        return verdict;
      },
    });
    if (result.kind === "unavailable" || signal.aborted) throw new Error("provider-retention-or-review-unavailable");
    if (!generation || !evidence.promptHash || !reviewedHash || evidence.imageProviderRequests !== 1 ||
      evidence.criticRequests === null || evidence.imageUsage === null) throw new Error("incomplete-accounting-or-image");
    evidence.outcome = result.kind === "approved-image" ? "automated-pass" : "quality-fail";
    const final = await persist("completed", result.reviews.flatMap(r => r.failureCodes));
    return { kind: "completed" as const, recordId: final.id, assetHash: final.assetHash, reviewedAssetHash: reviewedHash,
      evidence: final.reviewEvidence!.feasibility!, durationThroughFinalPersistenceMs: Date.now() - started };
  } catch {
    stopReason = signal.aborted ? "deadline-or-disconnect" : "provider-accounting-classification-or-retention-failure";
    evidence.outcome = "stopped"; evidence.stopReason = stopReason;
    // A failed retention attempt cannot unlock the next case. If this also fails the prior claim stays incomplete.
    try { await persist("completed", [stopReason]); } catch { /* fail closed; claimed case remains consumed */ }
    return { kind: "stopped" as const, reason: stopReason, caseId: item.trialId };
  }
}

export function feasibilityTeaser(row: ArtworkAttemptRecord): Buffer {
  const evidence = row.reviewEvidence;
  if (evidence?.feasibility?.datasetId !== FEASIBILITY_DATASET || evidence.feasibility.stage !== "completed" ||
      !evidence.reviewedAssetHash) throw new Error("no-completed-review-pixels");
  const original = Buffer.from(row.assetBytesBase64, "base64");
  if (feasibilityHash(original) !== row.assetHash) throw new Error("source-hash-mismatch");
  const teaser = customerVisiblePreviewBytes(original);
  if (feasibilityHash(teaser) !== evidence.reviewedAssetHash) throw new Error("reviewed-hash-mismatch");
  return teaser;
}

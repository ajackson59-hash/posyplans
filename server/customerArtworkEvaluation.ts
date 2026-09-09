// Instrument the approved, fixed Preview fixtures through the ordinary customer
// route. Provider inputs/policy are unchanged; every dispatch is durably claimed.
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import type { Event } from "@shared/schema";
import type { AiFirstArtworkAttemptStore } from "./aiFirst/artworkAttemptStore";
import { MEDIUM_FEASIBILITY_CASES } from "./aiFirst/mediumFeasibilityCases";
import { ArtworkProviderError, ArtworkNormalizationError, generateArtwork, type ArtworkResult } from "./aiFirst/artwork";
import { runVisionGate, type VisionVerdict } from "./aiFirst/visionGate";
import { buildQualityLockedPreviewBrief, customerVisiblePreviewBytes, detectNamedCreativeReference,
  generateQualityLockedPreview, type PreviewQualityDependencies } from "./prePaymentPreviewQuality";

export const CUSTOMER_EVALUATION_EVENTS: readonly number[] = [42, 43, 44, 45, 46, 47, 48, 49];
export const CUSTOMER_EVALUATION_DATASET = "customer-artwork-20260909";
const hash = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

export function customerArtworkEvaluation(event: Event, store: AiFirstArtworkAttemptStore) {
  const index = CUSTOMER_EVALUATION_EVENTS.indexOf(event.id);
  if (process.env.VERCEL_ENV !== "preview" || index < 0) return null;
  const item = MEDIUM_FEASIBILITY_CASES[index];
  if (event.eventName !== "Artwork evaluation" || event.eventType !== "Artwork evaluation" ||
      event.inviteStatus !== "draft" || event.themeName !== "" || event.paletteColors !== "[]" ||
      hash(event.vibeDescription) !== item.hostBriefSha256 || !store.recordOnce) {
    throw new Error("customer-evaluation-fixture-or-retention-drift");
  }
  const caseId = `${CUSTOMER_EVALUATION_DATASET}-${String(index + 1).padStart(2, "0")}`;
  const evidence: Record<string, unknown> = {
    datasetId: CUSTOMER_EVALUATION_DATASET, caseId, deploymentSha: process.env.VERCEL_GIT_COMMIT_SHA,
    hostBriefSha256: item.hostBriefSha256, humanReview: "pending", customerRoute: true,
    imageRequests: 0, criticRequests: 0, classifierRequests: 0, stage: "registered",
  };
  let source = Buffer.alloc(0), generation: ArtworkResult | undefined, verdict: VisionVerdict | null = null;
  let claim: Promise<unknown> | undefined;
  const save = async (stage: string) => {
    const persistenceStarted = Date.now();
    const { concept } = await buildQualityLockedPreviewBrief(event);
    let reviewedAssetHash: string | null = null;
    try { if (source.length) reviewedAssetHash = hash(customerVisiblePreviewBytes(source)); } catch { /* retain undecodable source */ }
    evidence.stage = stage; evidence.recordedAt = Date.now();
    const saved = await store.recordOnce!({
      eventId: event.id, ownerToken: event.ownerToken, runId: CUSTOMER_EVALUATION_DATASET,
      idempotencyKey: `${caseId}:${stage}`, directionIndex: index, attempt: 1,
      status: "rejected", bytes: source, previewId: null, concept,
      failureCodes: [], tier1Findings: [], visionScores: verdict?.scores ?? null,
      model: "gpt-image-2", quality: "medium", size: "1024x1536", costUsdMicros: 0,
      reviewEvidence: { version: 1, reviewedAssetHash,
        verdict, generationDurationMs: generation?.durationMs ?? 0, generationTelemetry: generation?.telemetry,
        customerEvaluation: structuredClone(evidence) },
    });
    if (!saved.created || !saved.record) throw new Error("customer-evaluation-claim-conflict");
    const read = await store.findById(event.id, event.ownerToken, saved.record.id);
    if (!read || read.assetHash !== hash(source) || hash(Buffer.from(read.assetBytesBase64, "base64")) !== read.assetHash ||
        JSON.stringify(read.reviewEvidence?.customerEvaluation) !== JSON.stringify(evidence)) {
      throw new Error("customer-evaluation-retention-mismatch");
    }
    evidence.persistenceMs = Number(evidence.persistenceMs ?? 0) + Date.now() - persistenceStarted;
  };
  const ensureClaim = () => claim ??= save("claimed");
  return {
    classify: async (text: string, signal?: AbortSignal) => {
      await ensureClaim();
      if (text !== [event.eventName, event.eventType, event.themeName, event.vibeDescription].filter(Boolean).join(" ")) {
        throw new Error("customer-evaluation-classifier-brief-drift");
      }
      const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0 });
      const observed = { messages: { create: async (body: any, options: any) => {
        if (evidence.classifierRequests !== 0 || body.model !== "claude-haiku-4-5-20251001" || options?.maxRetries !== 0) {
          throw new Error("customer-evaluation-classifier-limit");
        }
        evidence.classifierRequests = null; evidence.classifierRequest = body;
        await save("classification-claimed"); signal?.throwIfAborted();
        const started = Date.now();
        const response = await client.messages.create(body, options);
        evidence.classifierRequests = 1; evidence.classifierMs = Date.now() - started;
        evidence.classifierUsage = response.usage; evidence.classifierResponse = response.content;
        await save("classifier-returned");
        if (![response.usage?.input_tokens, response.usage?.output_tokens].every(Number.isSafeInteger)) {
          throw new Error("customer-evaluation-classifier-accounting");
        }
        return response;
      } } } as unknown as Anthropic;
      const named = await detectNamedCreativeReference(text, { client: observed, signal, requireResolvedClassification: true });
      evidence.classification = named ? { ...named, trigger: named.trigger.source } : null;
      const cast = named?.requirements.filter(r => r.includes("is independently recognizable through canonical")) ?? [];
      const expected = item.classifierSubjects as readonly string[];
      if (expected.length ? !named || cast.length !== expected.length || expected.some(s => !cast.some(r => r.startsWith(`${s} is independently recognizable`))) : named !== null) {
        evidence.stopReason = "classifier-cast-drift"; await save("classification-failed");
        throw new Error("customer-evaluation-classifier-cast-drift");
      }
      await save("classified"); return named;
    },
    generate: async (input: Event, options: PreviewQualityDependencies = {}) => {
      await ensureClaim();
      if (options.quality !== "medium" || options.maxCandidates !== 1 || options.parallelCandidates !== false ||
          options.maxFormatRepairs !== 0 || options.allowTargetedCorrection !== false) throw new Error("customer-evaluation-policy-drift");
      evidence.classification ??= options.namedReference ? { ...options.namedReference, trigger: options.namedReference.trigger.source } : null;
      const result = await generateQualityLockedPreview(input, { ...options,
        generateImage: async request => {
          if (evidence.imageRequests !== 0 || !request.prompt.includes(item.hostBrief) || request.model !== "gpt-image-2" ||
              request.quality !== "medium" || request.maxTransientRetries !== 0 || request.referenceImages?.length || request.outputFormat !== "jpeg") {
            throw new Error("customer-evaluation-image-request-drift");
          }
          const { signal, ...payload } = request;
          evidence.imageRequest = payload; evidence.promptSha256 = hash(request.prompt); evidence.imageRequests = null;
          await save("image-claimed"); signal?.throwIfAborted();
          try { generation = await generateArtwork(request); }
          catch (error) {
            if (error instanceof ArtworkNormalizationError) { generation = error.result; source = generation.bytes; }
            if (error instanceof ArtworkProviderError) {
              evidence.providerFailure = error.diagnostics; evidence.imageRequests = error.diagnostics.providerRequestCount;
            }
            evidence.stopReason = "image-provider-unavailable"; await save("image-failed"); throw error;
          }
          source = generation.bytes; evidence.imageRequests = generation.telemetry?.providerRequestCount ?? null;
          evidence.generationMs = generation.durationMs; evidence.imageUsage = generation.telemetry?.responseUsage ?? null;
          await save("generated");
          if (evidence.imageRequests !== 1 || !evidence.imageUsage) throw new Error("customer-evaluation-image-accounting");
          return generation;
        },
        runVision: async request => {
          if (evidence.criticRequests !== 0 || request.maxFormatRepairs !== 0 || request.referenceImages?.length ||
              hash(request.bytes) !== hash(customerVisiblePreviewBytes(source))) throw new Error("customer-evaluation-review-drift");
          evidence.criticRequests = null; await save("review-claimed"); request.signal?.throwIfAborted();
          const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 0 });
          let dispatches = 0;
          const observed = { messages: { create: async (body: any, options: any) => {
            if (++dispatches !== 1 || body.model !== "claude-sonnet-4-6" || options?.maxRetries !== 0) {
              throw new Error("customer-evaluation-critic-limit");
            }
            const response = await client.messages.create(body, options);
            evidence.criticResponseUsage = response.usage;
            if (![response.usage?.input_tokens, response.usage?.output_tokens].every(Number.isSafeInteger)) {
              throw new Error("customer-evaluation-critic-accounting");
            }
            return response;
          } } } as unknown as Anthropic;
          verdict = await runVisionGate({ ...request, client: observed });
          evidence.criticRequests = verdict.requestCount ?? null; evidence.criticMs = verdict.durationMs; evidence.criticUsage = verdict.usage;
          await save("reviewed");
          if (verdict.requestCount !== 1 || verdict.unavailable) throw new Error("customer-evaluation-review-unavailable");
          return verdict;
        },
      });
      evidence.outcome = result.kind; evidence.failureCodes = result.reviews.flatMap(r => r.failureCodes);
      await save("completed");
      return result;
    },
  };
}

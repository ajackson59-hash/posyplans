/** Approved research-only scheduler. Private Preview route; no customer activation.
 * Invalid model reports are retained failures, not reasons to abandon independent cases.
 * Unknown accounting, transport integrity or retention still fail closed. Old runners are untouched. */
import Anthropic from "@anthropic-ai/sdk";
import { createHash } from "node:crypto";
import type { Event } from "@shared/schema";
import { REVIEW_CALIBRATION_MODEL, type AiFirstArtworkAttemptStore, type ArtworkAttemptInput } from "./aiFirst/artworkAttemptStore";
import { MEDIUM_FEASIBILITY_CASES } from "./aiFirst/mediumFeasibilityCases";
import { crossThemeProfile, type CrossThemeCaseId } from "./crossThemeReviewProfiles";
import { prepareSeparatedReview, combineSeparatedReview, type SeparatedReviewReceipt } from "./aiFirst/separatedArtworkReview";
import { validateIndependentCraft } from "./aiFirst/independentCraftReview";
import { validateBriefFidelity } from "./aiFirst/briefFidelityReview";
import { VISION_MODEL } from "./aiFirst/visionGate";
import { reviewProviderError } from "./aiFirst/reviewProviderError";
import proposedRegistration from "./separatedResearchRegistration.json";

export type ResearchRegistration = Omit<typeof proposedRegistration, "authorizationStatus"> & { authorizationStatus: "pending" | "approved" };
const hash = (v: string | Buffer) => createHash("sha256").update(v).digest("hex");
const cost = (r: SeparatedReviewReceipt) => r.usage.inputTokens * 3 + r.usage.outputTokens * 15;
function receiptMatches(receipt: SeparatedReviewReceipt | null, r: { imageHash: string; requestFingerprint: string; schemaHash: string }) {
  return !!receipt && receipt.imageHash === r.imageHash && receipt.requestFingerprint === r.requestFingerprint &&
    receipt.schemaHash === r.schemaHash && receipt.model === VISION_MODEL && receipt.requestCount === 1 &&
    !!receipt.usage && Number.isSafeInteger(receipt.usage.inputTokens) && receipt.usage.inputTokens > 0 &&
    Number.isSafeInteger(receipt.usage.outputTokens) && receipt.usage.outputTokens > 0 &&
    typeof receipt.rawText === "string" && receipt.rawText.length <= 200_000;
}
/** Prices are the registered standard/global, uncached Sonnet 4.6 rates only. */
function standardUsage(usage: unknown, receipt: SeparatedReviewReceipt | null) {
  const u = usage as Record<string, unknown> | undefined;
  return !!u && !!receipt && u.input_tokens === receipt.usage.inputTokens && u.output_tokens === receipt.usage.outputTokens &&
    (u.cache_creation_input_tokens ?? 0) === 0 && (u.cache_read_input_tokens ?? 0) === 0 &&
    (u.service_tier ?? "standard") === "standard" && (u.inference_geo ?? "global") === "global" &&
    Object.values((u.server_tool_use ?? {}) as Record<string, unknown>).every(v => v === 0);
}
interface Options {
  candidate: Buffer;
  environment?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  preflightOnly?: boolean;
  closeOnly?: boolean;
  /** Test transport only; never exposed by the HTTP route. */
  fetch?: typeof fetch;
}

export async function runSeparatedResearchStudy(event: Event, store: AiFirstArtworkAttemptStore, requestId: string, options: Options,
  registration: ResearchRegistration = proposedRegistration as ResearchRegistration) {
  const SEPARATED_STUDY_DATASET = registration.dataset, SEPARATED_STUDY_REQUESTS = registration.requests;
  const key = (id: string, stage: string) => `${SEPARATED_STUDY_DATASET}:${id}:${stage}`;
  const closeKey = `${SEPARATED_STUDY_DATASET}:closed`;
  const env = options.environment ?? process.env;
  const blocked = (reason: string) => ({ kind: "blocked" as const, reason, customerActivation: "disabled" as const });
  const index = SEPARATED_STUDY_REQUESTS.findIndex(r => r.requestId === requestId), r = SEPARATED_STUDY_REQUESTS[index];
  if (registration.protocol !== "independent-failures-continue-v1" || registration.maximumCalls !== 19 ||
    SEPARATED_STUDY_REQUESTS.length !== registration.maximumCalls || new Set(SEPARATED_STUDY_REQUESTS.map(r => r.requestId)).size !== registration.maximumCalls ||
    registration.dataset !== "separated-research-20260916-v3" || !Number.isSafeInteger(registration.budgetMicros) ||
    registration.budgetMicros <= 0 || registration.budgetMicros > 2_500_000 ||
    registration.reusedCraft.length !== 1 || registration.reusedCraft[0].requestId !== "craft-elsa" ||
    SEPARATED_STUDY_REQUESTS.some(r => r.requestId === "craft-elsa" ||
      !Number.isSafeInteger(r.requestPlanningReserveMicros) || r.requestPlanningReserveMicros <= 0) ||
    index < 0 || env.VERCEL_ENV !== "preview" || env.VERCEL_GIT_COMMIT_REF !== "codex/launch-blockers" ||
    !env.VERCEL_GIT_COMMIT_SHA || !store.recordOnce || event.id !== 61 || !event.ownerToken ||
    event.eventName !== "Artwork evaluation" || event.eventType !== "Artwork evaluation" || event.inviteStatus !== "draft" ||
    event.themeName !== "" || event.paletteColors !== "[]" || hash(event.vibeDescription) !== MEDIUM_FEASIBILITY_CASES[0].hostBriefSha256 || options.signal?.aborted)
    return blocked("separated-context-mismatch");
  const bytes = options.candidate;
  if (bytes.length > 2_600_000 || hash(bytes) !== r.imageHash) return blocked("separated-pixel-integrity");
  const c = registration.cases.find(c => r.role === "craft" ? c.craftRequestId === requestId : c.fidelityRequestId === requestId);
  if (!c || c.reviewedHash !== r.imageHash) return blocked("separated-registration-integrity");
  const profile = await crossThemeProfile(c.caseId as CrossThemeCaseId);
  const input = { ...profile, bytes, reviewMode: "teaser" as const };
  const plan = prepareSeparatedReview(input), packet = r.role === "craft" ? plan.craft : plan.fidelity;
  if (plan.fingerprint !== c.combinedFingerprint || plan.fidelity.contextHash !== c.contextHash ||
    packet.requestFingerprint !== r.requestFingerprint || packet.schemaHash !== r.schemaHash ||
    packet.body.max_tokens !== r.maxOutputTokens || hash(JSON.stringify(packet.body)) !== r.requestFingerprint)
    return blocked("separated-request-integrity");
  // Reuse only server-retained exact craft evidence, not a client-provided pass flag.
  const reusedReceipts = new Map<string, SeparatedReviewReceipt>();
  for (const reuse of registration.reusedCraft) {
    const row = await store.findById(event.id, event.ownerToken, reuse.attemptId);
    const e = row?.reviewEvidence?.customerEvaluation;
    const receipt = e?.receipt as SeparatedReviewReceipt | null;
    if (!row || row.id !== reuse.attemptId || row.eventId !== event.id || row.ownerToken !== event.ownerToken ||
      row.runId !== reuse.dataset || row.idempotencyKey !== `${reuse.dataset}:${reuse.requestId}:completed` ||
      row.status !== "rejected" || row.previewId || row.model !== REVIEW_CALIBRATION_MODEL || row.assetHash !== reuse.imageHash ||
      hash(Buffer.from(row.assetBytesBase64, "base64")) !== reuse.imageHash ||
      e?.role !== "craft" || e.stage !== "completed" || e.dataset !== reuse.dataset || e.requestId !== reuse.requestId ||
      e.deploymentSha !== reuse.deploymentSha || e.customerActivation !== "disabled" || e.contractValid !== true ||
      e.physicalRequests !== 1 || e.requestVerified !== true || e.accountingKnown !== true ||
      !receiptMatches(receipt, reuse) || receipt?.stopReason !== "end_turn" ||
      hash(receipt.rawText) !== reuse.responseHash || e.responseHash !== reuse.responseHash ||
      e.costMicros !== reuse.costMicros || cost(receipt) !== reuse.costMicros || !standardUsage(e.providerUsage, receipt))
      return blocked("research-reuse-integrity");
    let report: unknown = null;
    try { report = JSON.parse(receipt.rawText); } catch { /* Invalid historical evidence is never reusable. */ }
    if (!validateIndependentCraft(report).valid) return blocked("research-reuse-contract");
    // Also bind the old receipt to today's exact craft packet for every dependent case.
    if (c.craftRequestId === reuse.requestId && (plan.craft.requestFingerprint !== reuse.requestFingerprint ||
      plan.craft.schemaHash !== reuse.schemaHash || plan.craft.imageHash !== reuse.imageHash))
      return blocked("research-reuse-packet-changed");
    reusedReceipts.set(reuse.requestId, receipt);
  }
  const rows = await store.listForOwner(event.id, event.ownerToken);
  const closed = rows.some(row => row.idempotencyKey === closeKey), claimed = rows.some(row => row.idempotencyKey === key(requestId, "claimed"));
  let spentMicros = 0, prerequisitesValid = true;
  for (const prior of SEPARATED_STUDY_REQUESTS.slice(0, index)) {
    const claims = rows.filter(row => row.idempotencyKey === key(prior.requestId, "claimed"));
    const results = rows.filter(row => row.idempotencyKey === key(prior.requestId, "completed")), row = results[0];
    const e = row?.reviewEvidence?.customerEvaluation;
    const receipt = e?.receipt as SeparatedReviewReceipt | null;
    if (claims.length !== 1 || results.length !== 1 || row.status !== "rejected" || row.previewId || row.assetHash !== prior.imageHash ||
      e?.dataset !== SEPARATED_STUDY_DATASET || e.deploymentSha !== env.VERCEL_GIT_COMMIT_SHA ||
      e.requestId !== prior.requestId || e.customerActivation !== "disabled" || e.continuationAllowed !== true ||
      e.physicalRequests !== 1 || e.accountingKnown !== true || !receipt || !receiptMatches(receipt, prior) || e.requestVerified !== true || !standardUsage(e.providerUsage, receipt) ||
      e.responseHash !== hash(receipt.rawText) || e.costMicros !== cost(receipt) || Number(e.costMicros) > prior.requestPlanningReserveMicros) {
      prerequisitesValid = false; break;
    }
    spentMicros += Number(e.costMicros);
  }
  const base: ArtworkAttemptInput = { eventId: event.id, ownerToken: event.ownerToken, runId: SEPARATED_STUDY_DATASET,
    directionIndex: index, attempt: 0, status: "rejected", previewId: null, bytes, concept: profile.concept,
    model: REVIEW_CALIBRATION_MODEL, quality: "not-applicable", size: null, costUsdMicros: 0,
    failureCodes: ["calibration-only-no-customer-approval"], tier1Findings: [], visionScores: null };
  const proof: Record<string, unknown> = { dataset: SEPARATED_STUDY_DATASET, requestId, role: r.role, sourceCaseId: c.caseId,
    sourceHash: c.sourceHash, imageHash: r.imageHash, requestFingerprint: r.requestFingerprint, schemaHash: r.schemaHash,
    contextHash: plan.fidelity.contextHash, combinedFingerprint: plan.fingerprint, deploymentSha: env.VERCEL_GIT_COMMIT_SHA,
    physicalRequests: null, accountingKnown: false, costMicros: null, receipt: null, responseHash: null,
    protocol: registration.protocol, authorizationStatus: registration.authorizationStatus,
    reusedCraft: registration.reusedCraft, componentContractValid: false,
    requestPlanningReserveMicros: r.requestPlanningReserveMicros, customerActivation: "disabled", continuationAllowed: false,
    imageProviderCalls: 0, classifierRequests: 0, retries: 0, generationDurationMs: 0 };
  const save = async (stage: string, closing = false) => {
    const evidence = { ...proof, stage }, idempotencyKey = closing ? closeKey : key(requestId, stage);
    const saved = await store.recordOnce!({ ...base, idempotencyKey, reviewEvidence: { version: 1, reviewedAssetHash: r.imageHash,
      previewImageProfile: "detail-v1", verdict: null, generationDurationMs: 0, customerEvaluation: evidence } });
    if (!saved.created || !saved.record) throw Error("separated-claim-or-retention-failed");
    const read = await store.findById(event.id, event.ownerToken, saved.record.id);
    if (!read || read.idempotencyKey !== idempotencyKey || read.runId !== SEPARATED_STUDY_DATASET || read.status !== "rejected" ||
      read.previewId || read.model !== REVIEW_CALIBRATION_MODEL || read.assetHash !== r.imageHash ||
      hash(Buffer.from(read.assetBytesBase64, "base64")) !== r.imageHash ||
      JSON.stringify(read.reviewEvidence?.customerEvaluation) !== JSON.stringify(evidence)) throw Error("separated-retention-failed");
    return read.id;
  };
  if (options.preflightOnly) return { kind: "preflight" as const, requestId, role: r.role, imageHash: r.imageHash,
    requestFingerprint: r.requestFingerprint, schemaHash: r.schemaHash, sourceHash: c.sourceHash,
    deploymentSha: env.VERCEL_GIT_COMMIT_SHA, prerequisitesValid, closed, alreadyClaimed: claimed, spentMicros,
    authorizationStatus: registration.authorizationStatus, reusedReceiptIds: registration.reusedCraft.map(r => r.attemptId),
    requestPlanningReserveMicros: r.requestPlanningReserveMicros, providerCalls: 0, customerActivation: "disabled" as const };
  if (registration.authorizationStatus !== "approved") return blocked("research-awaiting-fresh-approval");
  if (options.closeOnly) {
    if (closed) return { kind: "closed" as const, alreadyClosed: true, customerActivation: "disabled" as const };
    proof.closeReason = "owner-approved-closeout";
    return { kind: "closed" as const, attemptId: await save("closed", true), customerActivation: "disabled" as const };
  }
  if (closed) return blocked("separated-study-closed");
  if (claimed) return blocked("separated-request-already-claimed");
  if (!prerequisitesValid) return blocked("separated-prerequisite-failed");
  if (spentMicros + r.requestPlanningReserveMicros > registration.budgetMicros) return blocked("separated-budget-reserve");
  if (!env.ANTHROPIC_API_KEY && !options.fetch) return blocked("separated-provider-unconfigured");
  try { await save("claimed"); } catch { return blocked("separated-already-claimed-or-retention-failed"); }
  const signal = AbortSignal.any([AbortSignal.timeout(60_000), ...(options.signal ? [options.signal] : [])]);
  let physicalRequests = 0, requestVerified = false;
  const started = Date.now();
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY ?? "offline-test", maxRetries: 0, fetch: async (url, init) => {
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    if (!body || hash(JSON.stringify(body)) !== r.requestFingerprint || physicalRequests !== 0) throw Error("separated-transport-integrity");
    signal.throwIfAborted(); requestVerified = true; physicalRequests++;
    return (options.fetch ?? fetch)(url, { ...init, signal });
  } });
  let receipt: SeparatedReviewReceipt | null = null, report: unknown = null;
  let accountingKnown = false;
  try {
    const response = await client.messages.create(packet.body as Anthropic.Messages.MessageCreateParamsNonStreaming, { signal, maxRetries: 0 });
    const textParts = response.content.filter(p => p.type === "text");
    receipt = { imageHash: r.imageHash, requestFingerprint: r.requestFingerprint, schemaHash: r.schemaHash,
      model: response.model, requestCount: physicalRequests, stopReason: response.stop_reason,
      rawText: textParts.map(p => p.text).join(""), usage: { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens } };
    proof.providerUsage = response.usage;
    proof.providerMessageId = response.id;
    proof.providerContent = response.content;
    accountingKnown = receiptMatches(receipt, r) && standardUsage(response.usage, receipt);
    if (response.content.length !== 1 || textParts.length !== 1) proof.providerContentInvalid = true;
    try { report = JSON.parse(receipt.rawText); } catch { proof.responseParseFailed = true; }
  } catch (error) {
    proof.providerError = reviewProviderError(error, [event.ownerToken,
      ...Object.entries(env).filter(([name]) => /key|token|secret|password|database_url/i.test(name)).map(([, value]) => value)]);
  }
  const component = r.role === "craft" ? validateIndependentCraft(report) : validateBriefFidelity(report, plan.fidelity.context);
  let combined: ReturnType<typeof combineSeparatedReview> | null = null;
  if (r.role === "fidelity") {
    const priorCraft = rows.find(row => row.idempotencyKey === key(c.craftRequestId, "completed"))?.reviewEvidence?.customerEvaluation;
    const craft = reusedReceipts.get(c.craftRequestId) ??
      (priorCraft?.componentContractValid === true ? priorCraft.receipt as SeparatedReviewReceipt : null);
    combined = combineSeparatedReview(input, { craft, fidelity: receipt });
  }
  const costMicros = accountingKnown && receipt ? cost(receipt) : null;
  const componentContractValid = component.valid && receipt?.stopReason === "end_turn" && !proof.providerContentInvalid;
  const contractValid = componentContractValid && (combined?.valid ?? true);
  // A valid-looking JSON fragment in an incomplete/mixed response can never become an artwork pass.
  if (combined && !componentContractValid) combined = { ...combined, valid: false, passed: false,
    disposition: "invalid", issues: [...combined.issues, "fidelity:provider-contract-invalid"] };
  const continuationAllowed = requestVerified && physicalRequests === 1 && !signal.aborted && accountingKnown &&
    costMicros !== null && costMicros <= r.requestPlanningReserveMicros &&
    spentMicros + costMicros <= registration.budgetMicros;
  Object.assign(proof, { receipt, responseHash: receipt ? hash(receipt.rawText) : null, component, combined, physicalRequests,
    requestVerified, accountingKnown, costMicros, componentContractValid, contractValid, continuationAllowed,
    providerOutcome: continuationAllowed ? contractValid ? "valid-review" : "retained-invalid-review" : "fatal",
    providerMs: Date.now() - started,
    reportDisposition: !contractValid ? "invalid" : component.unresolved || combined?.unresolved ? "unresolved" : "valid" });
  let attemptId: string;
  try { attemptId = await save("completed"); }
  catch (error) {
    proof.continuationAllowed = false; proof.closeReason = "retention-failure";
    try { await save("closed", true); } catch { /* A claim without a reconciled result also blocks every later request. */ }
    throw error;
  }
  let closeAttemptId: string | undefined;
  if (!continuationAllowed || index === SEPARATED_STUDY_REQUESTS.length - 1) {
    proof.closeReason = continuationAllowed ? "all-nineteen-completed" : !accountingKnown ? "accounting-unknown" : "request-or-budget-failure";
    closeAttemptId = await save("closed", true);
  }
  return { kind: continuationAllowed ? "completed" as const : "stopped" as const, requestId, role: r.role, attemptId,
    closeAttemptId, closed: !!closeAttemptId, continuationAllowed, receipt, component, combined,
    physicalRequests, costMicros, spentMicros: costMicros === null ? null : spentMicros + costMicros,
    reportDisposition: proof.reportDisposition, providerMs: proof.providerMs, customerActivation: "disabled" as const };
}

// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { Event } from '@shared/schema';
import { encodePng } from '../server/aiFirst/png';
import { InMemoryArtworkAttemptStore, REVIEW_CALIBRATION_MODEL } from '../server/aiFirst/artworkAttemptStore';
import { MEDIUM_FEASIBILITY_CASES } from '../server/aiFirst/mediumFeasibilityCases';
import { compactReviewProfile } from '../server/compactReviewProfiles';
import { prepareCompactReview } from '../server/aiFirst/compactArtworkReview';
import { IDENTITY_FEATURES } from '../server/aiFirst/identityComparison';
import { runCompactReviewStudy, type CompactReviewRegistration } from '../server/compactReviewStudy';
import proposed from '../server/compactReviewRegistration.json';

const hash = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const png = (color: number) => encodePng({ width: 8, height: 8, rgb: new Uint8Array(192).fill(color) });
const bytes = png(127), referenceSources = [png(60), png(70), png(80)];
const environment = { VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'codex/launch-blockers', VERCEL_GIT_COMMIT_SHA: 'offline-compact-test' };
const event = { id: 61, ownerToken: 'offline-owner', eventName: 'Artwork evaluation', eventType: 'Artwork evaluation',
  inviteStatus: 'draft', themeName: '', paletteColors: '[]', vibeDescription: MEDIUM_FEASIBILITY_CASES[0].hostBrief } as Event;

async function fixture(edit: (raw: any, response: any, call: number) => void = () => {}) {
  const registration = structuredClone(proposed) as CompactReviewRegistration;
  registration.authorizationStatus = 'approved'; // Fake transport only. Deployed registration remains pending.
  registration.references.forEach((r, i) => r.sha256 = hash(referenceSources[i]));
  const store = new InMemoryArtworkAttemptStore();
  const plans = new Map<string, ReturnType<typeof prepareCompactReview>>();
  for (const c of registration.cases) {
    const references = c.referenceHashes.length ? registration.references.map((r, i) => ({ sha256: r.sha256, sourceUrl: r.sourceUrl,
      subject: r.subject, region: r.region, role: 'identity' as const, bytes: referenceSources[i] })) : [];
    c.referenceHashes = references.map(r => r.sha256);
    const profile = await compactReviewProfile(c.caseId);
    const plan = prepareCompactReview({ ...profile, bytes, referenceImages: references, reviewMode: 'teaser' }); plans.set(c.caseId, plan);
    c.reviewedHash = plan.imageHash; c.contextHash = plan.fidelity.contextHash; c.combinedFingerprint = plan.fingerprint;
    for (const r of registration.requests.filter(r => r.requestId === c.craftRequestId || r.requestId === c.fidelityRequestId)) {
      const p = r.role === 'craft' ? plan.craft : plan.fidelity;
      r.imageHash = p.imageHash; r.requestFingerprint = p.requestFingerprint; r.schemaHash = p.schemaHash;
    }
  }
  for (const old of registration.reusedCraft) {
    const c = registration.cases.find(c => c.craftRequestId === old.requestId)!, p = plans.get(c.caseId)!.craft;
    const raw = { judgments: p.context.checks.map(c => ({ checkId: c.id, ...c.binding, finding: 'fulfilled', location: 'canvas', observation: 'Synthetic construction support only.' })), counts: [] };
    const receipt = { imageHash: p.imageHash, requestFingerprint: p.requestFingerprint, schemaHash: p.schemaHash, model: p.body.model,
      requestCount: 1, stopReason: 'end_turn', rawText: JSON.stringify(raw), usage: { inputTokens: 1000, outputTokens: 400 } };
    const saved = await store.recordOnce({ eventId: event.id, ownerToken: event.ownerToken, runId: old.dataset,
      idempotencyKey: `${old.dataset}:${old.requestId}:completed`, directionIndex: 0, attempt: 0, status: 'rejected', previewId: null,
      bytes, concept: (await compactReviewProfile(c.caseId)).concept, model: REVIEW_CALIBRATION_MODEL, quality: 'not-applicable', size: null,
      costUsdMicros: 0, failureCodes: ['calibration-only-no-customer-approval'], tier1Findings: [], visionScores: null,
      reviewEvidence: { version: 1, reviewedAssetHash: p.imageHash, previewImageProfile: 'detail-v1', verdict: null, generationDurationMs: 0,
        customerEvaluation: { dataset: old.dataset, requestId: old.requestId, deploymentSha: old.deploymentSha,
          componentContractValid: true, physicalRequests: 1, requestVerified: true, accountingKnown: true,
          receipt, providerUsage: { input_tokens: 1000, output_tokens: 400 } } } });
    old.attemptId = saved.record!.id; old.imageHash = p.imageHash; old.requestFingerprint = p.requestFingerprint;
    old.schemaHash = p.schemaHash; old.rawTextSha256 = hash(receipt.rawText); old.receiptSha256 = hash(JSON.stringify(receipt));
  }
  let calls = 0;
  const transport = vi.fn(async (_url: any, init: any) => {
    const body = JSON.parse(init.body), task = body.messages[0].content.find((p: any) => p.type === 'text' && p.text.startsWith('FULL TASK DATA:'));
    const ctx = JSON.parse(task ? task.text.split('SERVER CHECKS:\n')[1] : body.messages[0].content.at(-1).text);
    let raw: any;
    if (!task) raw = { judgments: ctx.checks.map((c: any) => ({ checkId: c.id, ...c.binding, finding: 'fulfilled', location: 'canvas', observation: 'Synthetic construction only.' })), counts: [] };
    else {
      raw = { observations: [], judgments: [], counts: [], identityComparisons: [] };
      for (const c of ctx.checks) {
        raw.observations.push({ id: c.id, viewId: 'candidate-full', visibility: 'clear', location: `synthetic ${c.id}`, observation: 'Synthetic visible evidence only.' });
        raw.judgments.push({ checkId: c.id, finding: 'fulfilled', evidenceIds: [c.id] });
      }
      for (const target of ctx.comparisonTargets) for (const feature of IDENTITY_FEATURES) {
        const candidateId = `${target.key}:${feature}:candidate`, referenceId = `${target.key}:${feature}:reference`;
        for (const [id, viewId] of [[candidateId, 'candidate-full'], [referenceId, target.key]]) raw.observations.push({
          id, viewId, visibility: 'clear', location: `synthetic ${feature}`, observation: `Synthetic ${feature}; not visual approval.` });
        raw.identityComparisons.push({ referenceKey: target.key, feature, candidateEvidenceId: candidateId, referenceEvidenceId: referenceId, assessment: 'match' });
      }
    }
    const response = { id: 'msg_offline', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6', stop_reason: 'end_turn',
      usage: { input_tokens: 1000, output_tokens: 400 }, content: [{ type: 'text', text: '' }] };
    edit(raw, response, ++calls); if (!response.content[0].text) response.content[0].text = JSON.stringify(raw);
    return new Response(JSON.stringify(response), { headers: { 'Content-Type': 'application/json' } });
  }) as unknown as ReturnType<typeof vi.fn> & typeof fetch;
  return { registration, store, transport, run: (id: string, overrides = {}) => {
    const c = registration.cases.find(c => c.fidelityRequestId === id || c.craftRequestId === id)!;
    return runCompactReviewStudy(event, store, id, { candidate: bytes, referenceSources: c?.referenceHashes.length ? referenceSources : [],
      environment, fetch: transport, ...overrides }, registration);
  } };
}

it('keeps the new allowance pending; preflight reads without calls or writes', async () => {
  expect(proposed.authorizationStatus).toBe('pending'); const f = await fixture(); f.registration.authorizationStatus = 'pending';
  const before = JSON.stringify(f.store.all);
  expect(await f.run('fidelity-c01', { preflightOnly: true, candidate: undefined })).toMatchObject({ kind: 'preflight', providerCalls: 0, authorizationStatus: 'pending' });
  expect(await f.run('fidelity-c01')).toMatchObject({ kind: 'blocked', reason: 'research-awaiting-fresh-approval' });
  expect(JSON.stringify(f.store.all)).toBe(before); expect(f.transport).not.toHaveBeenCalled();
});
it('executes fifteen once using eight unchanged retained craft receipts and permanently closes', async () => {
  const f = await fixture(), before = JSON.stringify(f.store.all), eventBefore = JSON.stringify(event);
  for (const r of f.registration.requests) {
    const result = await f.run(r.requestId);
    expect(result, r.requestId + ': ' + ('reason' in result ? result.reason : '')).toMatchObject({ kind: 'completed', physicalRequests: 1, costMicros: 9000 });
    if (r.role === 'fidelity') expect(result).toMatchObject({ combined: { valid: true, passed: true, customerActivation: 'disabled' } });
  }
  expect(f.transport).toHaveBeenCalledTimes(15); expect(f.store.all).toHaveLength(39);
  expect(JSON.stringify(f.store.all.slice(0, 8))).toBe(before); expect(JSON.stringify(event)).toBe(eventBefore);
  expect(f.store.all.every(r => r.status === 'rejected' && !r.previewId)).toBe(true);
  expect(await f.run('fidelity-c01')).toMatchObject({ kind: 'blocked', reason: 'separated-study-closed' });
});
it.each(['changed-old-receipt', 'wrong-reference', 'wrong-deployment', 'wrong-pixels', 'skipped-request'])('blocks %s before payment', async mode => {
  const f = await fixture(); let override = {};
  if (mode === 'changed-old-receipt') f.registration.reusedCraft[0].rawTextSha256 = 'altered';
  if (mode === 'wrong-reference') { await f.run('fidelity-c01'); override = { referenceSources }; }
  if (mode === 'wrong-deployment') override = { environment: { ...environment, VERCEL_ENV: 'production' } };
  if (mode === 'wrong-pixels') override = { candidate: png(99) };
  const before = f.transport.mock.calls.length;
  expect(await f.run(mode === 'skipped-request' ? 'fidelity-c02' : 'fidelity-c01', override)).toMatchObject({ kind: 'blocked' });
  expect(f.transport).toHaveBeenCalledTimes(before);
});
it.each(['missing-usage', 'cache-cost', 'geo-premium', 'provider-error', 'reserve-overrun'])('closes on %s with no retries', async mode => {
  const f = await fixture((_raw, response) => {
    if (mode === 'missing-usage') response.usage.input_tokens = undefined;
    if (mode === 'cache-cost') response.usage.cache_creation_input_tokens = 1;
    if (mode === 'geo-premium') response.usage.inference_geo = 'us';
    if (mode === 'reserve-overrun') response.usage.input_tokens = 1000000;
  });
  if (mode === 'provider-error') f.transport.mockImplementation(async () => { throw Error('provider failed'); });
  expect(await f.run('fidelity-c01')).toMatchObject({ kind: 'stopped', closed: true, continuationAllowed: false });
  expect(await f.run('fidelity-c02')).toMatchObject({ kind: 'blocked' }); expect(f.transport).toHaveBeenCalledTimes(1);
});
it('retains invalid reports as failures and never repairs them', async () => {
  const f = await fixture((raw, _response, n) => { if (n === 1) raw.purchase = true; });
  expect(await f.run('fidelity-c01')).toMatchObject({ kind: 'completed', reportDisposition: 'invalid', combined: { valid: false, passed: false } });
  expect(await f.run('fidelity-c02')).toMatchObject({ kind: 'completed' }); expect(f.transport).toHaveBeenCalledTimes(2);
});

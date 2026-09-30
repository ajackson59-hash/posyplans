// @vitest-environment node
import { expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { encodePng, decodePng } from '../server/aiFirst/png';
import { copyReviewRegion, prepareReviewDetailViews } from '../server/aiFirst/reviewDetailViews';
import { prepareCompactReview, validateCompactReview, combineCompactReview } from '../server/aiFirst/compactArtworkReview';
import { prepareSeparatedReview } from '../server/aiFirst/separatedArtworkReview';
import { crossThemeProfile } from '../server/crossThemeReviewProfiles';
import { IDENTITY_FEATURES } from '../server/aiFirst/identityComparison';
import type { ReviewReference } from '../server/aiFirst/reviewReferences';

const hash = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
const bytes = encodePng({ width: 16, height: 16, rgb: new Uint8Array(16 * 16 * 3).fill(120) });
const ref: ReviewReference = { bytes, sha256: hash(bytes), sourceUrl: 'https://example.com/labeled-reference',
  role: 'identity', subject: 'Rumi from KPop Demon Hunters', region: 'animated subject' };
async function fixture(references = false) {
  const input = { ...await crossThemeProfile('c05'), bytes, reviewMode: 'teaser' as const, referenceImages: references ? [ref] : [] };
  const plan = prepareCompactReview(input), ctx = plan.fidelity.context;
  const raw: any = { observations: [], judgments: [], counts: [], identityComparisons: [] };
  for (const check of ctx.evidence.checks) {
    raw.observations.push({ id: check.id, viewId: 'candidate-full', visibility: 'clear', location: `synthetic ${check.id}`,
      observation: 'Synthetic visible support for a code test only.' });
    raw.judgments.push({ checkId: check.id, finding: 'fulfilled', evidenceIds: [check.id] });
  }
  for (const target of ctx.evidence.comparisonTargets) for (const feature of IDENTITY_FEATURES) {
    for (const role of ['candidate', 'reference']) raw.observations.push({ id: `${role}:${feature}`, visibility: 'clear',
      viewId: role === 'candidate' ? 'candidate-full' : target.key, location: `synthetic ${feature}`,
      observation: `Synthetic ${role} geometry for ${feature}; not a visual approval.` });
    raw.identityComparisons.push({ referenceKey: target.key, feature, candidateEvidenceId: `candidate:${feature}`,
      referenceEvidenceId: `reference:${feature}`, assessment: 'match' });
  }
  const receipt = (packet: typeof plan.craft | typeof plan.fidelity, data: unknown) => ({ imageHash: packet.imageHash,
    requestFingerprint: packet.requestFingerprint, schemaHash: packet.schemaHash, model: packet.body.model,
    requestCount: 1, stopReason: 'end_turn', rawText: JSON.stringify(data), usage: { inputTokens: 1000, outputTokens: 500 } });
  const craftRaw = { judgments: plan.craft.context.checks.map(c => ({ checkId: c.id, ...c.binding, finding: 'fulfilled',
    location: 'canvas', observation: 'Synthetic construction support only.' })), counts: [] };
  return { input, plan, ctx, raw, receipt, craft: receipt(plan.craft, craftRaw) };
}

it('uses exact native RGB regions, covers the whole source and preserves the original bytes', () => {
  const width = 1001, height = 1203, rgb = new Uint8Array(width * height * 3);
  for (let i = 0; i < rgb.length; i++) rgb[i] = (i * 31) % 251;
  const source = encodePng({ width, height, rgb }), before = hash(source);
  const views = prepareReviewDetailViews(source), coverage = new Uint8Array(width * height);
  expect(views).toHaveLength(4);
  for (const v of views) {
    const image = decodePng(v.bytes), expected = copyReviewRegion({ width, height, rgb }, v.region);
    expect(Buffer.from(image.rgb).equals(Buffer.from(expected.rgb))).toBe(true);
    for (let y = v.region.y; y < v.region.y + v.region.height; y++) coverage.fill(1, y * width + v.region.x, y * width + v.region.x + v.region.width);
    expect(v.sourceHash).toBe(before);
  }
  expect(coverage.every(v => v === 1)).toBe(true); expect(hash(source)).toBe(before);
  expect(prepareReviewDetailViews(bytes)).toEqual([]);
  expect(() => copyReviewRegion({ width, height, rgb }, { x: -1, y: 0, width: 3, height: 3 })).toThrow();
});

it('preserves the exact craft request, full host wording and all source bindings', async () => {
  const f = await fixture(), old = prepareSeparatedReview(f.input);
  expect(f.plan.craft).toEqual(old.craft);
  expect(f.ctx.evidence).toEqual(old.fidelity.context);
  expect(JSON.stringify(f.plan.fidelity.body)).toContain(f.input.brief.vibe);
  expect(validateCompactReview(f.raw, f.ctx)).toMatchObject({ valid: true, passed: true });
  const result = combineCompactReview(f.input, { craft: f.craft, fidelity: f.receipt(f.plan.fidelity, f.raw) });
  expect(result).toMatchObject({ valid: true, passed: true, customerActivation: 'disabled' });
  expect(result.fidelity.decisions.map(d => [d.checkId, d.sourceId, d.quote])).toEqual(f.ctx.evidence.checks.map(c => [c.id, c.binding.sourceId, c.binding.quote]));
});

it.each(['unknown-check', 'missing-check', 'duplicate-check', 'extra-verdict', 'copied-binding', 'missing-evidence', 'unknown-view',
  'reference-only', 'duplicate-evidence', 'unused-evidence', 'insufficient-pass'])('rejects %s without fabricating an art failure', async mode => {
  const f = await fixture();
  if (mode === 'unknown-check') f.raw.judgments[0].checkId = 'made-up';
  if (mode === 'missing-check') f.raw.judgments.pop();
  if (mode === 'duplicate-check') f.raw.judgments.push(f.raw.judgments[0]);
  if (mode === 'extra-verdict') f.raw.purchase = true;
  if (mode === 'copied-binding') f.raw.judgments[0].quote = 'every character';
  if (mode === 'missing-evidence') f.raw.judgments[0].evidenceIds = ['missing'];
  if (mode === 'unknown-view') f.raw.observations[0].viewId = 'not-a-view';
  if (mode === 'reference-only') { f.ctx.views.push({ id: 'ref', role: 'reference', sha256: hash(bytes) }); f.raw.observations[0].viewId = 'ref'; }
  if (mode === 'duplicate-evidence') f.raw.observations.push(f.raw.observations[0]);
  if (mode === 'unused-evidence') f.raw.observations.push({ ...f.raw.observations[0], id: 'unused' });
  if (mode === 'insufficient-pass') f.raw.observations[0].visibility = 'insufficient';
  expect(validateCompactReview(f.raw, f.ctx)).toMatchObject({ valid: false, passed: false });
});

it('keeps a known violation visible alongside genuine uncertainty', async () => {
  const f = await fixture();
  f.raw.judgments.find((r: any) => r.checkId === 'policy:textLogoWatermarkFree').finding = 'lettering';
  f.raw.judgments.at(-1).finding = 'uncertain';
  expect(combineCompactReview(f.input, { craft: f.craft, fidelity: f.receipt(f.plan.fidelity, f.raw) }))
    .toMatchObject({ valid: true, passed: false, unresolved: true, disposition: 'rejected' });
});

it('counts distinct observed objects with server-owned scope and rejects duplicate or invisible count evidence', async () => {
  const f = await fixture(), quote = 'Exactly two arches.';
  f.ctx.evidence.sources.push({ id: 'count-source', text: quote, authority: 'host' });
  f.ctx.evidence.checks.push({ id: 'count-check', dimension: 'briefFidelity', binding: { sourceId: 'count-source', quote },
    instruction: quote, findings: ['fulfilled', 'uncertain'], countRule: { operator: 'exactly', value: 2, target: 'arches', quote } });
  for (const id of ['coverage', 'left-arch', 'right-arch']) f.raw.observations.push({ id, viewId: 'candidate-full', visibility: 'clear', location: id, observation: `Synthetic ${id} only.` });
  f.raw.counts.push({ checkId: 'count-check', visibility: 'complete', itemEvidenceIds: ['left-arch', 'right-arch'], coverageEvidenceId: 'coverage' });
  expect(validateCompactReview(f.raw, f.ctx)).toMatchObject({ valid: true, passed: true });
  f.raw.counts[0].itemEvidenceIds = ['left-arch', 'left-arch'];
  expect(validateCompactReview(f.raw, f.ctx)).toMatchObject({ valid: false, passed: false });
  f.raw.counts[0].itemEvidenceIds = ['left-arch', 'right-arch'];
  f.raw.observations.find((o: any) => o.id === 'left-arch').visibility = 'insufficient';
  expect(validateCompactReview(f.raw, f.ctx)).toMatchObject({ valid: false, passed: false });
});

it('grounds four features in the requested reference and keeps identity mismatch independent of naming the candidate', async () => {
  const f = await fixture(true);
  const reordered = { region: ref.region, subject: ref.subject, role: 'identity' as const, sourceUrl: ref.sourceUrl, sha256: ref.sha256, bytes: ref.bytes };
  expect(prepareCompactReview({ ...f.input, referenceImages: [reordered] }).fingerprint).toBe(f.plan.fingerprint);
  expect(validateCompactReview(f.raw, f.ctx)).toMatchObject({ valid: true, passed: true });
  f.raw.identityComparisons[0].assessment = 'mismatch';
  expect(validateCompactReview(f.raw, f.ctx)).toMatchObject({ valid: true, passed: false, identityComparison: { comparisons: [{ decision: 'mismatch' }] } });
});

it.each(['wrong-reference', 'missing-feature', 'reused-feature', 'insufficient-reference', 'insufficient-candidate'])('rejects %s identity support', async mode => {
  const f = await fixture(true);
  if (mode === 'wrong-reference') f.raw.identityComparisons[0].referenceEvidenceId = f.raw.identityComparisons[0].candidateEvidenceId;
  if (mode === 'missing-feature') f.raw.identityComparisons.pop();
  if (mode === 'reused-feature') f.raw.identityComparisons[1].candidateEvidenceId = f.raw.identityComparisons[0].candidateEvidenceId;
  if (mode === 'insufficient-reference') f.raw.observations.find((o: any) => o.id === 'reference:facialProportions').visibility = 'insufficient';
  if (mode === 'insufficient-candidate') f.raw.observations.find((o: any) => o.id === 'candidate:facialProportions').visibility = 'insufficient';
  expect(validateCompactReview(f.raw, f.ctx)).toMatchObject({ valid: false, passed: false });
});

it.each(['wrong-image', 'wrong-request', 'wrong-model', 'truncated', 'retried', 'unknown-cost'])('rejects %s receipts, including a structurally valid body', async mode => {
  const f = await fixture(), fidelity = f.receipt(f.plan.fidelity, f.raw);
  if (mode === 'wrong-image') fidelity.imageHash = 'stale';
  if (mode === 'wrong-request') fidelity.requestFingerprint = 'v2';
  if (mode === 'wrong-model') fidelity.model = 'unregistered-model';
  if (mode === 'truncated') fidelity.stopReason = 'max_tokens';
  if (mode === 'retried') fidelity.requestCount = 2;
  if (mode === 'unknown-cost') fidelity.usage.inputTokens = 0;
  expect(combineCompactReview(f.input, { craft: f.craft, fidelity })).toMatchObject({ valid: false, passed: false, disposition: 'invalid-review' });
});

it('binds a real SDK serialized body using fake transport only', async () => {
  const f = await fixture(true); let calls = 0;
  const client = new Anthropic({ apiKey: 'offline-test', maxRetries: 0, fetch: async (_url, init) => {
    calls++; expect(hash(JSON.stringify(JSON.parse(String(init?.body))))).toBe(f.plan.fidelity.requestFingerprint);
    return new Response(JSON.stringify({ id: 'msg_offline', type: 'message', role: 'assistant', model: 'claude-sonnet-4-6', stop_reason: 'end_turn',
      usage: { input_tokens: 1000, output_tokens: 500 }, content: [{ type: 'text', text: JSON.stringify(f.raw) }] }), { headers: { 'Content-Type': 'application/json' } });
  } });
  await client.messages.create(f.plan.fidelity.body); expect(calls).toBe(1);
});

/** Offline preparation. Frozen historical receipts are reusable only for unchanged craft packets. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import jpeg from 'jpeg-js';
import { prepareCompactReview } from '../server/aiFirst/compactArtworkReview.ts';
import { prepareSeparatedReview, validateEvidenceReview } from '../server/aiFirst/separatedArtworkReview.ts';
import { boundedReviewImage, copyReviewRegion, prepareReviewDetailViews } from '../server/aiFirst/reviewDetailViews.ts';
import { encodePng } from '../server/aiFirst/png.ts';
import { compactReviewProfile, COMPACT_REVIEW_CASES } from '../server/compactReviewProfiles.ts';
import type { ReviewReference } from '../server/aiFirst/reviewReferences.ts';

globalThis.fetch = async () => { throw Error('Offline preparation: network prohibited'); };
const [imageDir, referenceDir, oldLiveDir, outputDir] = process.argv.slice(2);
assert(imageDir && referenceDir && oldLiveDir && outputDir, 'Supply images, reference sources, closed-run evidence, and new output directory');
assert(!fs.existsSync(path.join(outputDir, 'registration.json')), 'Never overwrite a frozen preparation');
const hash = (v: string | Buffer | Uint8Array) => createHash('sha256').update(v).digest('hex');
const write = (name: string, data: unknown) => fs.writeFileSync(path.join(outputDir, name), JSON.stringify(data, null, 2) + '\n');
for (const d of ['requests', 'references', 'images', 'details', 'contexts', 'baseline']) fs.mkdirSync(path.join(outputDir, d), { recursive: true });
const references: ReviewReference[] = [], referenceRecords = [];
for (const [name, extension, expected] of [
  ['Rumi', 'png', '534d23bee02f125a69eebcac35bf0c8c25b658195928a530853b42529ec6ddb5'],
  ['Mira', 'jpg', '8a04198d7efee5e097cf499d6ca95019bb8e2d450048b4afc0bd16b2c87f48fd'],
  ['Zoey', 'png', '206292495edee079a83a4614e70e114567d1a952fbe13bc416d397c06c3d7863'],
]) {
  const source = fs.readFileSync(path.join(referenceDir, `${name.toLowerCase()}.${extension}`));
  assert.equal(hash(source), expected);
  let decoded;
  if (extension === 'png') decoded = boundedReviewImage(source);
  else {
    const image = jpeg.decode(source, { useTArray: true, formatAsRGBA: false });
    decoded = { width: image.width, height: image.height, rgb: image.data };
  }
  assert.equal(decoded.width, 1200); assert.equal(decoded.height, 589);
  const region = { x: 435, y: 0, width: 765, height: 589 };
  const pixels = copyReviewRegion(decoded, region), bytes = encodePng(pixels, 'sub');
  const reference: ReviewReference = { bytes, sha256: hash(bytes),
    sourceUrl: 'https://www.netflix.com/tudum/articles/kpop-demon-hunters-cast', role: 'identity',
    subject: name, region: 'Named KPop Demon Hunters animated character panel only; native source pixels, no photographic adult panel' };
  references.push(reference);
  const { bytes: _, ...metadata } = reference;
  referenceRecords.push({ ...metadata, sourceHash: expected, sourceFilename: `${name.toLowerCase()}.${extension}`,
    sourceWidth: 1200, sourceHeight: 589, sourceRegion: region, decodedRgbSha256: hash(pixels.rgb) });
  fs.writeFileSync(path.join(outputDir, 'references', `${name.toLowerCase()}.png`), bytes);
}
const requests = [], cases = [], reusedCraft: any[] = [], proof = [];
for (const c of COMPACT_REVIEW_CASES) {
  const bytes = fs.readFileSync(path.join(c.image === 'zoey' ? referenceDir : imageDir, `${c.image}${c.image === 'zoey' ? '' : '-reviewed'}.png`));
  const profile = await compactReviewProfile(c.caseId);
  const input = { ...profile, bytes, reviewMode: 'teaser' as const,
    referenceImages: ['rumi', 'zoey', 'kpop'].includes(c.image) ? references : [] };
  const plan = prepareCompactReview(input), oldPlan = prepareSeparatedReview({ ...profile, bytes, reviewMode: 'teaser' });
  assert.equal(plan.craft.requestFingerprint, oldPlan.craft.requestFingerprint);
  const craftRequestId = `craft-${c.image}`, fidelityRequestId = `fidelity-${c.caseId}`;
  if (c.image !== 'zoey' && !reusedCraft.some(r => r.requestId === craftRequestId)) {
    const envelope = JSON.parse(fs.readFileSync(path.join(oldLiveDir, `review-${craftRequestId}.json`), 'utf8'));
    const result = envelope.result, r = result.receipt;
    assert.equal(r.imageHash, plan.imageHash); assert.equal(r.requestFingerprint, plan.craft.requestFingerprint);
    assert.equal(r.schemaHash, plan.craft.schemaHash); assert.equal(r.stopReason, 'end_turn'); assert.equal(r.requestCount, 1);
    assert.equal(validateEvidenceReview(JSON.parse(r.rawText), plan.craft.context).valid, true);
    reusedCraft.push({ requestId: craftRequestId, attemptId: String(result.attemptId), dataset: 'evidence-review-20260917-v1',
      deploymentSha: envelope.deploymentSha, imageHash: r.imageHash, requestFingerprint: r.requestFingerprint,
      schemaHash: r.schemaHash, rawTextSha256: hash(r.rawText), receiptSha256: hash(JSON.stringify(r)),
      providerMs: result.providerMs, originalHttpMs: Math.round(envelope.elapsedSeconds * 1000) });
    write(`baseline/${craftRequestId}.json`, envelope);
  }
  cases.push({ caseId: c.caseId, image: c.image, reviewedHash: plan.imageHash, combinedFingerprint: plan.fingerprint,
    contextHash: plan.fidelity.contextHash, craftRequestId, fidelityRequestId,
    referenceHashes: input.referenceImages.map(r => r.sha256) });
  for (const role of (c.image === 'zoey' ? ['craft', 'fidelity'] : ['fidelity']) as ('craft' | 'fidelity')[]) {
    const requestId = role === 'craft' ? craftRequestId : fidelityRequestId;
    if (requests.some(r => r.requestId === requestId)) continue;
    const p = plan[role];
    requests.push({ requestId, role, imageHash: p.imageHash, requestFingerprint: p.requestFingerprint,
      schemaHash: p.schemaHash, version: p.version, maxOutputTokens: p.body.max_tokens,
      planningInputTokens: 25000, requestPlanningReserveMicros: 75000 + 15 * p.body.max_tokens });
    fs.writeFileSync(path.join(outputDir, 'requests', `${requestId}.json`), JSON.stringify(p.body));
  }
  fs.writeFileSync(path.join(outputDir, 'images', `${c.image}.png`), bytes);
  for (const detail of prepareReviewDetailViews(bytes)) fs.writeFileSync(path.join(outputDir, 'details', `${c.image}-${detail.id}.png`), detail.bytes);
  write(`contexts/${c.caseId}.json`, { context: plan.fidelity.context, details: plan.detailEvidence, references: plan.referenceEvidence });
  // New references replace duplicate identity judgments with four feature checks;
  // all original source text remains in the complete task data and is accounted for.
  proof.push({ caseId: c.caseId, imageHash: plan.imageHash, unchangedCraft: true,
    originalCheckCount: oldPlan.fidelity.context.checks.length, currentCheckCount: plan.fidelity.context.evidence.checks.length,
    removedChecks: oldPlan.fidelity.context.checks.filter(o => !plan.fidelity.context.evidence.checks.some(n => n.id === o.id)),
    referenceTargets: plan.fidelity.context.evidence.comparisonTargets,
    originalOutputCap: oldPlan.fidelity.body.max_tokens, newOutputCap: plan.fidelity.body.max_tokens,
    candidateBytesUnchanged: true, detailViews: plan.detailEvidence });
}
assert.equal(requests.length, 15); assert.equal(cases.length, 14); assert.equal(reusedCraft.length, 8);
const reserve = requests.reduce((sum, r) => sum + r.requestPlanningReserveMicros, 0);
assert(reserve <= 2_500_000);
const registration = { dataset: 'compact-review-final-20260917-v1', protocol: 'compact-review-final-v1',
  authorizationStatus: 'pending', maximumCalls: 15, budgetMicros: 2_500_000,
  pricing: { inputMicrosPerToken: 3, outputMicrosPerToken: 15, checkedDate: '2026-09-17',
    source: 'https://platform.claude.com/docs/en/about-claude/pricing', serviceTier: 'standard', inferenceGeo: 'global' },
  requests, cases, reusedCraft, references: referenceRecords };
write('registration.json', registration);
write('preparation-proof.json', { providerCalls: 0, networkAttempts: 0, oldAllowancesRemainClosed: true,
  requestPlanningReservesTotalMicros: reserve, budgetMicros: 2_500_000, providerInvoiceCap: false,
  newCraftCalls: 1, newFidelityCalls: 14, reusedCraft: 8, uniqueCandidateImages: 9,
  humanLabelsInRequests: false, checks: proof });
console.log(JSON.stringify({ calls: 15, craft: 1, fidelity: 14, reusedCraft: 8, images: 9, providerCalls: 0, reserveUsd: reserve / 1e6 }));

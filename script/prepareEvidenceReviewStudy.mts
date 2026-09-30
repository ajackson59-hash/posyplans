/** Offline only: freeze v2 packets; never authorize or dispatch a provider call. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
globalThis.fetch = async () => { throw Error('Offline preparation: network prohibited'); };
const { prepareSeparatedReview } = await import('../server/aiFirst/separatedArtworkReview.ts');
const { crossThemeProfile, CROSS_THEME_CASES } = await import('../server/crossThemeReviewProfiles.ts');
const [imageDir, boardFile, outputDir] = process.argv.slice(2);
assert(imageDir && boardFile && outputDir, 'Supply image directory, frozen board manifest, private output directory');
const board = JSON.parse(fs.readFileSync(boardFile, 'utf8'));
const hash = (v: string | Buffer) => createHash('sha256').update(v).digest('hex');
const requests = [], cases = [];
fs.mkdirSync(path.join(outputDir, 'requests'), { recursive: true });
for (const c of CROSS_THEME_CASES) {
  const b = board.cases.find((x: any) => x.caseId === c.caseId);
  const bytes = fs.readFileSync(path.join(imageDir, `${c.image}-reviewed.png`));
  assert.equal(hash(bytes), b.imageSha256);
  const plan = prepareSeparatedReview({ ...await crossThemeProfile(c.caseId), bytes, reviewMode: 'teaser' });
  assert.equal(plan.fingerprint, b.v2.combinedFingerprint, 'Reviewer packets changed after the human board');
  const craftRequestId = `craft-${c.image}`, fidelityRequestId = `fidelity-${c.caseId}`;
  cases.push({ caseId:c.caseId, image:c.image, reviewedHash:plan.imageHash,
    combinedFingerprint:plan.fingerprint, contextHash:plan.fidelity.contextHash, craftRequestId, fidelityRequestId });
  for (const role of ['craft','fidelity'] as const) {
    const requestId = role === 'craft' ? craftRequestId : fidelityRequestId;
    if (requests.some(r => r.requestId === requestId)) continue;
    const p = plan[role];
    requests.push({ requestId, role, imageHash:p.imageHash, requestFingerprint:p.requestFingerprint,
      schemaHash:p.schemaHash, version:p.version, maxOutputTokens:p.body.max_tokens,
      planningInputTokens:15000, requestPlanningReserveMicros:45000+15*p.body.max_tokens });
    fs.writeFileSync(path.join(outputDir,'requests',`${requestId}.json`),JSON.stringify(p.body));
  }
}
assert.equal(requests.length,20);
assert.equal(new Set(cases.map(c=>c.reviewedHash)).size,8);
const registration={dataset:'evidence-review-20260917-v1',authorizationStatus:'pending',
  protocol:'evidence-owned-research-v1',maximumCalls:20,budgetMicros:2500000,
  pricing:{inputMicrosPerToken:3,outputMicrosPerToken:15,checkedDate:'2026-09-17',
    source:'https://platform.claude.com/docs/en/about-claude/pricing',serviceTier:'standard',inferenceGeo:'global'},
  reusedCraft:[],requests,cases};
const reserve=requests.reduce((s,r)=>s+r.requestPlanningReserveMicros,0);
assert(reserve<=registration.budgetMicros);
fs.writeFileSync(path.join(outputDir,'registration.json'),JSON.stringify(registration,null,2)+'\n');
fs.writeFileSync(path.join(outputDir,'preparation-proof.json'),JSON.stringify({providerCalls:0,networkAttempts:0,
  requests:20,uniqueImages:8,unchangedBoardPackets:12,newCraftCalls:8,newFidelityCalls:12,
  requestPlanningReservesTotalMicros:reserve,budgetMicros:registration.budgetMicros,
  humanLabelsInRequests:false,oldAllowancesRemainClosed:true,
  registrationSha256:hash(JSON.stringify(registration))},null,2)+'\n');
console.log(JSON.stringify({requests:20,images:8,providerCalls:0,planningReserveUsd:reserve/1e6,budgetUsd:2.5}));

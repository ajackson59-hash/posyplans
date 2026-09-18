// @vitest-environment node
import {createHash} from 'node:crypto';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import type {Event} from '@shared/schema';
import {encodePng} from '../server/aiFirst/png';
import {InMemoryArtworkAttemptStore,REVIEW_CALIBRATION_MODEL} from '../server/aiFirst/artworkAttemptStore';
import {MEDIUM_FEASIBILITY_CASES} from '../server/aiFirst/mediumFeasibilityCases';
import {CROSS_THEME_FOLLOWUP_REGISTRATIONS as registrations,runCrossThemeFollowup,priorCrossThemeClosed,CROSS_THEME_FOLLOWUP_DATASET,PRIOR_CROSS_THEME_SPEND_MICROS} from '../server/crossThemeFollowup';
import allRegistrations from '../server/crossThemeReviewRegistration.json';
import {CROSS_THEME_DATASET,crossThemeProfile,type CrossThemeCaseId} from '../server/crossThemeReviewProfiles';
import {researchVerdict,uncertainVerdict} from './researchReviewFixture';
const hash=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex');
const bytes=encodePng({width:600,height:600,rgb:new Uint8Array(600*600*3).fill(110)});
const frozen=structuredClone(registrations);
const environment={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'codex/launch-blockers',VERCEL_GIT_COMMIT_SHA:'followup-test'};
const event={id:61,ownerToken:'test-owner',eventName:'Artwork evaluation',eventType:'Artwork evaluation',inviteStatus:'draft',themeName:'',paletteColors:'[]',vibeDescription:MEDIUM_FEASIBILITY_CASES[0].hostBrief} as Event;
beforeEach(async()=>{for(const r of registrations){const {brief,concept}=await crossThemeProfile(r.caseId as CrossThemeCaseId);Object.assign(r,{reviewedHash:hash(bytes),contextHash:hash(JSON.stringify({brief,concept,previewImageProfile:'detail-v1'}))});}});
afterEach(()=>{registrations.forEach((r,i)=>Object.assign(r,frozen[i]));});
async function fixture(){
 const store=new InMemoryArtworkAttemptStore(),review=vi.fn(async()=>uncertainVerdict());
 const {concept}=await crossThemeProfile('c01');
 const base={eventId:61,ownerToken:event.ownerToken,bytes,concept,directionIndex:0,attempt:0,status:'rejected' as const,previewId:null,model:REVIEW_CALIBRATION_MODEL,quality:'not-applicable' as const,costUsdMicros:0,failureCodes:[],tier1Findings:[],visionScores:null};
 const usages=[[6826,693],[6812,858],[6826,699],[6826,816],[7366,855]];
 for(let i=0;i<5;i++){
  const r=allRegistrations[i],v=i===4?uncertainVerdict():researchVerdict();v.usage={inputTokens:usages[i][0],outputTokens:usages[i][1]};
  const e={...r,dataset:CROSS_THEME_DATASET,caseId:r.caseId,deploymentSha:'28d3c354c5a81e5c4154ed39a8e56798f6af9ee6',physicalRequests:1,accountingKnown:true,criticCostMicros:usages[i][0]*3+usages[i][1]*15,customerActivation:'disabled',continuationAllowed:i<4};
  for(const stage of ['claimed','completed']){
   const row=await store.record({...base,runId:CROSS_THEME_DATASET,idempotencyKey:`${CROSS_THEME_DATASET}:${r.caseId}:${stage}`,reviewEvidence:{version:1,reviewedAssetHash:r.reviewedHash,verdict:stage==='completed'?v:null,generationDurationMs:0,customerEvaluation:{...e,stage}}});row.assetHash=r.reviewedHash;
  }
  if(i===4)await store.record({...base,runId:CROSS_THEME_DATASET,idempotencyKey:`${CROSS_THEME_DATASET}:closed`,reviewEvidence:{version:1,reviewedAssetHash:r.reviewedHash,verdict:v,generationDurationMs:0,customerEvaluation:{...e,stage:'closed',closeReason:'review-contract-failure'}}});
 }
 return {store,review,options:{candidate:bytes,environment,review}};
}
it('requires the exact closed five-call predecessor and never exposes already-consumed cases',async()=>{
 const f=await fixture();expect(priorCrossThemeClosed(f.store.all)).toBe(true);
 expect(await runCrossThemeFollowup(event,f.store,'c06',{...f.options,preflightOnly:true})).toMatchObject({kind:'preflight',prerequisitesValid:true,spentMicros:162783});
 expect((await runCrossThemeFollowup(event,f.store,'c01',f.options)).kind).toBe('blocked');
 f.store.all.at(-1)!.reviewEvidence!.customerEvaluation!.closeReason='changed';
 expect((await runCrossThemeFollowup(event,f.store,'c06',f.options)).kind).toBe('blocked');expect(f.review).not.toHaveBeenCalled();
});
it('continues after well-formed uncertainty while every image remains rejected, then closes after seven',async()=>{
 const f=await fixture(),prior=structuredClone(f.store.all),before=structuredClone(event);
 for(const r of registrations)expect(await runCrossThemeFollowup(event,f.store,r.caseId as CrossThemeCaseId,f.options)).toMatchObject({kind:'completed',reportDisposition:'unresolved',continuationAllowed:true,verdict:{passed:false,reviewIntegrity:{valid:false}}});
 expect(f.review).toHaveBeenCalledTimes(7);expect(f.store.all.slice(0,11)).toEqual(prior);expect(event).toEqual(before);
 expect(f.store.all).toHaveLength(26);expect(f.store.all.at(-1)!.idempotencyKey).toBe(`${CROSS_THEME_FOLLOWUP_DATASET}:closed`);
 for(const row of f.store.all.slice(11))expect(row).toMatchObject({status:'rejected',previewId:null});
 expect((await runCrossThemeFollowup(event,f.store,'c06',f.options)).kind).toBe('blocked');
});
it('allows one call under concurrent requests and blocks replay, skipped order, changed pixels and Production',async()=>{
 const f=await fixture();
 expect((await runCrossThemeFollowup(event,f.store,'c07',f.options)).kind).toBe('blocked');
 expect((await runCrossThemeFollowup(event,f.store,'c06',{...f.options,candidate:Buffer.from('bad')})).kind).toBe('blocked');
 expect((await runCrossThemeFollowup(event,f.store,'c06',{...f.options,environment:{...environment,VERCEL_ENV:'production'}})).kind).toBe('blocked');
 const results=await Promise.all([1,2].map(()=>runCrossThemeFollowup(event,f.store,'c06',f.options)));
 expect(results.map(r=>r.kind).sort()).toEqual(['blocked','completed']);expect(f.review).toHaveBeenCalledTimes(1);
 expect((await runCrossThemeFollowup(event,f.store,'c06',f.options)).kind).toBe('blocked');
});
it.each(['contradiction','missing-row','accounting','provider','raw-response','schema'])(
 'stops on %s despite allowing uncertainty',async(mode)=>{
 const f=await fixture(),v=uncertainVerdict();
 if(mode==='contradiction')v.reviewIntegrity!.issues.push('briefFidelity:binary-check-conflict');
 if(mode==='missing-row')v.checklist!.valid=false;
 if(mode==='accounting')v.usage.inputTokens=0;
 if(mode==='provider')v.unavailable=true;
 if(mode==='raw-response')v.providerResponses=[];
 if(mode==='schema')v.requestSchema!.sha256='changed';
 f.review.mockResolvedValue(v);
 expect(await runCrossThemeFollowup(event,f.store,'c06',f.options)).toMatchObject({kind:'stopped',closed:true,continuationAllowed:false});
 expect((await runCrossThemeFollowup(event,f.store,'c07',f.options)).kind).toBe('blocked');expect(f.review).toHaveBeenCalledTimes(1);
});
it('closes on readback failure and blocks later calls',async()=>{
 const f=await fixture(),find=f.store.findById.bind(f.store);let reads=0;
 vi.spyOn(f.store,'findById').mockImplementation(async(...args)=>++reads===1?find(...args):undefined);
 await expect(runCrossThemeFollowup(event,f.store,'c06',f.options)).rejects.toThrow('retention');
 expect((await runCrossThemeFollowup(event,f.store,'c07',f.options)).kind).toBe('blocked');expect(f.review).toHaveBeenCalledTimes(1);
});
it('accounts for the original five calls without granting their budget or registrations again',async()=>{
 const f=await fixture();const r=await runCrossThemeFollowup(event,f.store,'c06',f.options);
 expect(r).toMatchObject({spentMicros:PRIOR_CROSS_THEME_SPEND_MICROS+7000*3+900*15});
 expect(f.review.mock.calls[0][0]).toMatchObject({reviewMode:'teaser',maxFormatRepairs:0});
 expect(JSON.stringify(f.review.mock.calls[0][0])).not.toMatch(/priorSpend|followup-v1|expectedIdentity|humanFinish/);
});

// @vitest-environment node
import {createHash} from 'node:crypto';
import {beforeEach,afterEach,expect,it,vi} from 'vitest';
import type {Event} from '@shared/schema';
import {encodePng} from '../server/aiFirst/png';
import {InMemoryArtworkAttemptStore} from '../server/aiFirst/artworkAttemptStore';
import {MEDIUM_FEASIBILITY_CASES} from '../server/aiFirst/mediumFeasibilityCases';
import {CROSS_THEME_REGISTRATIONS,runCrossThemeReview,CROSS_THEME_DATASET} from '../server/crossThemeReview';
import {crossThemeProfile,type CrossThemeCaseId} from '../server/crossThemeReviewProfiles';
import type {VisionVerdict} from '../server/aiFirst/visionGate';
const hash=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex');
const bytes=encodePng({width:600,height:600,rgb:new Uint8Array(600*600*3).fill(110)});
const frozen=structuredClone(CROSS_THEME_REGISTRATIONS);
const environment={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'codex/launch-blockers',VERCEL_GIT_COMMIT_SHA:'test-deployment'};
const event={id:61,ownerToken:'test-owner',eventName:'Artwork evaluation',eventType:'Artwork evaluation',inviteStatus:'draft',themeName:'',paletteColors:'[]',vibeDescription:MEDIUM_FEASIBILITY_CASES[0].hostBrief} as Event;
const verdict=():VisionVerdict=>({passed:false,unavailable:false,requestCount:1,durationMs:12,usage:{inputTokens:6000,outputTokens:1400},
 scores:{textLogoWatermarkFree:5,artifactFree:5,premiumFinish:5,briefFidelity:2,compositionQuality:5,ageAppropriate:5},
 requiredPresent:[],excludedFound:[],notes:'Synthetic transport evidence only',failureCodes:['brief-fidelity'],
 reviewIntegrity:{version:'separate-execution-review-v3',valid:true,issues:[]},checklist:{valid:true,issues:[],version:'requirement-ids-v1'} as any,
 requestSchema:{version:'static-review-schema-v2',sha256:'schema'},providerResponses:[{text:'{"synthetic":true}',stopReason:'end_turn'}]});
beforeEach(async()=>{
 for(const r of CROSS_THEME_REGISTRATIONS){
  const {brief,concept}=await crossThemeProfile(r.caseId as CrossThemeCaseId);
  Object.assign(r,{reviewedHash:hash(bytes),contextHash:hash(JSON.stringify({brief,concept,previewImageProfile:'detail-v1'})),schemaHash:'schema'});
 }
});
afterEach(()=>{CROSS_THEME_REGISTRATIONS.forEach((r,i)=>Object.assign(r,frozen[i]));vi.unstubAllEnvs();vi.unstubAllGlobals();});
function fixture(){const store=new InMemoryArtworkAttemptStore(),review=vi.fn(async()=>verdict());return {store,review,options:{candidate:bytes,environment,review}};}
it('preflights every registered input without spending or persistence, including non-invitation reference dimensions',async()=>{
 const f=fixture();for(const r of CROSS_THEME_REGISTRATIONS)expect(await runCrossThemeReview(event,f.store,r.caseId as CrossThemeCaseId,{...f.options,preflightOnly:true})).toMatchObject({kind:'preflight',criticRequests:0,alreadyClaimed:false});
 expect(f.store.all).toHaveLength(0);expect(f.review).not.toHaveBeenCalled();
});
it('requires exact environment, owner event, brief, pixels and order before a claim',async()=>{
 const f=fixture();
 for(const [e,o,c] of [[{...event,id:54},f.options,'c01'],[{...event,vibeDescription:'changed'},f.options,'c01'],
 [event,{...f.options,environment:{...environment,VERCEL_ENV:'production'}},'c01'],[event,{...f.options,candidate:Buffer.from('bad')},'c01'],
 [event,{...f.options,signal:AbortSignal.abort()},'c01'],[event,f.options,'c02']] as const)
 expect((await runCrossThemeReview(e,f.store,c,o)).kind).toBe('blocked');
 expect(f.store.all).toHaveLength(0);expect(f.review).not.toHaveBeenCalled();
});
it('allows one physical dispatch under replay/concurrency and never passes labels to the reviewer',async()=>{
 const f=fixture(),before=structuredClone(event);
 const results=await Promise.all([1,2].map(()=>runCrossThemeReview(event,f.store,'c01',f.options)));
 expect(results.map(r=>r.kind).sort()).toEqual(['blocked','completed']);expect(f.review).toHaveBeenCalledTimes(1);
 expect((await runCrossThemeReview(event,f.store,'c01',f.options)).kind).toBe('blocked');
 const request=f.review.mock.calls[0][0];expect(request).toMatchObject({reviewMode:'teaser',maxFormatRepairs:0});
 expect(JSON.stringify(request)).not.toMatch(/expectedIdentity|Candidate B|cross-theme-review|humanFinish/);
 expect(event).toEqual(before);expect(f.store.all).toHaveLength(2);
 for(const row of f.store.all)expect(row).toMatchObject({status:'rejected',previewId:null,assetHash:hash(bytes)});
});
it('keeps valid quality failures, proceeds in fixed order, then permanently closes after twelve',async()=>{
 const f=fixture();for(const r of CROSS_THEME_REGISTRATIONS)expect(await runCrossThemeReview(event,f.store,r.caseId as CrossThemeCaseId,f.options)).toMatchObject({kind:'completed',continuationAllowed:true});
 expect(f.review).toHaveBeenCalledTimes(12);expect(f.store.all).toHaveLength(25);
 expect(f.store.all.at(-1)?.idempotencyKey).toBe(`${CROSS_THEME_DATASET}:closed`);
 expect((await runCrossThemeReview(event,f.store,'c01',f.options)).kind).toBe('blocked');
});
it.each(['contract','checklist','schema','raw-response','accounting','unavailable','provider-throws'])('stops and closes without retry on %s',async(mode)=>{
 const f=fixture(),v=verdict();
 if(mode==='contract')v.reviewIntegrity!.valid=false;
 if(mode==='checklist')v.checklist!.valid=false;
 if(mode==='schema')v.requestSchema!.sha256='drift';
 if(mode==='raw-response')v.providerResponses=[];
 if(mode==='accounting')v.usage.inputTokens=0;
 if(mode==='unavailable')v.unavailable=true;
 if(mode==='provider-throws')f.review.mockRejectedValue(Error('transport failed'));else f.review.mockResolvedValue(v);
 expect(await runCrossThemeReview(event,f.store,'c01',f.options)).toMatchObject({kind:'stopped',closed:true,continuationAllowed:false});
 expect((await runCrossThemeReview(event,f.store,'c02',f.options)).kind).toBe('blocked');
 expect((await runCrossThemeReview(event,f.store,'c01',f.options)).kind).toBe('blocked');expect(f.review).toHaveBeenCalledTimes(1);
 expect(f.store.all[1].reviewEvidence?.verdict).toEqual(mode==='provider-throws'?null:v);
});
it('blocks spending when claim readback fails, and cannot skip the failed claim',async()=>{
 const f=fixture();vi.spyOn(f.store,'findById').mockResolvedValue(undefined);
 expect((await runCrossThemeReview(event,f.store,'c01',f.options)).kind).toBe('blocked');
 expect((await runCrossThemeReview(event,f.store,'c02',f.options)).kind).toBe('blocked');expect(f.review).not.toHaveBeenCalled();
});
it('retention failure after the provider prevents subsequent calls',async()=>{
 const f=fixture(),find=f.store.findById.bind(f.store);let reads=0;
 vi.spyOn(f.store,'findById').mockImplementation(async(...args)=>{reads++;return reads===1?find(...args):undefined;});
 await expect(runCrossThemeReview(event,f.store,'c01',f.options)).rejects.toThrow('retention');
 expect((await runCrossThemeReview(event,f.store,'c02',f.options)).kind).toBe('blocked');
 expect(f.review).toHaveBeenCalledTimes(1);
});
it('checks the exact SDK request before any real fetch',async()=>{
 const f=fixture(),fetch=vi.fn();vi.stubGlobal('fetch',fetch);vi.stubEnv('ANTHROPIC_API_KEY','offline-test');
 const result=await runCrossThemeReview(event,f.store,'c01',{candidate:bytes,environment});
 expect(result).toMatchObject({kind:'stopped',physicalRequests:0,closed:true});expect(fetch).not.toHaveBeenCalled();
});
it('supports idempotent no-spend closeout of all unused registrations',async()=>{
 const f=fixture();expect(await runCrossThemeReview(event,f.store,'c01',{...f.options,closeOnly:true})).toMatchObject({kind:'closed'});
 expect(await runCrossThemeReview(event,f.store,'c01',{...f.options,closeOnly:true})).toMatchObject({kind:'closed',alreadyClosed:true});
 expect((await runCrossThemeReview(event,f.store,'c01',f.options)).kind).toBe('blocked');expect(f.review).not.toHaveBeenCalled();
});

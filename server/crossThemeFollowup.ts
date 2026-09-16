/** Seven-case follow-up approved after the first study closed. No customer activation. */
import Anthropic from '@anthropic-ai/sdk';
import {createHash} from 'node:crypto';
import type {Event} from '@shared/schema';
import {REVIEW_CALIBRATION_MODEL,type AiFirstArtworkAttemptStore,type ArtworkAttemptInput,type ArtworkAttemptRecord} from './aiFirst/artworkAttemptStore';
import {MEDIUM_FEASIBILITY_CASES} from './aiFirst/mediumFeasibilityCases';
import {runTier1Checks} from './aiFirst/tier1';
import {GOOGLE_ARTWORK_MODEL} from './aiFirst/artwork';
import {runVisionGate,visionCostUsd,type VisionVerdict} from './aiFirst/visionGate';
import {CROSS_THEME_DATASET as PRIOR_DATASET,crossThemeProfile,type CrossThemeCaseId} from './crossThemeReviewProfiles';
import {researchReviewDisposition} from './aiFirst/researchReviewDisposition';
import allRegistrations from './crossThemeReviewRegistration.json';
const registrations=allRegistrations.slice(5);
export const CROSS_THEME_FOLLOWUP_DATASET='cross-theme-review-20260916-followup-v1';
const CROSS_THEME_DATASET=CROSS_THEME_FOLLOWUP_DATASET;

export const CROSS_THEME_FOLLOWUP_REGISTRATIONS=registrations;
export const PRIOR_CROSS_THEME_SPEND_MICROS=162783;
const PRIOR_DEPLOYMENT='28d3c354c5a81e5c4154ed39a8e56798f6af9ee6';
const hash=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
const budgetMicros=1_500_000;
const key=(caseId:string,stage:string)=>`${CROSS_THEME_DATASET}:${caseId}:${stage}`;
const closeKey=`${CROSS_THEME_DATASET}:closed`;
/** The old five reviews stay consumed. Only its seven never-dispatched cases are eligible. */
export function priorCrossThemeClosed(rows:ArtworkAttemptRecord[]):boolean {
 const prior=rows.filter(r=>r.runId===PRIOR_DATASET);
 if(prior.length!==11)return false;
 const closed=prior.filter(r=>r.idempotencyKey===`${PRIOR_DATASET}:closed`);
 const proof=closed[0]?.reviewEvidence?.customerEvaluation;
 if(closed.length!==1||closed[0].status!=='rejected'||closed[0].previewId||
   proof?.stage!=='closed'||proof.closeReason!=='review-contract-failure'||proof.caseId!=='c05'||
   proof.deploymentSha!==PRIOR_DEPLOYMENT||proof.customerActivation!=='disabled'||proof.continuationAllowed!==false)return false;
 let spent=0;
 for(const r of allRegistrations.slice(0,5)){
   const claim=prior.filter(row=>row.idempotencyKey===`${PRIOR_DATASET}:${r.caseId}:claimed`);
   const results=prior.filter(row=>row.idempotencyKey===`${PRIOR_DATASET}:${r.caseId}:completed`);
   const row=results[0],e=row?.reviewEvidence?.customerEvaluation,v=row?.reviewEvidence?.verdict;
   if(claim.length!==1||results.length!==1||row?.status!=='rejected'||row.previewId||row.assetHash!==r.reviewedHash||
     e?.dataset!==PRIOR_DATASET||e.stage!=='completed'||e.caseId!==r.caseId||e.deploymentSha!==PRIOR_DEPLOYMENT||
     e.sourceHash!==r.sourceHash||e.contextHash!==r.contextHash||e.requestHash!==r.requestHash||
     e.customerActivation!=='disabled'||e.physicalRequests!==1||e.accountingKnown!==true||!v||v.unavailable||v.requestCount!==1||
     !Number.isSafeInteger(v.usage.inputTokens)||v.usage.inputTokens<=0||!Number.isSafeInteger(v.usage.outputTokens)||v.usage.outputTokens<=0||
     e.criticCostMicros!==Math.round(visionCostUsd(v.usage)*1e6))return false;
   spent+=Number(e.criticCostMicros);
 }
 return spent===PRIOR_CROSS_THEME_SPEND_MICROS;
}
interface Options {candidate:Buffer;environment?:NodeJS.ProcessEnv;signal?:AbortSignal;preflightOnly?:boolean;closeOnly?:boolean;review?:typeof runVisionGate}

export async function runCrossThemeFollowup(event:Event,store:AiFirstArtworkAttemptStore,caseId:CrossThemeCaseId,options:Options){
 const env=options.environment??process.env;
 const blocked=(reason:string)=>({kind:'blocked' as const,reason,customerActivation:'disabled' as const});
 const index=registrations.findIndex(c=>c.caseId===caseId),r=registrations[index];
 if(env.VERCEL_ENV!=='preview'||env.VERCEL_GIT_COMMIT_REF!=='codex/launch-blockers'||!env.VERCEL_GIT_COMMIT_SHA||
   index<0||r?.caseId!==caseId||!store.recordOnce||event.id!==61||!event.ownerToken||
   event.eventName!=='Artwork evaluation'||event.eventType!=='Artwork evaluation'||event.inviteStatus!=='draft'||
   event.themeName!==''||event.paletteColors!=='[]'||hash(event.vibeDescription)!==MEDIUM_FEASIBILITY_CASES[0].hostBriefSha256||options.signal?.aborted)
   return blocked('cross-theme-context-mismatch');
 const bytes=options.candidate;
 if(bytes.length>2_600_000||hash(bytes)!==r.reviewedHash)return blocked('cross-theme-pixel-integrity');
 const {brief,concept}=await crossThemeProfile(caseId);
 const contextHash=hash(JSON.stringify({brief,concept,previewImageProfile:'detail-v1'}));
 if(contextHash!==r.contextHash)return blocked('cross-theme-profile-integrity');
 const tier1=runTier1Checks({bytes,brief,concept,artworkModel:GOOGLE_ARTWORK_MODEL,overlayCoverage:0,artworkOpacity:1,layoutApplied:false,ocr:true});
 const rows=await store.listForOwner(event.id,event.ownerToken);
 const closed=rows.some(row=>row.idempotencyKey===closeKey);
 const claimed=rows.some(row=>row.idempotencyKey===key(caseId,'claimed'));
 let spentMicros=PRIOR_CROSS_THEME_SPEND_MICROS,prerequisitesValid=priorCrossThemeClosed(rows);
 for(let i=0;i<index;i++){
   const p=registrations[i],matches=rows.filter(row=>row.idempotencyKey===key(p.caseId,'completed'));
   const row=matches[0],e=row?.reviewEvidence?.customerEvaluation,v=row?.reviewEvidence?.verdict;
   const cost=e?.criticCostMicros;
   if(matches.length!==1||row?.status!=='rejected'||row.previewId||row.assetHash!==p.reviewedHash||
     e?.dataset!==CROSS_THEME_DATASET||e.stage!=='completed'||e.caseId!==p.caseId||
     e.deploymentSha!==env.VERCEL_GIT_COMMIT_SHA||e.contextHash!==p.contextHash||e.requestHash!==p.requestHash||
     e.customerActivation!=='disabled'||e.continuationAllowed!==true||e.physicalRequests!==1||
     !v||v.unavailable||researchReviewDisposition(v)==='invalid'||e.reportDisposition!==researchReviewDisposition(v)||v.requestCount!==1||
     typeof cost!=='number'||!Number.isSafeInteger(cost)||cost<=0||cost>p.requestReserveMicros||cost!==Math.round(visionCostUsd(v.usage)*1e6)){prerequisitesValid=false;break;}
   spentMicros+=cost;
 }
 const base:ArtworkAttemptInput={eventId:event.id,ownerToken:event.ownerToken,runId:CROSS_THEME_DATASET,
   directionIndex:index,attempt:0,status:'rejected',previewId:null,bytes,concept,model:REVIEW_CALIBRATION_MODEL,
   quality:'not-applicable',size:null,costUsdMicros:0,failureCodes:['calibration-only-no-customer-approval'],
   tier1Findings:tier1.findings,visionScores:null};
 const evidence:Record<string,unknown>={dataset:CROSS_THEME_DATASET,caseId,stage:'claimed',deploymentSha:env.VERCEL_GIT_COMMIT_SHA,
   sourceHash:r.sourceHash,reviewedHash:r.reviewedHash,contextHash,requestHash:r.requestHash,requestReserveMicros:r.requestReserveMicros,
   priorDataset:PRIOR_DATASET,priorSpendMicros:PRIOR_CROSS_THEME_SPEND_MICROS,protocolVersion:'research-uncertainty-v1',
   imageProviderCalls:0,classifierRequests:0,physicalRequests:null,criticRequests:null,criticCostMicros:null,
   customerActivation:'disabled',continuationAllowed:false,assetRole:'exact-reviewed-pixels',
   sourceRetention:'original source is separately retained; this research row retains reviewed bytes'};
 const save=async(stage:string,verdict:VisionVerdict|null,closing=false)=>{
   const proof={...evidence,stage};
   const saved=await store.recordOnce!({...base,idempotencyKey:closing?closeKey:key(caseId,stage),
     visionScores:verdict?.scores??null,reviewEvidence:{version:1,previewImageProfile:'detail-v1',reviewedAssetHash:r.reviewedHash,
       verdict,generationDurationMs:0,customerEvaluation:proof}});
   if(!saved.created||!saved.record)throw Error('cross-theme-claim-or-retention-failed');
   const read=await store.findById(event.id,event.ownerToken,saved.record.id);
   if(!read||read.runId!==CROSS_THEME_DATASET||read.idempotencyKey!==(closing?closeKey:key(caseId,stage))||read.status!=='rejected'||read.previewId||
     read.model!==REVIEW_CALIBRATION_MODEL||read.assetHash!==r.reviewedHash||hash(Buffer.from(read.assetBytesBase64,'base64'))!==r.reviewedHash||
     JSON.stringify(read.reviewEvidence?.customerEvaluation)!==JSON.stringify(proof)||JSON.stringify(read.reviewEvidence?.verdict)!==JSON.stringify(verdict))
     throw Error('cross-theme-retention-failed');
   return read.id;
 };
 if(options.preflightOnly)return {kind:'preflight' as const,caseId,sourceHash:r.sourceHash,reviewedHash:r.reviewedHash,contextHash,requestHash:r.requestHash,
   schemaHash:r.schemaHash,deploymentSha:env.VERCEL_GIT_COMMIT_SHA,width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20),reviewedBytes:bytes.length,
   tier1:{passed:tier1.passed,findings:tier1.findings},alreadyClaimed:claimed,closed,prerequisitesValid,
   spentMicros,requestReserveMicros:r.requestReserveMicros,criticRequests:0,imageProviderCalls:0,customerActivation:'disabled' as const};
 if(options.closeOnly){
   if(closed)return {kind:'closed' as const,alreadyClosed:true,customerActivation:'disabled' as const};
   evidence.closeReason='owner-approved-study-closeout';
   return {kind:'closed' as const,attemptId:await save('closed',null,true),customerActivation:'disabled' as const};
 }
 if(closed)return blocked('cross-theme-closed');
 if(claimed)return blocked('cross-theme-already-claimed');
 if(!prerequisitesValid)return blocked('cross-theme-prerequisite-failed');
 if(spentMicros+r.requestReserveMicros>budgetMicros)return blocked('cross-theme-budget-reserve');
 if(!options.review&&!process.env.ANTHROPIC_API_KEY)return blocked('cross-theme-provider-unconfigured');
 try{await save('claimed',null);}catch{return blocked('cross-theme-already-claimed-or-retention-failed');}
 const signal=AbortSignal.any([AbortSignal.timeout(45_000),...(options.signal?[options.signal]:[])]);
 let physicalRequests=0,requestVerified=false;
 const client=options.review?undefined:new Anthropic({apiKey:process.env.ANTHROPIC_API_KEY,maxRetries:0,fetch:async(url,init)=>{
   const body=typeof init?.body==='string'?JSON.parse(init.body):null;
   if(!body||hash(JSON.stringify(body))!==r.requestHash||physicalRequests!==0)throw Error('cross-theme-request-integrity');
   signal.throwIfAborted();requestVerified=true;physicalRequests++;
   return fetch(url,{...init,signal});
 }});
 let verdict:VisionVerdict|null=null;
 try{
   signal.throwIfAborted();
   verdict=await(options.review??runVisionGate)({bytes,brief,concept,client,reviewMode:'teaser',maxFormatRepairs:0,signal});
   // Test injection is never exposed through the HTTP route.
   if(options.review){physicalRequests=verdict.requestCount??0;requestVerified=true;}
 }catch{evidence.error='cross-theme-provider-unavailable';}
 const accountingKnown=!!verdict&&verdict.requestCount===1&&physicalRequests===1&&
   Number.isSafeInteger(verdict.usage.inputTokens)&&verdict.usage.inputTokens>0&&
   Number.isSafeInteger(verdict.usage.outputTokens)&&verdict.usage.outputTokens>0;
 const cost=accountingKnown?Math.round(visionCostUsd(verdict!.usage)*1e6):null;
 const reportDisposition=researchReviewDisposition(verdict);
 const contractValid=!!verdict&&!verdict.unavailable&&reportDisposition!=='invalid'&&
   verdict.checklist?.valid===true&&verdict.requestSchema?.sha256===r.schemaHash&&
   verdict.providerResponses?.length===1&&verdict.providerResponses[0].stopReason==='end_turn';
 const continuationAllowed=requestVerified&&!signal.aborted&&accountingKnown&&contractValid&&cost!==null&&cost<=r.requestReserveMicros;
 Object.assign(evidence,{physicalRequests,requestVerified,criticRequests:verdict?.requestCount??null,
   criticCostMicros:cost,criticUsage:verdict?.usage??null,criticMs:verdict?.durationMs??null,accountingKnown,
   contractValid,reportDisposition,continuationAllowed,fullGatePassed:verdict?.passed??null});
 let attemptId:string;
 try{attemptId=await save('completed',verdict);}
 catch(error){
   evidence.continuationAllowed=false;evidence.closeReason='retention-failure';
   try{await save('closed',verdict,true);}catch{/* A partial/failed closeout must be audited; never retry locally. */}
   throw error;
 }
 let closeAttemptId:string|undefined;
 if(!continuationAllowed||index===registrations.length-1){
   evidence.closeReason=continuationAllowed?'all-seven-completed':!accountingKnown?'accounting-unknown':!contractValid?'review-contract-failure':'request-or-budget-failure';
   closeAttemptId=await save('closed',verdict,true);
 }
 return {kind:continuationAllowed?'completed' as const:'stopped' as const,caseId,attemptId,closeAttemptId,
   reportDisposition,continuationAllowed,closed:!!closeAttemptId,physicalRequests,criticCostMicros:cost,spentMicros:cost===null?null:spentMicros+cost,
   imageProviderCalls:0,customerActivation:'disabled' as const,verdict};
}

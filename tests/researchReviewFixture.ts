import {REVIEW_CRITERIA} from '../server/aiFirst/reviewEvidence';
import type {VisionVerdict} from '../server/aiFirst/visionGate';
export function researchVerdict():VisionVerdict {
 return {passed:true,unavailable:false,requestCount:1,durationMs:10,usage:{inputTokens:7000,outputTokens:900},
 scores:Object.fromEntries(Object.keys(REVIEW_CRITERIA).map(k=>[k,5])) as any,
 dimensionAssessments:Object.fromEntries(Object.keys(REVIEW_CRITERIA).map(k=>[k,{status:'clear',criterion:'none',location:'canvas',observation:'Visible positive support',...(k==='premiumFinish'?{basis:'observed-craft'}:k==='compositionQuality'?{basis:'observed-layout'}:{})}])) as any,
 mediumAssessment:{status:'matched',location:'canvas',observedTreatment:'3d',observation:'Dimensional materials'},
 reviewIntegrity:{version:'separate-execution-review-v3',valid:true,issues:[]},
 checklist:{version:'requirement-ids-v1',valid:true,issues:[],requirements:[{id:'r1',kind:'medium',requirement:'Requested medium'}]},
 requiredPresent:[{requirementId:'r1',requirement:'Requested medium',present:true,evidence:'Located support',reviewStatus:'reported'}],
 excludedFound:[],notes:'Synthetic test; no visual approval',failureCodes:[],requestSchema:{version:'static-review-schema-v2',sha256:'f470c9ef41809cd746d123eaa47108005fdfa2e403587ce5c3e94e5eae7bb39d'},providerResponses:[{text:'{"synthetic":true}',stopReason:'end_turn'}]};
}
export function uncertainVerdict():VisionVerdict{
 const v=researchVerdict();v.passed=false;v.scores.textLogoWatermarkFree=4;
 v.dimensionAssessments!.textLogoWatermarkFree={status:'uncertain',criterion:'lettering',location:'jacket patch',observation:'Small marks cannot be resolved'};
 v.reviewIntegrity={version:'separate-execution-review-v3',valid:false,issues:['textLogoWatermarkFree:unresolved-observation']};
 v.failureCodes=['review-inconsistent','text-detected'];return v;
}

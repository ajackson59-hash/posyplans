/** Research sequencing only. Never changes a verdict, score, or customer approval. */
import type {VisionVerdict} from './visionGate';
import {REVIEW_CRITERIA} from './reviewEvidence';

export type ResearchReviewDisposition = 'valid' | 'unresolved' | 'invalid';
const located=(v:unknown)=>typeof v==='string'&&v.trim().length>0;
export function researchReviewDisposition(v:VisionVerdict|null):ResearchReviewDisposition {
 if(!v||v.unavailable||!v.checklist?.valid||!v.reviewIntegrity||
   !Array.isArray(v.reviewIntegrity.issues)||!Array.isArray(v.checklist.requirements)||!Array.isArray(v.requiredPresent)||!v.dimensionAssessments||!v.mediumAssessment)return 'invalid';
 const permitted=new Set<string>();
 for(const key of Object.keys(REVIEW_CRITERIA) as (keyof typeof REVIEW_CRITERIA)[]){
   const row=v.dimensionAssessments[key],score=v.scores[key];
   if(!row||!located(row.location)||!located(row.observation)||!Number.isInteger(score)||score<1||score>5)return 'invalid';
   if(row.status==='uncertain'){
     if(score===5||!(REVIEW_CRITERIA[key] as readonly string[]).includes(row.criterion))return 'invalid';
     permitted.add(`${key}:unresolved-observation`);
     if((key==='premiumFinish'||key==='compositionQuality')&&row.basis==='unresolved')
       permitted.add(`${key}:missing-independent-execution-basis`);
   }
 }
 const medium=v.mediumAssessment;
 if(medium.status==='unresolved'){
   const ids=new Set(v.checklist.requirements.filter(r=>r.kind==='medium').map(r=>r.id));
   const rows=v.requiredPresent.filter(r=>typeof r.requirementId==='string'&&ids.has(r.requirementId));
   if(!located(medium.location)||!located(medium.observation)||!located(medium.observedTreatment)||
     v.scores.briefFidelity>=5||!rows.length||rows.some(r=>r.reviewStatus!=='reported'||r.present))return 'invalid';
   permitted.add('medium:unresolved-observation');
 }
 const issues=v.reviewIntegrity.issues;
 if(v.reviewIntegrity.valid)return issues.length===0&&permitted.size===0?'valid':'invalid';
 // Exact allow-list: malformed/missing requirements, contradictions and any
 // unrelated issue still stop. Unresolved is always an artwork failure.
 if(v.passed||!issues.length||!permitted.size||issues.some(i=>!permitted.has(i)))return 'invalid';
 // Every uncertainty must actually be represented in the retained validator output.
 if(Array.from(permitted).some(i=>!issues.includes(i)))return 'invalid';
 return 'unresolved';
}

// @vitest-environment node
import {expect,it} from 'vitest';
import {researchReviewDisposition} from '../server/aiFirst/researchReviewDisposition';
import {REVIEW_CRITERIA} from '../server/aiFirst/reviewEvidence';
import type {VisionVerdict} from '../server/aiFirst/visionGate';
import {researchVerdict,uncertainVerdict} from './researchReviewFixture';
it('records complete uncertainty separately without changing rejection, scores or evidence',()=>{
 const v=uncertainVerdict(),before=structuredClone(v);
 expect(researchReviewDisposition(v)).toBe('unresolved');expect(v).toEqual(before);expect(v.passed).toBe(false);
 expect(researchReviewDisposition(researchVerdict())).toBe('valid');
});
it.each(['extra-contradiction','checklist','missing-assessment','wrong-criterion','raised-score','approved','missing-issue','unavailable','brief-basis'])(
 'keeps %s as invalid instead of laundering it through uncertainty',mode=>{
 const v=uncertainVerdict();
 if(mode==='extra-contradiction')v.reviewIntegrity!.issues.push('briefFidelity:binary-check-conflict');
 if(mode==='checklist')v.checklist!.valid=false;
 if(mode==='missing-assessment')delete v.dimensionAssessments!.artifactFree;
 if(mode==='wrong-criterion')v.dimensionAssessments!.textLogoWatermarkFree.criterion='malformed-anatomy';
 if(mode==='raised-score')v.scores.textLogoWatermarkFree=5;
 if(mode==='approved')v.passed=true;
 if(mode==='missing-issue'){v.reviewIntegrity!.valid=true;v.reviewIntegrity!.issues=[];}
 if(mode==='unavailable')v.unavailable=true;
 if(mode==='brief-basis'){v.dimensionAssessments!.premiumFinish.basis='brief-compliance';v.reviewIntegrity!.issues.push('premiumFinish:brief-compliance-is-not-execution');}
 expect(researchReviewDisposition(v)).toBe('invalid');
});
it('allows unresolved craft basis only with explicit uncertainty and a sub-five score',()=>{
 const v=uncertainVerdict();v.dimensionAssessments!.premiumFinish={status:'uncertain',criterion:'unresolved-detail',basis:'unresolved',location:'small trim',observation:'Cannot resolve edge detail'};v.scores.premiumFinish=4;
 v.reviewIntegrity!.issues.push('premiumFinish:unresolved-observation','premiumFinish:missing-independent-execution-basis');
 expect(researchReviewDisposition(v)).toBe('unresolved');
 v.dimensionAssessments!.premiumFinish.status='defect';expect(researchReviewDisposition(v)).toBe('invalid');
});
it('allows honest medium uncertainty only when the medium and fidelity are not claimed as passed',()=>{
 const v=uncertainVerdict();v.mediumAssessment!.status='unresolved';v.scores.briefFidelity=4;v.requiredPresent[0].present=false;
 v.reviewIntegrity!.issues.push('medium:unresolved-observation');
 expect(researchReviewDisposition(v)).toBe('unresolved');
 v.requiredPresent[0].present=true;expect(researchReviewDisposition(v)).toBe('invalid');
});

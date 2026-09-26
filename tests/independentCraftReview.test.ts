// @vitest-environment node
import {expect,it,vi} from 'vitest';
import {encodePng} from '../server/aiFirst/png';
import {buildIndependentCraftRequest,validateIndependentCraft} from '../server/aiFirst/independentCraftReview';
import {crossThemeProfile} from '../server/crossThemeReviewProfiles';
const bytes=encodePng({width:8,height:8,rgb:new Uint8Array(192).fill(120)});
const clear=()=>Object.fromEntries(['artifactFree','premiumFinish','compositionQuality'].map(d=>[d,{score:5,status:'clear',criterion:'none',location:'canvas',observation:'Positive visible support'}]));
it('creates identical craft packets for one image across incompatible host directions, with no brief data or network',async()=>{
 const fetch=vi.spyOn(globalThis,'fetch').mockRejectedValue(Error('offline'));
 try{
  const packets=[];
  for(const c of ['c01','c04','c06','c07','c08','c09','c10','c11'] as const){
   // Full production profiles differ, but none is an argument to craft review.
   const profile=await crossThemeProfile(c);expect(profile.brief).toBeDefined();
   packets.push(buildIndependentCraftRequest(bytes));
  }
  expect(new Set(packets.map(p=>p.requestFingerprint)).size).toBe(1);
  const request=JSON.stringify(packets[0].body);
  expect(request).not.toMatch(/Elsa|Anna|Olaf|Sven|Rumi|Zoey|Blippi|Meekah|Brian|Gallery Opening|KPop Tier|expectedIdentity|hostBrief/);
  expect(packets[0].body.output_config.format.schema.required).toEqual(['artifactFree','premiumFinish','compositionQuality']);
  expect(fetch).not.toHaveBeenCalled();
 }finally{fetch.mockRestore();}
});
it('binds the fingerprint to exact image bytes and rejects malformed input',()=>{
 const other=encodePng({width:8,height:8,rgb:new Uint8Array(192).fill(121)});
 expect(buildIndependentCraftRequest(other).requestFingerprint).not.toBe(buildIndependentCraftRequest(bytes).requestFingerprint);
 expect(()=>buildIndependentCraftRequest(Buffer.from('not png'))).toThrow();
});
it('keeps uncertainty rejected and never promotes a reduced score',()=>{
 const raw=clear();raw.premiumFinish={score:4,status:'uncertain',criterion:'unresolved-detail',location:'small trim',observation:'Cannot resolve edge detail'};
 const before=structuredClone(raw),result=validateIndependentCraft(raw);
 expect(result).toMatchObject({valid:true,unresolved:true,passed:false});expect(result.assessments.premiumFinish?.score).toBe(4);expect(raw).toEqual(before);
});
it('rejects the observed clear-composition/four-score contradiction',()=>{
 const raw=clear();raw.compositionQuality.score=4;
 expect(validateIndependentCraft(raw)).toMatchObject({valid:false,passed:false,issues:['compositionQuality:clear-score-conflict']});
});
it.each(['missing','wrong-criterion','nan','extra'])('rejects %s evidence',mode=>{
 const raw=clear();if(mode==='missing')delete raw.artifactFree;if(mode==='wrong-criterion')raw.premiumFinish={score:2,status:'defect',criterion:'medium-substitution',location:'canvas',observation:'Wrong requested medium'};
 if(mode==='nan')raw.premiumFinish.score=NaN;if(mode==='extra')raw.fullApproval={score:5,status:'clear',criterion:'none',location:'canvas',observation:'unsupported'};
 expect(validateIndependentCraft(raw).passed).toBe(false);
});

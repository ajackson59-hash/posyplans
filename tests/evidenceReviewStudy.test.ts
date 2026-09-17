// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { Event } from '@shared/schema';
import { encodePng } from '../server/aiFirst/png';
import { InMemoryArtworkAttemptStore } from '../server/aiFirst/artworkAttemptStore';
import { MEDIUM_FEASIBILITY_CASES } from '../server/aiFirst/mediumFeasibilityCases';
import { crossThemeProfile, type CrossThemeCaseId } from '../server/crossThemeReviewProfiles';
import { prepareSeparatedReview } from '../server/aiFirst/separatedArtworkReview';
import { runEvidenceReviewStudy, type EvidenceReviewRegistration } from '../server/evidenceReviewStudy';
import proposed from '../server/evidenceReviewRegistration.json';

const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const bytes=encodePng({width:8,height:8,rgb:new Uint8Array(192).fill(127)});
const environment={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'codex/launch-blockers',VERCEL_GIT_COMMIT_SHA:'offline-v2-test'};
const event={id:61,ownerToken:'offline-owner',eventName:'Artwork evaluation',eventType:'Artwork evaluation',
  inviteStatus:'draft',themeName:'',paletteColors:'[]',vibeDescription:MEDIUM_FEASIBILITY_CASES[0].hostBrief} as Event;

async function fixture(edit:(raw:any,response:any,call:number)=>void=()=>{}) {
  const registration=structuredClone(proposed) as EvidenceReviewRegistration;
  registration.authorizationStatus='approved'; // Synthetic transport; production calls still use the fixed owner-private scope.
  for(const c of registration.cases){
    const p=prepareSeparatedReview({...await crossThemeProfile(c.caseId as CrossThemeCaseId),bytes,reviewMode:'teaser'});
    c.reviewedHash=p.imageHash;c.contextHash=p.fidelity.contextHash;c.combinedFingerprint=p.fingerprint;
    for(const r of registration.requests.filter(r=>r.requestId===c.craftRequestId||r.requestId===c.fidelityRequestId)){
      const packet=r.role==='craft'?p.craft:p.fidelity;
      r.imageHash=packet.imageHash;r.requestFingerprint=packet.requestFingerprint;r.schemaHash=packet.schemaHash;
    }
  }
  const store=new InMemoryArtworkAttemptStore();let calls=0;
  const transport=vi.fn(async(_url:any,init:any)=>{
    const body=JSON.parse(init.body),text=body.messages[0].content.at(-1).text;
    const ctx=JSON.parse(text.includes('SERVER CHECKS:\n')?text.split('SERVER CHECKS:\n')[1]:text);
    const raw={judgments:ctx.checks.map((c:any)=>({checkId:c.id,...c.binding,finding:'fulfilled',
      location:'canvas',observation:'Synthetic visible support; not a visual approval'})),counts:[]};
    const response={id:'msg_offline',type:'message',role:'assistant',model:'claude-sonnet-4-6',stop_reason:'end_turn',
      usage:{input_tokens:1000,output_tokens:400},content:[{type:'text',text:''}]};
    edit(raw,response,++calls);
    if(!response.content[0].text)response.content[0].text=JSON.stringify(raw);
    return new Response(JSON.stringify(response),{status:200,headers:{'Content-Type':'application/json'}});
  }) as unknown as ReturnType<typeof vi.fn>&typeof fetch;
  const options={candidate:bytes,environment,fetch:transport};
  return {registration,store,transport,options,run:(id:string,overrides={})=>runEvidenceReviewStudy(event,store,id,{...options,...overrides},registration)};
}

it('registers the approved bounded scope and still blocks an explicitly pending registration',async()=>{
  expect(proposed.authorizationStatus).toBe('approved');expect(proposed.reusedCraft).toEqual([]);
  const f=await fixture();f.registration.authorizationStatus='pending';
  expect(await f.run('craft-elsa',{preflightOnly:true})).toMatchObject({kind:'preflight',providerCalls:0,authorizationStatus:'pending'});
  expect(await f.run('craft-elsa')).toMatchObject({kind:'blocked',reason:'research-awaiting-fresh-approval'});
  expect(await f.run('craft-elsa',{closeOnly:true})).toMatchObject({kind:'blocked'});
  expect(f.store.all).toHaveLength(0);expect(f.transport).not.toHaveBeenCalled();
});
it('runs twenty once, stores every raw receipt privately, leaves the event untouched and closes durably',async()=>{
  const f=await fixture(),before=structuredClone(event);
  for(const r of f.registration.requests){
    const result=await f.run(r.requestId);
    expect(result).toMatchObject({kind:'completed',physicalRequests:1,costMicros:9000,continuationAllowed:true});
    if(r.role==='fidelity')expect(result).toMatchObject({combined:{valid:true,passed:true,customerActivation:'disabled'}});
  }
  expect(f.transport).toHaveBeenCalledTimes(20);expect(f.store.all).toHaveLength(41);
  expect(f.store.all.every(r=>r.status==='rejected'&&!r.previewId)).toBe(true);
  expect(event).toEqual(before);
  const result=f.store.all.find(r=>r.idempotencyKey===`${proposed.dataset}:craft-elsa:completed`)!;
  expect(result.reviewEvidence!.customerEvaluation).toMatchObject({providerContent:expect.any(Array),receipt:{rawText:expect.any(String)},accountingKnown:true});
  expect(f.store.all.at(-1)!.reviewEvidence!.customerEvaluation!.closeReason).toBe('all-twenty-completed');
  expect(await f.run('craft-elsa')).toMatchObject({kind:'blocked',reason:'separated-study-closed'});
});
it.each(['extra-verdict','changed-binding','invalid-json','max-tokens','refusal','mixed-content'])('retains %s invalidity without converting it to approval or abandoning independent cases',async(mode)=>{
  const f=await fixture((raw,res,n)=>{
    if(n!==1)return;
    if(mode==='extra-verdict')raw.purchase='matched';
    if(mode==='changed-binding')raw.judgments[0].quote+=' all characters';
    if(mode==='invalid-json')res.content[0].text='{broken';
    if(mode==='max-tokens')res.stop_reason='max_tokens';
    if(mode==='refusal'){res.stop_reason='refusal';res.content[0].text='Cannot review';}
    if(mode==='mixed-content')res.content.push({type:'text',text:''});
  });
  expect(await f.run('craft-elsa')).toMatchObject({kind:'completed',continuationAllowed:true,reportDisposition:'invalid'});
  expect(await f.run('fidelity-c01')).toMatchObject({kind:'completed',combined:{valid:false,passed:false}});
  for(const r of f.registration.requests.slice(2))expect(await f.run(r.requestId)).toMatchObject({kind:'completed'});
  expect(f.transport).toHaveBeenCalledTimes(20);
});
it('keeps a real negative visible alongside uncertainty and allows further diagnostic cases',async()=>{
  const f=await fixture((raw,_res,n)=>{
    if(n===1)raw.judgments[0].finding='uncertain';
    if(n===2)raw.judgments.find((j:any)=>j.checkId==='policy:textLogoWatermarkFree').finding='lettering';
  });
  await f.run('craft-elsa');
  expect(await f.run('fidelity-c01')).toMatchObject({kind:'completed',combined:{valid:true,passed:false,disposition:'rejected',unresolved:true}});
});
it.each(['missing-usage','cache-charge','geo-premium','wrong-model','budget-overrun'])('halts with retained evidence for %s',async mode=>{
  const f=await fixture((_raw,res)=>{
    if(mode==='missing-usage')res.usage.input_tokens=undefined;
    if(mode==='cache-charge')res.usage.cache_creation_input_tokens=5;
    if(mode==='geo-premium')res.usage.inference_geo='us';
    if(mode==='wrong-model')res.model='unregistered-model';
    if(mode==='budget-overrun')res.usage.input_tokens=1000000;
  });
  expect(await f.run('craft-elsa')).toMatchObject({kind:'stopped',closed:true,continuationAllowed:false});
  expect(await f.run('fidelity-c01')).toMatchObject({kind:'blocked',reason:'separated-study-closed'});
  expect(f.transport).toHaveBeenCalledTimes(1);
});
it('retains provider errors as unknown cost, makes no retry and permanently closes',async()=>{
  const f=await fixture();f.transport.mockImplementation(async()=>new Response(JSON.stringify({type:'error',error:{type:'invalid_request_error',message:'bad schema'}}),{status:400,headers:{'Content-Type':'application/json'}}));
  expect(await f.run('craft-elsa')).toMatchObject({kind:'stopped',costMicros:null,physicalRequests:1,closed:true});
  expect(await f.run('craft-elsa')).toMatchObject({kind:'blocked'});
  expect(f.transport).toHaveBeenCalledTimes(1);
});
it('claims exclusively across duplicate requests and forbids skipped cases or deployment changes',async()=>{
  const f=await fixture();expect(await f.run('fidelity-c01')).toMatchObject({kind:'blocked'});
  const results=await Promise.all([f.run('craft-elsa'),f.run('craft-elsa')]);
  expect(results.map(r=>r.kind).sort()).toEqual(['blocked','completed']);expect(f.transport).toHaveBeenCalledTimes(1);
  expect(await f.run('fidelity-c01',{environment:{...environment,VERCEL_GIT_COMMIT_SHA:'changed'}})).toMatchObject({kind:'blocked'});
});
it.each(['receipt','pixels','model','owner','claim-deployment'])('blocks corrupted retained %s before another call',async mode=>{
  const f=await fixture();await f.run('craft-elsa');const claim=f.store.all[0],result=f.store.all[1];
  if(mode==='receipt')result.reviewEvidence!.customerEvaluation!.responseHash='changed';
  if(mode==='pixels')result.assetBytesBase64=Buffer.from('changed').toString('base64');
  if(mode==='model')(result as any).model='changed';
  if(mode==='owner')result.ownerToken='other';
  if(mode==='claim-deployment')claim.reviewEvidence!.customerEvaluation!.deploymentSha='changed';
  expect(await f.run('fidelity-c01')).toMatchObject({kind:'blocked'});expect(f.transport).toHaveBeenCalledTimes(1);
});
it('retention failure after billing cannot be replayed',async()=>{
  const f=await fixture(),find=f.store.findById.bind(f.store);
  vi.spyOn(f.store,'findById').mockImplementation(async(...args)=>{const r=await find(...args);return r?.idempotencyKey?.endsWith(':completed')?undefined:r;});
  await expect(f.run('craft-elsa')).rejects.toThrow('retention');
  expect(await f.run('fidelity-c01')).toMatchObject({kind:'blocked'});expect(f.transport).toHaveBeenCalledTimes(1);
});
it('rejects a changed input and unregistered budget before dispatch',async()=>{
  const f=await fixture();expect(await f.run('craft-elsa',{candidate:Buffer.from('changed')})).toMatchObject({kind:'blocked'});
  f.registration.budgetMicros=3000000;expect(await f.run('craft-elsa')).toMatchObject({kind:'blocked'});
  expect(f.transport).not.toHaveBeenCalled();
});
it('never reopens or imports a receipt from a legacy study',async()=>{
  const f=await fixture();f.registration.dataset='separated-research-20260916-v3';
  expect(await f.run('craft-elsa')).toMatchObject({kind:'blocked'});
  expect(f.transport).not.toHaveBeenCalled();expect(f.store.all).toHaveLength(0);
});

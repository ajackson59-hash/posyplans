/** Owner-private study controls. Client timings describe this diagnostic page, never the customer purchase flow. */
export const mediumFeasibilityPage = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Posy private artwork study</title><style>body{max-width:920px;margin:40px auto;padding:0 24px;font:16px/1.6 system-ui;color:#263d34;background:#faf8f2}button{padding:12px 20px;font:inherit}article{border-top:1px solid #ccc;padding:24px 0}img{display:block;width:100%;height:auto;max-width:373px}pre{white-space:pre-wrap;font:13px/1.5 monospace}p{max-width:75ch}</style>
<h1>Private artwork study</h1><p>Eight fixed directions, one medium image each. Every result stays private. Automated verdicts and these page-load timings do not establish human approval or customer purchase-flow performance.</p>
<p id="state">Reading the study record…</p><button id="run" disabled>Run the approved eight-case study</button><details><summary>Verified study configuration</summary><pre id="preflight"></pre></details><main id="cases"></main>
<script type="module">
const root=location.pathname.slice(0,-6), state=document.querySelector('#state'), run=document.querySelector('#run'), main=document.querySelector('#cases');
const getJson=async(path,options)=>{const response=await fetch(path,{...options,cache:'no-store'}); const content=response.headers.get('content-type')||''; if(!content.includes('application/json'))throw Error('Expected Posy JSON; authentication or deployment requires attention');const body=await response.json();if(!response.ok)throw Error(body.reason||body.error||'Study request failed');return body;};
const manifest=await getJson(root);const articles=new Map();
for(const c of manifest.inputs){const a=document.createElement('article'), h=document.createElement('h2'), p=document.createElement('p'), detail=document.createElement('pre');h.textContent=c.trialId;p.textContent=c.hostBrief;detail.textContent='No new result';a.append(h,p,detail);main.append(a);articles.set(c.trialId,{a,detail});}
document.querySelector('#preflight').textContent=JSON.stringify({datasetId:manifest.datasetId,policyHash:manifest.policyHash,deploymentSha:manifest.deploymentSha,paidEnabled:manifest.paidEnabled,models:manifest.models,existingRecords:manifest.records.length,physicalImageRequests:manifest.physicalImageRequests,physicalCriticRequests:manifest.physicalCriticRequests,physicalClassifierRequests:manifest.physicalClassifierRequests},null,2);
const previouslyClaimed=manifest.records.length>0;
state.textContent=manifest.paidEnabled?(previouslyClaimed?'Existing claims found. Review evidence before continuing; this page will not replay them.':'Approved study is enabled. Starting will use the registered provider requests.'):'Prepared. New paid allowance has not been granted; no generation is enabled.';
run.disabled=!manifest.paidEnabled||previouslyClaimed||!manifest.models.every(model=>model.accessible);
run.addEventListener('click',async()=>{run.disabled=true;try{for(const c of manifest.inputs){const section=articles.get(c.trialId);state.textContent='Running '+c.trialId;const started=performance.now();
const result=await getJson(root+'/'+encodeURIComponent(c.trialId),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({confirmBoundedFeasibility:true,policyHash:manifest.policyHash})});
if(result.kind!=='completed')throw Error(result.reason||'Study stopped; no replacement is permitted');
section.detail.textContent=JSON.stringify(result.evidence,null,2);
const imageResponse=await fetch(root+'/'+encodeURIComponent(result.recordId)+'/teaser',{cache:'no-store'});if(!imageResponse.ok)throw Error('Exact review pixels unavailable');
const imageBytes=await imageResponse.arrayBuffer();const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',imageBytes))).map(n=>n.toString(16).padStart(2,'0')).join('');
if(digest!==result.reviewedAssetHash)throw Error('Reviewed-pixel hash mismatch');
const img=document.createElement('img');img.alt='Private study result for '+c.trialId;const objectUrl=URL.createObjectURL(new Blob([imageBytes],{type:'image/png'}));img.src=objectUrl;section.a.append(img);await img.decode();const browserLoadedMs=performance.now()-started;URL.revokeObjectURL(objectUrl);
if(img.naturalHeight!==560||img.naturalWidth!==373)throw Error('Review dimensions changed');
await getJson(root+'/'+encodeURIComponent(result.recordId)+'/browser-observation',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reviewedAssetHash:digest,browserLoadedMs})});
section.detail.textContent+='\\nPrivate study pixels decoded after '+(browserLoadedMs/1000).toFixed(3)+' seconds. Human review pending.';
}state.textContent='All eight results retained. Human assessment and the full release benchmark remain pending.';}catch(error){state.textContent='Stopped: '+error.message;}});
</script></html>`;

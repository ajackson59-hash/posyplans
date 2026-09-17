// @vitest-environment node
import { expect,it,vi } from 'vitest';
import { JSDOM } from 'jsdom';
import { webcrypto,createHash } from 'node:crypto';
import { humanArtworkReviewPage } from '../server/humanArtworkReviewPage';
it('requires a loaded, hash-matching image, full-size inspection, five checks and a note before a staff decision',async()=>{
  const bytes=Buffer.from('synthetic DOM fixture, not a decoded image');const imageHash=createHash('sha256').update(bytes).digest('hex');
  let row={id:'synthetic-row',eventId:99001,state:'review',version:2,stale:false,briefHash:'b'.repeat(64),imageHash,
    brief:{eventName:'QA <img src=x onerror=alert(1)>',vibe:'Synthetic only'},history:[]};
  const fetch=vi.fn(async(path:string,options:any)=>{
    expect(options.headers.Authorization).toBe('Bearer synthetic-key-for-dom-test');
    expect(path).not.toContain('synthetic-key');
    if(path.endsWith('/asset'))return new Response(bytes,{headers:{'content-type':'image/png'}});
    if(path.endsWith('/decision')){const decision=JSON.parse(options.body);expect(decision.imageHash).toBe(imageHash);expect(decision.checks).toHaveLength(5);row={...row,state:'approved',version:3};return Response.json(row)}
    return Response.json({reviews:[row],generationEnabled:false});
  });
  const dom=new JSDOM(humanArtworkReviewPage,{url:'https://synthetic.example.test/artwork-review',runScripts:'dangerously',beforeParse(window){
    (window as any).fetch=fetch;Object.defineProperty(window.crypto,'subtle',{value:webcrypto.subtle});
    (window.URL as any).createObjectURL=()=> 'blob:synthetic';(window.URL as any).revokeObjectURL=vi.fn();
  }});
  try {
    const d=dom.window.document, el=(id:string)=>d.getElementById(id)!;
    (el('key') as HTMLInputElement).value='synthetic-key-for-dom-test';el('connect').click();
    await vi.waitFor(()=>expect(el('queue').children.length).toBe(1));(el('queue').firstChild as HTMLElement).click();
    await vi.waitFor(()=>expect(el('art').getAttribute('src')).toBe('blob:synthetic'));
    expect(el('title').querySelector('img')).toBeNull();expect((el('approve') as HTMLButtonElement).disabled).toBe(true);
    el('art').dispatchEvent(new dom.window.Event('load'));
    el('checks').querySelectorAll<HTMLInputElement>('input').forEach(input=>{input.checked=true;input.dispatchEvent(new dom.window.Event('change',{bubbles:true}))});
    (el('note') as HTMLTextAreaElement).value='Synthetic behavior test, not artwork quality approval.';el('note').dispatchEvent(new dom.window.Event('input'));
    expect((el('approve') as HTMLButtonElement).disabled).toBe(true);el('size').click();expect((el('approve') as HTMLButtonElement).disabled).toBe(false);
    el('approve').click();await vi.waitFor(()=>expect(el('status').textContent).toContain('Approved.'));
    expect(fetch.mock.calls.filter(([p])=>p.endsWith('/decision'))).toHaveLength(1);
    el('logout').click();expect(el('brief').textContent).toBe('');expect((el('note') as HTMLTextAreaElement).value).toBe('');expect(el('art').hasAttribute('src')).toBe(false);
  } finally {dom.window.close()}
});

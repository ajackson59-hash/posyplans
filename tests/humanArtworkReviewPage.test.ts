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

it('queues a documented correction without generation, retains comparison images, and resets every approval check',async()=>{
  const oldBytes=Buffer.from('old synthetic pixels'),newBytes=Buffer.from('new synthetic pixels');
  const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
  let row:any={id:'synthetic-correction',eventId:99001,state:'rejected',version:3,stale:false,briefHash:'b'.repeat(64),imageHash:digest(oldBytes),
    brief:{eventName:'Synthetic correction only'},history:[{action:'rejected',note:'Missing a bird.'}],previousCandidates:[],correctionsRemaining:3};
  const fetch=vi.fn(async(path:string,options:any)=>{
    if(path.endsWith('/previous/3/asset'))return new Response(oldBytes);
    if(path.endsWith('/asset'))return new Response(row.state==='review'?newBytes:oldBytes);
    if(path.endsWith('/correction')){
      expect(JSON.parse(options.body)).toEqual({version:3,imageHash:digest(oldBytes),briefHash:row.briefHash,note:'Restore the third red bird.'});
      row={...row,state:'queued',version:4,imageHash:undefined,previousCandidates:[{version:3,imageHash:digest(oldBytes)}],correctionsRemaining:2};
      return Response.json(row);
    }
    if(options.method==='POST')throw Error('Unexpected mutation');
    return Response.json({reviews:[row],generationEnabled:false});
  });
  const dom=new JSDOM(humanArtworkReviewPage,{url:'https://synthetic.example.test/artwork-review',runScripts:'dangerously',beforeParse(window){
    (window as any).fetch=fetch;Object.defineProperty(window.crypto,'subtle',{value:webcrypto.subtle});
    let serial=0;(window.URL as any).createObjectURL=()=> 'blob:synthetic-'+(++serial);(window.URL as any).revokeObjectURL=vi.fn();
  }});
  try{
    const d=dom.window.document,el=(id:string)=>d.getElementById(id)!;
    const disabled=(id:string)=>(el(id) as HTMLButtonElement).disabled;
    (el('key') as HTMLInputElement).value='synthetic-key';el('connect').click();
    await vi.waitFor(()=>expect(el('queue').children).toHaveLength(1));(el('queue').firstChild as HTMLElement).click();
    await vi.waitFor(()=>expect(el('art').hasAttribute('src')).toBe(true));el('art').dispatchEvent(new dom.window.Event('load'));
    expect(disabled('queue-correction')).toBe(true);
    (el('correction-note') as HTMLTextAreaElement).value='Restore the third red bird.';el('correction-note').dispatchEvent(new dom.window.Event('input'));
    expect(disabled('queue-correction')).toBe(false);el('queue-correction').click();el('queue-correction').click();
    await vi.waitFor(()=>expect(el('status').textContent).toContain('Correction queued.'));
    expect(fetch.mock.calls.filter(([p])=>p.endsWith('/correction'))).toHaveLength(1);
    expect(fetch.mock.calls.filter(([p])=>p.endsWith('/generate'))).toHaveLength(0);
    expect(el('art').hasAttribute('src')).toBe(false);expect(el('generate').hidden).toBe(true);expect(disabled('approve')).toBe(true);
    row={...row,state:'review',version:6,imageHash:digest(newBytes)};el('refresh').click();
    await vi.waitFor(()=>expect(el('art').hasAttribute('src')).toBe(true));el('art').dispatchEvent(new dom.window.Event('load'));
    expect((el('note') as HTMLTextAreaElement).value).toBe('');expect([...el('checks').querySelectorAll<HTMLInputElement>('input')].every(i=>!i.checked)).toBe(true);
    (el('previous-list').firstChild as HTMLElement).click();await vi.waitFor(()=>expect(el('previous-art').hasAttribute('src')).toBe(true));el('previous-size').click();
    expect(el('previous-art').classList.contains('full')).toBe(true);
    el('checks').querySelectorAll<HTMLInputElement>('input').forEach(i=>{i.checked=true;i.dispatchEvent(new dom.window.Event('change',{bubbles:true}))});
    (el('note') as HTMLTextAreaElement).value='Synthetic mechanics check only.';el('note').dispatchEvent(new dom.window.Event('input'));
    expect(disabled('approve')).toBe(true); // Inspecting the archive never counts as inspecting the current image.
    el('size').click();expect(disabled('approve')).toBe(false);
    el('logout').click();expect(el('previous-art').hasAttribute('src')).toBe(false);expect(el('previous-list').children).toHaveLength(0);
    expect((el('correction-note') as HTMLTextAreaElement).value).toBe('');expect(el('history').textContent).toBe('');
  }finally{dom.window.close()}
});

// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import type { Event } from '@shared/schema';
import { encodePng } from '../server/aiFirst/png';
import { HUMAN_REVIEW_CHECKS, requestHumanArtwork, generateHumanArtwork, decideHumanArtwork, isCurrentHumanApproval,
  humanReviewEventEnabled, reviewerAuthorized, type HumanArtworkReview, type HumanArtworkReviewStore } from '../server/humanArtworkReview';
vi.mock('../server/storage', () => ({ storage: {}, db: {} }));
vi.mock('../server/masterPlannerEntitlement', () => ({ getEntitlementSummary: vi.fn() }));
const { registerHumanArtworkReviewRoutes } = await import('../server/humanArtworkReviewRoutes');
const { registerEventArtworkRoutes } = await import('../server/eventArtworkRoutes');
const { eventArtworkUrl } = await import('../server/eventArtwork');

class MemoryStore implements HumanArtworkReviewStore {
  rows = new Map<string, HumanArtworkReview>();
  async create(row: HumanArtworkReview) { const old = await this.current(row.eventId,row.briefHash); if(old)return old;this.rows.set(row.id,structuredClone(row));return row; }
  async get(id: string) { return structuredClone(this.rows.get(id)); }
  async current(id: number, hash: string) { return structuredClone([...this.rows.values()].find(r=>r.eventId===id&&r.briefHash===hash)); }
  async list() { return structuredClone([...this.rows.values()]); }
  async compareAndSet(row: HumanArtworkReview, version: number) { if(this.rows.get(row.id)?.version!==version)return false;this.rows.set(row.id,structuredClone(row));return true; }
}
const base = { id:99001, ownerToken:'synthetic-owner', eventName:'QA only', eventType:'Birthday', vibeDescription:'Watercolor flowers, exactly three red birds, no balloons.',
  eventDate:'September 17, 2026', themeName:'Garden', paletteColors:'[]', estimatedGuestCount:8, location:'Garden', venueName:'', formality:'casual' } as Event;
const env = { VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'codex/launch-blockers',POSY_HUMAN_ARTWORK_REVIEW:'true',POSY_HUMAN_ARTWORK_REVIEW_EVENT_IDS:'99001',
  POSY_ARTWORK_REVIEWER_KEY:'synthetic-test-key-not-a-live-secret-12345',POSY_ARTWORK_REVIEWER_ID:'synthetic-reviewer' };
const bytes = encodePng({ width:8,height:12,rgb:Buffer.alloc(8*12*3,150) });
let store:MemoryStore,event:Event,paid:boolean;
const fakeGenerate = vi.fn(async()=>({ bytes,dataUrl:'data:image/png;base64,'+bytes.toString('base64'),durationMs:1,telemetry:{providerRequestCount:1,responseUsage:{input_tokens:0,output_tokens:0}} }));
beforeEach(()=>{store=new MemoryStore();event={...base};paid=false;fakeGenerate.mockClear()});
afterEach(()=>vi.unstubAllEnvs());
const input = (row:HumanArtworkReview) => ({decision:'approved' as const,version:row.version,imageHash:row.imageHash!,briefHash:row.briefHash,checks:[...HUMAN_REVIEW_CHECKS],note:'Synthetic mechanics test only; not a real quality approval.'});
async function candidate(){const row=await requestHumanArtwork(event,store);await generateHumanArtwork(row,store,'test',fakeGenerate as any);return (await store.get(row.id))!;}
function app(overrides:NodeJS.ProcessEnv={}) {
  const app=express();app.use(express.json());
  registerHumanArtworkReviewRoutes(app,{reviews:store,env:{...env,...overrides},events:{getEventByOwnerToken:async token=>token===event.ownerToken?event:undefined,
    updateEventById:async(_id,data)=>event={...event,...data}},unlocked:async()=>paid,generate:async row=>{await generateHumanArtwork(row,store,'test',fakeGenerate as any)},schedule:task=>{void task()}});
  app.use((_req,res)=>res.status(418).json({legacy:true}));return app;
}
const owner='/api/events/owner/synthetic-owner';
const auth=(req:request.Test)=>req.set('Authorization','Bearer '+env.POSY_ARTWORK_REVIEWER_KEY);

describe('human artwork release boundary',()=>{
  it('queues idempotently with no paid calls and hides pixels/checkout/planning until approval',async()=>{
    const a=app();for(let n=0;n<2;n++)expect((await request(a).post(owner+'/prepayment-preview').send({email:'qa@example.test'})).status).toBe(202);
    expect(store.rows.size).toBe(1);expect(fakeGenerate).not.toHaveBeenCalled();
    const row=await candidate();expect(row.state).toBe('review');expect(isCurrentHumanApproval(row,event)).toBe(false);
    expect((await request(a).get(owner+'/prepayment-preview/asset')).status).toBe(404);
    expect((await request(a).post('/api/checkout/create-session').send({returnToken:event.ownerToken})).status).toBe(409);
    expect((await request(a).post(owner+'/master-planner/generate').send({})).status).toBe(409);
    expect((await request(a).get(owner+'/prepayment-preview/readiness')).body.checkoutAllowed).toBe(false);
  });
  it('requires a separate staff credential and never includes pixels or owner token in queue JSON',async()=>{
    await candidate();const a=app();expect((await request(a).get('/api/staff/artwork-reviews')).status).toBe(401);
    const list=await auth(request(a).get('/api/staff/artwork-reviews'));expect(list.status).toBe(200);
    expect(list.text).not.toContain(event.ownerToken);expect(list.text).not.toContain('imageBase64');expect(list.text).not.toContain('sourceBase64');
    expect(reviewerAuthorized('Bearer '+event.ownerToken,env)).toBe(false);
    expect((await request(a).get('/artwork-review')).headers['content-security-policy']).toContain("frame-ancestors 'none'");
  });
  it('does not dispatch paid generation when the separate spend switch is off',async()=>{
    const row=await requestHumanArtwork(event,store);
    const res=await auth(request(app()).post('/api/staff/artwork-reviews/'+row.id+'/generate')).send({confirmOneImage:true,version:row.version,briefHash:row.briefHash});
    expect(res.status).toBe(409);expect(fakeGenerate).not.toHaveBeenCalled();expect((await store.get(row.id))?.state).toBe('queued');
  });
  it('a concurrent duplicate generation loses the durable claim before dispatch',async()=>{
    const row=await requestHumanArtwork(event,store);
    await Promise.allSettled([generateHumanArtwork(row,store,'a',fakeGenerate as any),generateHumanArtwork(row,store,'b',fakeGenerate as any)]);
    expect(fakeGenerate).toHaveBeenCalledTimes(1);expect((await store.get(row.id))?.state).toBe('review');
    expect(fakeGenerate.mock.calls[0]).toBeDefined();
  });
  it('provider failures remain terminal without retry or invented billing',async()=>{
    const row=await requestHumanArtwork(event,store);const fail=vi.fn(async()=>{throw Error('timeout')});
    await generateHumanArtwork(row,store,'test',fail);const failed=(await store.get(row.id))!;
    expect(failed.state).toBe('failed');expect(failed.generation?.billing).toBe('unknown');
    await expect(generateHumanArtwork(failed,store,'test',fail)).rejects.toThrow();expect(fail).toHaveBeenCalledTimes(1);
  });
  it.each(['checks','image','brief','version','changedEvent'] as const)('rejects incomplete or stale decision: %s',async kind=>{
    const row=await candidate();const decision=input(row);
    if(kind==='checks')decision.checks.pop();if(kind==='image')decision.imageHash='0'.repeat(64);if(kind==='brief')decision.briefHash='0'.repeat(64);if(kind==='version')decision.version--;
    if(kind==='changedEvent')event={...event,vibeDescription:'A different brief'};
    await expect(decideHumanArtwork(row,event,store,decision,'test')).rejects.toThrow();expect((await store.get(row.id))?.state).toBe('review');
  });
  it('releases exactly the inspected PNG, requires paid reuse, then revokes after a changed brief',async()=>{
    const row=await candidate(),a=app();const decision=await auth(request(a).post('/api/staff/artwork-reviews/'+row.id+'/decision')).send(input(row));expect(decision.status).toBe(200);
    const asset=await request(a).get(owner+'/prepayment-preview/asset');expect(asset.status).toBe(200);expect(asset.body.equals(Buffer.from(row.imageBase64!,'base64'))).toBe(true);
    expect((await request(a).post('/api/checkout/create-session').send({returnToken:event.ownerToken})).status).toBe(418);
    expect((await request(a).post(owner+'/invite/use-prepayment-preview').send({})).status).toBe(402);
    paid=true;expect((await request(a).post(owner+'/invite/use-prepayment-preview').send({})).status).toBe(200);
    expect(event.inviteArtworkUrl).toBe('data:image/png;base64,'+row.imageBase64);expect(event.inviteIllustrationUrl).toBe(event.inviteArtworkUrl);
    event={...event,vibeDescription:event.vibeDescription+' Add a blue butterfly.'};expect((await request(a).get(owner+'/prepayment-preview/asset')).status).toBe(404);
    expect((await request(a).post(owner+'/invite/use-prepayment-preview').send({})).status).toBe(409);
  });
  it('only one competing review decision persists; a rejection cannot become an approval',async()=>{
    const row=await candidate();const results=await Promise.allSettled([decideHumanArtwork(row,event,store,{...input(row),decision:'rejected'},'a'),decideHumanArtwork(row,event,store,input(row),'b')]);
    expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect((await store.get(row.id))?.state).toBe('rejected');
    expect(isCurrentHumanApproval(await store.get(row.id),event)).toBe(false);
  });
  it.each(['/ai-first/generate','/invite/generate-concepts','/invite/custom-design','/prepayment-preview/compact-review'])('blocks legacy generation/replacement path %s',async path=>{
    expect((await request(app()).post(owner+path).send({})).status).toBe(409);
  });
  it('blocks raw artwork PATCH but allows ordinary event changes',async()=>{
    expect((await request(app()).patch(owner).send({inviteArtworkUrl:'https://example.test/unreviewed.png'})).status).toBe(409);
    expect((await request(app()).patch(owner).send({eventName:'new name'})).status).toBe(418);
  });
  it.each([{VERCEL_ENV:'production'},{POSY_HUMAN_ARTWORK_REVIEW:'false'},{VERCEL_GIT_COMMIT_REF:'main'}])('keeps the workflow off outside its scoped Preview: %j',async override=>{
    const a=app(override);expect((await request(a).get('/artwork-review')).status).toBe(404);
    expect((await request(a).get(owner+'/prepayment-preview/readiness')).status).toBe(418);
    expect(humanReviewEventEnabled(event,{...env,...override})).toBe(false);
  });
  it('does not affect non-enrolled historical events',async()=>{
    expect((await request(app({POSY_HUMAN_ARTWORK_REVIEW_EVENT_IDS:'61'})).get(owner+'/prepayment-preview/readiness')).status).toBe(418);
  });
  it('serves approved bytes to owners and guests, then revokes both deliveries after a brief change',async()=>{
    for(const [key,value] of Object.entries(env))vi.stubEnv(key,value);
    const row=await candidate();await decideHumanArtwork(row,event,store,input(row),'synthetic-test');
    event={...event,inviteStatus:'published',shareSlug:'synthetic-guest',inviteArtworkUrl:'data:image/png;base64,'+row.imageBase64};
    const a=express();registerEventArtworkRoutes(a,{getEventByOwnerToken:async()=>event,getEventByShareSlug:async()=>event},async current=>{
      const saved=await store.get(row.id);return isCurrentHumanApproval(saved,current)?'data:image/png;base64,'+saved.imageBase64:null;
    });
    const paths=[eventArtworkUrl(event,'inviteArtworkUrl','owner'),eventArtworkUrl(event,'inviteArtworkUrl','public')];
    for(const path of paths){const response=await request(a).get(path);expect(response.status).toBe(200);expect(response.body.equals(Buffer.from(row.imageBase64!,'base64'))).toBe(true)}
    event={...event,vibeDescription:'Changed request'};for(const path of paths)expect((await request(a).get(path)).status).toBe(404);
  });
});

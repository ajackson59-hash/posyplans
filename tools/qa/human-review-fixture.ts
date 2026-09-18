// Local, disposable interface fixture. Never imported by the application.
// Run: DATABASE_URL=postgres://synthetic/unused npx tsx tools/qa/human-review-fixture.ts
// No database queries, provider requests, payments or outbound messages.
import express from 'express';
import { createServer } from 'node:http';
import type { Event } from '../../shared/schema';
import { encodePng } from '../../server/aiFirst/png';
import { registerHumanArtworkReviewRoutes } from '../../server/humanArtworkReviewRoutes';
import { requestHumanArtwork, generateHumanArtwork, type HumanArtworkReview, type HumanArtworkReviewStore } from '../../server/humanArtworkReview';
import { setupVite } from '../../server/vite';
if(process.env.NODE_ENV==='production'||process.env.VERCEL)throw Error('Local fixture only');
const env={VERCEL_ENV:'preview',VERCEL_GIT_COMMIT_REF:'codex/launch-blockers',POSY_HUMAN_ARTWORK_REVIEW:'true',POSY_HUMAN_ARTWORK_REVIEW_EVENT_IDS:'99001',
  POSY_ARTWORK_REVIEWER_KEY:'synthetic-fixture-not-a-real-secret-12345',POSY_ARTWORK_REVIEWER_ID:'synthetic-interface-test'};
let event={id:99001,ownerToken:'synthetic-human-review',eventName:'Synthetic workflow fixture',eventType:'Birthday',
  vibeDescription:'SYNTHETIC TEST ONLY. Three vertical color bands. These pixels are not AI artwork or a quality benchmark.',
  themeName:'Interface test',paletteColors:'[]',eventDate:'September 17, 2026',location:'',venueName:'',estimatedGuestCount:8} as Event;
const rows=new Map<string,HumanArtworkReview>();
const store:HumanArtworkReviewStore={
  create:async row=>{const old=[...rows.values()].find(r=>r.eventId===row.eventId&&r.briefHash===row.briefHash);if(old)return structuredClone(old);rows.set(row.id,structuredClone(row));return row},
  get:async id=>structuredClone(rows.get(id)),current:async(id,hash)=>structuredClone([...rows.values()].find(r=>r.eventId===id&&r.briefHash===hash)),
  list:async()=>structuredClone([...rows.values()]),compareAndSet:async(row,version)=>{if(rows.get(row.id)?.version!==version)return false;rows.set(row.id,structuredClone(row));return true},
};
const rgb=Buffer.alloc(600*900*3);const colors=[[203,180,213],[240,205,176],[153,183,158]];
for(let y=0;y<900;y++)for(let x=0;x<600;x++){const c=colors[Math.floor(x/200)];for(let n=0;n<3;n++)rgb[(y*600+x)*3+n]=c[n]}
const bytes=encodePng({width:600,height:900,rgb});
const row=await requestHumanArtwork(event,store);
await generateHumanArtwork(row,store,'synthetic-fixture',async()=>({bytes,dataUrl:'data:image/png;base64,'+bytes.toString('base64'),durationMs:0}));
const app=express(),server=createServer(app);app.use(express.json());
registerHumanArtworkReviewRoutes(app,{reviews:store,env,events:{getEventByOwnerToken:async token=>token===event.ownerToken?event:undefined,
  updateEventById:async(_id,data)=>event={...event,...data}},unlocked:async()=>false});
app.get('/api/checkout/config',(_req,res)=>res.json({configured:true}));
app.get('/api/events/owner/:token/master-planner/entitlement',(_req,res)=>res.json({canGenerate:false,emailCaptured:true,planTier:'none'}));
app.get('/api/events/owner/:token',(_req,res)=>res.json({event}));
app.use('/api',(_req,res)=>res.status(409).json({error:'Synthetic fixture: no payment, provider or email calls are available.'}));
await setupVite(server,app);
server.listen(4173,'127.0.0.1',()=>console.log('Synthetic fixture: http://127.0.0.1:4173/artwork-review and /draft-generating/synthetic-human-review'));

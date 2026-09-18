// @vitest-environment node
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {Event} from '@shared/schema';
const state=vi.hoisted(()=>({event:{} as Event,completed:'[]',approved:null as string|null}));
vi.mock('../server/storage',()=>({storage:{
  getGeneration:async()=>({completedStages:state.completed}),getEventById:async()=>state.event,listGuests:async()=>[],
  updateEventById:async(_id:number,data:Partial<Event>)=>state.event={...state.event,...data},
}}));
vi.mock('../server/humanArtworkPolicy',()=>({approvedHumanArtwork:async()=>state.approved}));
vi.mock('../server/masterPlannerEntitlement',()=>({safeParseStages:(s:string)=>JSON.parse(s),markGenerationConsumed:vi.fn(),markGenerationFailed:vi.fn(),markStageCompleted:vi.fn()}));
const {runMasterPlannerOrchestration}=await import('../server/masterPlannerOrchestrator');
beforeEach(()=>{
  vi.stubEnv('VERCEL_ENV','preview');vi.stubEnv('VERCEL_GIT_COMMIT_REF','codex/launch-blockers');vi.stubEnv('POSY_HUMAN_ARTWORK_REVIEW','true');vi.stubEnv('POSY_HUMAN_ARTWORK_REVIEW_EVENT_IDS','99001');
  state.event={id:99001,eventName:'Synthetic',eventType:'Birthday',themeName:'Reviewed garden',paletteColors:'["#fff000"]',vibeDescription:'Three birds'} as Event;
  state.completed=JSON.stringify(['theme','budget','menu','shopping','timeline','checks']);state.approved=null;
});
afterEach(()=>vi.unstubAllEnvs());
it('reuses the exact approved image without another concept or illustration call',async()=>{
  state.approved='data:image/png;base64,c3ludGhldGlj';const deps={generateInviteConcepts:vi.fn(),generateIllustration:vi.fn()};
  await runMasterPlannerOrchestration(99001,1,deps as any);
  expect(state.event.inviteArtworkUrl).toBe(state.approved);expect(state.event.inviteIllustrationUrl).toBe(state.approved);
  expect(deps.generateInviteConcepts).not.toHaveBeenCalled();expect(deps.generateIllustration).not.toHaveBeenCalled();
});
it('fails closed if the approved image is no longer current',async()=>{
  const deps={generateInviteConcepts:vi.fn(),generateIllustration:vi.fn()};
  await expect(runMasterPlannerOrchestration(99001,1,deps as any)).rejects.toThrow('human approval');
  expect(state.event.draftStatus).toBe('failed_partial');expect(deps.generateIllustration).not.toHaveBeenCalled();
});
it('does not let the planning theme replace the reviewed palette or theme',async()=>{
  state.completed=JSON.stringify(['budget','menu','shopping','timeline','invites','checks']);
  await runMasterPlannerOrchestration(99001,1,{generateThemeAndIdentity:async()=>({themeName:'Wrong replacement',paletteColors:['#000000'],eventIdentity:'Plan identity'})} as any);
  expect(state.event.themeName).toBe('Reviewed garden');expect(state.event.paletteColors).toBe('["#fff000"]');expect(state.event.eventIdentity).toBe('Plan identity');
});

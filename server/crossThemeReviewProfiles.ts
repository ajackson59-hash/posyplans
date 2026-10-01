/** Frozen profiles for the owner-approved twelve-call private reviewer pilot. */
import type { Event } from '@shared/schema';
import { MEDIUM_FEASIBILITY_CASES } from './aiFirst/mediumFeasibilityCases';
import { calibrationProfile } from './aiFirst/reviewCalibration';
import { buildQualityLockedPreviewBrief, detectNamedCreativeReferenceSync } from './prePaymentPreviewQuality';
import { namedReferenceIdentityNotes } from './namedReferenceResolver';

export const CROSS_THEME_DATASET = 'cross-theme-review-20260916-v1';
export const CROSS_THEME_CASES = [
  {caseId:'c01',image:'elsa',requested:'Elsa'}, {caseId:'c02',image:'elsa',requested:'Anna'},
  {caseId:'c03',image:'olaf',requested:'Olaf'}, {caseId:'c04',image:'olaf',requested:'Sven'},
  {caseId:'c05',image:'rumi',requested:'Rumi'}, {caseId:'c06',image:'rumi',requested:'Zoey'},
  {caseId:'c07',image:'vector',requested:'flat vector'}, {caseId:'c08',image:'vector',requested:'watercolor'},
  {caseId:'c09',image:'construction',requested:''}, {caseId:'c10',image:'kpop',requested:''},
  {caseId:'c11',image:'scene',requested:''}, {caseId:'c12',image:'lettering',requested:''},
] as const;
export type CrossThemeCaseId = typeof CROSS_THEME_CASES[number]['caseId'];
const disneyNotes = `Identity descriptions for Disney Frozen. Elsa: pale platinum-blonde hair swept back into one long side braid, large blue eyes, cool blue sparkling ice-dress fabric. Anna: auburn hair in two braids, blue-green eyes, freckles, dark embroidered bodice and magenta outer clothing in her original-film appearance. Olaf: a white segmented snowman with a long orange carrot nose, twig hair, dark eyebrows, a broad mouth and a prominent front tooth. Sven: a brown-gray reindeer with branched antlers, a long dark muzzle and lighter fur around the neck. These descriptions identify the requested characters without asserting which appears in the candidate. Source: https://frozen.disney.com/`;

export async function crossThemeProfile(caseId: CrossThemeCaseId) {
  const c = CROSS_THEME_CASES.find(c => c.caseId === caseId)!;
  if (!c) throw new Error('cross-theme-unknown-case');
  if (c.image === 'rumi') {
    const p = await calibrationProfile(c.requested === 'Rumi' ? 'rumi-matched' : 'rumi-mismatched');
    p.brief.visualIdentityOverride = `An intentional editorial diptych: a photographic adult portrait on the left and a stylized 3D animated portrait of ${c.requested} from KPop Demon Hunters on the right. Preserve this mixed photographic and animated treatment and the intentional portrait framing.`;
    return {brief:p.brief,concept:p.concept};
  }
  if (c.image === 'elsa' || c.image === 'olaf') {
    const vibe = `A close-up character portrait of ${c.requested} from Disney Frozen against a blue background. Stylized 3D animated-film treatment. Preserve intentional close portrait framing; no full-body scene is requested.`;
    const p = await buildQualityLockedPreviewBrief({eventName:'Character portrait study',eventType:'Editorial portrait',themeName:'',paletteColors:'[]',vibeDescription:vibe} as Event,disneyNotes,null);
    p.brief.visualIdentityOverride = vibe;
    p.brief.requirements = {required:[`[VISIBLE NAMED IDENTITY] ${c.requested} from Disney Frozen is visibly recognizable in the portrait`],preferred:[],excluded:[]};
    return p;
  }
  const index = c.image === 'vector' ? 6 : c.image === 'construction' ? 4 : c.image === 'kpop' ? 2 : 0;
  let vibe:string = MEDIUM_FEASIBILITY_CASES[index].hostBrief;
  if(c.caseId==='c08') vibe=vibe.replace('Flat vector artwork','Watercolor artwork')
    .replace('Crisp geometry and a restrained palette are the premium treatment.','Translucent painted washes and a restrained palette are the premium treatment.')
    .replace('No painted texture, photographic shadows, 3D gloss','No hard vector edges, photographic shadows, 3D gloss');
  const event = {eventName:c.image==='vector'?'Gallery Opening':c.image==='kpop'?'KPop Tier Comparison QA':'Artwork evaluation',eventType:c.image==='vector'?'Gallery Opening':c.image==='kpop'?'Birthday Party':'Artwork evaluation',themeName:'',paletteColors:'[]',vibeDescription:vibe} as Event;
  const named=detectNamedCreativeReferenceSync(vibe);
  return buildQualityLockedPreviewBrief(event,named?namedReferenceIdentityNotes(named):'',named);
}

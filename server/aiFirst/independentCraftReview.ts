/** Pure packet builder/validator: no provider call or score replacement. */
import {createHash} from 'node:crypto';
import {decodePng} from './png';
import {REVIEW_CRITERIA} from './reviewEvidence';
import {VISION_MODEL} from './visionGate';

export const INDEPENDENT_CRAFT_VERSION='independent-observed-craft-v2';
const dimensions=['artifactFree','premiumFinish','compositionQuality'] as const;
type Dimension=typeof dimensions[number];
const properties=Object.fromEntries(dimensions.map(d=>[d,{type:'object',properties:{
 score:{type:'integer',enum:[1,2,3,4,5]},status:{type:'string',enum:['clear','defect','uncertain']},
 criterion:{type:'string',enum:['none',...REVIEW_CRITERIA[d]]},location:{type:'string'},observation:{type:'string'},
 },required:['score','status','criterion','location','observation'],additionalProperties:false}]));
export const INDEPENDENT_CRAFT_SCHEMA={type:'object',properties,required:[...dimensions],additionalProperties:false};
const system=`Judge only the execution and visual organization actually visible in this image. The requested subject, franchise, event, medium, references, exclusions and prior grades are intentionally not provided. Do not infer a customer request or judge compliance with an imagined one.
First identify the visible construction mentally, including mixed or unfamiliar treatment. Evaluate control and coherence within that treatment. Flat vector, painting, drawing, photographic, 3D, collage and other media are equally eligible for excellent execution. Flatness, crisp geometry, realistic shading, stylization and visible texture are not defects in themselves. Do not require watercolor marks on graphic art, or canonical source rendering on a character interpreted in another medium.
artifactFree: inspect malformed anatomy/objects, accidental seams, duplicated patterns and incoherent light. Respect intentional stylization.
premiumFinish: inspect controlled edges/marks, palette, materials and detail. Generic execution needs a specific visible repetitive or default decision and its location; an absent alternative medium, wrong character, purchase preference or lack of event decorations is not a craft defect.
compositionQuality: inspect the arrangement actually present, its visual hierarchy, overlaps and frame relationships. Evaluate a portrait, diptych, collage, dense arrangement or deliberate abstract edge crop on its own terms. Unknown host intent is not a visible layout defect; intended layout compliance belongs to a separate review. Do not invent browser crops, overlays or text areas.
Every dimension must have located evidence. Clear means criterion none and score 5; cite positive visible support. Defect means a permitted dimension-specific criterion and score 1-4; cite the actual flaw. Uncertain means a permitted criterion, located unresolved feature and score 1-4. Never treat uncertainty as a pass. Return only the complete schema. This assessment is not invitation approval; a separate full-brief check remains required.`;

/** Only image bytes enter this packet. No host/context argument exists. A caller
 * can key retained craft evidence by requestFingerprint for identical pixels. */
export function buildIndependentCraftRequest(bytes:Buffer){
 if(bytes.length>4_000_000)throw Error('craft-image-too-large');
 const image=decodePng(bytes);
 if(image.width>1536||image.height>1536||image.width<1||image.height<1)throw Error('craft-image-dimensions');
 const body={model:VISION_MODEL,max_tokens:1600,system,messages:[{role:'user',content:[
   {type:'image',source:{type:'base64',media_type:'image/png',data:bytes.toString('base64')}},
   {type:'text',text:'Assess the execution and composition visible in these exact pixels. No customer brief is available in this assessment.'},
 ]}],output_config:{format:{type:'json_schema',schema:INDEPENDENT_CRAFT_SCHEMA}}};
 const hash=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
 return {body,imageHash:hash(bytes),requestFingerprint:hash(JSON.stringify(body)),schemaHash:hash(JSON.stringify(INDEPENDENT_CRAFT_SCHEMA)),version:INDEPENDENT_CRAFT_VERSION};
}

/** No score is raised or synthesized. Invalid and uncertain reports fail. */
export function validateIndependentCraft(raw:unknown){
 const issues:string[]=[],record=raw&&typeof raw==='object'&&!Array.isArray(raw)?raw as Record<string,unknown>:{};
 const assessments:Partial<Record<Dimension,{score:number;status:string;criterion:string;location:string;observation:string}>>={};
 if(Object.keys(record).some(k=>!dimensions.includes(k as Dimension)))issues.push('unexpected-dimension');
 for(const d of dimensions){
   const value=record[d];
   const row=value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
   if(Object.keys(row).some(k=>!['score','status','criterion','location','observation'].includes(k)))issues.push(`${d}:unexpected-field`);
   const located=(s:unknown):s is string=>typeof s==='string'&&s.trim().length>0;
   if(typeof row.score!=='number'||!Number.isInteger(row.score)||row.score<1||row.score>5||
     !['clear','defect','uncertain'].includes(String(row.status))||!located(row.location)||!located(row.observation)||!located(row.criterion)){
     issues.push(`${d}:incomplete`);continue;
   }
   assessments[d]={score:row.score,status:String(row.status),criterion:row.criterion,location:row.location,observation:row.observation};
   if(row.status==='clear'){
     if(row.score!==5||row.criterion!=='none')issues.push(`${d}:clear-score-conflict`);
   }else{
     if(row.score===5||!(REVIEW_CRITERIA[d] as readonly string[]).includes(row.criterion))issues.push(`${d}:defect-score-conflict`);
   }
 }
 const uncertain=Object.values(assessments).some(a=>a.status==='uncertain');
 return {assessments,issues,valid:issues.length===0,unresolved:uncertain,passed:issues.length===0&&!uncertain&&dimensions.every(d=>assessments[d]?.score===5)};
}

// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { encode as encodeJpeg } from 'jpeg-js';
import type { Event } from '@shared/schema';
import { buildEventBrief } from '../server/aiFirst/brief';
import { buildArtworkEditRequest } from '../server/aiFirst/artworkEdit';
import { generateArtwork } from '../server/aiFirst/artwork';
import { encodePng } from '../server/aiFirst/png';
import { previewImageBytes } from '../server/prePaymentPreviewImage';

const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const source = encodePng({width:1024,height:1536,rgb:Buffer.alloc(1024*1536*3,130)});
const image = previewImageBytes(source,'detail-v1');
const candidate = {sourceBase64:source.toString('base64'),imageBase64:image.toString('base64'),imageHash:hash(image)};
function input(vibe='Watercolor peonies, exactly three red birds, no balloons.') {
  return {brief:buildEventBrief({event:{eventName:'Garden party',eventType:'Birthday',vibeDescription:vibe,
    themeName:'Garden',paletteColors:'[]'} as Event,dna:{},guestCount:8,inspirationNotes:''}),
    candidate:{...candidate},correction:'Add the missing third bird and keep the rest of the scene.',
    previousNotes:[{action:'rejected',note:'The bird count is wrong.'}]};
}
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs()});

describe('saved-artwork edits',()=>{
  it.each([
    'Elsa and Anna in a snowy garden, cut-paper artwork, no snowman or lettering.',
    'Exactly three red birds with watercolor peonies, no balloons.',
    'A botanical lacquer-inlay moonlit dinner, gold leaves, no people.',
  ])('retains the complete free-form brief and original source: %s',vibe=>{
    const data=input(vibe),edit=buildArtworkEditRequest(data);
    expect(edit.request.prompt).toContain(JSON.stringify(data.brief));
    expect(edit.request.prompt).toContain(data.correction);
    expect(edit.request.referenceImages?.[0].bytes.equals(source)).toBe(true);
    expect(edit.request).toMatchObject({model:'gpt-image-2',quality:'medium',maxTransientRetries:0});
    expect(edit.source).toEqual({inputImageHash:hash(source),reviewedImageHash:hash(image),width:1024,height:1536,inputKind:'original-source'});
  });
  it('can edit an older retained image without an original, but never substitutes for a corrupt original',()=>{
    const data=input();delete data.candidate.sourceBase64;
    const edit=buildArtworkEditRequest(data);
    expect(edit.request.referenceImages?.[0].bytes.equals(image)).toBe(true);
    expect(edit.source.inputKind).toBe('reviewed-image');
    data.candidate.sourceBase64='not-a-png';
    expect(()=>buildArtworkEditRequest(data)).toThrow('verified');
  });
  it('rejects a valid but unrelated original and a hash-mismatched inspected image',()=>{
    const data=input();data.candidate.sourceBase64=encodePng({width:8,height:12,rgb:Buffer.alloc(288,200)}).toString('base64');
    expect(()=>buildArtworkEditRequest(data)).toThrow('does not match');
    data.candidate={...candidate,imageHash:'0'.repeat(64)};
    expect(()=>buildArtworkEditRequest(data)).toThrow('no longer matches');
  });
  it.each([true,false])('edits the exact retained original PNG without re-encoding it (source retained: %s)',hasSource=>{
    const data=input();
    expect(hash(source)).not.toBe(hash(image));
    data.candidate={imageBase64:source.toString('base64'),imageHash:hash(source)} as typeof candidate;
    if(hasSource) data.candidate.sourceBase64=source.toString('base64');
    const edit=buildArtworkEditRequest(data);
    expect(edit.request.referenceImages?.[0].bytes.equals(source)).toBe(true);
    expect(edit.source).toMatchObject({inputImageHash:hash(source),reviewedImageHash:hash(source),
      inputKind:hasSource?'original-source':'reviewed-image'});
    data.candidate.sourceBase64=encodePng({width:1024,height:1536,rgb:Buffer.alloc(1024*1536*3,200)}).toString('base64');
    expect(()=>buildArtworkEditRequest(data)).toThrow('does not match');
  });
  it.each([[12,8,'16:9'],[8,8,'1:1']] as const)('keeps a supported %sx%s orientation', (width,height,aspectRatio)=>{
    const data=input(),bytes=encodePng({width,height,rgb:Buffer.alloc(width*height*3,70)}),reviewed=previewImageBytes(bytes,'detail-v1');
    data.candidate={sourceBase64:bytes.toString('base64'),imageBase64:reviewed.toString('base64'),imageHash:hash(reviewed)};
    expect(buildArtworkEditRequest(data).request.aspectRatio).toBe(aspectRatio);
  });
  it('does not stretch an unsupported frame or truncate an oversized brief',()=>{
    const data=input(),bytes=encodePng({width:16,height:9,rgb:Buffer.alloc(16*9*3,70)}),reviewed=previewImageBytes(bytes,'detail-v1');
    data.candidate={sourceBase64:bytes.toString('base64'),imageBase64:reviewed.toString('base64'),imageHash:hash(reviewed)};
    expect(()=>buildArtworkEditRequest(data)).toThrow('shape');
    const large=input('Requested detail '.repeat(2100));
    expect(()=>buildArtworkEditRequest(large)).toThrow('no details were removed');
  });
  it('passes the actual source PNG and complete correction to the provider edit endpoint once',async()=>{
    vi.stubEnv('OPENAI_API_KEY','synthetic-edit-transport-key');
    const jpeg=encodeJpeg({width:1024,height:1536,data:Buffer.alloc(1024*1536*4,255)},100).data;
    const fetch=vi.fn(async()=>new Response(JSON.stringify({data:[{b64_json:jpeg.toString('base64')}]}),{status:200}));
    vi.stubGlobal('fetch',fetch);
    const data=input(),edit=buildArtworkEditRequest(data);
    const result=await generateArtwork({...edit.request,signal:AbortSignal.timeout(5000)});
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url,init]=fetch.mock.calls[0] as unknown as [string,RequestInit];
    expect(url).toBe('https://api.openai.com/v1/images/edits');
    const form=init.body as FormData;
    expect(form.get('prompt')).toBe(edit.request.prompt);
    expect(form.get('model')).toBe('gpt-image-2');expect(form.get('n')).toBe('1');
    expect(form.get('size')).toBe('1024x1536');expect(form.get('input_fidelity')).toBeNull();
    expect(form.getAll('image[]')).toHaveLength(1);
    expect(Buffer.from(await (form.get('image[]') as Blob).arrayBuffer()).equals(source)).toBe(true);
    expect(result.telemetry?.providerRequestCount).toBe(1);
  });
  it('never switches a failed edit into text-only generation or an automatic retry',async()=>{
    vi.stubEnv('OPENAI_API_KEY','synthetic-edit-transport-key');
    const fetch=vi.fn(async()=>new Response(JSON.stringify({error:{message:'Provider unavailable'}}),{status:503}));
    vi.stubGlobal('fetch',fetch);
    await expect(generateArtwork(buildArtworkEditRequest(input()).request)).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('https://api.openai.com/v1/images/edits');
  });
});

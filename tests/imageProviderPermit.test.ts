// Offline transport-boundary checks. Every provider fetch is replaced; these
// tests do not generate images or claim anything in a hosted database.
// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InviteDesignConcept } from '@shared/inviteDesign';
import { authorizeImageDispatch } from '../server/imageSpendGuard';
import { generateArtwork, GOOGLE_ARTWORK_MODEL, type ArtworkRequest } from '../server/aiFirst/artwork';
import { generateGoogleArtwork } from '../server/aiFirst/googleArtwork';
import { generateInviteIllustration } from '../server/illustrationGen';

vi.mock('../server/imageSpendGuard', () => ({ authorizeImageDispatch: vi.fn() }));
const { claimDispatch } = vi.hoisted(() => ({ claimDispatch: vi.fn() }));
vi.mock('../server/imageSpendStore', () => ({ DbImageSpendStore: class {
  claimDispatch = claimDispatch;
} }));

const authorize = vi.mocked(authorizeImageDispatch);
const fetchMock = vi.fn();
const permit = '548cf7a8-9a12-49a3-bcf7-073e773a473c';
const execution = '3a5ee96c-bb20-4b8f-88e0-22bf37c3f21f';
const request: ArtworkRequest = { model: 'gpt-image-2', prompt: 'A complete private host brief',
  aspectRatio: '9:16', quality: 'medium', outputFormat: 'png', maxTransientRetries: 0,
  imageSpendPermit: permit, imageSpendExecution: execution };
const concept = { illustrationPrompt: 'A garden celebration' } as InviteDesignConcept;
const response = () => new Response(JSON.stringify({ data: [{ b64_json: Buffer.from('fixture pixels').toString('base64') }] }), { status: 200 });

beforeEach(() => {
  vi.stubEnv('OPENAI_API_KEY', 'offline-openai-key');
  vi.stubEnv('GEMINI_API_KEY', 'offline-google-key');
  authorize.mockReset().mockResolvedValue(undefined);
  claimDispatch.mockReset().mockResolvedValue(undefined);
  fetchMock.mockReset().mockImplementation(async () => response());
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('durable image permit at every provider boundary', () => {
  it.each([
    ['OpenAI create', () => generateArtwork(request)],
    ['OpenAI edit', () => generateArtwork({ ...request, referenceImages: [{ bytes: Buffer.from('saved source'), mimeType: 'image/png' }] })],
    ['direct Google', () => generateGoogleArtwork({ ...request, model: GOOGLE_ARTWORK_MODEL })],
    ['delegated Google', () => generateArtwork({ ...request, model: GOOGLE_ARTWORK_MODEL })],
    ['legacy illustration', () => generateInviteIllustration(concept, '9:16', 'medium')],
  ] as const)('denies %s before any provider call and preserves the guard error', async (_name, dispatch) => {
    const denied = new Error('The durable image policy is paused');
    authorize.mockRejectedValue(denied);
    await expect(dispatch()).rejects.toBe(denied);
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('waits for committed authorization before sending the request', async () => {
    let release!: () => void;
    authorize.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    const work = generateArtwork(request);
    expect(authorize).toHaveBeenCalledWith(request);
    expect(fetchMock).not.toHaveBeenCalled();
    release();
    await work;
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not send the internal permit or authorization metadata to OpenAI', async () => {
    await generateArtwork(request);
    expect(authorize).toHaveBeenCalledWith(request);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/images/generations');
    expect(JSON.parse(init.body)).toMatchObject({ model: request.model, prompt: request.prompt, quality: 'medium', n: 1 });
    expect(init.body).not.toContain(permit);
    expect(init.body).not.toContain(execution);
    expect(init.body).not.toContain('imageSpendPermit');
    expect(init.body).not.toContain('imageSpendExecution');
  });

  it('keeps permits out of the multipart edit and preserves the saved source', async () => {
    const bytes = Buffer.from('exact saved source');
    const edit = { ...request, referenceImages: [{ bytes, mimeType: 'image/png' as const }] };
    await generateArtwork(edit);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.openai.com/v1/images/edits');
    expect(authorize).toHaveBeenCalledWith(edit);
    expect(init.body.has('imageSpendPermit')).toBe(false);
    expect(init.body.has('imageSpendExecution')).toBe(false);
    expect(Buffer.from(await init.body.get('image[]').arrayBuffer())).toEqual(bytes);
  });

  it('allows only the one worker whose duplicate-dispatch claim succeeded', async () => {
    const duplicate = Object.assign(new Error('Already dispatched'), { code: 'duplicate' });
    authorize.mockResolvedValueOnce(undefined).mockRejectedValueOnce(duplicate);
    const results = await Promise.allSettled([generateArtwork(request), generateArtwork(request)]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.find(result => result.status === 'rejected')).toMatchObject({ reason: duplicate });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('requires another authorization before a transport retry could reach the provider', async () => {
    const denied = new Error('One-use permit cannot authorize a second dispatch');
    authorize.mockResolvedValueOnce(undefined).mockRejectedValueOnce(denied);
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: { code: 'server_error' } }), {
      status: 503, headers: { 'retry-after': '0' },
    }));
    await expect(generateArtwork({ ...request, maxTransientRetries: 1 })).rejects.toBe(denied);
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does not claim a permit after the request is already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('Cancelled before dispatch'));
    await expect(generateArtwork({ ...request, signal: controller.signal })).rejects.toThrow('Cancelled before dispatch');
    await expect(generateGoogleArtwork({ ...request, model: GOOGLE_ARTWORK_MODEL, signal: controller.signal })).rejects.toThrow('Cancelled before dispatch');
    expect(authorize).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('passes legacy metadata without inventing a customer permit', async () => {
    await generateInviteIllustration(concept, '16:9', 'low');
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-image-1',
      aspectRatio: '16:9', quality: 'low', outputFormat: 'png', maxTransientRetries: 0 }));
    expect(authorize.mock.calls[0][0]).not.toHaveProperty('imageSpendPermit');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ model: 'gpt-image-1', size: '1536x1024', quality: 'low', n: 1 });
  });
});

describe('real helper scope through the provider adapters', () => {
  async function realHelper() {
    const actual = await vi.importActual<typeof import('../server/imageSpendGuard')>('../server/imageSpendGuard');
    authorize.mockImplementation(actual.authorizeImageDispatch);
    return actual;
  }

  it('uses the durable database claim in the guarded Preview before its one fetch', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('VERCEL_GIT_COMMIT_REF', 'codex/launch-blockers');
    await realHelper();
    await generateArtwork(request);
    expect(claimDispatch).toHaveBeenCalledExactlyOnceWith(request);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(claimDispatch.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0]);
  });

  it.each([
    ['no permit', { imageSpendPermit: undefined }],
    ['malformed permit', { imageSpendPermit: 'client-invented' }],
    ['no execution claim', { imageSpendExecution: undefined }],
    ['malformed execution claim', { imageSpendExecution: 'client-invented' }],
    ['implicit retry', { maxTransientRetries: undefined }],
    ['explicit retry', { maxTransientRetries: 1 as const }],
  ])('rejects %s before database or provider dispatch in scoped Preview', async (_name, change) => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('VERCEL_GIT_COMMIT_REF', 'codex/launch-blockers');
    await realHelper();
    await expect(generateArtwork({ ...request, ...change })).rejects.toMatchObject({ code: 'blocked' });
    expect(claimDispatch).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['legacy', 'direct Google', 'delegated Google'] as const)('cannot dispatch %s without a permit through the real helper', async path => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('VERCEL_GIT_COMMIT_REF', 'codex/launch-blockers');
    await realHelper();
    const google = { ...request, model: GOOGLE_ARTWORK_MODEL, imageSpendPermit: undefined };
    const work = path === 'legacy' ? generateInviteIllustration(concept, '9:16')
      : path === 'direct Google' ? generateGoogleArtwork(google) : generateArtwork(google);
    await expect(work).rejects.toMatchObject({ code: 'blocked' });
    expect(claimDispatch).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fails closed on database uncertainty before reaching OpenAI', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview');
    vi.stubEnv('VERCEL_GIT_COMMIT_REF', 'codex/launch-blockers');
    await realHelper();
    claimDispatch.mockRejectedValue(new Error('Synthetic unavailable database'));
    await expect(generateArtwork(request)).rejects.toMatchObject({ code: 'unavailable' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['Production', 'production', 'codex/launch-blockers'],
    ['another Preview branch', 'preview', 'some-other-branch'],
    ['missing branch', 'preview', undefined],
    ['missing environment', undefined, 'codex/launch-blockers'],
  ])('preserves existing dispatch outside scope: %s', async (_name, environment, branch) => {
    vi.stubEnv('VERCEL_ENV', environment);
    vi.stubEnv('VERCEL_GIT_COMMIT_REF', branch);
    await realHelper();
    await generateArtwork({ ...request, imageSpendPermit: undefined, imageSpendExecution: undefined });
    expect(claimDispatch).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

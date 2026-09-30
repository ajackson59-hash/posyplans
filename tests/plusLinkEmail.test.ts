// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendPlusLinkCodeEmail } from '../server/email';

const ID = 'b66c1388-90ed-4dfe-aa6d-772df6884917';
const input = { to: 'billing@example.invalid', code: '00123456', challengeId: ID };
const fetchMock = vi.fn<typeof fetch>();
beforeEach(() => {
  vi.stubEnv('RESEND_API_KEY', 're_synthetic_not_a_real_key');
  vi.stubEnv('RESEND_FROM_EMAIL', 'Posy <hello@posyplans.com>');
  vi.stubEnv('RESEND_REPLY_TO_EMAIL', 'hello@posyplans.com');
  fetchMock.mockReset(); fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: 'synthetic-receipt' }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
function payload() {
  return JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
    to: string[]; from: string; reply_to: string; subject: string; text: string; html: string;
  };
}

describe('Plus link code email', () => {
  it('sends only the static code instructions with leading zeroes and challenge-scoped idempotency', async () => {
    const result = await sendPlusLinkCodeEmail({ ...input,
      eventName: 'https://attacker.example/\" onmouseover=\"bad', ownerToken: 'private-owner-capability',
    } as typeof input);
    expect(result).toEqual({ ok: true, providerId: 'synthetic-receipt' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.resend.com/emails');
    const init = fetchMock.mock.calls[0][1]!;
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ 'Idempotency-Key': `plus-link/${ID}` });
    const sent = payload();
    expect(sent.to).toEqual([input.to]); expect(sent.from).toBe('Posy <hello@posyplans.com>');
    expect(sent.subject).toBe('Your Posy Plus verification code');
    expect(sent.text).toContain('\n\n00123456\n\n'); expect(sent.html).toContain('00123456');
    expect(sent.text).toContain('expires in 10 minutes');
    expect(sent.text).toContain('connects your membership to that event');
    expect(sent.text).toContain('Never share this code');
    expect(sent.html).toContain('Posy support will never ask you to share it');
    expect(sent.html).not.toMatch(/href=|attacker|private-owner-capability|dashboard\//);
    expect(sent.text).not.toMatch(/https?:\/\/|attacker|private-owner-capability/);
  });

  it('passes a ten-second abort signal to the provider and reports an abort without retrying', async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    fetchMock.mockImplementation(async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(new DOMException('Synthetic timeout', 'AbortError')), { once: true });
    }));
    const pending = sendPlusLinkCodeEmail(input);
    expect(timeout).toHaveBeenCalledWith(10_000);
    expect(fetchMock.mock.calls[0][1]?.signal).toBe(controller.signal);
    controller.abort();
    expect(await pending).toMatchObject({ ok: false, code: 'resend_network_error' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([{}, { id: '' }, null, 'not-json'])('refuses to claim provider acceptance without a receipt (%j)', async body => {
    fetchMock.mockResolvedValue(new Response(body === 'not-json' ? body : JSON.stringify(body), { status: 200 }));
    const result = await sendPlusLinkCodeEmail(input);
    expect(result.ok).toBe(false); expect(result.providerId).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports explicit provider rejection without an automatic retry', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ name: 'rate_limit_exceeded', message: 'Synthetic refusal' }), { status: 429 }));
    expect(await sendPlusLinkCodeEmail(input)).toMatchObject({ ok: false, statusCode: 429, code: 'rate_limit_exceeded' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports a network failure without an automatic retry', async () => {
    fetchMock.mockRejectedValue(Error('Synthetic connection failure'));
    expect(await sendPlusLinkCodeEmail(input)).toMatchObject({ ok: false, code: 'resend_network_error' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([{ ...input, code: '1234567' }, { ...input, code: '123456789' },
    { ...input, code: '<script>' }, { ...input, challengeId: 'invalid' }])('rejects invalid code or challenge before dispatch (%j)', async value => {
    expect(await sendPlusLinkCodeEmail(value)).toEqual({ ok: false, code: 'invalid_verification_email' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each(['missing-key', 'missing-sender', 'test-sender'])('does not dispatch with %s', async reason => {
    vi.stubEnv('NODE_ENV', 'production');
    if (reason === 'missing-key') vi.stubEnv('RESEND_API_KEY', '');
    if (reason === 'missing-sender') vi.stubEnv('RESEND_FROM_EMAIL', '');
    if (reason === 'test-sender') vi.stubEnv('RESEND_FROM_EMAIL', 'Posy <onboarding@resend.dev>');
    expect((await sendPlusLinkCodeEmail(input)).ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

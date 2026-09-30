// @vitest-environment node
// Synthetic consent/configuration and mocked transport only. No Meta requests.
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendMetaPurchaseEvent, type MetaPurchaseParams } from "../server/metaCapi";

vi.mock("node:crypto", async importOriginal => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, createHash: vi.fn(actual.createHash) };
});

const fetchMock = vi.fn<typeof fetch>();
const params: MetaPurchaseParams = {
  email: "Synthetic@Example.Invalid", phone: "+1 (555) 010-0199",
  value: 9.99, currency: "USD", eventId: "synthetic-purchase-id",
};

beforeEach(() => {
  vi.stubEnv("META_CAPI_ACCESS_TOKEN", "synthetic-meta-token");
  vi.stubEnv("META_PIXEL_ID", "synthetic-pixel-id");
  vi.stubGlobal("fetch", fetchMock.mockReset().mockResolvedValue(new Response(null, { status: 200 })));
  vi.mocked(createHash).mockClear();
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("server-side Meta marketing consent", () => {
  it.each([undefined, false])("skips configured tracking before accessing or hashing contact details when consent is %s", async marketingConsent => {
    const unconsented = { ...params, marketingConsent };
    Object.defineProperty(unconsented, "email", { get() { throw new Error("Contact details must not be read without consent"); } });
    Object.defineProperty(unconsented, "phone", { get() { throw new Error("Contact details must not be read without consent"); } });

    await expect(sendMetaPurchaseEvent(unconsented)).resolves.toBeUndefined();
    expect(createHash).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not treat a truthy unverified value as consent", async () => {
    await sendMetaPurchaseEvent({ ...params, marketingConsent: "true" } as unknown as MetaPurchaseParams);
    expect(createHash).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("allows one deduplicated Purchase only when a caller explicitly supplies true", async () => {
    // This verifies the helper contract, not a real consent collection flow.
    // Production callers must not pass true until such a flow is implemented.
    await sendMetaPurchaseEvent({ ...params, marketingConsent: true });
    expect(createHash).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://graph.facebook.com/v19.0/synthetic-pixel-id/events?access_token=synthetic-meta-token");
    expect(options?.method).toBe("POST");
    const body = JSON.parse(String(options?.body));
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ event_name: "Purchase", event_id: params.eventId,
      user_data: { em: [expect.stringMatching(/^[a-f0-9]{64}$/)], ph: [expect.stringMatching(/^[a-f0-9]{64}$/)] },
      custom_data: { value: 9.99, currency: "USD" } });
    expect(String(options?.body)).not.toContain(params.email);
    expect(String(options?.body)).not.toContain(params.phone);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getEmailConfiguration, sendEventRecoveryEmail, sendInviteEmail } from "../server/email";

const fetchMock = vi.fn(async () =>
  new Response(JSON.stringify({ id: "email-provider-id" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }),
);

beforeEach(() => {
  process.env.RESEND_API_KEY = "re_test";
  process.env.RESEND_FROM_EMAIL = "Posy <hello@posyplans.com>";
  process.env.RESEND_REPLY_TO_EMAIL = "hello@posyplans.com";
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM_EMAIL;
  delete process.env.RESEND_REPLY_TO_EMAIL;
});

function sentPayload(): { html: string; text: string; from: string; reply_to: string } {
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body));
}

describe("branded email presentation", () => {
  it("presents a recovery link as a private host dashboard email", async () => {
    const result = await sendEventRecoveryEmail({
      to: "host@example.com",
      subject: "Your private Posy event link",
      body: "Your event is saved.\n\nhttps://posyplans.com/dashboard/private-token",
      idempotencyKey: "event-recovery/test",
    });

    expect(result).toEqual({ ok: true, providerId: "email-provider-id" });
    const payload = sentPayload();
    expect(payload.html).toContain("Open event dashboard");
    expect(payload.html).toContain("This email contains a private Posy event link.");
    expect(payload.html).not.toContain("on behalf of your host");
    expect(payload.from).toBe("Posy <hello@posyplans.com>");
    expect(payload.reply_to).toBe("hello@posyplans.com");
    const headers = fetchMock.mock.calls[0]?.[1]?.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe("event-recovery/test");
  });

  it("keeps guest invitation language on RSVP emails", async () => {
    await sendInviteEmail({
      to: "guest@example.com",
      subject: "You're invited",
      body: "Join us.\n\nhttps://posyplans.com/rsvp/guest-token",
    });

    const payload = sentPayload();
    expect(payload.html).toContain("View &amp; RSVP");
    expect(payload.html).toContain("Sent by Posy on behalf of your host.");
  });

  it("reports whether the deployment has a verified production sender", () => {
    expect(getEmailConfiguration()).toEqual(
      expect.objectContaining({
        apiKeyConfigured: true,
        fromAddressConfigured: true,
        productionSenderConfigured: true,
        usesTestSender: false,
        senderDomain: "posyplans.com",
      }),
    );
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendEventRecoveryEmail, sendInviteEmail } from "../server/email";

const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));

beforeEach(() => {
  process.env.RESEND_API_KEY = "re_test";
  process.env.RESEND_FROM_EMAIL = "Posy <hello@posyplans.com>";
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM_EMAIL;
});

function sentPayload(): { html: string; text: string } {
  const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
  return JSON.parse(String(init?.body));
}

describe("branded email presentation", () => {
  it("presents a recovery link as a private host dashboard email", async () => {
    const result = await sendEventRecoveryEmail({
      to: "host@example.com",
      subject: "Your private Posy event link",
      body: "Your event is saved.\n\nhttps://posyplans.com/dashboard/private-token",
    });

    expect(result).toEqual({ ok: true });
    const payload = sentPayload();
    expect(payload.html).toContain("Open event dashboard");
    expect(payload.html).toContain("This email contains a private Posy event link.");
    expect(payload.html).not.toContain("on behalf of your host");
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
});

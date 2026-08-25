import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createServer } from "node:http";

process.env.DATABASE_URL = "postgres://test/test";

const OWNER = "owner-token-test";
const TOKEN_A = "a".repeat(32);
const TOKEN_B = "b".repeat(32);

const baseEvent = {
  id: 1,
  ownerToken: OWNER,
  shareSlug: "private-party",
  eventName: "Maya's Birthday",
  eventType: "Birthday Party",
  eventDate: "Saturday, August 8",
  location: "The Garden",
  hostNames: "Alex",
  rsvpDeadline: "August 1",
  rsvpRestriction: "none",
  inviteSubject: "You're invited, {{guestName}}!",
  inviteMessage: "Come celebrate with us.",
  capturedEmail: null,
};

function guest(overrides: Record<string, unknown> = {}) {
  return {
    id: 17,
    eventId: 1,
    accessToken: TOKEN_A,
    name: "Maya Rivera",
    email: "maya@example.com",
    phone: "+1 (555) 555-1212",
    group: "Family",
    partySize: 2,
    rsvpStatus: "pending",
    attendingCount: null,
    attendingAdults: null,
    attendingChildren: null,
    note: "",
    invitedAt: null,
    respondedAt: null,
    emailSentAt: null,
    emailSendError: null,
    smsOptIn: true,
    smsConsentAt: 1,
    smsSentAt: null,
    smsSendError: null,
    ...overrides,
  };
}

let storedGuests = [guest(), guest({ id: 18, accessToken: TOKEN_B, name: "Noah Rivera", email: "noah@example.com" })];

const storageMock = {
  getEventByShareSlug: vi.fn(async (slug: string) => slug === baseEvent.shareSlug ? { ...baseEvent } : undefined),
  getEventByOwnerToken: vi.fn(async (token: string) => token === OWNER ? { ...baseEvent } : undefined),
  getEventsByEmail: vi.fn(async (email: string) => email === "host@example.com" ? [{ ...baseEvent }] : []),
  listGuests: vi.fn(async () => storedGuests.map((item) => ({ ...item }))),
  getGuest: vi.fn(async (id: number) => storedGuests.find((item) => item.id === id)),
  getGuestByAccessToken: vi.fn(async (eventId: number, token: string) =>
    storedGuests.find((item) => item.eventId === eventId && item.accessToken === token)),
  updateGuest: vi.fn(async (eventId: number, id: number, data: Record<string, unknown>) => {
    const index = storedGuests.findIndex((item) => item.eventId === eventId && item.id === id);
    if (index < 0) return undefined;
    storedGuests[index] = { ...storedGuests[index], ...data };
    return { ...storedGuests[index] };
  }),
  rotateGuestAccessToken: vi.fn(async (eventId: number, id: number) => {
    const index = storedGuests.findIndex((item) => item.eventId === eventId && item.id === id);
    if (index < 0) return undefined;
    storedGuests[index] = { ...storedGuests[index], accessToken: "r".repeat(32) };
    return { ...storedGuests[index] };
  }),
};

const sendInviteEmail = vi.fn(async () => ({ ok: true }));
const sendEventRecoveryEmail = vi.fn(async () => ({ ok: true }));
const sendReminderSms = vi.fn(async () => ({ ok: true }));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/email", () => ({ sendInviteEmail, sendEventRecoveryEmail }));
vi.mock("../server/sms", () => ({ sendReminderSms }));

const { registerRoutes } = await import("../server/routes");

async function makeApp() {
  const app = express();
  app.use(express.json());
  await registerRoutes(createServer(app), app);
  return app;
}

beforeEach(() => {
  storedGuests = [guest(), guest({ id: 18, accessToken: TOKEN_B, name: "Noah Rivera", email: "noah@example.com" })];
  vi.clearAllMocks();
  storageMock.getEventsByEmail.mockImplementation(async (email: string) =>
    email === "host@example.com" ? [{ ...baseEvent }] : []);
  sendInviteEmail.mockResolvedValue({ ok: true });
  sendEventRecoveryEmail.mockResolvedValue({ ok: true });
  sendReminderSms.mockResolvedValue({ ok: true });
});

describe("host event recovery", () => {
  it("sends private owner links to the matched inbox without returning them to the browser", async () => {
    const app = await makeApp();
    const res = await request(app)
      .post("/api/events/lookup")
      .set("X-Forwarded-Host", "evil.example")
      .send({ email: " HOST@EXAMPLE.COM " });

    expect(res.status).toBe(202);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.body).toEqual({
      ok: true,
      message: "If an event is connected to that email, a private dashboard link is on its way.",
    });
    expect(JSON.stringify(res.body)).not.toContain(OWNER);
    expect(storageMock.getEventsByEmail).toHaveBeenCalledWith("host@example.com");
    expect(sendEventRecoveryEmail).toHaveBeenCalledWith(expect.objectContaining({
      to: "host@example.com",
      body: expect.stringContaining(`https://posyplans.com/dashboard/${OWNER}`),
    }));
    expect(sendEventRecoveryEmail.mock.calls[0][0].body).not.toContain("evil.example");
  });

  it("returns the same non-enumerating response when no event exists", async () => {
    const app = await makeApp();
    const known = await request(app).post("/api/events/lookup").send({ email: "host@example.com" });
    const missing = await request(app).post("/api/events/lookup").send({ email: "missing@example.com" });

    expect(missing.status).toBe(known.status);
    expect(missing.body).toEqual(known.body);
    expect(sendEventRecoveryEmail).toHaveBeenCalledTimes(1);
  });

  it("bounds repeated recovery emails for the same address", async () => {
    storageMock.getEventsByEmail.mockResolvedValue([{ ...baseEvent }]);
    const app = await makeApp();

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const res = await request(app).post("/api/events/lookup").send({ email: "rate-limit@example.com" });
      expect(res.status).toBe(202);
    }

    expect(storageMock.getEventsByEmail).toHaveBeenCalledTimes(3);
    expect(sendEventRecoveryEmail).toHaveBeenCalledTimes(3);
  });
});

describe("personalized guest RSVP routes", () => {
  it("returns only safe recipient fields for a valid guest token", async () => {
    const app = await makeApp();
    const res = await request(app).get(`/api/events/public/${baseEvent.shareSlug}/guest/${TOKEN_A}`);

    expect(res.status).toBe(200);
    expect(res.headers["cache-control"]).toBe("private, no-store");
    expect(res.body).toMatchObject({ name: "Maya Rivera", partySize: 2, rsvpStatus: "pending" });
    expect(res.body).not.toHaveProperty("id");
    expect(res.body).not.toHaveProperty("eventId");
    expect(res.body).not.toHaveProperty("accessToken");
    expect(res.body).not.toHaveProperty("email");
    expect(res.body).not.toHaveProperty("phone");
  });

  it("does not accept a token from another event or an invalid token", async () => {
    const app = await makeApp();
    const res = await request(app).get(`/api/events/public/${baseEvent.shareSlug}/guest/${"x".repeat(32)}`);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Invitation not found");
  });

  it("retires fuzzy guest enumeration and rejects numeric-id RSVP URLs", async () => {
    const app = await makeApp();
    const search = await request(app).get(`/api/events/public/${baseEvent.shareSlug}/search-guests?q=Ma`);
    expect(search.status).toBe(410);
    expect(JSON.stringify(search.body)).not.toContain("Maya");

    const numeric = await request(app)
      .post(`/api/events/public/${baseEvent.shareSlug}/guests/17/rsvp`)
      .send({ status: "yes" });
    expect(numeric.status).toBe(404);
    expect(storageMock.updateGuest).not.toHaveBeenCalled();
  });

  it("uses exact name plus exact email or normalized phone for generic recovery", async () => {
    const app = await makeApp();
    const email = await request(app)
      .post(`/api/events/public/${baseEvent.shareSlug}/identify`)
      .send({ name: "  MAYA   RIVERA ", contact: "MAYA@example.com" });
    expect(email.status).toBe(200);
    expect(email.body.guestToken).toBe(TOKEN_A);
    expect(email.body.guest).not.toHaveProperty("email");

    const phone = await request(app)
      .post(`/api/events/public/${baseEvent.shareSlug}/identify`)
      .send({ name: "Maya Rivera", contact: "15555551212" });
    expect(phone.status).toBe(200);
    expect(phone.body.guestToken).toBe(TOKEN_A);

    const partial = await request(app)
      .post(`/api/events/public/${baseEvent.shareSlug}/identify`)
      .send({ name: "Maya", contact: "maya@example.com" });
    expect(partial.status).toBe(404);
    expect(partial.body.error).toBe("We couldn't verify that invitation");
  });

  it("caps submitted headcount to the invitation's party allowance", async () => {
    const app = await makeApp();
    const res = await request(app)
      .post(`/api/events/public/${baseEvent.shareSlug}/guest/${TOKEN_A}/rsvp`)
      .send({ status: "yes", attendingAdults: 2, attendingChildren: 3, note: "Vegetarian" });

    expect(res.status).toBe(200);
    expect(storageMock.updateGuest).toHaveBeenCalledWith(1, 17, expect.objectContaining({
      rsvpStatus: "yes",
      attendingAdults: 2,
      attendingChildren: 0,
      attendingCount: 2,
      note: "Vegetarian",
    }));
    expect(res.body).not.toHaveProperty("accessToken");
  });

  it("puts the recipient token in invite email and SMS links", async () => {
    const app = await makeApp();
    const email = await request(app)
      .post(`/api/events/owner/${OWNER}/guests/17/send-email`)
      .send({ origin: "https://evil.example" });
    expect(email.status).toBe(200);
    expect(sendInviteEmail).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.stringContaining(`/rsvp/${baseEvent.shareSlug}/g/${TOKEN_A}`),
    }));
    expect(sendInviteEmail.mock.calls[0][0].body).not.toContain("evil.example");

    const sms = await request(app)
      .post(`/api/events/owner/${OWNER}/guests/17/send-sms`)
      .send({ origin: "https://evil.example" });
    expect(sms.status).toBe(200);
    expect(sendReminderSms).toHaveBeenCalledWith(expect.objectContaining({
      body: expect.stringContaining(`/rsvp/${baseEvent.shareSlug}/g/${TOKEN_A}`),
    }));
    expect(sendReminderSms.mock.calls[0][0].body).not.toContain("evil.example");
  });
});

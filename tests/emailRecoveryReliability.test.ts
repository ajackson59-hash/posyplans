import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

process.env.DATABASE_URL = "postgres://test/test";

const getRecoveryEventsByEmail = vi.fn();
const sendEventRecoveryEmail = vi.fn();
const getEmailConfiguration = vi.fn();

vi.mock("../server/eventRecoveryStore", () => ({
  getRecoveryEventsByEmail: (...args: unknown[]) => getRecoveryEventsByEmail(...args),
}));

vi.mock("../server/email", () => ({
  getEmailConfiguration: (...args: unknown[]) => getEmailConfiguration(...args),
  sendEventRecoveryEmail: (...args: unknown[]) => sendEventRecoveryEmail(...args),
}));

const { registerEventRecoveryRoutes } = await import("../server/eventRecoveryRoutes");

function app() {
  const instance = express();
  instance.use(express.json());
  registerEventRecoveryRoutes(instance);
  return instance;
}

const linkedEvent = {
  ownerToken: "owner-token-private",
  eventName: "Hayden's Birthday",
  eventType: "Birthday Party",
  eventDate: "Sat, Jan 16, 2027",
};

beforeEach(() => {
  getRecoveryEventsByEmail.mockReset();
  sendEventRecoveryEmail.mockReset();
  getEmailConfiguration.mockReset();
  getEmailConfiguration.mockReturnValue({
    apiKeyConfigured: true,
    fromAddressConfigured: true,
    productionSenderConfigured: true,
    usesTestSender: false,
    senderDomain: "updates.posyplans.com",
    environment: "preview",
  });
  getRecoveryEventsByEmail.mockResolvedValue([linkedEvent]);
  sendEventRecoveryEmail.mockResolvedValue({ ok: true, providerId: "provider-email-id" });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Find My Event email recovery", () => {
  it("does not falsely say check your inbox when the deployment cannot send email", async () => {
    getEmailConfiguration.mockReturnValue({
      apiKeyConfigured: false,
      fromAddressConfigured: false,
      productionSenderConfigured: false,
      usesTestSender: false,
      senderDomain: null,
      environment: "preview",
    });

    const response = await request(app())
      .post("/api/events/lookup")
      .send({ email: "host@example.com" });

    expect(response.status).toBe(503);
    expect(response.body.code).toBe("email_configuration_incomplete");
    expect(response.body.requestId).toMatch(/^[a-f0-9]{12}$/);
    expect(getRecoveryEventsByEmail).not.toHaveBeenCalled();
    expect(sendEventRecoveryEmail).not.toHaveBeenCalled();
  });

  it("keeps the browser response non-enumerating while attaching a support reference", async () => {
    const response = await request(app())
      .post("/api/events/lookup")
      .send({ email: "HOST@example.com" });

    expect(response.status).toBe(202);
    expect(response.body).toEqual(
      expect.objectContaining({
        ok: true,
        message: expect.stringContaining("If an event is connected"),
        requestId: expect.stringMatching(/^[a-f0-9]{12}$/),
      }),
    );
    expect(getRecoveryEventsByEmail).toHaveBeenCalledWith("host@example.com");
    expect(sendEventRecoveryEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "host@example.com",
        subject: "Your Posy event link",
        idempotencyKey: expect.stringContaining("event-recovery/"),
      }),
    );
    expect(JSON.stringify(response.body)).not.toContain("owner-token-private");
  });

  it("returns the identical accepted response for an address with no linked event", async () => {
    getRecoveryEventsByEmail.mockResolvedValue([]);

    const response = await request(app())
      .post("/api/events/lookup")
      .send({ email: "unlinked@example.com" });

    expect(response.status).toBe(202);
    expect(response.body.ok).toBe(true);
    expect(response.body.message).toContain("If an event is connected");
    expect(response.body.requestId).toMatch(/^[a-f0-9]{12}$/);
    expect(sendEventRecoveryEmail).not.toHaveBeenCalled();
  });
});

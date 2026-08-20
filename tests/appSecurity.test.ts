import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

process.env.DATABASE_URL = "postgres://test/test";

const { createExpressApp } = await import("../server/app");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("application token hygiene", () => {
  it("redacts bearer credentials from API logs and sets privacy headers", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { app } = createExpressApp();
    app.get("/api/events/owner/owner-secret/guest/guest-secret", (_req, res) => {
      res.json({ ownerToken: "owner-secret", guestToken: "guest-secret", nested: { accessToken: "access-secret" } });
    });

    const res = await request(app).get("/api/events/owner/owner-secret/guest/guest-secret");

    expect(res.status).toBe(200);
    expect(res.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");

    const logged = logSpy.mock.calls.flat().join(" ");
    expect(logged).toContain("/owner/[REDACTED]/guest/[REDACTED]");
    expect(logged).not.toContain("owner-secret");
    expect(logged).not.toContain("guest-secret");
    expect(logged).not.toContain("access-secret");
  });
});

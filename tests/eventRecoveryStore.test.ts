import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.DATABASE_URL = "postgres://test/test";

const limit = vi.fn();
const orderBy = vi.fn(() => ({ limit }));
const where = vi.fn(() => ({ orderBy }));
const from = vi.fn(() => ({ where }));
const select = vi.fn(() => ({ from }));

vi.mock("../server/criticalDb", () => ({
  criticalDb: { select },
}));

const { getRecoveryEventsByEmail } = await import("../server/eventRecoveryStore");

beforeEach(() => {
  select.mockClear();
  from.mockClear();
  where.mockClear();
  orderBy.mockClear();
  limit.mockReset();
  limit.mockResolvedValue([]);
});

describe("event recovery data access", () => {
  it("selects only recovery metadata and limits the result at the database", async () => {
    await getRecoveryEventsByEmail(" Host@Example.com ");

    expect(select).toHaveBeenCalledTimes(1);
    const projection = select.mock.calls[0][0] as Record<string, unknown>;
    expect(Object.keys(projection)).toEqual([
      "ownerToken",
      "eventName",
      "eventType",
      "eventDate",
    ]);
    expect(projection).not.toHaveProperty("inviteIllustrationUrl");
    expect(projection).not.toHaveProperty("prePaymentPreviewUrl");
    expect(orderBy).toHaveBeenCalledTimes(1);
    expect(limit).toHaveBeenCalledWith(20);
  });
});

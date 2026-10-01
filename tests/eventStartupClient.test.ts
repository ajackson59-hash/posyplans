import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPendingEventStartKey,
  getOrCreatePendingEventStartKey,
  startEventWithRecovery,
} from "@/lib/eventStartup";

const seed = {
  eventName: "My Celebration",
  eventType: "Birthday Party",
  eventDate: "",
  inviteSubject: "You're invited!",
  inviteMessage: "",
};

beforeEach(() => {
  window.sessionStorage.clear();
});

describe("event startup recovery", () => {
  it("retries transient failures with one stable start key", async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(new Error("503: temporarily unavailable"))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValue({ json: async () => ({ ownerToken: "owner-token-123" }) });
    const sleep = vi.fn(async () => undefined);

    const result = await startEventWithRecovery(seed, {
      request,
      sleep,
      startKey: "stable-event-start-key-1234567890",
      retryDelaysMs: [0, 10, 20],
    });

    expect(result.event.ownerToken).toBe("owner-token-123");
    expect(request).toHaveBeenCalledTimes(3);
    const sentKeys = request.mock.calls.map(([, , body]) => (body as { startKey: string }).startKey);
    expect(new Set(sentKeys)).toEqual(new Set(["stable-event-start-key-1234567890"]));
    expect(sleep).toHaveBeenNthCalledWith(1, 10);
    expect(sleep).toHaveBeenNthCalledWith(2, 20);
  });

  it("does not retry a deterministic validation failure", async () => {
    const request = vi.fn().mockRejectedValue(new Error("400: invalid_event_start"));

    await expect(
      startEventWithRecovery(seed, {
        request,
        sleep: async () => undefined,
        startKey: "stable-event-start-key-1234567890",
        retryDelaysMs: [0, 10, 20],
      }),
    ).rejects.toThrow("invalid_event_start");

    expect(request).toHaveBeenCalledTimes(1);
  });

  it("keeps the pending key through a reload-style read and clears only the completed key", () => {
    const first = getOrCreatePendingEventStartKey();
    const second = getOrCreatePendingEventStartKey();
    expect(second).toBe(first);

    clearPendingEventStartKey("a-different-key-that-must-not-clear");
    expect(getOrCreatePendingEventStartKey()).toBe(first);

    clearPendingEventStartKey(first);
    expect(getOrCreatePendingEventStartKey()).not.toBe(first);
  });
});

// Durable run/idempotency state, exercised directly.
//
// The property under test throughout: `claim()` is the one atomic write
// that makes "duplicate click" and "duplicate request to a second server
// instance" the same code path. Everything else (progress, counts,
// terminal state) exists so the client's unexpected-EOF handling and the
// UI's progress/fallback reporting have a durable source of truth to read
// instead of trusting only the one HTTP response that might have dropped.

import { describe, expect, it } from "vitest";
import { InMemoryRunStore } from "../server/aiFirst/runStore";

describe("claim()", () => {
  it("claims a fresh runId", async () => {
    const store = new InMemoryRunStore();
    const result = await store.claim({ runId: "r1", eventId: 1, ownerToken: "tok" });
    expect(result.outcome).toBe("claimed");
    expect(result.record.status).toBe("active");
    expect(result.record.terminal).toBe(false);
  });

  it("a second claim for the same runId is a duplicate, not a second row", async () => {
    const store = new InMemoryRunStore();
    await store.claim({ runId: "r1", eventId: 1, ownerToken: "tok" });
    const second = await store.claim({ runId: "r1", eventId: 1, ownerToken: "tok" });
    expect(second.outcome).toBe("duplicate");
    expect(store.all).toHaveLength(1);
  });

  it("a different runId for the SAME event while one is active is refused as active-elsewhere, not claimed", async () => {
    // This is the constraint a prior pass of this repair was missing: two
    // different run ids for one event must not both be claimable while one
    // is still active, because that is exactly what two server instances
    // racing with independently-minted run ids would produce.
    const store = new InMemoryRunStore();
    const a = await store.claim({ runId: "r1", eventId: 1, ownerToken: "tok" });
    const b = await store.claim({ runId: "r2", eventId: 1, ownerToken: "tok" });
    expect(a.outcome).toBe("claimed");
    expect(b.outcome).toBe("active-elsewhere");
    if (b.outcome === "active-elsewhere") expect(b.record.runId).toBe("r1");
    // No row was ever created for r2 — it was refused, not claimed-then-lost.
    expect(store.all).toHaveLength(1);
    expect(await store.get("r2")).toBeUndefined();
  });

  it("different runIds for the same event ARE independent once the first is terminal", async () => {
    const store = new InMemoryRunStore();
    const a = await store.claim({ runId: "r1", eventId: 1, ownerToken: "tok" });
    expect(a.outcome).toBe("claimed");
    await store.complete("r1");
    const b = await store.claim({ runId: "r2", eventId: 1, ownerToken: "tok" });
    expect(b.outcome).toBe("claimed");
    expect(store.all).toHaveLength(2);
  });

  it("different runIds for DIFFERENT events are independent even while both are active", async () => {
    const store = new InMemoryRunStore();
    const a = await store.claim({ runId: "r1", eventId: 1, ownerToken: "tok" });
    const b = await store.claim({ runId: "r2", eventId: 2, ownerToken: "tok" });
    expect(a.outcome).toBe("claimed");
    expect(b.outcome).toBe("claimed");
    expect(store.all).toHaveLength(2);
  });
});

describe("lifecycle", () => {
  it("progress, completed and fallback counts accumulate on the row", async () => {
    const store = new InMemoryRunStore();
    await store.claim({ runId: "r1", eventId: 1, ownerToken: "tok" });
    await store.updateProgress("r1", "Creating the first invitation direction…");
    await store.incrementCompleted("r1");
    await store.incrementCompleted("r1");
    await store.incrementFallback("r1");

    const row = await store.get("r1");
    expect(row?.progressMessage).toBe("Creating the first invitation direction…");
    expect(row?.completedCount).toBe(2);
    expect(row?.fallbackCount).toBe(1);
    expect(row?.terminal).toBe(false);
  });

  it("complete() sets status completed and terminal true", async () => {
    const store = new InMemoryRunStore();
    await store.claim({ runId: "r1", eventId: 1, ownerToken: "tok" });
    await store.complete("r1");
    const row = await store.get("r1");
    expect(row?.status).toBe("completed");
    expect(row?.terminal).toBe(true);
  });

  it("fail() sets status failed, records the message, and is terminal", async () => {
    const store = new InMemoryRunStore();
    await store.claim({ runId: "r1", eventId: 1, ownerToken: "tok" });
    await store.fail("r1", "concept generation failed: model unavailable");
    const row = await store.get("r1");
    expect(row?.status).toBe("failed");
    expect(row?.terminal).toBe(true);
    expect(row?.errorMessage).toContain("model unavailable");
  });

  it("a row that never reaches complete() or fail() stays non-terminal — the unexpected-EOF case", async () => {
    const store = new InMemoryRunStore();
    await store.claim({ runId: "r1", eventId: 1, ownerToken: "tok" });
    await store.updateProgress("r1", "Creating the first invitation direction…");
    // Simulates a crashed process: nothing ever calls complete()/fail().
    const row = await store.get("r1");
    expect(row?.terminal).toBe(false);
    expect(row?.status).toBe("active");
  });
});

describe("hasActiveRun", () => {
  it("is true only while a claimed run has not reached a terminal state", async () => {
    const store = new InMemoryRunStore();
    expect(await store.hasActiveRun(1)).toBe(false);
    await store.claim({ runId: "r1", eventId: 1, ownerToken: "tok" });
    expect(await store.hasActiveRun(1)).toBe(true);
    await store.complete("r1");
    expect(await store.hasActiveRun(1)).toBe(false);
  });

  it("is scoped per event", async () => {
    const store = new InMemoryRunStore();
    await store.claim({ runId: "r1", eventId: 1, ownerToken: "tok" });
    expect(await store.hasActiveRun(2)).toBe(false);
  });

  it("a failed run is not active", async () => {
    const store = new InMemoryRunStore();
    await store.claim({ runId: "r1", eventId: 1, ownerToken: "tok" });
    await store.fail("r1", "boom");
    expect(await store.hasActiveRun(1)).toBe(false);
  });
});

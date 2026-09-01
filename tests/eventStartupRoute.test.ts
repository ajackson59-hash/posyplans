import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import type { Event, InsertEvent } from "@shared/schema";

process.env.DATABASE_URL = "postgres://test/test";

const {
  createIdempotentStartedEvent,
  ownerTokenForStartKey,
  registerEventStartupRoutes,
} = await import("../server/eventStartupRoutes");

const startKey = "stable-event-start-key-1234567890";
const seed = {
  eventName: "My Celebration",
  eventType: "Birthday Party",
  eventDate: "",
  inviteSubject: "You're invited!",
  inviteMessage: "",
};

function eventFor(ownerToken: string): Event {
  return {
    id: 1,
    ownerToken,
    shareSlug: "share-slug",
    eventName: "My Celebration",
    eventType: "Birthday Party",
    eventDate: "",
    inviteStatus: "draft",
    createdAt: Date.now(),
  } as Event;
}

describe("idempotent event startup", () => {
  it("derives a stable, opaque owner token from one browser start key", () => {
    const first = ownerTokenForStartKey(startKey);
    const second = ownerTokenForStartKey(startKey);
    const different = ownerTokenForStartKey(`${startKey}-different`);

    expect(first).toBe(second);
    expect(first).toHaveLength(24);
    expect(different).not.toBe(first);
    expect(first).not.toContain(startKey);
  });

  it("recovers a replayed/lost response as the same event instead of inserting a duplicate", async () => {
    const rows = new Map<string, Event>();
    const persistence = {
      tryInsert: vi.fn(async (input: { data: InsertEvent; ownerToken: string; shareSlug: string; createdAt: number }) => {
        if (rows.has(input.ownerToken)) return undefined;
        const event = eventFor(input.ownerToken);
        rows.set(input.ownerToken, event);
        return event;
      }),
      findByOwnerToken: vi.fn(async (ownerToken: string) => rows.get(ownerToken)),
    };

    const first = await createIdempotentStartedEvent(seed, startKey, persistence);
    const replay = await createIdempotentStartedEvent(seed, startKey, persistence);

    expect(replay.ownerToken).toBe(first.ownerToken);
    expect(rows.size).toBe(1);
    expect(persistence.findByOwnerToken).toHaveBeenCalledWith(first.ownerToken);
  });
});

describe("POST /api/events/start", () => {
  it("validates the key and never calls persistence for an invalid request", async () => {
    const createEvent = vi.fn();
    const app = express();
    app.use(express.json());
    registerEventStartupRoutes(app, { createEvent });

    const response = await request(app).post("/api/events/start").send({ ...seed, startKey: "too-short" });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("invalid_event_start");
    expect(createEvent).not.toHaveBeenCalled();
  });

  it("returns the private event token after a successful idempotent start", async () => {
    const expected = eventFor(ownerTokenForStartKey(startKey));
    const createEvent = vi.fn(async () => expected);
    const app = express();
    app.use(express.json());
    registerEventStartupRoutes(app, { createEvent });

    const response = await request(app).post("/api/events/start").send({ ...seed, startKey });

    expect(response.status).toBe(200);
    expect(response.body.ownerToken).toBe(expected.ownerToken);
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(createEvent).toHaveBeenCalledWith(expect.objectContaining(seed), startKey);
  });

  it("returns a calm retryable response instead of leaking a database error", async () => {
    const createEvent = vi.fn(async () => {
      throw new Error("connection terminated unexpectedly");
    });
    const app = express();
    app.use(express.json());
    registerEventStartupRoutes(app, { createEvent });

    const response = await request(app).post("/api/events/start").send({ ...seed, startKey });

    expect(response.status).toBe(503);
    expect(response.headers["retry-after"]).toBe("1");
    expect(response.body).toEqual(
      expect.objectContaining({
        code: "event_start_unavailable",
        retryable: true,
      }),
    );
    expect(JSON.stringify(response.body)).not.toContain("connection terminated");
  });
});

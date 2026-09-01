import type { Express } from "express";
import { createHash, randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { events, insertEventSchema } from "@shared/schema";
import type { Event, InsertEvent } from "@shared/schema";
import { criticalDb } from "./criticalDb";

const startKeySchema = z
  .string()
  .min(24)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

const EVENT_START_ATTEMPTS = 3;

function randomToken(length: number): string {
  return randomBytes(length).toString("base64url").slice(0, length);
}

function databaseIdentity(): {
  host: string;
  port: string;
  projectRef: string | null;
  database: string;
} {
  try {
    const url = new URL(process.env.DATABASE_URL || "");
    const username = decodeURIComponent(url.username);
    const projectRef = username.startsWith("postgres.")
      ? username.slice("postgres.".length)
      : null;
    return {
      host: url.hostname,
      port: url.port || "default",
      projectRef,
      database: url.pathname.replace(/^\//, "") || "default",
    };
  } catch {
    return { host: "unparseable", port: "unknown", projectRef: null, database: "unknown" };
  }
}

function compact(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  return value.length > 400 ? `${value.slice(0, 400)}…` : value;
}

function databaseFailureDetails(error: unknown): Record<string, unknown> {
  const outer = error && typeof error === "object"
    ? error as Record<string, unknown>
    : {};
  const rawCause = outer.cause;
  const cause = rawCause && typeof rawCause === "object"
    ? rawCause as Record<string, unknown>
    : {};

  // Keep the database identity and Postgres cause first: Vercel truncates long
  // console lines, while Drizzle's outer message can contain the full SQL.
  return {
    database: databaseIdentity(),
    causeCode: typeof cause.code === "string" ? cause.code : null,
    causeMessage: compact(
      rawCause instanceof Error
        ? rawCause.message
        : cause.message,
    ),
    causeDetail: compact(cause.detail),
    causeHint: compact(cause.hint),
    causeColumn: typeof cause.column === "string" ? cause.column : null,
    outerName: error instanceof Error ? error.name : null,
    outerMessage: compact(error instanceof Error ? error.message : String(error)),
  };
}

/**
 * The browser keeps one start key until it has received and stored the owner
 * token. A deterministic owner token makes a retried/lost response resolve to
 * the event already inserted by the first request instead of producing a
 * second blank event.
 */
export function ownerTokenForStartKey(startKey: string): string {
  return createHash("sha256")
    .update(`posy-event-start:v1:${startKey}`)
    .digest("base64url")
    .slice(0, 24);
}

interface EventStartInsert {
  data: InsertEvent;
  ownerToken: string;
  shareSlug: string;
  createdAt: number;
}

export interface EventStartPersistence {
  tryInsert(input: EventStartInsert): Promise<Event | undefined>;
  findByOwnerToken(ownerToken: string): Promise<Event | undefined>;
}

const databasePersistence: EventStartPersistence = {
  async tryInsert(input) {
    const rows = await criticalDb
      .insert(events)
      .values({
        ...input.data,
        inviteStatus: "draft",
        ownerToken: input.ownerToken,
        shareSlug: input.shareSlug,
        createdAt: input.createdAt,
      })
      // Handles either a concurrent replay of the same owner token or the
      // extremely unlikely random share-slug collision without throwing.
      .onConflictDoNothing()
      .returning();
    return rows[0];
  },

  async findByOwnerToken(ownerToken) {
    const rows = await criticalDb.select().from(events).where(eq(events.ownerToken, ownerToken));
    return rows[0];
  },
};

export async function createIdempotentStartedEvent(
  data: InsertEvent,
  startKey: string,
  persistence: EventStartPersistence = databasePersistence,
): Promise<Event> {
  const ownerToken = ownerTokenForStartKey(startKey);
  const createdAt = Date.now();

  for (let attempt = 0; attempt < EVENT_START_ATTEMPTS; attempt += 1) {
    const inserted = await persistence.tryInsert({
      data,
      ownerToken,
      shareSlug: randomToken(10),
      createdAt,
    });
    if (inserted) return inserted;

    // If the first response was lost (or another identical request won the
    // insert race), the unique owner token is now the recovery lookup key.
    const existing = await persistence.findByOwnerToken(ownerToken);
    if (existing) return existing;
  }

  throw new Error("event_start_conflict");
}

export interface EventStartupRouteDependencies {
  createEvent?: (data: InsertEvent, startKey: string) => Promise<Event>;
}

export function registerEventStartupRoutes(
  app: Express,
  dependencies: EventStartupRouteDependencies = {},
): void {
  const createEvent = dependencies.createEvent ?? createIdempotentStartedEvent;

  app.post("/api/events/start", async (req, res) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const parsedStartKey = startKeySchema.safeParse((body as Record<string, unknown>).startKey);
    if (!parsedStartKey.success) {
      return res.status(400).json({
        error: "Posy couldn't verify this event start. Please reload and try again.",
        code: "invalid_event_start",
      });
    }

    // insertEventSchema strips the trusted startKey before anything reaches
    // the events table, while preserving the same validation contract as the
    // existing POST /api/events route.
    const parsedEvent = insertEventSchema.safeParse(body);
    if (!parsedEvent.success) {
      return res.status(400).json({
        error: "Check the event details and try again.",
        code: "invalid_event_details",
      });
    }

    try {
      const event = await createEvent(parsedEvent.data, parsedStartKey.data);
      res.setHeader("Cache-Control", "no-store");
      return res.json(event);
    } catch (error) {
      // Keep the customer response calm and secret-free, but emit only the
      // concise database cause in private runtime logs. Logging the full
      // Drizzle error prints an enormous SQL statement and can hide the one
      // actionable Postgres code/message behind log truncation.
      console.error(`[event-start] ${JSON.stringify(databaseFailureDetails(error))}`);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Retry-After", "1");
      return res.status(503).json({
        error: "Posy couldn't secure your event yet. Your answers are still safe — please try again.",
        code: "event_start_unavailable",
        retryable: true,
      });
    }
  });
}

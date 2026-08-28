import { desc, eq } from "drizzle-orm";
import { events } from "@shared/schema";
import type { Event } from "@shared/schema";
import { criticalDb } from "./criticalDb";

/**
 * The recovery email needs only enough information to name an event and build
 * its private dashboard link. Never select the complete events row here:
 * invitation artwork and pre-payment previews are stored as multi-megabyte
 * data URLs on some existing records, and loading those blobs made a simple
 * Find My Event request compete with the rest of the app for memory and
 * database time.
 */
export type RecoveryEventRecord = Pick<
  Event,
  "ownerToken" | "eventName" | "eventType" | "eventDate"
>;

export async function getRecoveryEventsByEmail(email: string): Promise<RecoveryEventRecord[]> {
  const normalized = email.trim().toLowerCase();

  return criticalDb
    .select({
      ownerToken: events.ownerToken,
      eventName: events.eventName,
      eventType: events.eventType,
      eventDate: events.eventDate,
    })
    .from(events)
    .where(eq(events.capturedEmail, normalized))
    .orderBy(desc(events.createdAt))
    .limit(20);
}

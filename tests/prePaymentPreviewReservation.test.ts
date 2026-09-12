import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { Event } from "@shared/schema";
import { previewCompletionCondition, previewReservationCondition } from "../server/prePaymentPreviewReservation";

describe("durable preview reservation SQL", () => {
  it("completes only the exact reserved job and unchanged event brief", () => {
    const query = new PgDialect().sqlToQuery(previewCompletionCondition({
      id: 10, ownerToken: "private-owner", prePaymentPreviewAttempts: 2,
      prePaymentPreviewUrl: "", prePaymentPreviewUsedAt: 123456,
      eventName: "Current name", vibeDescription: "Current full brief", estimatedGuestCount: 12,
    } as Event)!);
    for (const column of ["id", "owner_token", "pre_payment_preview_attempts", "pre_payment_preview_url",
      "pre_payment_preview_used_at", "event_name", "vibe_description", "theme_name", "palette_colors", "estimated_guest_count"]) {
      expect(query.sql).toContain(`"events"."${column}" =`);
    }
    expect(query.params).toEqual([10, "private-owner", 2, "", 123456, "Current name", "", "", "", "Current full brief", "", "", "", 12]);
    // Completing an already-reserved image may happen after checkout. This
    // does not grant payment access and must not start another reservation.
    expect(query.sql).not.toContain("spark_unlocked_at");
  });

  it.each([null, 123456])("guards the exact owner, budget and asset snapshot (startedAt=%s)", (usedAt) => {
    const condition = previewReservationCondition({ id: 10, ownerToken: "private-owner", sparkUnlockedAt: null,
      prePaymentPreviewAttempts: 1, prePaymentPreviewUrl: "previous-asset",
      prePaymentPreviewUsedAt: usedAt } as Event);
    const query = new PgDialect().sqlToQuery(condition!);
    expect(query.sql).toContain('"events"."spark_unlocked_at" is null');
    expect(query.sql).toContain('"events"."pre_payment_preview_attempts" <');
    expect(query.sql).toContain('"events"."pre_payment_preview_attempts" =');
    expect(query.sql).toContain('"events"."pre_payment_preview_url" =');
    expect(query.sql).toContain('"events"."pre_payment_preview_used_at"');
    expect(query.params).toEqual([10, "private-owner", 3, 1, "previous-asset", ...(usedAt === null ? [] : [usedAt])]);
  });
});

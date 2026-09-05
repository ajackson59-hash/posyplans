import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { Event } from "@shared/schema";
import { previewReservationCondition } from "../server/prePaymentPreviewReservation";

describe("durable preview reservation SQL", () => {
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

import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import type { Event } from "@shared/schema";
import { PREPAYMENT_PREVIEW_QUALITY_LOCK_CUTOFF_MS } from "../server/prePaymentPreviewQuality";
import { REFERENCE_BOARD_DATA_URL_PREFIX } from "../server/prePaymentReferenceBoard";

process.env.DATABASE_URL = "postgres://test/test";

const mocks = vi.hoisted(() => ({
  getEventByOwnerToken: vi.fn(),
  updateEventById: vi.fn(),
  getEntitlementSummary: vi.fn(),
}));

vi.mock("../server/storage", () => ({
  storage: {
    getEventByOwnerToken: mocks.getEventByOwnerToken,
    updateEventById: mocks.updateEventById,
  },
}));

vi.mock("../server/masterPlannerEntitlement", () => ({
  getEntitlementSummary: mocks.getEntitlementSummary,
  canGenerateDraft: vi.fn(async () => ({ ok: false, reason: "needs_payment" })),
}));

const { registerInitialPreviewRoute } = await import("../server/initialPreviewRoute");

const OWNER = "owner-approved-preview";
const EVENT_ID = 812;
const APPROVED_URL = `data:image/png;posy-quality-approved;base64,${Buffer.from("approved pixels").toString("base64")}`;

function eventWith(prePaymentPreviewUrl: string): Event {
  return {
    id: EVENT_ID,
    ownerToken: OWNER,
    prePaymentPreviewUrl,
    prePaymentPreviewUsedAt: PREPAYMENT_PREVIEW_QUALITY_LOCK_CUTOFF_MS + 1,
    prePaymentPreviewAttempts: 1,
  } as unknown as Event;
}

function makeApp() {
  const app = express();
  app.use(express.json());
  registerInitialPreviewRoute(app);
  return app;
}

beforeEach(() => {
  mocks.getEventByOwnerToken.mockReset();
  mocks.updateEventById.mockReset();
  mocks.getEntitlementSummary.mockReset();
  mocks.getEntitlementSummary.mockResolvedValue({ canGenerate: true });
});

describe("POST /invite/use-prepayment-preview", () => {
  it("reuses only a current quality-approved image for an unlocked host", async () => {
    const event = eventWith(APPROVED_URL);
    mocks.getEventByOwnerToken.mockResolvedValue(event);
    mocks.updateEventById.mockResolvedValue({
      ...event,
      inviteIllustrationUrl: APPROVED_URL,
      inviteArtworkUrl: APPROVED_URL,
    });

    const response = await request(makeApp())
      .post(`/api/events/owner/${OWNER}/invite/use-prepayment-preview`)
      .send({});

    expect(response.status).toBe(200);
    expect(response.body.reusedExistingArtwork).toBe(true);
    expect(mocks.updateEventById).toHaveBeenCalledWith(EVENT_ID, {
      inviteIllustrationUrl: APPROVED_URL,
      inviteArtworkUrl: APPROVED_URL,
    });
  });

  it.each([
    ["direction card", `data:image/svg+xml;base64,${Buffer.from("<svg />").toString("base64")}`],
    ["reference board", `${REFERENCE_BOARD_DATA_URL_PREFIX}${Buffer.from("<svg />").toString("base64")}`],
    ["unapproved PNG", `data:image/png;base64,${Buffer.from("raw pixels").toString("base64")}`],
  ])("rejects a %s instead of promoting it to invitation artwork", async (_label, previewUrl) => {
    mocks.getEventByOwnerToken.mockResolvedValue(eventWith(previewUrl));

    const response = await request(makeApp())
      .post(`/api/events/owner/${OWNER}/invite/use-prepayment-preview`)
      .send({});

    expect(response.status).toBe(409);
    expect(response.body.error).toContain("approved image preview");
    expect(mocks.getEntitlementSummary).not.toHaveBeenCalled();
    expect(mocks.updateEventById).not.toHaveBeenCalled();
  });

  it("still requires an unlocked entitlement for approved artwork", async () => {
    mocks.getEventByOwnerToken.mockResolvedValue(eventWith(APPROVED_URL));
    mocks.getEntitlementSummary.mockResolvedValue({ canGenerate: false });

    const response = await request(makeApp())
      .post(`/api/events/owner/${OWNER}/invite/use-prepayment-preview`)
      .send({});

    expect(response.status).toBe(402);
    expect(mocks.updateEventById).not.toHaveBeenCalled();
  });
});

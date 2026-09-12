// @vitest-environment node
import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { Event } from "@shared/schema";
import { InMemoryArtworkAttemptStore } from "../server/aiFirst/artworkAttemptStore";
import { encodePng } from "../server/aiFirst/png";
import { MEDIUM_FEASIBILITY_CASES } from "../server/aiFirst/mediumFeasibilityCases";
import { buildQualityLockedPreviewBrief, customerVisiblePreviewBytes } from "../server/prePaymentPreviewQuality";
import { ORIGINAL_CONTROL_REVIEW, reviewRetainedCustomerArtwork } from "../server/customerArtworkRetainedReview";

const environment = { VERCEL_ENV: "preview", VERCEL_GIT_COMMIT_REF: "codex/launch-blockers" };
async function fixture() {
  const event = { id: 53, ownerToken: "private-fixture", eventName: "Artwork evaluation", eventType: "Artwork evaluation",
    inviteStatus: "draft", themeName: "", paletteColors: "[]", vibeDescription: MEDIUM_FEASIBILITY_CASES[4].hostBrief } as Event;
  const { concept } = await buildQualityLockedPreviewBrief(event, "", null);
  const rgb = new Uint8Array(768 * 1376 * 3);
  for (let y = 0; y < 1376; y++) for (let x = 0; x < 768; x++) {
    const i = (y * 768 + x) * 3; rgb[i] = 40 + x / 5; rgb[i + 1] = 40 + y / 8; rgb[i + 2] = 90;
  }
  const bytes = encodePng({ width: 768, height: 1376, rgb });
  const store = new InMemoryArtworkAttemptStore();
  const source = await store.record({ eventId: event.id, ownerToken: event.ownerToken, bytes, concept,
    directionIndex: 4, attempt: 1, status: "rejected", model: ORIGINAL_CONTROL_REVIEW.model,
    quality: "medium", size: "768x1376", failureCodes: ["dimensions"], tier1Findings: [], visionScores: null, costUsdMicros: 67200 });
  const registration = { ...ORIGINAL_CONTROL_REVIEW, attemptId: source.id, sourceHash: createHash("sha256").update(bytes).digest("hex") };
  return { event, store, registration, bytes };
}

it("rejects Production, other owners, source drift and changed briefs before review", async () => {
  const { event, store, registration } = await fixture(); const review = vi.fn();
  for (const [input, env, reg] of [
    [event, { ...environment, VERCEL_ENV: "production" }, registration],
    [{ ...event, ownerToken: "different-owner" }, environment, registration],
    [{ ...event, vibeDescription: "changed" }, environment, registration],
    [event, environment, { ...registration, sourceHash: "0".repeat(64) }],
  ] as const) {
    expect((await reviewRetainedCustomerArtwork(input, store, reg, env, review)).kind).toBe("blocked");
  }
  expect(review).not.toHaveBeenCalled(); expect(store.all).toHaveLength(1);
});

it.each([true, false])("reviews unchanged retained pixels once, persists the verdict and never regenerates (passed=%s)", async passed => {
  const { event, store, registration, bytes } = await fixture();
  const review = vi.fn(async () => ({ passed, unavailable: false, scores: { textLogoWatermarkFree: 5, artifactFree: 5,
    premiumFinish: 5, briefFidelity: 5, compositionQuality: 5, ageAppropriate: 5 }, requiredPresent: [], excludedFound: [],
    failureCodes: [], notes: "Offline test verdict", durationMs: 1, requestCount: 1, usage: { inputTokens: 10, outputTokens: 10 } }));
  const result = await reviewRetainedCustomerArtwork(event, store, registration, environment, review);
  expect(result.kind).toBe(passed ? "approved-image" : "rejected");
  const request = (review.mock.calls[0] as any)[0];
  expect(request.bytes.equals(customerVisiblePreviewBytes(bytes))).toBe(true);
  expect(request.brief.vibe).toBe(event.vibeDescription);
  expect(request.reviewMode).toBe("teaser"); expect(request.maxFormatRepairs).toBe(0);
  expect(store.all.at(-1)?.reviewEvidence?.customerEvaluation).toMatchObject({ imageRequests: 0, criticRequests: 1, stage: "completed" });
  expect((await reviewRetainedCustomerArtwork(event, store, registration, environment, review)).kind).toBe("blocked");
  expect(review).toHaveBeenCalledTimes(1);
});

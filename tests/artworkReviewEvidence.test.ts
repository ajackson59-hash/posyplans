import { describe, expect, it } from "vitest";
import { encodeAttemptVision, decodeAttemptVision, type ArtworkReviewEvidence } from "../server/aiFirst/artworkAttemptStore";

const scores = { textLogoWatermarkFree: 5, artifactFree: 4, premiumFinish: 4,
  briefFidelity: 5, compositionQuality: 5, ageAppropriate: 5 };

describe("durable artwork review evidence", () => {
  it("reads legacy score-only rows without changing their scores", () => {
    expect(decodeAttemptVision(JSON.stringify(scores))).toEqual({ visionScores: scores, reviewEvidence: null });
    expect(decodeAttemptVision(null)).toEqual({ visionScores: null, reviewEvidence: null });
  });
  it("round trips the full verdict, usage, exact-pixel hash and generation timing", () => {
    const reviewEvidence: ArtworkReviewEvidence = { version: 1, reviewedAssetHash: "exact-teaser-sha256", generationDurationMs: 42000,
      verdict: { scores, requiredPresent: [{ requirement: "orange glasses", present: true, evidence: "On the left figure's face" }],
        excludedFound: [], notes: "Local hand artifact in the foreground", passed: false, failureCodes: ["artifact"],
        unavailable: false, durationMs: 9000, usage: { inputTokens: 1900, outputTokens: 600 } } };
    expect(decodeAttemptVision(encodeAttemptVision(scores, reviewEvidence))).toEqual({ visionScores: scores, reviewEvidence });
  });
  it("retains a preparation failure without inventing a reviewed image or scores", () => {
    const reviewEvidence: ArtworkReviewEvidence = { version: 1, reviewedAssetHash: null, generationDurationMs: 42000,
      verdict: null, reviewError: "PNG could not be decoded" };
    expect(decodeAttemptVision(encodeAttemptVision(null, reviewEvidence))).toEqual({ visionScores: null, reviewEvidence });
  });
});

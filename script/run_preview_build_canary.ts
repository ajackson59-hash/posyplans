import Anthropic from "@anthropic-ai/sdk";
import { DbArtworkAttemptStore } from "../server/aiFirst/dbStore";
import { storage } from "../server/storage";

const environment = process.env.VERCEL_ENV || "local";
const branch = process.env.VERCEL_GIT_COMMIT_REF || "unknown";
const ownerToken = "qa-preview-brian-binding-lock-20260901-c4";
const attemptId = "98";

if (environment !== "preview" || branch !== "codex/launch-blockers") {
  console.log(`[build-preview-final-brian-audit] ${JSON.stringify({ skipped: true, environment, branch })}`);
  process.exit(0);
}

try {
  const event = await storage.getEventByOwnerToken(ownerToken);
  if (!event) throw new Error("Brian QA event not found");
  const store = new DbArtworkAttemptStore();
  const attempt = await store.findById(event.id, ownerToken, attemptId);
  if (!attempt || attempt.status !== "accepted") throw new Error("Accepted Brian artwork attempt not found");
  const bytes = Buffer.from(attempt.assetBytesBase64, "base64");

  console.log(`[build-preview-final-brian-evidence] ${JSON.stringify({
    attemptId: attempt.id,
    model: attempt.model,
    quality: attempt.quality,
    assetHash: attempt.assetHash,
    failureCodes: attempt.failureCodes,
    visionScores: attempt.visionScores,
  })}`);

  if (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== "test") {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1800,
      system:
        "You are a demanding senior art director for a premium children's celebration product. Audit exact final pre-purchase teaser pixels. The standard is conversion-worthy: named identity must be recognizable at a glance, the scene must feel bespoke rather than a generic franchise promo, and remaining AI artifacts must not meaningfully undermine purchase desire. Return strict JSON only.",
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: bytes.toString("base64") } },
          {
            type: "text",
            text: `Brian's fourth-birthday Blippi + Meekah first look. Required creative world: unmistakable Blippi and Meekah together; upscale indoor soft-play center; bright foam climbing structures; ball pit; floating bubbles; colorful ice-cream treats; no invented central celebrant; no birthday candles/numeral/countable age markers because the exact age is carried in surrounding UI; premium, dimensional, joyful finish. Return exactly {"visualDescription":"","blippiRecognition":"low|medium|high","meekahRecognition":"low|medium|high","namedWorldOverall":"low|medium|high","requestedPresent":[],"requestedMissing":[],"prohibitedFound":[],"syntheticAICues":[],"premiumStrengths":[],"genericPromoFeel":false,"wouldCreatePurchaseDesire":false,"purchaseDesireReason":"","launchVerdict":"pass|borderline|fail","singleHighestLeverageImprovement":""}.`,
          },
        ],
      }],
    });
    const audit = response.content.map((block) => block.type === "text" ? block.text : "").join("").trim();
    console.log(`[build-preview-final-brian-art-director] ${audit}`);
  }
} catch (error) {
  console.error(`[build-preview-final-brian-audit] ${JSON.stringify({
    status: 500,
    error: error instanceof Error ? error.message : String(error),
  })}`);
} finally {
  process.exit(0);
}

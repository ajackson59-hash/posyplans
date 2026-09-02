import Anthropic from "@anthropic-ai/sdk";
import { DbArtworkAttemptStore } from "../server/aiFirst/dbStore";
import { storage } from "../server/storage";

const environment = process.env.VERCEL_ENV || "local";
const branch = process.env.VERCEL_GIT_COMMIT_REF || "unknown";
const ownerToken = "qa-preview-brian-binding-lock-20260901-c4";
const attemptId = "96";

if (environment !== "preview" || branch !== "codex/launch-blockers") {
  console.log(`[build-preview-accepted-pixel-audit] ${JSON.stringify({ skipped: true, environment, branch })}`);
  process.exit(0);
}

try {
  const event = await storage.getEventByOwnerToken(ownerToken);
  if (!event) throw new Error("Accepted QA event not found");
  const store = new DbArtworkAttemptStore();
  const attempt = await store.findById(event.id, ownerToken, attemptId);
  if (!attempt || attempt.status !== "accepted") throw new Error("Accepted QA artwork attempt not found");

  const bytes = Buffer.from(attempt.assetBytesBase64, "base64");
  console.log(`[build-preview-accepted-pixel-evidence] ${JSON.stringify({
    attemptId: attempt.id,
    status: attempt.status,
    model: attempt.model,
    quality: attempt.quality,
    size: attempt.size,
    assetHash: attempt.assetHash,
    bytes: bytes.length,
    failureCodes: attempt.failureCodes,
    visionScores: attempt.visionScores,
  })}`);

  if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === "test") {
    console.log(`[build-preview-accepted-art-director] ${JSON.stringify({ skipped: true, reason: "critic key unavailable" })}`);
  } else {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1600,
      system:
        "You are a demanding senior art director for a premium children's celebration brand. Inspect only the exact supplied customer teaser pixels. Judge whether a parent would feel that the service understood the requested named creative world and whether the image itself creates enough desire to continue toward purchase. Be strict about recognizable identity, synthetic AI cues, generic character-promo composition, material finish, and event personalization. Do not recommend weakening the gate. Return strict JSON only.",
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: bytes.toString("base64"),
            },
          },
          {
            type: "text",
            text: `Brian's fourth birthday first look. Required: recognizable Blippi + Meekah together; upscale indoor soft-play center; bright foam climbing structures; ball pit; floating bubbles; colorful ice-cream treats; natural non-text age-four cue; no invented portrait/appearance for Brian; polished dimensional premium finish. The production gate passed with text/logo 5, artifact 4, premium 4, brief fidelity 4, composition 4, age 5. Return exactly {"visualDescription":"","recognition":{"blippi":"low|medium|high","meekah":"low|medium|high","namedWorldOverall":"low|medium|high"},"requestedPresent":[],"requestedMissing":[],"syntheticAICues":[],"premiumStrengths":[],"remainingDefects":[],"feelsLikeGenericPromo":false,"inventedCelebrantAppearance":false,"wouldCreatePurchaseDesire":false,"purchaseDesireReason":"","launchVerdict":"pass|borderline|fail","singleHighestLeverageImprovement":""}.`,
          },
        ],
      }],
    });
    const audit = response.content
      .map((block) => block.type === "text" ? block.text : "")
      .join("")
      .trim();
    console.log(`[build-preview-accepted-art-director] ${audit}`);
  }
} catch (error) {
  console.error(`[build-preview-accepted-pixel-audit] ${JSON.stringify({
    status: 500,
    error: error instanceof Error ? error.message : String(error),
  })}`);
} finally {
  process.exit(0);
}

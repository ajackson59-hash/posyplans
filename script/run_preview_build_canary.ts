import Anthropic from "@anthropic-ai/sdk";
import { DbArtworkAttemptStore } from "../server/aiFirst/dbStore";
import { storage } from "../server/storage";

const environment = process.env.VERCEL_ENV || "local";
const branch = process.env.VERCEL_GIT_COMMIT_REF || "unknown";
const ownerToken = "qa-preview-brian-binding-lock-20260901-c4";
const attemptId = "97";

if (environment !== "preview" || branch !== "codex/launch-blockers") {
  console.log(`[build-preview-strict-pixel-audit] ${JSON.stringify({ skipped: true, environment, branch })}`);
  process.exit(0);
}

try {
  const event = await storage.getEventByOwnerToken(ownerToken);
  if (!event) throw new Error("Strict QA event not found");
  const store = new DbArtworkAttemptStore();
  const attempt = await store.findById(event.id, ownerToken, attemptId);
  if (!attempt || attempt.status !== "rejected") throw new Error("Strict rejected artwork attempt not found");
  const bytes = Buffer.from(attempt.assetBytesBase64, "base64");

  console.log(`[build-preview-strict-pixel-evidence] ${JSON.stringify({
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
        "You are a forensic senior art director auditing exact final teaser pixels that Posy's strict gate rejected. Identify each requested visual fact as present or absent; exact counts are literal and named people must be recognizable beyond generic color coding. Also judge purchase desire and premium finish. Return strict JSON only.",
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: bytes.toString("base64") } },
          {
            type: "text",
            text: `Audit Brian's fourth-birthday Blippi + Meekah teaser. Check each binary requirement independently: (1) Blippi is unmistakably recognizable through blue/orange play-and-learn outfit, orange glasses and orange bow tie; (2) Meekah is unmistakably recognizable through natural curly hair and recognizable purple play-and-learn wardrobe with warm orange/yellow accents—not a generic second adult; (3) both are central together and interact with the party; (4) upscale indoor soft-play setting; (5) bright foam climbing structures, ball pit, floating bubbles, colorful ice-cream treats; (6) exactly four separate unnumbered birthday candles or another unmistakable physical count of exactly four; (7) no central unidentified child posed as the implied celebrant; (8) no invented portrait/appearance for Brian. Return exactly {"visualDescription":"","requirements":[{"id":1,"present":false,"evidence":""},{"id":2,"present":false,"evidence":""},{"id":3,"present":false,"evidence":""},{"id":4,"present":false,"evidence":""},{"id":5,"present":false,"evidence":""},{"id":6,"present":false,"evidence":""},{"id":7,"present":false,"evidence":""},{"id":8,"present":false,"evidence":""}],"blippiRecognition":"low|medium|high","meekahRecognition":"low|medium|high","premiumFinish":"low|medium|high","genericPromoFeel":false,"syntheticAICues":[],"wouldCreatePurchaseDesire":false,"purchaseDesireReason":"","singleHighestLeverageGeneratorFix":""}. For requirements 7 and 8, present=true means the prohibited thing is absent/safely satisfied.`,
          },
        ],
      }],
    });
    const audit = response.content.map((block) => block.type === "text" ? block.text : "").join("").trim();
    console.log(`[build-preview-strict-art-director] ${audit}`);
  }
} catch (error) {
  console.error(`[build-preview-strict-pixel-audit] ${JSON.stringify({
    status: 500,
    error: error instanceof Error ? error.message : String(error),
  })}`);
} finally {
  process.exit(0);
}

import Anthropic from "@anthropic-ai/sdk";
import { DbArtworkAttemptStore } from "../server/aiFirst/dbStore";
import { storage } from "../server/storage";

const environment = process.env.VERCEL_ENV || "local";
const branch = process.env.VERCEL_GIT_COMMIT_REF || "unknown";
const ownerToken = "qa-preview-brian-binding-lock-20260901-c4";
const attemptId = "99";

if (environment !== "preview" || branch !== "codex/launch-blockers") {
  console.log(`[build-preview-variance-audit] ${JSON.stringify({ skipped: true, environment, branch })}`);
  process.exit(0);
}

try {
  const event = await storage.getEventByOwnerToken(ownerToken);
  if (!event) throw new Error("Brian QA event not found");
  const store = new DbArtworkAttemptStore();
  const attempt = await store.findById(event.id, ownerToken, attemptId);
  if (!attempt || attempt.status !== "rejected") throw new Error("Rejected Brian variance attempt not found");
  const bytes = Buffer.from(attempt.assetBytesBase64, "base64");

  console.log(`[build-preview-variance-evidence] ${JSON.stringify({
    attemptId: attempt.id,
    assetHash: attempt.assetHash,
    failureCodes: attempt.failureCodes,
    visionScores: attempt.visionScores,
  })}`);

  if (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== "test") {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1500,
      system: "You are a forensic senior art director. Audit the exact rejected teaser pixels and identify the concrete causes of artifact, premium-finish and excluded-content failure. Return strict JSON only.",
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: "image/png", data: bytes.toString("base64") } },
        { type: "text", text: `Brian's Blippi + Meekah party. Required: high-recognition Blippi and Meekah, indoor soft play, foam climbing, ball pit, bubbles, colorful ice cream. Prohibited: any child in the foreground or central hero plane; birthday candles, numerals or countable age markers; text/logos; pasted cutout/promo composition. Return exactly {"visualDescription":"","excludedFound":[],"artifactDefects":[],"premiumDefects":[],"blippiRecognition":"low|medium|high","meekahRecognition":"low|medium|high","wouldCreatePurchaseDesire":false,"singleHighestLeverageReliabilityLesson":""}.` },
      ] }],
    });
    console.log(`[build-preview-variance-art-director] ${response.content.map((b) => b.type === "text" ? b.text : "").join("").trim()}`);
  }
} catch (error) {
  console.error(`[build-preview-variance-audit] ${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}`);
} finally {
  process.exit(0);
}

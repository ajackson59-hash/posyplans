import Anthropic from "@anthropic-ai/sdk";
import { DbArtworkAttemptStore } from "../server/aiFirst/dbStore";
import { storage } from "../server/storage";

const environment = process.env.VERCEL_ENV || "local";
const branch = process.env.VERCEL_GIT_COMMIT_REF || "unknown";
const ownerToken = "qa-preview-brian-premium-lock-20260901-c3";
const attemptId = "92";

if (environment !== "preview" || branch !== "codex/launch-blockers") {
  console.log(`[build-preview-pixel-inspection] ${JSON.stringify({ skipped: true, environment, branch })}`);
  process.exit(0);
}

try {
  const event = await storage.getEventByOwnerToken(ownerToken);
  if (!event) throw new Error("Retained QA event not found");
  const store = new DbArtworkAttemptStore();
  const attempt = await store.findById(event.id, ownerToken, attemptId);
  if (!attempt) throw new Error("Retained QA artwork attempt not found");

  const bytes = Buffer.from(attempt.assetBytesBase64, "base64");
  console.log(`[build-preview-pixel-evidence] ${JSON.stringify({
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
    console.log(`[build-preview-art-director] ${JSON.stringify({ skipped: true, reason: "critic key unavailable" })}`);
  } else {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1600,
      system:
        "You are a demanding senior art director for a premium children's celebration brand. Inspect only the exact supplied teaser pixels. Diagnose the actionable visual reasons for any score below 4, and identify any requested detail that is missing or any forbidden design surface/artifact that appears. Return strict JSON only.",
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
            text: `Brian's fourth birthday first look. Required visual world: recognizable Blippi + Meekah together, upscale indoor soft-play center, foam climbing structures, ball pit, floating bubbles, colorful ice-cream treats, a natural fourth-birthday cue, polished dimensional premium finish. Forbidden: words/logos, blank cards/panels/signs/frames, collage/merchandise-promo layout, pasted cutout look. Automated scores: text/logo 5, artifact 4, premium 3, brief fidelity 3, composition 4, age 5; failure codes premium-feel, brief-fidelity, excluded-present. Return exactly {"visualDescription":"","recognition":{"blippi":"","meekah":"","setting":""},"requestedPresent":[],"requestedMissing":[],"forbiddenVisible":[],"premiumDefects":[],"compositionDefects":[],"syntheticAICues":[],"singleHighestLeverageRepair":"","secondHighestLeverageRepair":"","wouldCreatePurchaseDesire":false,"reason":""}.`,
          },
        ],
      }],
    });
    const audit = response.content
      .map((block) => block.type === "text" ? block.text : "")
      .join("")
      .trim();
    console.log(`[build-preview-art-director] ${audit}`);
  }
} catch (error) {
  console.error(`[build-preview-pixel-inspection] ${JSON.stringify({
    status: 500,
    error: error instanceof Error ? error.message : String(error),
  })}`);
} finally {
  process.exit(0);
}

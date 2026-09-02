import Anthropic from "@anthropic-ai/sdk";
import { DbArtworkAttemptStore } from "../server/aiFirst/dbStore";
import { storage } from "../server/storage";

const environment = process.env.VERCEL_ENV || "local";
const branch = process.env.VERCEL_GIT_COMMIT_REF || "unknown";
const ownerToken = "qa-preview-brian-binding-lock-20260901-c4";
const attemptIds = ["100", "101"];

if (environment !== "preview" || branch !== "codex/launch-blockers") {
  console.log(`[build-preview-best-of-two-audit] ${JSON.stringify({ skipped: true, environment, branch })}`);
  process.exit(0);
}

try {
  const event = await storage.getEventByOwnerToken(ownerToken);
  if (!event) throw new Error("Brian QA event not found");
  const store = new DbArtworkAttemptStore();
  const attempts = await Promise.all(attemptIds.map((id) => store.findById(event.id, ownerToken, id)));
  if (attempts.some((attempt) => !attempt)) throw new Error("One or more best-of-two attempts were not found");

  if (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== "test") {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    for (const attempt of attempts) {
      if (!attempt) continue;
      const bytes = Buffer.from(attempt.assetBytesBase64, "base64");
      const response = await client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1400,
        system: "You are a forensic senior art director. Audit one exact rejected pre-purchase teaser image. Identify the actual excluded content and concrete premium/artifact defects; do not infer exclusions that are not visibly present. Return strict JSON only.",
        messages: [{ role: "user", content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: bytes.toString("base64") } },
          { type: "text", text: `Brian's Blippi + Meekah party. Required: recognizable Blippi and Meekah, indoor soft play, foam climbing, ball pit, bubbles, colorful ice cream. Prohibited: any child in the foreground or central hero plane; birthday candles, numerals or countable age markers; generated text/logos; collage/pasted cutout/promo/card surfaces. Return exactly {"attemptId":"${attempt.id}","visualDescription":"","excludedFound":[],"artifactDefects":[],"premiumDefects":[],"blippiRecognition":"low|medium|high","meekahRecognition":"low|medium|high","wouldCreatePurchaseDesire":false,"bestGeneratorFix":""}.` },
        ] }],
      });
      console.log(`[build-preview-best-of-two-art-director] ${response.content.map((b) => b.type === "text" ? b.text : "").join("").trim()}`);
    }
  }
} catch (error) {
  console.error(`[build-preview-best-of-two-audit] ${JSON.stringify({ error: error instanceof Error ? error.message : String(error) })}`);
} finally {
  process.exit(0);
}

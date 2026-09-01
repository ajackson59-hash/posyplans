import Anthropic from "@anthropic-ai/sdk";
import { DbArtworkAttemptStore } from "../server/aiFirst/dbStore";
import { boxDownsampleRgb, decodePng, encodePng } from "../server/aiFirst/png";
import { runInternalPreviewCanary } from "../server/emailDiagnosticRoutes";
import { storage } from "../server/storage";

const environment = process.env.VERCEL_ENV || "local";
const branch = process.env.VERCEL_GIT_COMMIT_REF || "unknown";
const ownerToken = "qa-preview-blippi-20260901-a7f3c9";

if (environment !== "preview" || branch !== "codex/launch-blockers") {
  console.log(`[build-preview-canary] ${JSON.stringify({ skipped: true, environment, branch })}`);
  process.exit(0);
}

try {
  const result = await runInternalPreviewCanary();
  console.log(`[build-preview-canary] ${JSON.stringify(result)}`);

  const event = await storage.getEventByOwnerToken(ownerToken);
  if (!event) throw new Error("Internal canary event was not found after the run");

  const attemptStore = new DbArtworkAttemptStore();
  const attempts = await attemptStore.listForOwner(event.id, event.ownerToken);
  const latest = attempts.at(-1);
  if (!latest) {
    console.log(`[build-preview-inspection] ${JSON.stringify({ skipped: true, reason: "no retained artwork candidate" })}`);
    process.exit(0);
  }

  const candidateBytes = Buffer.from(latest.assetBytesBase64, "base64");
  const thumbnailBytes = encodePng(boxDownsampleRgb(decodePng(candidateBytes), 240));
  const thumbnailBase64 = thumbnailBytes.toString("base64");
  const chunkSize = 3200;
  const chunkCount = Math.ceil(thumbnailBase64.length / chunkSize);
  console.log(`[build-preview-thumbnail-meta] ${JSON.stringify({
    attemptId: latest.id,
    status: latest.status,
    assetHash: latest.assetHash,
    sourceBytes: candidateBytes.length,
    thumbnailBytes: thumbnailBytes.length,
    chunkCount,
  })}`);
  for (let index = 0; index < chunkCount; index += 1) {
    const chunk = thumbnailBase64.slice(index * chunkSize, (index + 1) * chunkSize);
    console.log(`[build-preview-thumbnail ${index + 1}/${chunkCount}] ${chunk}`);
  }

  if (process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY !== "test") {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 900,
      system: "You are a demanding senior art director for a premium invitation studio. Analyze the exact supplied customer-facing teaser image. Be concrete and visual, not generic. Return strict JSON only.",
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: candidateBytes.toString("base64"),
            },
          },
          {
            type: "text",
            text: `This teaser is for a four-year-old's Blippi + Meekah party at an indoor soft-play center, with bubbles, foam climbing structures, a ball pit and colorful ice-cream treats. Explain precisely why this image may have received premiumFinish 3/5 while its theme fidelity and composition scored 4/5. Return: {"visualDescription":"","strongestElements":[],"specificDefects":[],"premiumFinishGaps":[],"themeFidelityGaps":[],"compositionGaps":[],"singleHighestLeveragePromptRepair":"","customerWorthShowing":true}.`,
          },
        ],
      }],
    });
    const auditText = response.content
      .map((block) => block.type === "text" ? block.text : "")
      .join("");
    console.log(`[build-preview-art-director] ${auditText}`);
  }
} catch (error) {
  console.error(`[build-preview-canary] ${JSON.stringify({
    status: 500,
    body: {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    },
  })}`);
}

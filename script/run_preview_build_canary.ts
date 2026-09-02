import Anthropic from "@anthropic-ai/sdk";
import { DbArtworkAttemptStore } from "../server/aiFirst/dbStore";
import { storage } from "../server/storage";

const environment = process.env.VERCEL_ENV || "local";
const branch = process.env.VERCEL_GIT_COMMIT_REF || "unknown";
const ownerToken = "qa-preview-brian-medium-lock-20260901-c2";
const attemptId = "91";

function databaseIdentity(raw: string | undefined) {
  if (!raw) return { configured: false };
  try {
    const parsed = new URL(raw);
    const username = decodeURIComponent(parsed.username || "");
    const projectRef = username.includes(".")
      ? username.split(".").at(-1) || null
      : /^db\.([a-z0-9]+)\./i.exec(parsed.hostname)?.[1] || null;
    return {
      configured: true,
      hostname: parsed.hostname,
      port: parsed.port || "default",
      database: parsed.pathname.replace(/^\//, "") || null,
      projectRef,
      pooled: parsed.hostname.includes("pooler") || username.includes("."),
    };
  } catch {
    return { configured: true, parseable: false };
  }
}

console.log(`[build-preview-database] ${JSON.stringify({
  environment,
  branch,
  database: databaseIdentity(process.env.DATABASE_URL),
  inspectionOnly: true,
})}`);

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
      max_tokens: 1400,
      system:
        "You are a demanding senior art director for a premium children's invitation and celebration brand. Inspect the exact supplied customer-facing teaser pixels. Do not be generous. Diagnose why a competent AI image would fail to create purchase desire. Return strict JSON only.",
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
            text: `This is a pre-purchase first look for Brian's fourth birthday: Blippi + Meekah together at an upscale indoor soft-play center, with foam climbing structures, ball pit, floating bubbles and colorful ice-cream treats. The automated gate scored text/logo 5, artifact-free 4, premium finish 3, brief fidelity 4, composition 4, age appropriateness 5. Analyze only the pixels you see. Return exactly: {"visualDescription":"","recognition":{"blippi":"","meekah":"","setting":"","requestedDetails":[]},"strongestElements":[],"premiumFinishDefects":[],"compositionDefects":[],"syntheticAICues":[],"whatMakesItFeelGeneric":[],"singleHighestLeverageArtDirectionRepair":"","secondHighestLeverageRepair":"","wouldThisCreatePurchaseDesire":false,"reason":""}.`,
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

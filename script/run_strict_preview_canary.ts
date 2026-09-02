import { storage } from "../server/storage";
import { DbArtworkAttemptStore } from "../server/aiFirst/dbStore";
import { resolveNamedCreativeReference } from "../server/namedReferenceResolver";
import {
  detectNamedCreativeReferenceSync,
  generateQualityLockedPreview,
} from "../server/prePaymentPreviewQuality";

const environment = process.env.VERCEL_ENV || "local";
const branch = process.env.VERCEL_GIT_COMMIT_REF || "unknown";
const ownerToken = "qa-preview-brian-strict-best2-20260902";
const deadlineMs = 120_000;

if (environment !== "preview" || branch !== "codex/launch-blockers") {
  console.log(`[strict-preview-canary] ${JSON.stringify({ skipped: true, environment, branch })}`);
  process.exit(0);
}

const controller = new AbortController();
const timer = setTimeout(() => controller.abort(new Error("strict preview canary exceeded 120 seconds")), deadlineMs);
const startedAt = Date.now();

try {
  const event = await storage.getEventByOwnerToken(ownerToken);
  if (!event) throw new Error("strict Brian QA event not found");

  const source = [event.eventName, event.eventType, event.themeName, event.vibeDescription]
    .filter(Boolean)
    .join(" ");
  const namedReference = detectNamedCreativeReferenceSync(source);
  if (!namedReference) throw new Error("curated Blippi + Meekah reference not detected");

  const resolved = await resolveNamedCreativeReference(event, namedReference);
  if (!resolved?.images.length || !resolved.notes.trim()) {
    throw new Error("automatic named-theme research did not resolve usable identity evidence");
  }

  const attemptStore = new DbArtworkAttemptStore();
  const result = await generateQualityLockedPreview(event, {
    inspirationNotes: resolved.notes,
    quality: "medium",
    maxCandidates: 2,
    parallelCandidates: true,
    namedReference,
    attemptRetention: {
      store: attemptStore,
      eventId: event.id,
      ownerToken: event.ownerToken,
    },
    signal: controller.signal,
  });

  console.log(`[strict-preview-canary] ${JSON.stringify({
    eventId: event.id,
    namedReference: namedReference.label,
    resultKind: result.kind,
    model: result.model,
    privateCandidates: result.attempts,
    durationMs: Date.now() - startedAt,
    researchStrategy: resolved.strategy,
    reviews: result.reviews.map((review) => ({
      failureCodes: review.failureCodes,
      scores: review.vision?.scores ?? null,
      teaserChecks: review.vision?.teaserChecks ?? null,
      excludedFound: review.vision?.excludedFound ?? [],
      requiredPresent: review.vision?.requiredPresent ?? [],
      notes: review.notes,
    })),
  })}`);
} catch (error) {
  console.error(`[strict-preview-canary] ${JSON.stringify({
    resultKind: "unavailable",
    durationMs: Date.now() - startedAt,
    error: error instanceof Error ? error.message : String(error),
  })}`);
} finally {
  clearTimeout(timer);
  process.exit(0);
}

import type { Express } from "express";
import { createHash, randomBytes } from "node:crypto";
import { storage } from "./storage";
import { DbArtworkAttemptStore } from "./aiFirst/dbStore";
import { getEmailConfiguration, sendEventRecoveryEmail } from "./email";
import { resolveNamedCreativeReference } from "./namedReferenceResolver";
import {
  detectNamedCreativeReferenceSync,
  directionCardDataUrl,
  generateQualityLockedPreview,
} from "./prePaymentPreviewQuality";

const PUBLIC_APP_ORIGIN = "https://posyplans.com";
const TEST_LIMIT = 3;
const TEST_WINDOW_MS = 60 * 60 * 1000;
const attempts = new Map<string, { count: number; resetsAt: number }>();

// Temporary, Preview-only, one-time internal QA gate. Only the SHA-256 digest
// is committed; the bearer value never enters source control. This route is
// removed immediately after the canary evidence is collected.
const INTERNAL_PREVIEW_CANARY_TOKEN_SHA256 =
  "9d8fffe0244c2716a1704b00b3ffb661a615635369818afa28af15cb8de5892b";
const INTERNAL_PREVIEW_CANARY_OWNER_TOKEN = "qa-preview-brian-medium-lock-20260901-c2";
const QUALITY_APPROVED_PNG_PREFIX = "data:image/png;posy-quality-approved;base64,";
const STANDARD_PNG_PREFIX = "data:image/png;base64,";
const INTERNAL_CANARY_DEADLINE_MS = 115_000;

function allowTest(ownerToken: string, now = Date.now()): boolean {
  const current = attempts.get(ownerToken);
  if (!current || current.resetsAt <= now) {
    attempts.set(ownerToken, { count: 1, resetsAt: now + TEST_WINDOW_MS });
    return true;
  }
  if (current.count >= TEST_LIMIT) return false;
  current.count += 1;
  return true;
}

function maskEmail(value: string): string {
  const [local, domain] = value.split("@");
  if (!local || !domain) return "configured recipient";
  const visible = local.slice(0, Math.min(2, local.length));
  return `${visible}${"•".repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}

function diagnosticBody(eventName: string, ownerToken: string): string {
  const link = `${PUBLIC_APP_ORIGIN}/dashboard/${encodeURIComponent(ownerToken)}`;
  return [
    "Hi,",
    "This is a Posy email-delivery test for the event below:",
    `${eventName}\n${link}`,
    "If this arrived, Posy's sender, API key, and mailbox delivery path are working.",
  ].join("\n\n");
}

function canaryTokenMatches(value: unknown): boolean {
  if (typeof value !== "string" || !value) return false;
  return createHash("sha256").update(value).digest("hex") === INTERNAL_PREVIEW_CANARY_TOKEN_SHA256;
}

function withDeadline<T>(promise: Promise<T>, timeoutMs: number, stage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${stage} exceeded the internal canary deadline`)), Math.max(1, timeoutMs));
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function runInternalPreviewCanary() {
  if (process.env.VERCEL_ENV !== "preview") {
    return { status: 404, body: { error: "Not found" } };
  }

  const event = await storage.getEventByOwnerToken(INTERNAL_PREVIEW_CANARY_OWNER_TOKEN);
  if (!event) return { status: 404, body: { error: "Internal QA event not found" } };
  if (event.sparkUnlockedAt) {
    return { status: 409, body: { error: "Internal QA event is already unlocked" } };
  }
  if (event.prePaymentPreviewAttempts !== 0 || event.prePaymentPreviewUrl) {
    return {
      status: 409,
      body: {
        error: "Internal QA event is no longer pristine",
        attempts: event.prePaymentPreviewAttempts,
        hasAsset: Boolean(event.prePaymentPreviewUrl),
      },
    };
  }

  const source = [event.eventName, event.eventType, event.themeName, event.vibeDescription]
    .filter(Boolean)
    .join(" ");
  const namedReference = detectNamedCreativeReferenceSync(source);
  if (!namedReference) {
    return { status: 500, body: { error: "Curated Blippi + Meekah reference was not detected" } };
  }

  const startedAt = Date.now();
  const remainingMs = () => Math.max(1, INTERNAL_CANARY_DEADLINE_MS - (Date.now() - startedAt));
  const attemptStore = new DbArtworkAttemptStore();
  await storage.updateEventById(event.id, {
    prePaymentPreviewAttempts: 1,
    prePaymentPreviewUrl: "",
    prePaymentPreviewUsedAt: startedAt,
  });

  let resultKind = "direction-card";
  let model: string | null = null;
  let privateCandidates = 0;
  let terminalReason: string | null = null;

  try {
    const resolved = await withDeadline(
      resolveNamedCreativeReference(event, namedReference),
      Math.min(10_000, remainingMs()),
      "Visual-reference resolution",
    );

    if (!resolved?.images.length) {
      terminalReason = "automatic_reference_unavailable";
      await storage.updateEventById(event.id, {
        prePaymentPreviewUrl: directionCardDataUrl(event, namedReference),
        prePaymentPreviewUsedAt: Date.now(),
      });
    } else {
      const result = await withDeadline(
        generateQualityLockedPreview(event, {
          inspirationNotes: resolved.notes,
          referenceImages: resolved.images,
          quality: "medium",
          maxCandidates: 1,
          namedReference,
          attemptRetention: {
            store: attemptStore,
            eventId: event.id,
            ownerToken: event.ownerToken,
          },
        }),
        remainingMs(),
        "Artwork generation and review",
      );

      model = result.model;
      privateCandidates = result.attempts;
      if (result.kind === "approved-image" && result.dataUrl.startsWith(STANDARD_PNG_PREFIX)) {
        resultKind = "approved-image";
        await storage.updateEventById(event.id, {
          prePaymentPreviewUrl: `${QUALITY_APPROVED_PNG_PREFIX}${result.dataUrl.slice(STANDARD_PNG_PREFIX.length)}`,
          prePaymentPreviewUsedAt: Date.now(),
        });
      } else {
        terminalReason = result.kind === "unavailable" ? result.error || "provider_unavailable" : "quality_rejected";
        await storage.updateEventById(event.id, {
          prePaymentPreviewUrl: directionCardDataUrl(event, namedReference),
          prePaymentPreviewUsedAt: Date.now(),
        });
      }
    }
  } catch (error) {
    terminalReason = error instanceof Error ? error.message : String(error);
    await storage.updateEventById(event.id, {
      prePaymentPreviewUrl: directionCardDataUrl(event, namedReference),
      prePaymentPreviewUsedAt: Date.now(),
    });
  }

  const evidence = await attemptStore.listForOwner(event.id, event.ownerToken);
  return {
    status: 200,
    body: {
      ok: true,
      eventId: event.id,
      eventName: event.eventName,
      namedReference: namedReference.label,
      resultKind,
      model,
      privateCandidates,
      durationMs: Date.now() - startedAt,
      deadlineMs: INTERNAL_CANARY_DEADLINE_MS,
      terminalReason,
      retainedEvidence: evidence.map((row) => ({
        status: row.status,
        model: row.model,
        quality: row.quality,
        size: row.size,
        failureCodes: row.failureCodes,
        visionScores: row.visionScores,
        assetHash: row.assetHash,
      })),
    },
  };
}

/**
 * Read-only configuration health plus a private owner-token diagnostic send.
 * No secret values or complete recipient addresses are ever returned.
 */
export function registerEmailDiagnosticRoutes(app: Express): void {
  app.get("/api/email/config", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");

    if (req.query.qa_canary !== undefined) {
      if (!canaryTokenMatches(req.query.qa_canary)) {
        return res.status(404).json({ error: "Not found" });
      }
      const result = await runInternalPreviewCanary();
      return res.status(result.status).json(result.body);
    }

    const config = getEmailConfiguration();
    return res.json({
      configured: config.productionSenderConfigured,
      apiKeyConfigured: config.apiKeyConfigured,
      fromAddressConfigured: config.fromAddressConfigured,
      productionSenderConfigured: config.productionSenderConfigured,
      usesTestSender: config.usesTestSender,
      senderDomain: config.senderDomain,
      environment: config.environment,
    });
  });

  app.post("/api/events/owner/:ownerToken/email-test", async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    if (!event.capturedEmail) {
      return res.status(409).json({
        error: "This event does not have a verified recovery email linked yet.",
        code: "event_email_not_linked",
      });
    }
    if (!allowTest(req.params.ownerToken)) {
      return res.status(429).json({
        error: "Please wait before sending another delivery test.",
        code: "email_test_rate_limited",
      });
    }

    const config = getEmailConfiguration();
    const requestId = randomBytes(6).toString("hex");
    if (!config.productionSenderConfigured) {
      console.error(`[email-diagnostic] ${JSON.stringify({
        requestId,
        eventId: event.id,
        accepted: false,
        code: "email_configuration_incomplete",
        config,
      })}`);
      return res.status(503).json({
        error: "Posy's sending domain is not fully configured in this deployment.",
        code: "email_configuration_incomplete",
        requestId,
        config,
      });
    }

    const result = await sendEventRecoveryEmail({
      to: event.capturedEmail,
      subject: "Posy email delivery test",
      body: diagnosticBody(event.eventName, event.ownerToken),
      idempotencyKey: `posy-email-test/${event.id}/${requestId}`,
    });

    console.info(`[email-diagnostic] ${JSON.stringify({
      requestId,
      eventId: event.id,
      accepted: result.ok,
      providerId: result.providerId || null,
      code: result.code || null,
      statusCode: result.statusCode || null,
    })}`);

    if (!result.ok) {
      return res.status(502).json({
        error: result.error || "The email provider did not accept this message.",
        code: result.code || "email_provider_rejected",
        requestId,
        config,
      });
    }

    return res.json({
      ok: true,
      requestId,
      providerId: result.providerId || null,
      sentTo: maskEmail(event.capturedEmail),
    });
  });
}

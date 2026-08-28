import type { Express } from "express";
import { randomBytes } from "node:crypto";
import { storage } from "./storage";
import { getEmailConfiguration, sendEventRecoveryEmail } from "./email";

const PUBLIC_APP_ORIGIN = "https://posyplans.com";
const TEST_LIMIT = 3;
const TEST_WINDOW_MS = 60 * 60 * 1000;
const attempts = new Map<string, { count: number; resetsAt: number }>();

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

/**
 * Read-only configuration health plus a private owner-token diagnostic send.
 * No secret values or complete recipient addresses are ever returned.
 */
export function registerEmailDiagnosticRoutes(app: Express): void {
  app.get("/api/email/config", (_req, res) => {
    const config = getEmailConfiguration();
    res.setHeader("Cache-Control", "no-store");
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

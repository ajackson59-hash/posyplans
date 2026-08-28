import type { Express, Request } from "express";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import type { Event } from "@shared/schema";
import { storage } from "./storage";
import { getEmailConfiguration, sendEventRecoveryEmail } from "./email";

const PUBLIC_APP_ORIGIN = "https://posyplans.com";
const recoverySchema = z.object({ email: z.string().trim().email().max(254) });
const EMAIL_LIMIT = 3;
const IP_LIMIT = 12;
const WINDOW_MS = 60 * 60 * 1000;
const attempts = new Map<string, { count: number; resetsAt: number }>();

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function consume(key: string, limit: number, now: number): boolean {
  const current = attempts.get(key);
  if (!current || current.resetsAt <= now) {
    attempts.set(key, { count: 1, resetsAt: now + WINDOW_MS });
    if (attempts.size > 4000) {
      attempts.forEach((entry, candidate) => {
        if (entry.resetsAt <= now) attempts.delete(candidate);
      });
    }
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}

function allowed(req: Request, email: string, now = Date.now()): boolean {
  const forwardedIp = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim();
  const ip = forwardedIp || req.ip || "unknown";
  return consume(`email:${hash(email)}`, EMAIL_LIMIT, now) && consume(`ip:${hash(ip)}`, IP_LIMIT, now);
}

function recoveryBody(events: Event[]): string {
  const links = events.slice(0, 20).map((event) => {
    const detail = [event.eventType, event.eventDate].filter(Boolean).join(" · ");
    const dashboardUrl = `${PUBLIC_APP_ORIGIN}/dashboard/${encodeURIComponent(event.ownerToken)}`;
    return `${event.eventName}${detail ? ` — ${detail}` : ""}\n${dashboardUrl}`;
  });

  return [
    "Hi,",
    "Someone requested the private dashboard link for your Posy event. Use the secure link below to continue planning:",
    links.join("\n\n"),
    "If you didn't request this email, you can ignore it. Your event has not been changed.",
  ].join("\n\n");
}

/**
 * This route is intentionally registered before the legacy route in routes.ts.
 * It preserves the same anti-enumeration response for matched and unmatched
 * addresses, while refusing to claim delivery when the entire email service is
 * unconfigured and attaching a support reference to every accepted request.
 */
export function registerEventRecoveryRoutes(app: Express): void {
  app.post("/api/events/lookup", async (req, res) => {
    const requestId = randomBytes(6).toString("hex");
    const parsed = recoverySchema.safeParse(req.body);
    res.setHeader("Cache-Control", "no-store");

    if (!parsed.success) {
      return res.status(400).json({
        error: "Enter a valid email address.",
        code: "invalid_recovery_email",
        requestId,
      });
    }

    const config = getEmailConfiguration();
    if (!config.productionSenderConfigured) {
      console.error(`[event-recovery] ${JSON.stringify({
        requestId,
        accepted: false,
        code: "email_configuration_incomplete",
        config,
      })}`);
      return res.status(503).json({
        error: "Email recovery is temporarily unavailable while Posy's sender is being secured. Your event has not been changed.",
        code: "email_configuration_incomplete",
        requestId,
      });
    }

    const normalized = parsed.data.email.toLowerCase();
    const emailHash = hash(normalized).slice(0, 16);
    const genericResponse = {
      ok: true as const,
      message: "If an event is connected to that email, a private dashboard link is on its way.",
      requestId,
    };

    if (!allowed(req, normalized)) {
      console.info(`[event-recovery] ${JSON.stringify({ requestId, emailHash, rateLimited: true })}`);
      return res.status(202).json(genericResponse);
    }

    try {
      const found = await storage.getEventsByEmail(normalized);
      let accepted = false;
      let providerId: string | null = null;
      let providerCode: string | null = null;
      let providerStatus: number | null = null;

      if (found.length > 0) {
        const fiveMinuteBucket = Math.floor(Date.now() / (5 * 60 * 1000));
        const result = await sendEventRecoveryEmail({
          to: normalized,
          subject: found.length === 1 ? "Your Posy event link" : "Your Posy event links",
          body: recoveryBody(found),
          idempotencyKey: `event-recovery/${emailHash}/${fiveMinuteBucket}`,
        });
        accepted = result.ok;
        providerId = result.providerId || null;
        providerCode = result.code || null;
        providerStatus = result.statusCode || null;
      }

      console.info(`[event-recovery] ${JSON.stringify({
        requestId,
        emailHash,
        matchCount: found.length,
        accepted,
        providerId,
        providerCode,
        providerStatus,
      })}`);
    } catch (error) {
      console.error(`[event-recovery] ${JSON.stringify({
        requestId,
        emailHash,
        accepted: false,
        code: "recovery_processing_failed",
        message: error instanceof Error ? error.message : "unknown error",
      })}`);
    }

    return res.status(202).json(genericResponse);
  });
}

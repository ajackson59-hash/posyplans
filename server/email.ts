// Sends guest invite and event-recovery emails through Resend's HTTP API.
// Requires RESEND_API_KEY and a verified custom sender in RESEND_FROM_EMAIL.
// Customer-facing sends deliberately refuse to fall back to resend.dev outside
// tests: Resend's shared domain can only deliver to the address on the Resend
// account, which otherwise turns a provider 403 into a misleading success UI.

export interface SendEmailResult {
  ok: boolean;
  error?: string;
  authUrl?: string;
  providerId?: string;
  statusCode?: number;
  code?: string;
}

export interface EmailConfiguration {
  apiKeyConfigured: boolean;
  fromAddressConfigured: boolean;
  productionSenderConfigured: boolean;
  usesTestSender: boolean;
  senderDomain: string | null;
  environment: string;
}

const RESEND_API_URL = "https://api.resend.com/emails";
const DEFAULT_FROM = "Posy <onboarding@resend.dev>";
const DEFAULT_REPLY_TO = "hello@posyplans.com";

function senderAddress(value: string): string {
  const angleMatch = value.match(/<\s*([^>]+)\s*>/);
  return (angleMatch?.[1] || value).trim().toLowerCase();
}

function senderDomain(value: string): string | null {
  const address = senderAddress(value);
  const at = address.lastIndexOf("@");
  return at >= 0 ? address.slice(at + 1) : null;
}

export function getEmailConfiguration(): EmailConfiguration {
  const apiKeyConfigured = Boolean(process.env.RESEND_API_KEY?.trim());
  const configuredFrom = process.env.RESEND_FROM_EMAIL?.trim() || "";
  const usesTestSender = Boolean(configuredFrom) && senderDomain(configuredFrom) === "resend.dev";
  const fromAddressConfigured = Boolean(configuredFrom);

  return {
    apiKeyConfigured,
    fromAddressConfigured,
    productionSenderConfigured: apiKeyConfigured && fromAddressConfigured && !usesTestSender,
    usesTestSender,
    senderDomain: configuredFrom ? senderDomain(configuredFrom) : null,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "unknown",
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Turns the plain-text body (which already contains a bare RSVP/dashboard URL)
// into a calm, branded HTML email with a clear button and readable spacing.
function buildEmailHtml(body: string, ctaLabel: string, footer: string): string {
  const urlPattern = /(https?:\/\/[^\s]+)/g;
  const paragraphs = body
    .split(/\n{2,}/)
    .map((block) => escapeHtml(block).replace(/\n/g, "<br>"))
    .map((block) =>
      block.replace(urlPattern, (escapedUrl) => {
        const realUrl = escapedUrl
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'");
        return `<a href="${realUrl}" style="display:inline-block;margin-top:4px;padding:10px 20px;background:#5c6756;color:#ffffff;border-radius:6px;text-decoration:none;font-weight:600;">${escapeHtml(ctaLabel)}</a>`;
      }),
    );

  return `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:32px 16px;background:#f6eae4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:#2f2b26;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width:480px;background:#ffffff;border-radius:12px;padding:32px;" cellpadding="0" cellspacing="0">
            <tr>
              <td style="font-size:18px;font-weight:700;color:#5c6756;letter-spacing:0.02em;padding-bottom:20px;">Posy</td>
            </tr>
            <tr>
              <td style="font-size:15px;line-height:1.6;">${paragraphs.map((p) => `<p style="margin:0 0 16px;">${p}</p>`).join("")}</td>
            </tr>
            <tr>
              <td style="padding-top:28px;border-top:1px solid #ece8e1;margin-top:24px;font-size:12px;color:#a3a894;">
                ${escapeHtml(footer)}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

async function sendEmail(
  opts: {
    to: string;
    subject: string;
    body: string;
    idempotencyKey?: string;
  },
  ctaLabel: string,
  footer: string,
): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) {
    return {
      ok: false,
      code: "missing_resend_api_key",
      error: "RESEND_API_KEY is not configured for this deployment.",
    };
  }

  const configuredFrom = process.env.RESEND_FROM_EMAIL?.trim();
  const from = configuredFrom || (process.env.NODE_ENV === "test" ? DEFAULT_FROM : "");
  if (!from) {
    return {
      ok: false,
      code: "missing_resend_from_email",
      error: "RESEND_FROM_EMAIL is not configured for this deployment.",
    };
  }

  if (senderDomain(from) === "resend.dev" && process.env.NODE_ENV !== "test") {
    return {
      ok: false,
      code: "resend_test_sender_not_allowed",
      error: "The Resend test sender cannot deliver Posy customer emails. Configure a verified Posy sender domain.",
    };
  }

  const replyTo = process.env.RESEND_REPLY_TO_EMAIL?.trim() || DEFAULT_REPLY_TO;

  try {
    const response = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...(opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey.slice(0, 256) } : {}),
      },
      body: JSON.stringify({
        from,
        to: [opts.to],
        reply_to: replyTo,
        subject: opts.subject,
        text: opts.body,
        html: buildEmailHtml(opts.body, ctaLabel, footer),
      }),
    });

    const responseBody = await response.text().catch(() => "");
    let parsed: { id?: string; message?: string; name?: string } = {};
    try {
      parsed = responseBody ? JSON.parse(responseBody) : {};
    } catch {
      // Keep the status-based fallback below when Resend does not return JSON.
    }

    if (!response.ok) {
      return {
        ok: false,
        statusCode: response.status,
        code: parsed.name || `resend_http_${response.status}`,
        error: parsed.message || `Resend rejected this email (status ${response.status}).`,
      };
    }

    return { ok: true, providerId: parsed.id };
  } catch (err) {
    return {
      ok: false,
      code: "resend_network_error",
      error: err instanceof Error ? err.message : "Couldn't reach the email provider.",
    };
  }
}

export async function sendInviteEmail(opts: {
  to: string;
  subject: string;
  body: string;
  idempotencyKey?: string;
}): Promise<SendEmailResult> {
  return sendEmail(
    opts,
    "View & RSVP",
    "Sent by Posy on behalf of your host. If this wasn't meant for you, you can ignore it.",
  );
}

export async function sendEventRecoveryEmail(opts: {
  to: string;
  subject: string;
  body: string;
  idempotencyKey?: string;
}): Promise<SendEmailResult> {
  return sendEmail(
    opts,
    "Open event dashboard",
    "This email contains a private Posy event link. If you weren't expecting it, you can ignore it.",
  );
}

// Sends guest invite and reminder emails through Resend's HTTP API.
// Requires RESEND_API_KEY (and ideally RESEND_FROM_EMAIL, once a sending
// domain is verified in Resend) to be set in the environment (Vercel
// production env vars). This intentionally uses a plain fetch() rather than
// the Resend SDK — same lightweight pattern as illustrationGen.ts — since
// this is a single, simple request with no need for the extra dependency.
//
// Until a custom domain is verified in Resend, RESEND_FROM_EMAIL falls back
// to Resend's shared test address (onboarding@resend.dev), which can only
// deliver to the Resend account's own verified email — real guest addresses
// will fail until a domain is verified. See RESEND_FROM_EMAIL below.

export interface SendEmailResult {
  ok: boolean;
  error?: string;
  authUrl?: string;
}

const RESEND_API_URL = "https://api.resend.com/emails";
const DEFAULT_FROM = "Posy <onboarding@resend.dev>";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Turns the plain-text body (which already contains a bare RSVP URL, per
// server/routes.ts's message templates) into a calm, branded HTML email —
// a real logo mark, a proper button for the RSVP link, and readable
// paragraph spacing, rather than a wall of unstyled plain text. Sending an
// html part alongside text also matters for deliverability: text-only
// mail from a shared sending address scores as spammier to most inboxes.
function buildEmailHtml(body: string, ctaLabel: string, footer: string): string {
  const urlPattern = /(https?:\/\/[^\s]+)/g;
  const paragraphs = body
    .split(/\n{2,}/)
    .map((block) => escapeHtml(block).replace(/\n/g, "<br>"))
    .map((block) =>
      block.replace(urlPattern, (escapedUrl) => {
        // escapeHtml already ran, so recover the real URL for the href
        // by unescaping just the characters we escaped above.
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

async function sendEmail(opts: {
  to: string;
  subject: string;
  body: string;
}, ctaLabel: string, footer: string): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return {
      ok: false,
      error: "Email sending isn't set up for this event yet. Please contact support.",
    };
  }

  const from = process.env.RESEND_FROM_EMAIL || DEFAULT_FROM;

  try {
    const response = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from,
        to: [opts.to],
        subject: opts.subject,
        text: opts.body,
        html: buildEmailHtml(opts.body, ctaLabel, footer),
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      let message = `Couldn't send this email (status ${response.status}).`;
      try {
        const parsed = JSON.parse(errorBody) as { message?: string };
        if (parsed.message) message = parsed.message;
      } catch {
        // Keep the generic message above if the error body isn't JSON.
      }
      return { ok: false, error: message };
    }

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Couldn't send this email — please try again.",
    };
  }
}

export async function sendInviteEmail(opts: {
  to: string;
  subject: string;
  body: string;
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
}): Promise<SendEmailResult> {
  return sendEmail(
    opts,
    "Open event dashboard",
    "This email contains a private Posy event link. If you weren't expecting it, you can ignore it.",
  );
}

// Sends Posy SMS messages through Twilio's REST API.
//
// Requires TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN plus preferably
// TWILIO_MESSAGING_SERVICE_SID. The Messaging Service path is the production
// path because Twilio Advanced Opt-Out can handle STOP/HELP/START consistently.
// TWILIO_FROM_NUMBER remains a testing fallback only.

export interface SendSmsResult {
  ok: boolean;
  error?: string;
  skipped?: "not_configured" | "no_consent" | "no_phone";
}

const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01";

export function smsConfiguration() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;
  return {
    configured: Boolean(accountSid && authToken && (messagingServiceSid || fromNumber)),
    messagingServiceConfigured: Boolean(accountSid && authToken && messagingServiceSid),
  };
}

export function normalizeSmsDestination(value: string): string {
  const trimmed = value.trim();
  if (/^\+[1-9]\d{7,14}$/.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return trimmed;
}

async function sendSms(opts: { to: string; body: string }): Promise<SendSmsResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;

  if (!accountSid || !authToken || !(messagingServiceSid || fromNumber)) {
    return {
      ok: false,
      skipped: "not_configured",
      error: "Posy text messaging is not fully configured yet.",
    };
  }

  const destination = normalizeSmsDestination(opts.to);
  if (!/^\+[1-9]\d{7,14}$/.test(destination)) {
    return { ok: false, skipped: "no_phone", error: "Enter a valid mobile number before sending." };
  }

  const params = new URLSearchParams({
    To: destination,
    Body: opts.body,
  });
  if (messagingServiceSid) params.set("MessagingServiceSid", messagingServiceSid);
  else if (fromNumber) params.set("From", fromNumber);

  try {
    const response = await fetch(`${TWILIO_API_BASE}/Accounts/${accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      },
      body: params.toString(),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => "");
      let message = `Couldn't send this text (status ${response.status}).`;
      try {
        const parsed = JSON.parse(errorBody) as { message?: string };
        if (parsed.message) message = parsed.message;
      } catch {
        // Keep the generic message above if Twilio did not return JSON.
      }
      return { ok: false, error: message };
    }

    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Couldn't send this text — please try again.",
    };
  }
}

/** Initial event invitation. Permission is enforced by the owner route before this transport is called. */
export async function sendInvitationSms(opts: { to: string; body: string }): Promise<SendSmsResult> {
  return sendSms(opts);
}

/** Reminder/update path. Callers must continue enforcing guest smsOptIn. */
export async function sendReminderSms(opts: { to: string; body: string }): Promise<SendSmsResult> {
  return sendSms(opts);
}

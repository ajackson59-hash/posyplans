// Sends RSVP reminder texts through Twilio's REST API.
//
// Requires TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN (and ideally
// TWILIO_MESSAGING_SERVICE_SID) to be set in the environment (Vercel
// production env vars). This intentionally uses a plain fetch() rather than
// the Twilio SDK — same lightweight pattern as email.ts — since this is a
// single, simple request with no need for the extra dependency.
//
// Sending through a Messaging Service (TWILIO_MESSAGING_SERVICE_SID) rather
// than a bare "From" number matters for compliance: Twilio's Advanced
// Opt-Out feature, configured once on the Messaging Service in the Twilio
// Console, automatically handles STOP/HELP/CANCEL/UNSUBSCRIBE/etc. replies
// for you. That's exactly what /sms-terms promises guests, so this module
// deliberately does not build custom keyword-handling logic — it should
// come from the Messaging Service's built-in Opt-Out Management, not a
// webhook we maintain here. If TWILIO_MESSAGING_SERVICE_SID isn't set yet,
// this falls back to TWILIO_FROM_NUMBER, but that fallback path does NOT
// get automatic opt-out handling — it's only meant for early testing before
// a Messaging Service is configured, never for real guest sends.
//
// Before this can send real messages, a Twilio account needs:
//   1. A2P 10DLC brand registration (using the PosyPlans LLC EIN once issued)
//   2. Campaign registration (the "Low Volume Mixed" / RSVP-reminder use case)
//   3. A purchased phone number, attached to a Messaging Service with
//      Advanced Opt-Out enabled
// None of that can happen from here — it requires the user's own Twilio
// account, billing, and business verification.

export interface SendSmsResult {
  ok: boolean;
  error?: string;
  skipped?: "not_configured" | "no_consent" | "no_phone";
}

const TWILIO_API_BASE = "https://api.twilio.com/2010-04-01";

export async function sendReminderSms(opts: {
  to: string;
  body: string;
}): Promise<SendSmsResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;
  const fromNumber = process.env.TWILIO_FROM_NUMBER;

  if (!accountSid || !authToken || !(messagingServiceSid || fromNumber)) {
    return {
      ok: false,
      skipped: "not_configured",
      error: "Text reminders aren't set up yet. Please contact support.",
    };
  }

  const params = new URLSearchParams({
    To: opts.to,
    Body: opts.body,
  });
  if (messagingServiceSid) {
    params.set("MessagingServiceSid", messagingServiceSid);
  } else if (fromNumber) {
    params.set("From", fromNumber);
  }

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
        // Keep the generic message above if the error body isn't JSON.
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

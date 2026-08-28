import type { Express } from "express";
import { z } from "zod";
import { storage } from "./storage";
import { sendInvitationSms, smsConfiguration } from "./sms";

const invitationSmsSchema = z.object({
  permissionConfirmed: z.literal(true),
});

const PUBLIC_APP_ORIGIN = "https://posyplans.com";

function invitationSmsBody(event: Awaited<ReturnType<typeof storage.getEventByOwnerToken>>, guest: Awaited<ReturnType<typeof storage.getGuest>>) {
  if (!event || !guest) return "";
  const firstName = guest.name.split(" ")[0] || guest.name;
  const host = event.hostNames?.trim() || "Your host";
  const link = `${PUBLIC_APP_ORIGIN}/rsvp/${event.shareSlug}/g/${guest.accessToken}`;
  const dateLine = event.eventDate ? ` on ${event.eventDate}` : "";
  return `Hi ${firstName}! ${host} invited you to ${event.eventName}${dateLine}. View your invitation and RSVP here: ${link}\n\nReply STOP to opt out of Posy texts.`;
}

/**
 * Initial invitation SMS is intentionally separate from RSVP-reminder consent.
 * The host must affirm they have permission to contact this specific guest for
 * this event. Sending the invitation does NOT set guest.smsOptIn; reminders and
 * updates remain disabled unless the guest explicitly opts in themselves.
 */
export function registerSmsInvitationRoutes(app: Express): void {
  app.get("/api/sms/config", (_req, res) => {
    res.json(smsConfiguration());
  });

  app.post("/api/events/owner/:ownerToken/guests/:guestId/send-invite-sms", async (req, res) => {
    const parsed = invitationSmsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Confirm that you have permission to text this guest about this event before sending.",
      });
    }

    const event = await storage.getEventByOwnerToken(req.params.ownerToken);
    if (!event) return res.status(404).json({ error: "Event not found" });
    if (event.inviteStatus !== "published") {
      return res.status(409).json({ error: "Publish the invitation before sending it by text." });
    }

    const guest = await storage.getGuest(Number(req.params.guestId));
    if (!guest || guest.eventId !== event.id) return res.status(404).json({ error: "Guest not found" });
    if (!guest.phone.trim()) return res.status(400).json({ error: "Add a mobile number for this guest first." });

    const result = await sendInvitationSms({
      to: guest.phone,
      body: invitationSmsBody(event, guest),
    });
    if (!result.ok) {
      return res.status(result.skipped === "not_configured" ? 503 : 502).json({
        error: result.error || "Couldn't send the invitation text.",
        code: result.skipped || "sms_send_failed",
      });
    }

    // invitedAt is channel-neutral and already drives the dashboard's invited
    // state. Do not touch smsOptIn or smsConsentAt here: the guest still has to
    // opt into future reminders/updates on the RSVP page themselves.
    const updated = await storage.updateGuest(event.id, guest.id, { invitedAt: Date.now() });
    return res.json({ ok: true, guest: updated });
  });
}

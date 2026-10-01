import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { apiRequestJson, queryClient } from "@/lib/queryClient";
import type { EventRecord, GuestRecord } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { MessageSquareText, Phone } from "lucide-react";

interface SmsConfig {
  configured: boolean;
  messagingServiceConfigured: boolean;
}

function ownerTokenFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/dashboard\/([^/?#]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export default function DashboardSmsInvitations() {
  const { toast } = useToast();
  const [location] = useLocation();
  const ownerToken = ownerTokenFromPath(location);
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const [permission, setPermission] = useState<Record<number, boolean>>({});
  const [phoneDrafts, setPhoneDrafts] = useState<Record<number, string>>({});

  useEffect(() => {
    setMount(null);
    if (!ownerToken) return;
    const find = () => setMount(document.querySelector<HTMLElement>('[data-testid="card-send-invitations"]'));
    find();
    const observer = new MutationObserver(find);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [ownerToken]);

  const eventQuery = useQuery<{ event: EventRecord; guests: GuestRecord[] }>({
    queryKey: [`/api/events/owner/${ownerToken}`],
    enabled: Boolean(ownerToken),
  });
  const config = useQuery<SmsConfig>({ queryKey: ["/api/sms/config"], enabled: Boolean(ownerToken) });

  const guests = eventQuery.data?.guests ?? [];
  const event = eventQuery.data?.event;
  const phoneGuests = useMemo(() => guests.filter((guest) => Boolean(guest.phone?.trim())), [guests]);
  const missingPhoneGuests = useMemo(() => guests.filter((guest) => !guest.phone?.trim()), [guests]);

  const savePhone = useMutation({
    mutationFn: async ({ guestId, phone }: { guestId: number; phone: string }) =>
      apiRequestJson("PATCH", `/api/events/owner/${ownerToken}/guests/${guestId}`, { phone }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/events/owner/${ownerToken}`] });
      toast({ title: "Mobile number saved" });
    },
    onError: (error: Error) => {
      toast({ title: "Couldn't save that number", description: error.message, variant: "destructive" });
    },
  });

  const sendInvite = useMutation({
    mutationFn: async (guestId: number) =>
      apiRequestJson<{ ok: true }>("POST", `/api/events/owner/${ownerToken}/guests/${guestId}/send-invite-sms`, {
        permissionConfirmed: true,
      }),
    onSuccess: (_result, guestId) => {
      const guest = guests.find((candidate) => candidate.id === guestId);
      queryClient.invalidateQueries({ queryKey: [`/api/events/owner/${ownerToken}`] });
      toast({ title: "Invitation text sent", description: guest ? `Texted ${guest.name}'s private invitation link.` : undefined });
      setPermission((current) => ({ ...current, [guestId]: false }));
    },
    onError: (error: Error) => {
      toast({ title: "Couldn't send that invitation text", description: error.message, variant: "destructive" });
    },
  });

  if (!ownerToken || !mount || !event || guests.length === 0) return null;

  return createPortal(
    <div className="border-t border-border px-6 pb-6 pt-4" data-testid="panel-send-invite-sms">
      <div className="flex items-start gap-2.5">
        <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">Send invitation by text</p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Posy sends the guest's private invitation and RSVP link. Sending an initial invitation does not subscribe the guest to reminders; they choose that separately when they RSVP.
          </p>
        </div>
      </div>

      {!config.data?.messagingServiceConfigured ? (
        <div className="mt-3 rounded-md border border-dashed border-border bg-muted/20 p-3 text-xs text-muted-foreground" data-testid="sms-setup-pending">
          Invitation texting is ready in Posy, but stays off until the approved Posy number is attached to the Twilio Messaging Service and its credentials are added to the deployment.
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {phoneGuests.map((guest) => (
            <div key={guest.id} className="rounded-md border border-border p-3" data-testid={`sms-invite-row-${guest.id}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-sm font-medium text-foreground">{guest.name}</p>
                  <p className="flex items-center gap-1 text-xs text-muted-foreground"><Phone className="h-3 w-3" /> {guest.phone}</p>
                </div>
                <Button
                  size="sm"
                  disabled={!permission[guest.id] || sendInvite.isPending || event.inviteStatus !== "published"}
                  onClick={() => sendInvite.mutate(guest.id)}
                  data-testid={`button-send-invite-sms-${guest.id}`}
                >
                  <MessageSquareText className="mr-1.5 h-3.5 w-3.5" />
                  {sendInvite.isPending && sendInvite.variables === guest.id ? "Sending…" : "Send by text"}
                </Button>
              </div>
              <label className="mt-2.5 flex cursor-pointer items-start gap-2 text-xs leading-relaxed text-muted-foreground">
                <input
                  type="checkbox"
                  checked={Boolean(permission[guest.id])}
                  onChange={(event) => setPermission((current) => ({ ...current, [guest.id]: event.target.checked }))}
                  className="mt-0.5 h-4 w-4 rounded border-border"
                  data-testid={`checkbox-sms-permission-${guest.id}`}
                />
                <span>I have permission to text this guest about this event.</span>
              </label>
            </div>
          ))}

          {missingPhoneGuests.length > 0 && (
            <details className="rounded-md border border-border p-3" data-testid="details-add-guest-phones">
              <summary className="cursor-pointer text-xs font-medium text-foreground">
                Add mobile numbers ({missingPhoneGuests.length})
              </summary>
              <div className="mt-3 space-y-2.5">
                {missingPhoneGuests.map((guest) => (
                  <div key={guest.id} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto] sm:items-center">
                    <span className="text-xs font-medium text-foreground">{guest.name}</span>
                    <Input
                      type="tel"
                      value={phoneDrafts[guest.id] ?? ""}
                      onChange={(event) => setPhoneDrafts((current) => ({ ...current, [guest.id]: event.target.value }))}
                      placeholder="(518) 555-0123"
                      className="h-9"
                      data-testid={`input-guest-phone-${guest.id}`}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={savePhone.isPending || !(phoneDrafts[guest.id] ?? "").trim()}
                      onClick={() => savePhone.mutate({ guestId: guest.id, phone: (phoneDrafts[guest.id] ?? "").trim() })}
                    >
                      Save
                    </Button>
                  </div>
                ))}
              </div>
            </details>
          )}

          {event.inviteStatus !== "published" && (
            <p className="text-xs text-muted-foreground">Publish the invitation first; Posy won't text guests a draft.</p>
          )}
        </div>
      )}
    </div>,
    mount,
  );
}

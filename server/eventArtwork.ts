import { createHash } from "node:crypto";
import type { Event, UpdateEvent } from "@shared/schema";

export const eventArtworkFields = ["inviteArtworkUrl", "inviteIllustrationUrl", "customInviteImageUrl", "conceptArtwork"] as const;
export type EventArtworkField = typeof eventArtworkFields[number];

function conceptOf(event: Event): Record<string, any> | null {
  try {
    const value = JSON.parse(event.inviteDesignConceptJson || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch { return null; }
}

export function storedEventArtwork(event: Event, field: EventArtworkField): string {
  const value = field === "conceptArtwork" ? conceptOf(event)?.aiFirst?.artworkUrl : event[field];
  return typeof value === "string" ? value : "";
}

export function eventArtworkVersion(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function eventArtworkUrl(event: Event, field: EventArtworkField, audience: "owner" | "public" = "owner"): string {
  const value = storedEventArtwork(event, field);
  if (!value.startsWith("data:")) {
    // A public response must never carry the host's bearer credential.
    return audience === "public" && value.includes("/api/events/owner/") ? "" : value;
  }
  const key = audience === "owner" ? event.ownerToken : event.shareSlug;
  return `/api/events/${audience}/${encodeURIComponent(key)}/invite/assets/${field}?v=${eventArtworkVersion(value)}`;
}

function artworkView(event: Event, audience: "owner" | "public"): Event {
  const view = { ...event };
  for (const field of eventArtworkFields) {
    if (field !== "conceptArtwork") view[field] = eventArtworkUrl(event, field, audience);
  }
  const concept = conceptOf(event);
  if (concept?.aiFirst && typeof concept.aiFirst.artworkUrl === "string") {
    concept.aiFirst.artworkUrl = eventArtworkUrl(event, "conceptArtwork", audience);
    view.inviteDesignConceptJson = JSON.stringify(concept);
  }
  return view;
}

/** A view only: the database retains the original bytes and approval marker. */
export function ownerEventView(event: Event): Event;
export function ownerEventView(event: Event | undefined): Event | undefined;
export function ownerEventView(event: Event | undefined): Event | undefined {
  if (!event) return event;
  return { ...artworkView(event, "owner"), prePaymentPreviewUrl: "" };
}

const publicFields = [
  "id", "shareSlug", "eventName", "eventType", "eventDate", "location", "hostNames",
  "themeName", "paletteColors", "inviteSubject", "inviteMessage", "inviteArtworkUrl",
  "inviteIllustrationUrl", "customInviteImageUrl", "inviteFontFamily", "inviteAccentColor",
  "inviteDesignConceptJson", "inviteRenderMode", "envelopeColor", "envelopeLinerPattern",
  "stampStyle", "linerColor", "stampColor", "rsvpRestriction", "rsvpDeadline", "inviteStatus", "rsvpPhone",
] as const satisfies readonly (keyof Event)[];

export function publicEventView(event: Event): Partial<Event> {
  const view = artworkView(event, "public");
  if (event.inviteStatus === "draft") {
    view.inviteArtworkUrl = view.inviteIllustrationUrl = view.customInviteImageUrl = "";
    view.inviteDesignConceptJson = "{}";
  }
  return Object.fromEntries(publicFields.map((field) => [field, view[field]]));
}

/** Resolve a displayed URL before saving it back. Never persist self-links,
 * silently replace a newer image, or copy another event's private asset URL. */
export function restoreEventArtworkReferences(event: Event, updates: UpdateEvent): UpdateEvent {
  const result = { ...updates };
  const resolve = (value: string): string => {
    if (!value.includes("/invite/assets/")) return value;
    for (const field of eventArtworkFields) {
      for (const audience of ["owner", "public"] as const) {
        if (value === eventArtworkUrl(event, field, audience) && storedEventArtwork(event, field).startsWith("data:")) {
          return storedEventArtwork(event, field);
        }
      }
    }
    throw Object.assign(new Error("That artwork has changed. Reload the invitation before saving."), { status: 409 });
  };
  for (const field of eventArtworkFields) {
    if (field !== "conceptArtwork" && typeof result[field] === "string") result[field] = resolve(result[field]);
  }
  if (typeof result.inviteDesignConceptJson === "string") {
    const concept = conceptOf({ ...event, inviteDesignConceptJson: result.inviteDesignConceptJson });
    if (concept?.aiFirst && typeof concept.aiFirst.artworkUrl === "string") {
      concept.aiFirst.artworkUrl = resolve(concept.aiFirst.artworkUrl);
      result.inviteDesignConceptJson = JSON.stringify(concept);
    }
  }
  return result;
}

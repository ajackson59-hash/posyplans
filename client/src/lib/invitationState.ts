import type { EventRecord } from "@/lib/types";
import { parseInviteDesignConcept } from "@shared/inviteDesign";

/**
 * Invitation copy exists on every event, so it is not proof that the host has
 * chosen a visual direction. Keep dashboard publishing language tied to an
 * actual applied design instead.
 */
export function hasSelectedInvitationDesign(event: EventRecord): boolean {
  if (event.inviteRenderMode === "custom" && event.customInviteImageUrl?.trim()) return true;

  return Boolean(
    parseInviteDesignConcept(event.inviteDesignConceptJson) ||
      event.inviteArtworkUrl?.trim() ||
      event.inviteIllustrationUrl?.trim(),
  );
}

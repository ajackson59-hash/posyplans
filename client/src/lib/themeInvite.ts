// Resolves an event into everything the composed invitation renderer needs.
// Shared by the theme chooser, the invite studio, and the guest RSVP page so
// all three are guaranteed to draw the same card.

import {
  getLaunchTheme,
  readThemeSelection,
  themeCopyForEvent,
  type LaunchTheme,
  type ThemeCopy,
  type ThemeSelection,
} from "@shared/themeCatalog";
import { parseInviteDesignConcept } from "@shared/inviteDesign";
import { applyInviteTokens } from "@shared/inviteTokens";
import type { EventRecord } from "./types";

export interface ThemeView {
  theme: LaunchTheme;
  selection: ThemeSelection;
  headline: string;
  message: string;
  fontPairingId: string;
}

/** The applied curated theme for an event, or null if it isn't using one. */
export function resolveThemeView(event: EventRecord): ThemeView | null {
  const concept = parseInviteDesignConcept(event.inviteDesignConceptJson);
  const selection = readThemeSelection(concept);
  if (!concept || !selection) return null;
  const theme = getLaunchTheme(selection.themeId);
  if (!theme) return null;

  const tokens = {
    eventName: event.eventName,
    eventDate: event.eventDate,
    location: event.location,
    hostNames: event.hostNames,
  };

  return {
    theme,
    selection,
    headline: applyInviteTokens(event.inviteSubject, tokens).trim() || event.eventName || theme.sample.headline,
    message: applyInviteTokens(event.inviteMessage, tokens).trim(),
    fontPairingId: concept.fontPairingId,
  };
}

/**
 * Preview copy for a theme the host has not applied yet. Uses their real event
 * details where they exist so the catalogue reads as their invitation, not a
 * stock sample.
 */
export function previewCopyFor(theme: LaunchTheme, event: EventRecord): { headline: string; copy: ThemeCopy } {
  return {
    headline: event.eventName?.trim() || theme.sample.headline,
    copy: themeCopyForEvent(theme, event),
  };
}

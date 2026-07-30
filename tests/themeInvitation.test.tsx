// The composed invitation is the single renderer shared by the catalogue, the
// studio, and the guest RSVP page — so these assertions cover what a guest
// actually receives, not just what the host previews.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThemeInvitation } from "@/components/ThemeInvitation";
import { resolveThemeView } from "@/lib/themeInvite";
import { LAUNCH_THEMES, buildThemedConcept, defaultThemeCopy } from "@shared/themeCatalog";
import { getFontPairing } from "@shared/inviteDesign";
import type { EventRecord } from "@/lib/types";

const theme = LAUNCH_THEMES[0];

function eventWithTheme(overrides: Partial<EventRecord> = {}): EventRecord {
  const concept = buildThemedConcept(theme, {
    copy: { ...defaultThemeCopy(theme), locationLine: "The Rosewood Terrace" },
  });
  return {
    id: 1,
    shareSlug: "slug",
    eventName: "Nina's Fortieth",
    eventType: "birthday",
    eventDate: "Saturday, June 14",
    location: "The Rosewood Terrace",
    hostNames: "Nina & Sam",
    themeName: theme.name,
    paletteColors: JSON.stringify(concept.paletteColors),
    inviteSubject: "An Evening in the Garden",
    inviteMessage: "Dinner is at seven.",
    inviteArtworkUrl: "",
    inviteFontFamily: "classic-serif",
    inviteAccentColor: "",
    inviteDesignConceptJson: JSON.stringify(concept),
    inviteIllustrationUrl: theme.artwork.fullUrl,
    budgetTotal: null,
    venueName: "",
    venueAddress: "",
    venueCapacity: null,
    venueContactName: "",
    venueContactPhone: "",
    rsvpRestriction: "none",
    rsvpDeadline: "",
    createdAt: 0,
    estimatedGuestCount: null,
    budgetCeiling: null,
    vibeDescription: "",
    eventIdentity: "",
    draftStatus: "none",
    draftStage: null,
    capturedEmail: null,
    emailCapturedAt: null,
    ...overrides,
  };
}

describe("resolveThemeView", () => {
  it("reads a stored curated theme back off an event", () => {
    const view = resolveThemeView(eventWithTheme());
    expect(view).not.toBeNull();
    expect(view!.theme.id).toBe(theme.id);
    expect(view!.headline).toBe("An Evening in the Garden");
    expect(view!.message).toBe("Dinner is at seven.");
  });

  it("falls back to the event name when the host has not written a headline", () => {
    expect(resolveThemeView(eventWithTheme({ inviteSubject: "" }))!.headline).toBe("Nina's Fortieth");
  });

  it("returns null for an event with no concept at all", () => {
    expect(resolveThemeView(eventWithTheme({ inviteDesignConceptJson: "{}" }))).toBeNull();
  });

  it("returns null for an AI concept that carries no curated theme", () => {
    const aiConcept = {
      conceptName: "Sunset Terrace",
      description: "Generated",
      paletteColors: ["#111111", "#222222", "#333333", "#444444"],
      fontPairingId: "editorial-serif",
      borderStyle: "none",
      layoutStyle: "banner",
      illustrationPrompt: "a sunset",
    };
    expect(resolveThemeView(eventWithTheme({ inviteDesignConceptJson: JSON.stringify(aiConcept) }))).toBeNull();
  });

  it("ignores a stored theme id that no longer exists in the catalogue", () => {
    const stale = { ...buildThemedConcept(theme), theme: { themeId: "retired-theme" } };
    expect(resolveThemeView(eventWithTheme({ inviteDesignConceptJson: JSON.stringify(stale) }))).toBeNull();
  });
});

describe("ThemeInvitation", () => {
  it("renders the full invitation hierarchy a guest needs", () => {
    const view = resolveThemeView(eventWithTheme())!;
    render(
      <ThemeInvitation
        theme={view.theme}
        headline={view.headline}
        copy={view.selection.copy}
        message={view.message}
        paletteVariantId={view.selection.paletteVariantId}
        placementId={view.selection.placementId}
        overlay={view.selection.overlay}
        fontPairingId={view.fontPairingId}
      />,
    );

    expect(screen.getByRole("heading", { name: "An Evening in the Garden" })).toBeTruthy();
    expect(screen.getByText(theme.sample.eyebrow)).toBeTruthy();
    expect(screen.getByText("The Rosewood Terrace")).toBeTruthy();
    expect(screen.getByText(theme.sample.rsvpLine)).toBeTruthy();
    expect(screen.getByText("Dinner is at seven.")).toBeTruthy();
  });

  it("layers live text over the artwork rather than baking it into an image", () => {
    const view = resolveThemeView(eventWithTheme())!;
    const { container } = render(
      <ThemeInvitation theme={view.theme} headline={view.headline} copy={view.selection.copy} />,
    );

    const img = container.querySelector("img")!;
    expect(img.getAttribute("src")).toBe(theme.artwork.fullUrl);
    // The headline is real DOM text, not part of the bitmap.
    expect(container.querySelector("h2")!.textContent).toBe("An Evening in the Garden");
  });

  it("describes the artwork for screen readers", () => {
    render(<ThemeInvitation theme={theme} headline="Hello" copy={defaultThemeCopy(theme)} />);
    expect(screen.getByAltText(theme.artwork.alt)).toBeTruthy();
  });

  it("uses the smaller asset when asked for a thumbnail", () => {
    const { container } = render(
      <ThemeInvitation theme={theme} headline="Hello" copy={defaultThemeCopy(theme)} thumbnail />,
    );
    expect(container.querySelector("img")!.getAttribute("src")).toBe(theme.artwork.thumbUrl);
  });

  it("applies the selected colourway and typeface to the headline", () => {
    const variant = theme.palettes[1];
    const pairingId = theme.fontPairingIds[1];
    const { container } = render(
      <ThemeInvitation
        theme={theme}
        headline="Hello"
        copy={defaultThemeCopy(theme)}
        paletteVariantId={variant.id}
        fontPairingId={pairingId}
      />,
    );

    const heading = container.querySelector("h2") as HTMLElement;
    expect(heading.style.fontFamily).toContain(getFontPairing(pairingId).headingFontFamily.split(",")[0].replace(/'/g, ""));
    expect(heading.style.color).toBeTruthy();
  });
});

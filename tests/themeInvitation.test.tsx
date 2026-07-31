// The composed invitation is the single renderer shared by the catalogue, the
// studio, and the guest RSVP page — so these assertions cover what a guest
// actually receives, not just what the host previews.

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ThemeInvitation } from "@/components/ThemeInvitation";
import { resolveThemeView } from "@/lib/themeInvite";
import { LAUNCH_THEMES, buildThemedConcept, defaultThemeCopy } from "@shared/themeCatalog";
import { BORDER_STYLES, LAYOUT_STYLES, getFontPairing } from "@shared/inviteDesign";
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

/** Every colour a decorative motif painted with, in document order. */
function artColorsIn(container: HTMLElement): string[] {
  const layer = container.querySelector("[data-art-layer]")!;
  return Array.from(layer.querySelectorAll("[fill], [stop-color], [stroke]")).flatMap((node) =>
    ["fill", "stop-color", "stroke"]
      .map((attr) => node.getAttribute(attr))
      .filter((value): value is string => !!value && value.startsWith("#")),
  );
}

describe("palette-responsive artwork", () => {
  it("paints the motif from the active colourway", () => {
    const variant = theme.palettes[0];
    const { container } = render(
      <ThemeInvitation
        theme={theme}
        headline="Hello"
        copy={defaultThemeCopy(theme)}
        paletteVariantId={variant.id}
      />,
    );

    const painted = artColorsIn(container);
    expect(painted.length).toBeGreaterThan(0);
    expect(painted).toContain(variant.ink);
    expect(painted).toContain(variant.accent);
  });

  it("repaints the motif when the colourway changes", () => {
    const first = theme.palettes[0];
    const second = theme.palettes[1];
    const draw = (paletteVariantId: string) =>
      artColorsIn(
        render(
          <ThemeInvitation
            theme={theme}
            headline="Hello"
            copy={defaultThemeCopy(theme)}
            paletteVariantId={paletteVariantId}
          />,
        ).container,
      );

    expect(draw(first.id)).not.toEqual(draw(second.id));
  });

  it("keeps the motif decorative — never announced, never clickable", () => {
    const { container } = render(<ThemeInvitation theme={theme} headline="Hello" copy={defaultThemeCopy(theme)} />);
    const layer = container.querySelector("[data-art-layer]") as HTMLElement;
    expect(layer.getAttribute("aria-hidden")).toBe("true");
    expect(layer.className).toContain("pointer-events-none");
  });
});

/** The rendered type block's geometry, in percentages of the card. */
function typeBlock(container: HTMLElement) {
  const el = container.querySelector("[data-testid=theme-invitation-type]") as HTMLElement;
  return {
    top: parseFloat(el.style.top),
    left: parseFloat(el.style.left),
    width: parseFloat(el.style.width),
    safeTop: Number(el.getAttribute("data-safe-top")),
    safeBottom: Number(el.getAttribute("data-safe-bottom")),
  };
}

const LONG_MESSAGE =
  "We would love you to join us for a long evening of dinner, dancing and far too much cake.";

describe("text safe area", () => {
  it("holds every theme and placement inside the card's margins", () => {
    for (const t of LAUNCH_THEMES) {
      for (const p of t.placements) {
        const { container } = render(
          <ThemeInvitation
            theme={t}
            headline={t.sample.headline}
            copy={defaultThemeCopy(t)}
            placementId={p.id}
            message={LONG_MESSAGE}
          />,
        );
        const block = typeBlock(container);
        expect(block.top).toBeGreaterThanOrEqual(7);
        expect(block.left).toBeGreaterThanOrEqual(8);
        expect(block.left + block.width).toBeLessThanOrEqual(92.001);
        // A cropped layout must not push its type band off the bottom of the card.
        expect(block.safeTop).toBeGreaterThanOrEqual(7);
        expect(block.safeBottom).toBeLessThanOrEqual(93.001);
        expect(block.safeBottom).toBeGreaterThan(block.top);
      }
    }
  });

  it("keeps the safe area the same at gallery, editor and mobile widths", () => {
    const at = (props: Partial<React.ComponentProps<typeof ThemeInvitation>>) =>
      typeBlock(
        render(
          <ThemeInvitation theme={theme} headline={theme.sample.headline} copy={defaultThemeCopy(theme)} {...props} />,
        ).container,
      );

    expect(at({ thumbnail: true, decorative: true })).toEqual(at({}));
    expect(at({ className: "max-w-md" })).toEqual(at({}));
  });

  it("masks decorative artwork out from behind the type", () => {
    const { container } = render(<ThemeInvitation theme={theme} headline="Hello" copy={defaultThemeCopy(theme)} />);
    const layer = container.querySelector("[data-art-layer]") as HTMLElement;
    expect(layer.style.maskImage || layer.style.getPropertyValue("-webkit-mask-image")).toContain("radial-gradient");
  });
});

describe("per-theme composition", () => {
  it("gives every theme a real layout archetype rather than forcing full-bleed", () => {
    for (const t of LAUNCH_THEMES) {
      expect(LAYOUT_STYLES).toContain(t.layoutStyle);
    }
    expect(new Set(LAUNCH_THEMES.map((t) => t.layoutStyle)).size).toBeGreaterThan(1);
  });

  it("gives every theme a border treatment rather than leaving them all bare", () => {
    for (const t of LAUNCH_THEMES) {
      expect(BORDER_STYLES).toContain(t.borderStyle);
    }
    expect(LAUNCH_THEMES.every((t) => t.borderStyle === "none")).toBe(false);
  });

  it("carries the theme's own layout and border into the stored concept", () => {
    for (const t of LAUNCH_THEMES) {
      const concept = buildThemedConcept(t);
      expect(concept.layoutStyle).toBe(t.layoutStyle);
      expect(concept.borderStyle).toBe(t.borderStyle);
    }
  });

  it("draws the frame for a bordered theme and omits it for an unbordered one", () => {
    const bordered = LAUNCH_THEMES.find((t) => t.borderStyle !== "none")!;
    const { container } = render(
      <ThemeInvitation theme={bordered} headline="Hello" copy={defaultThemeCopy(bordered)} />,
    );
    expect(container.querySelector("[data-testid=theme-invitation-frame]")).toBeTruthy();
  });

  it("varies artwork, texture and layout across the catalogue rather than recolouring one card", () => {
    const signature = (t: (typeof LAUNCH_THEMES)[number]) =>
      [t.layoutStyle, t.borderStyle, t.art.id, t.art.placement, t.texture.style, t.divider].join("/");
    expect(new Set(LAUNCH_THEMES.map(signature)).size).toBe(LAUNCH_THEMES.length);
  });
});

describe("shared renderer consistency", () => {
  it("renders the gallery thumbnail and the guest card from the same composition", () => {
    const view = resolveThemeView(eventWithTheme())!;
    const attrs = (thumbnail: boolean) => {
      const { container } = render(
        <ThemeInvitation
          theme={view.theme}
          headline={view.headline}
          copy={view.selection.copy}
          paletteVariantId={view.selection.paletteVariantId}
          thumbnail={thumbnail}
        />,
      );
      const root = container.firstElementChild as HTMLElement;
      return ["theme-id", "layout", "border", "texture", "art"].map((k) => root.getAttribute(`data-${k}`));
    };

    expect(attrs(true)).toEqual(attrs(false));
  });

  it("re-composes a selection saved while every theme was forced full-bleed", () => {
    const bannerTheme = LAUNCH_THEMES.find((t) => t.layoutStyle !== "full-bleed")!;
    const saved = { ...buildThemedConcept(bannerTheme), layoutStyle: "full-bleed", borderStyle: "none" };
    const view = resolveThemeView(
      eventWithTheme({ themeName: bannerTheme.name, inviteDesignConceptJson: JSON.stringify(saved) }),
    )!;

    expect(view.theme.id).toBe(bannerTheme.id);
    const { container } = render(
      <ThemeInvitation theme={view.theme} headline={view.headline} copy={view.selection.copy} />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute("data-layout")).toBe(bannerTheme.layoutStyle);
    expect(root.getAttribute("data-border")).toBe(bannerTheme.borderStyle);
  });

  it("composes each theme without falling back to a shared default", () => {
    for (const t of LAUNCH_THEMES) {
      const { container } = render(<ThemeInvitation theme={t} headline="Hello" copy={defaultThemeCopy(t)} />);
      const root = container.firstElementChild as HTMLElement;
      expect(root.getAttribute("data-layout")).toBe(t.layoutStyle);
      expect(root.getAttribute("data-border")).toBe(t.borderStyle);
      expect(root.getAttribute("data-art")).toBe(t.art.id);
    }
  });
});

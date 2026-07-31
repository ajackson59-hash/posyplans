// Live-QA follow-ups to the curated studio, covered where they actually
// manifest — in the rendered DOM:
//
//   * the editor pulling itself into view when a host picks a design from far
//     down the gallery, and keeping its tabs reachable while scrolling
//   * postage being a real second control rather than a renamed wax seal
//   * the "Customize this design" action being discoverable without a hover

import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  LAUNCH_THEMES,
  buildThemedConcept,
  defaultThemeCopy,
  getPostageStamp,
} from "@shared/themeCatalog";
import type { EventRecord } from "@/lib/types";

const apiRequestJson = vi.fn(async () => ({}));

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(),
  apiRequestJson: (...args: unknown[]) => apiRequestJson(...(args as [])),
  queryClient: { invalidateQueries: vi.fn() },
}));

const InviteStudio = (await import("@/components/InviteStudio")).default;
const ThemeChooser = (await import("@/components/ThemeChooser")).default;
const EnvelopeMockup = (await import("@/components/EnvelopeMockup")).default;

const theme = LAUNCH_THEMES[0];

function themedEvent(overrides: Partial<EventRecord> = {}): EventRecord {
  const concept = buildThemedConcept(theme, { copy: defaultThemeCopy(theme) });
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
    inviteMessage: "",
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
  } as EventRecord;
}

function withQuery(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const scrollIntoView = vi.fn();

beforeEach(() => {
  apiRequestJson.mockClear();
  scrollIntoView.mockClear();
  // jsdom implements neither; both are optional-chained in the component, so
  // stubbing them is what lets the assertions see the calls at all.
  Element.prototype.scrollIntoView = scrollIntoView;
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

describe("editor navigation visibility", () => {
  it("brings the editor into view and focuses its heading on arrival from the chooser", () => {
    withQuery(<InviteStudio ownerToken="tok" event={themedEvent()} onChangeDesign={() => {}} focusOnMount />);

    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.calls[0][0]).toMatchObject({ block: "start" });
    expect(document.activeElement).toBe(screen.getByTestId("heading-studio"));
  });

  it("scrolls without animation when the host prefers reduced motion", () => {
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;

    withQuery(<InviteStudio ownerToken="tok" event={themedEvent()} onChangeDesign={() => {}} focusOnMount />);

    expect(scrollIntoView.mock.calls[0][0]).toMatchObject({ behavior: "auto" });
  });

  it("leaves a returning host where they are", () => {
    withQuery(<InviteStudio ownerToken="tok" event={themedEvent()} onChangeDesign={() => {}} />);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("keeps the tab row sticky inside the control pane", () => {
    withQuery(<InviteStudio ownerToken="tok" event={themedEvent()} onChangeDesign={() => {}} />);
    const tabs = screen.getByTestId("studio-tablist");
    expect(tabs.className).toContain("sticky");
    // top-0 is only safe because nothing is fixed above it; a site header would
    // need an offset here instead.
    expect(tabs.className).toContain("top-0");
  });
});

describe("postage stamp is its own control", () => {
  it("offers the theme's curated postage alongside, not instead of, the wax seal", () => {
    withQuery(<InviteStudio ownerToken="tok" event={themedEvent()} onChangeDesign={() => {}} />);
    fireEvent.click(screen.getByTestId("tab-envelope"));

    expect(screen.getByRole("radiogroup", { name: "Postage stamp" })).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "Wax seal" })).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "Envelope paper" })).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "Envelope liner" })).toBeTruthy();

    const postage = screen.getByRole("radiogroup", { name: "Postage stamp" });
    expect(within(postage).getAllByRole("radio").length).toBeGreaterThanOrEqual(3);
  });

  it("persists a postage choice through the curated theme route", async () => {
    withQuery(<InviteStudio ownerToken="tok" event={themedEvent()} onChangeDesign={() => {}} />);
    fireEvent.click(screen.getByTestId("tab-envelope"));

    const choice = theme.envelope.stamps[2];
    fireEvent.click(screen.getByTestId(`swatch-postage-${choice.id}`));

    // The studio autosaves on a debounce, so the request is not synchronous.
    await waitFor(() => expect(apiRequestJson).toHaveBeenCalled(), { timeout: 3000 });

    const [method, url, body] = apiRequestJson.mock.calls.at(-1)!;
    expect(method).toBe("PATCH");
    expect(url).toContain("/invite/theme");
    expect(body.postageStampId).toBe(choice.id);
  });

  it("draws the selected postage on the envelope, with its own paper and face value", () => {
    withQuery(<InviteStudio ownerToken="tok" event={themedEvent()} onChangeDesign={() => {}} />);
    const applied = getPostageStamp(theme, undefined);

    // The preview envelope and the three swatches all draw a stamp, so scope to
    // the one inside the mockup.
    const envelope = screen.getByTestId("button-open-envelope");
    const stamp = within(envelope).getByTestId("svg-envelope-stamp");
    expect(within(stamp).getByTestId("text-stamp-denomination").textContent).toContain(applied.denomination);
    expect(within(stamp).getByTestId("text-stamp-caption").textContent).toBe(applied.caption);
    expect(stamp.getAttribute("aria-label")).toBe(`${applied.label} stamp`);
  });

  it("shows postage and a wax seal at the same time, the way real mail carries both", () => {
    const postage = theme.envelope.stamps[0];
    const { container } = render(
      <EnvelopeMockup
        envelopeColor="#e8e0d2"
        linerPattern="stripe"
        linerColor="#6d3f52"
        linerBaseColor="#f5ece0"
        stampStyle="wax-seal"
        stampColor="#6d3f52"
        postage={postage}
        finish="premium"
        addressee="For Maya"
        opened={false}
        interactive={false}
      />,
    );

    // A "wax-seal" style used to swallow the corner postage entirely.
    expect(within(container).getByTestId("svg-envelope-stamp")).toBeTruthy();
    expect(container.textContent).toContain(postage.caption);
  });

  it("leaves the pre-curated envelope alone when no postage is supplied", () => {
    const { container } = render(
      <EnvelopeMockup
        envelopeColor="#e8e0d2"
        linerPattern="stripe"
        linerColor="#6d3f52"
        linerBaseColor="#f5ece0"
        stampStyle="wax-seal"
        stampColor="#6d3f52"
        finish="premium"
        addressee="For Maya"
        opened={false}
        interactive={false}
      />,
    );

    expect(container.querySelector('[data-testid="svg-envelope-stamp"]')).toBeNull();
  });
});

describe("horizontal bleed", () => {
  // A 390px audit flagged 16px of protrusion on the dashboard's tab container.
  // Measured in Chromium, the only child past its right edge was the tab nav's
  // own intentional `-mx-4` full-bleed; the invitation section contributed
  // nothing. These guard that it stays that way — a stray negative horizontal
  // margin here would push real content off-screen on a phone, and unlike the
  // tab nav there would be no matching padding to put it back.
  function negativeMargins(root: HTMLElement) {
    return Array.from(root.querySelectorAll<HTMLElement>("*"))
      .map((el) => (typeof el.className === "string" ? el.className : ""))
      .filter((cls) => /(^|\s)-m[xlr]-/.test(cls));
  }

  it("keeps the editor inside its column", () => {
    const { container } = withQuery(
      <InviteStudio ownerToken="tok" event={themedEvent()} onChangeDesign={() => {}} />,
    );
    expect(negativeMargins(container)).toEqual([]);
  });

  it("keeps the chooser inside its column", () => {
    const { container } = withQuery(
      <ThemeChooser ownerToken="tok" event={themedEvent()} onCustomTheme={() => {}} onThemeApplied={() => {}} />,
    );
    expect(negativeMargins(container)).toEqual([]);
  });
});

describe("choose-a-design call to action", () => {
  it("shows a persistent action on every card rather than relying on hover", () => {
    withQuery(
      <ThemeChooser ownerToken="tok" event={themedEvent()} onCustomTheme={() => {}} onThemeApplied={() => {}} />,
    );

    for (const t of LAUNCH_THEMES) {
      const cta = screen.getByTestId(`cta-launch-theme-${t.id}`);
      expect(cta.className).not.toContain("opacity-0");
      expect(cta.textContent).toMatch(/Customize this design|Keep customizing/);
    }
  });

  it("reserves the artwork overlay for hover-capable pointers", () => {
    withQuery(
      <ThemeChooser ownerToken="tok" event={themedEvent()} onCustomTheme={() => {}} onThemeApplied={() => {}} />,
    );

    const card = screen.getByTestId(`card-launch-theme-${LAUNCH_THEMES[1].id}`);
    const overlay = Array.from(card.querySelectorAll("span")).find((el) =>
      el.textContent === "Customize this design" && el.className.includes("absolute"),
    );
    expect(overlay).toBeTruthy();
    expect(overlay!.className).toContain("[@media(hover:hover)]:flex");
    expect(overlay!.className).toContain("hidden");
  });
});

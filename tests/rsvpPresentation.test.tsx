// Guest-facing presentation guards. The invitation is the reveal; the RSVP
// controls should not compete with a sealed envelope, and desktop should use
// the available width as an intentional two-column composition once revealed.

import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { buildThemedConcept, LAUNCH_THEMES } from "@shared/themeCatalog";
import type { EventRecord } from "@/lib/types";

vi.mock("@/lib/queryClient", () => ({ apiRequest: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const Rsvp = (await import("@/pages/Rsvp")).default;

function publicEvent(withConcept: boolean): Omit<EventRecord, "ownerToken"> {
  const concept = buildThemedConcept(LAUNCH_THEMES[0]);
  return {
    id: 43,
    shareSlug: "qa",
    eventName: "I'm 3 and Diggin' It",
    eventType: "Birthday Party",
    eventDate: "Sat, Aug 8, 2026",
    location: "Hidden Valley",
    hostNames: "Alex",
    themeName: withConcept ? LAUNCH_THEMES[0].name : "",
    paletteColors: JSON.stringify(concept.paletteColors),
    inviteSubject: "You're invited!",
    inviteMessage: "We can't wait to celebrate with you.",
    inviteArtworkUrl: "",
    inviteFontFamily: "classic-serif",
    inviteAccentColor: "",
    inviteDesignConceptJson: withConcept ? JSON.stringify(concept) : "{}",
    inviteIllustrationUrl: withConcept ? LAUNCH_THEMES[0].artwork.fullUrl : "",
    customInviteImageUrl: "",
    inviteRenderMode: "",
    envelopeColor: withConcept ? "#f5efe0" : "",
    envelopeLinerPattern: withConcept ? "floral" : "",
    stampStyle: withConcept ? "seal" : "",
    linerColor: "#4a3728",
    stampColor: "#2c1f0e",
    rsvpRestriction: "none",
    rsvpDeadline: "",
    inviteStatus: "published",
    rsvpPhone: "",
  } as Omit<EventRecord, "ownerToken">;
}

function renderRsvp(withConcept: boolean) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, queryFn: async () => publicEvent(withConcept) },
    },
  });
  const { hook } = memoryLocation({ path: "/rsvp/qa" });
  render(
    <QueryClientProvider client={client}>
      <Router hook={hook}>
        <Route path="/rsvp/:shareSlug" component={Rsvp} />
      </Router>
    </QueryClientProvider>,
  );
}

describe("RSVP presentation", () => {
  it("keeps RSVP controls behind the sealed-envelope reveal", async () => {
    renderRsvp(true);

    await waitFor(() => expect(screen.getByTestId("button-open-envelope")).toBeTruthy());
    expect(screen.queryByTestId("input-guest-search")).toBeNull();
    expect(screen.queryByTestId("section-rsvp-controls")).toBeNull();

    const label = screen.getByTestId("text-envelope-addressee");
    expect(label.className).toContain("border");
    expect(label.style.backgroundColor).not.toBe("");
    expect(screen.getByTestId("envelope-flap-front")).toBeTruthy();
    expect(screen.getByTestId("envelope-flap-liner")).toBeTruthy();
  });

  it("centers the brand and frames the desktop RSVP page with side rails", async () => {
    renderRsvp(false);

    await waitFor(() => expect(screen.getByTestId("input-guest-search")).toBeTruthy());
    expect(screen.getByTestId("rsvp-header-inner").className).toContain("justify-center");
    expect(screen.getByTestId("rsvp-main").className).toContain("max-w-5xl");
    expect(screen.getByTestId("rsvp-main").className).toContain("lg:border-x");
    expect(screen.getByTestId("rsvp-presentation-grid").className).toContain("lg:grid-cols-");
    expect(screen.getByTestId("rsvp-invitation-mount").className).not.toContain("rounded");
    expect(screen.getByTestId("section-rsvp-controls").className).toContain("lg:border");
  });
});

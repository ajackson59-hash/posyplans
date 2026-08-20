// Guest-facing presentation guards. The invitation is the reveal and desktop
// keeps it as the focal point, with the complete RSVP flow directly below.

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { buildThemedConcept, LAUNCH_THEMES } from "@shared/themeCatalog";
import type { EventRecord } from "@/lib/types";
import { apiRequest } from "@/lib/queryClient";

vi.mock("@/lib/queryClient", () => ({ apiRequest: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const Rsvp = (await import("@/pages/Rsvp")).default;
const mockedApiRequest = vi.mocked(apiRequest);

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

    expect(screen.getByTestId("envelope-stage").className).toContain("max-w-lg");
    expect(screen.getByTestId("envelope-front")).toBeTruthy();
    expect(screen.getByTestId("envelope-back")).toBeTruthy();
    expect(screen.getByTestId("text-envelope-addressee").className).not.toContain("border");
    expect(screen.getByTestId("envelope-flap-front")).toBeTruthy();
    expect(screen.getByTestId("envelope-flap-liner")).toBeTruthy();

    fireEvent.click(screen.getByTestId("button-open-envelope"));
    expect(screen.getByTestId("envelope-mailpiece").style.transform).toBe("rotateY(180deg)");
    expect(screen.getByTestId("envelope-flap").style.transform).toBe("rotateX(-168deg)");
  });

  it("makes the invitation the focal point and stacks the complete RSVP area below it", async () => {
    mockedApiRequest.mockReset();
    renderRsvp(false);

    await waitFor(() => expect(screen.getByTestId("input-guest-search")).toBeTruthy());
    expect(screen.getByTestId("rsvp-header-inner").className).toContain("justify-center");
    expect(screen.getByTestId("rsvp-main").className).toContain("max-w-5xl");
    expect(screen.getByTestId("rsvp-main").className).not.toContain("border-x");
    expect(screen.getByTestId("rsvp-side-shade-left")).toBeTruthy();
    expect(screen.getByTestId("rsvp-side-shade-right")).toBeTruthy();
    expect(screen.getByTestId("rsvp-presentation-stack").className).toContain("max-w-2xl");
    expect(screen.getByTestId("rsvp-presentation-stack").className).not.toContain("grid-cols");

    const invite = screen.getByTestId("rsvp-invitation-mount");
    const controls = screen.getByTestId("section-rsvp-controls");
    expect(invite.compareDocumentPosition(controls) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(controls.className).toContain("sm:border");

    mockedApiRequest.mockResolvedValueOnce({
      json: async () => [{ id: 9, name: "Maya Rivera", group: "Family", rsvpStatus: "pending" }],
    } as Response);
    fireEvent.change(screen.getByTestId("input-guest-search"), { target: { value: "Maya" } });
    await waitFor(() => expect(screen.getByTestId("button-select-guest-9")).toBeTruthy());
    fireEvent.click(screen.getByTestId("button-select-guest-9"));
    fireEvent.click(screen.getByTestId("button-rsvp-yes"));

    expect(screen.getByTestId("button-adults-increment")).toBeTruthy();
    expect(screen.getByTestId("text-children-value")).toBeTruthy();
    expect(screen.getByTestId("textarea-rsvp-note")).toBeTruthy();
    expect(screen.getByTestId("checkbox-sms-opt-in")).toBeTruthy();
  });
});

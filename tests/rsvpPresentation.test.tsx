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

const personalizedGuest = {
  name: "Maya Rivera",
  group: "Family",
  partySize: 2,
  rsvpStatus: "pending" as const,
  attendingCount: null,
  attendingAdults: null,
  attendingChildren: null,
  note: "",
};

function renderRsvp(withConcept: boolean, path = "/rsvp/qa") {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: async ({ queryKey }) =>
          String(queryKey[0]).includes("/guest/") ? personalizedGuest : publicEvent(withConcept),
      },
    },
  });
  const { hook } = memoryLocation({ path });
  render(
    <QueryClientProvider client={client}>
      <Router hook={hook}>
        <Route path="/rsvp/:shareSlug/g/:guestToken" component={Rsvp} />
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
    expect(screen.getByTestId("envelope-mailpiece").style.transform).toBe("translateY(10%) rotateY(180deg)");
    expect(screen.getByTestId("envelope-flap").style.transform).toBe("rotateX(-108deg)");
    expect(screen.getByTestId("envelope-flap").style.transition).not.toContain("1.56");
    expect(screen.getByTestId("envelope-card-reveal").style.transform).toBe("translateY(-28%)");
  });

  it("makes the invitation the focal point and stacks the complete RSVP area below it", async () => {
    mockedApiRequest.mockReset();
    renderRsvp(false);

    await waitFor(() => expect(screen.getByTestId("form-identify-guest")).toBeTruthy());
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
      json: async () => ({ guest: personalizedGuest, guestToken: "a".repeat(32) }),
    } as Response);
    fireEvent.change(screen.getByTestId("input-guest-name-verify"), { target: { value: "Maya Rivera" } });
    fireEvent.change(screen.getByTestId("input-guest-contact-verify"), { target: { value: "maya@example.com" } });
    fireEvent.click(screen.getByTestId("button-verify-guest"));
    await waitFor(() => expect(screen.getByTestId("text-selected-guest").textContent).toContain("Maya Rivera"));
    fireEvent.click(screen.getByTestId("button-rsvp-yes"));

    expect(screen.getByTestId("button-adults-increment")).toBeTruthy();
    expect(screen.getByTestId("text-children-value")).toBeTruthy();
    expect(screen.getByTestId("textarea-rsvp-note")).toBeTruthy();
    expect(screen.getByTestId("checkbox-sms-opt-in")).toBeTruthy();
  });

  it("opens a recipient-specific link already addressed and never shows guest search", async () => {
    mockedApiRequest.mockReset();
    renderRsvp(true, `/rsvp/qa/g/${"b".repeat(32)}`);

    await waitFor(() => expect(screen.getByTestId("text-envelope-addressee").textContent).toBe("For Maya"));
    expect(screen.queryByTestId("form-identify-guest")).toBeNull();
    expect(screen.queryByTestId("input-guest-name-verify")).toBeNull();
  });

  it("submits RSVP and SMS consent with the guest token instead of a numeric id", async () => {
    mockedApiRequest.mockReset();
    mockedApiRequest.mockResolvedValue({ json: async () => personalizedGuest } as Response);
    const token = "c".repeat(32);
    renderRsvp(false, `/rsvp/qa/g/${token}`);

    await waitFor(() => expect(screen.getByTestId("text-selected-guest")).toBeTruthy());
    fireEvent.click(screen.getByTestId("button-rsvp-yes"));
    fireEvent.click(screen.getByTestId("button-adults-increment"));
    fireEvent.click(screen.getByTestId("checkbox-sms-opt-in"));
    fireEvent.change(screen.getByTestId("input-sms-phone"), { target: { value: "555-555-1212" } });
    fireEvent.click(screen.getByTestId("button-submit-rsvp"));

    await waitFor(() => expect(mockedApiRequest).toHaveBeenCalledWith(
      "POST",
      `/api/events/public/qa/guest/${token}/rsvp`,
      expect.objectContaining({ status: "yes", attendingCount: 2 }),
    ));
    expect(mockedApiRequest).toHaveBeenCalledWith(
      "POST",
      `/api/events/public/qa/guest/${token}/sms-opt-in`,
      { optIn: true, phone: "555-555-1212" },
    );
  });
});

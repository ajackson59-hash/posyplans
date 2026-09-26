import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Router, Switch } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { buildThemedConcept, LAUNCH_THEMES } from "@shared/themeCatalog";
import type { EventRecord } from "@/lib/types";

const request = vi.fn();
vi.mock("@/lib/queryClient", () => ({ apiRequest: (...args: unknown[]) => request(...args) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
const { default: Rsvp, InvitationPreview } = await import("@/pages/Rsvp");

const savedEvent = {
  id: 65,
  ownerToken: "private-owner",
  shareSlug: "draft-share",
  eventName: "Construction celebration",
  eventType: "Birthday",
  eventDate: "October 10, 2026",
  hostNames: "Test host",
  location: "Test venue",
  inviteStatus: "draft",
  inviteSubject: "Come celebrate!",
  inviteMessage: "Our saved invitation wording.",
  inviteArtworkUrl: "/api/events/owner/private-owner/invite/assets/inviteArtworkUrl?v=saved",
  inviteIllustrationUrl: "",
  inviteDesignConceptJson: "{}",
  paletteColors: "[]",
  rsvpRestriction: "plus_one",
  rsvpDeadline: "",
  rsvpPhone: "",
} as EventRecord;

function show(event = savedEvent, options: { path?: string; rejectOwner?: boolean } = {}) {
  request.mockReset();
  const query = vi.fn(async ({ queryKey }: { queryKey: readonly unknown[] }) => {
    const path = String(queryKey[0]);
    if (path === "/api/events/owner/private-owner") {
      if (options.rejectOwner) throw new Error("Event not found");
      return { event };
    }
    if (path === "/api/events/public/draft-share") return event;
    throw new Error(`Unexpected request: ${path}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { queryFn: query, retry: false } } });
  const { hook } = memoryLocation({ path: options.path ?? "/dashboard/private-owner/invitation-preview" });
  render(
    <QueryClientProvider client={client}>
      <Router hook={hook}>
        <Switch>
          <Route path="/dashboard/:ownerToken/invitation-preview" component={InvitationPreview} />
          <Route path="/rsvp/:shareSlug" component={Rsvp} />
        </Switch>
      </Router>
    </QueryClientProvider>,
  );
  return { query };
}

afterEach(() => vi.useRealTimers());

describe("private host invitation preview", () => {
  it("shows the saved draft with owner artwork without requesting public or guest routes", async () => {
    const { query } = show();
    const image = await screen.findByTestId("img-rsvp-artwork");
    expect(image.getAttribute("src")).toBe(savedEvent.inviteArtworkUrl);
    expect(screen.getByText("Our saved invitation wording.")).toBeTruthy();
    expect(screen.getByTestId("private-invitation-preview").textContent).toContain("still a draft");
    expect(screen.queryByTestId("text-draft-title")).toBeNull();
    expect(screen.queryByTestId("section-rsvp-controls")).toBeNull();
    expect(screen.queryByTestId("form-identify-guest")).toBeNull();
    expect(screen.getByRole("link", { name: "Back to your event" }).getAttribute("href")).toBe("/dashboard/private-owner");
    expect(query.mock.calls.map(([args]) => args.queryKey[0])).toEqual(["/api/events/owner/private-owner"]);
    expect(request).not.toHaveBeenCalled();
  });

  it("keeps the public draft blocked even if a preview query parameter is supplied", async () => {
    show(savedEvent, { path: "/rsvp/draft-share?preview=true" });
    await screen.findByTestId("text-draft-title");
    expect(screen.queryByTestId("img-rsvp-artwork")).toBeNull();
    expect(screen.queryByTestId("section-rsvp-controls")).toBeNull();
    expect(screen.queryByTestId("private-invitation-preview")).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it("does not fall back to the public event when owner access fails", async () => {
    const { query } = show(savedEvent, { rejectOwner: true });
    await screen.findByText("We couldn't open this private preview");
    expect(screen.queryByTestId("img-rsvp-artwork")).toBeNull();
    expect(query.mock.calls.map(([args]) => args.queryKey[0])).toEqual(["/api/events/owner/private-owner"]);
    expect(request).not.toHaveBeenCalled();
  });

  it("also prevents RSVP activity while privately previewing a published invitation", async () => {
    show({ ...savedEvent, inviteStatus: "published" });
    await screen.findByTestId("img-rsvp-artwork");
    expect(screen.getByTestId("private-invitation-preview").textContent).toContain("invitation is live");
    expect(screen.queryByTestId("section-rsvp-controls")).toBeNull();
    expect(screen.queryByTestId("button-submit-rsvp")).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it("previews the envelope reveal without unlocking guest actions or saving anything", async () => {
    const concept = buildThemedConcept(LAUNCH_THEMES[0]);
    show({ ...savedEvent, inviteDesignConceptJson: JSON.stringify(concept),
      inviteIllustrationUrl: LAUNCH_THEMES[0].artwork.fullUrl, envelopeColor: "#f5efe0",
      envelopeLinerPattern: "floral", stampStyle: "seal" });
    const open = await screen.findByTestId("button-open-envelope");
    vi.useFakeTimers();
    fireEvent.click(open);
    await act(async () => { vi.advanceTimersByTime(10000); });
    expect(screen.queryByTestId("button-open-envelope")).toBeNull();
    expect(screen.getByTestId("rsvp-invitation-mount")).toBeTruthy();
    expect(screen.queryByTestId("section-rsvp-controls")).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });
});

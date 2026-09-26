import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

const mocks = vi.hoisted(() => ({ request: vi.fn(), toast: vi.fn() }));
vi.mock("@/lib/queryClient", () => ({ apiRequest: mocks.request }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
const Rsvp = (await import("@/pages/Rsvp")).default;
const tokenA = "a".repeat(32), tokenB = "b".repeat(32);
const guest = (name = "Maya Rivera", overrides = {}) => ({ name, group: "Family", partySize: 4,
  rsvpStatus: "pending", attendingCount: null, attendingAdults: null, attendingChildren: null, note: "", ...overrides });
const event = (overrides = {}) => ({ id: 1, shareSlug: "qa", eventName: "Birthday", eventType: "Birthday",
  eventDate: "Saturday", location: "Garden", hostNames: "Alex", themeName: "", paletteColors: "[]",
  inviteSubject: "Join us", inviteMessage: "Celebrate with us", inviteDesignConceptJson: "{}",
  inviteArtworkUrl: "", inviteIllustrationUrl: "", customInviteImageUrl: "", inviteRenderMode: "",
  inviteStatus: "published", rsvpRestriction: "none", ...overrides });
function show(eventOverrides = {}, guestOverrides = {}) {
  const route = memoryLocation({ path: `/rsvp/qa/g/${tokenA}` });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0,
    queryFn: async ({ queryKey }) => String(queryKey[0]).includes('/guest/')
      ? guest(String(queryKey[0]).endsWith(tokenB) ? "Noah Rivera" : "Maya Rivera", guestOverrides)
      : event(eventOverrides) } } });
  render(<QueryClientProvider client={client}><Router hook={route.hook}>
    <Route path="/rsvp/:shareSlug/g/:guestToken" component={Rsvp} />
    <Route path="/rsvp/:shareSlug" component={Rsvp} />
  </Router></QueryClientProvider>);
  return { route, client };
}
beforeEach(() => vi.resetAllMocks());

describe("RSVP continuation", () => {
  it("keeps a plus-one allowance to two people across adults and children", async () => {
    show({ rsvpRestriction: "plus_one" });
    await screen.findByTestId("text-selected-guest");
    fireEvent.click(screen.getByTestId("button-rsvp-yes"));
    fireEvent.click(screen.getByTestId("button-adults-increment"));
    fireEvent.click(screen.getByTestId("button-children-increment"));
    expect(screen.getByTestId("text-adults-value").textContent).toBe("2");
    expect(screen.getByTestId("text-children-value").textContent).toBe("0");
  });
  it("confirms the saved headcount and offers to amend the saved response", async () => {
    mocks.request.mockResolvedValue({ json: async () => guest("Maya Rivera", { rsvpStatus: "yes", attendingCount: 1,
      attendingAdults: 1, attendingChildren: 0, note: "Saved note" }) });
    show(); await screen.findByTestId("text-selected-guest");
    fireEvent.click(screen.getByTestId("button-rsvp-yes"));
    fireEvent.click(screen.getByTestId("button-adults-increment"));
    fireEvent.click(screen.getByTestId("button-submit-rsvp"));
    expect((await screen.findByTestId("card-thank-you")).textContent).toContain("for 1 guest");
    fireEvent.click(screen.getByTestId("button-update-rsvp"));
    expect(screen.queryByTestId("card-thank-you")).toBeNull();
    expect((screen.getByTestId("textarea-rsvp-note") as HTMLTextAreaElement).value).toBe("Saved note");
    expect(screen.getByTestId("text-adults-value").textContent).toBe("1");
  });
  it("does not carry a previous recipient's response into another personal link", async () => {
    const { route } = show(); await screen.findByTestId("text-selected-guest");
    fireEvent.click(screen.getByTestId("button-rsvp-yes"));
    fireEvent.change(screen.getByTestId("textarea-rsvp-note"), { target: { value: "Maya's private note" } });
    await act(async () => route.navigate(`/rsvp/qa/g/${tokenB}`));
    await waitFor(() => expect(screen.getByTestId("text-selected-guest").textContent).toBe("Noah Rivera"));
    expect((screen.getByTestId("textarea-rsvp-note") as HTMLTextAreaElement).value).toBe("");
  });
  it("does not reconcile a lost response against a different adult/child breakdown", async () => {
    mocks.request.mockImplementation(async (method) => {
      if (method === "POST") throw new Error("Network request failed before reaching server");
      return { json: async () => guest("Maya Rivera", { rsvpStatus: "yes", attendingCount: 2, attendingAdults: 1, attendingChildren: 1 }) };
    });
    show({}, { rsvpStatus: "yes", attendingCount: 2, attendingAdults: 1, attendingChildren: 1 });
    await screen.findByTestId("text-selected-guest");
    fireEvent.click(screen.getByTestId("button-children-decrement"));
    fireEvent.click(screen.getByTestId("button-adults-increment"));
    fireEvent.click(screen.getByTestId("button-submit-rsvp"));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Couldn't submit RSVP" })), { timeout: 2500 });
    expect(screen.queryByTestId("card-thank-you")).toBeNull();
  });
  it("keeps an image reused without a design concept at its full native ratio", async () => {
    show({ inviteArtworkUrl: "/api/events/public/qa/invite/assets/inviteArtworkUrl?v=fixture" });
    const image = await screen.findByTestId("img-rsvp-artwork");
    expect(image.className).toContain("h-auto");
    expect(image.className).not.toContain("object-cover");
  });
  it("shows the unpublished message and never loads the private guest record", async () => {
    const { client } = show({ inviteStatus: "draft" });
    await screen.findByTestId("text-draft-title");
    expect(screen.queryByTestId("text-selected-guest")).toBeNull();
    expect(screen.queryByTestId("button-submit-rsvp")).toBeNull();
    expect(client.getQueryData([`/api/events/public/qa/guest/${tokenA}`])).toBeUndefined();
  });
  it("recognizes a response lost after save when every RSVP field matches", async () => {
    mocks.request.mockImplementation(async (method) => {
      if (method === "POST") throw new Error("Response lost after save");
      return { json: async () => guest("Maya Rivera", { rsvpStatus: "yes", attendingCount: 1, attendingAdults: 1, attendingChildren: 0 }) };
    });
    show(); await screen.findByTestId("text-selected-guest");
    fireEvent.click(screen.getByTestId("button-rsvp-yes"));
    fireEvent.click(screen.getByTestId("button-submit-rsvp"));
    await screen.findByTestId("card-thank-you");
    expect(mocks.request.mock.calls.filter(([method]) => method === "POST")).toHaveLength(1);
  });
});

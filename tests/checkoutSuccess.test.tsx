import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => ({ request: vi.fn(), navigate: vi.fn(), track: vi.fn() }));
vi.mock("@/lib/queryClient", () => ({ apiRequestJson: mocks.request }));
vi.mock("@/lib/analytics", () => ({ trackEvent: mocks.track, isMarketingConsentGranted: () => false }));
vi.mock("wouter", () => ({ useLocation: () => ["/checkout/success", mocks.navigate], Link: ({ children }: any) => <a>{children}</a> }));
const CheckoutSuccess = (await import("@/pages/CheckoutSuccess")).default;
let client: QueryClient;
beforeEach(() => {
  vi.resetAllMocks();
  window.history.pushState({}, "", "/checkout/success?session_id=cs_test_local&returnToken=unverified-return");
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(() => { cleanup(); client.clear(); });
function show() { render(<QueryClientProvider client={client}><CheckoutSuccess /></QueryClientProvider>); }

describe("checkout return screen", () => {
  it("keeps pending payment out of success and can retry without a second checkout", async () => {
    mocks.request.mockRejectedValueOnce(new Error("Payment is still being confirmed; do not pay again."))
      .mockResolvedValueOnce({ plan: "plus", planTier: "plus_active", returnToken: "verified-event", email: null });
    show();
    await screen.findByTestId("text-checkout-error-title");
    expect(screen.queryByTestId("text-checkout-success-title")).toBeNull();
    expect(mocks.track).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("button-retry-payment-confirmation"));
    expect((await screen.findByTestId("text-checkout-success-title")).textContent).toBe("You're on Plus");
    expect(mocks.request.mock.calls.every(([method, path]) => method === "GET" && path.startsWith("/api/checkout/confirm?"))).toBe(true);
    fireEvent.click(screen.getByTestId("button-back-home"));
    expect(mocks.navigate).toHaveBeenCalledWith("/dashboard/verified-event");
  });
  it.each([
    { plan: "plus", planTier: "plus_expired" },
    { plan: "plus", planTier: "plus_trial", trialEndsAt: 1 },
    { plan: "spark", unlocked: false },
  ])("does not present unusable access as success: %j", async (result) => {
    mocks.request.mockResolvedValue({ ...result, firedEvent: "subscribed" }); show();
    await screen.findByTestId("text-checkout-error-title");
    expect(screen.queryByTestId("text-checkout-success-title")).toBeNull();
    expect(screen.getByTestId("button-back-home").textContent).toBe("Back to my event");
    expect(mocks.track).not.toHaveBeenCalled();
  });
  it("labels a valid legacy trial accurately", async () => {
    mocks.request.mockResolvedValue({ plan: "plus", planTier: "plus_trial", trialEndsAt: Date.now() + 3600000 }); show();
    expect((await screen.findByTestId("text-checkout-success-title")).textContent).toBe("Your Plus trial is active");
  });
  it("routes a confirmed Spark purchase back to its verified event", async () => {
    mocks.request.mockResolvedValue({ plan: "spark", unlocked: true, returnToken: "purchased-event" }); show();
    await screen.findByTestId("text-checkout-success-title");
    fireEvent.click(screen.getByTestId("button-back-home"));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith("/draft-generating/purchased-event"));
  });
});

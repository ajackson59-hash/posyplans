// The personalized preview is the pre-payment value proof. A host's first
// submit must reveal it, not race directly to Stripe, while a provider failure
// must still leave checkout available.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiRequestJson = vi.fn();

vi.mock("@/lib/queryClient", () => ({
  apiRequestJson: (...args: unknown[]) => apiRequestJson(...args),
}));

vi.mock("@/lib/eventRecovery", () => ({ touchRecentEvent: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/components/AIDemoShowcase", () => ({
  default: () => <div data-testid="paywall-demo" />,
}));

const DraftGenerating = (await import("@/pages/DraftGenerating")).default;

const OWNER = "preview-owner-token";
const EMAIL = "alex+fresh-preview@example.com";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderPaywall() {
  const { hook } = memoryLocation({ path: `/draft-generating/${OWNER}` });
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: async ({ queryKey }) => {
          if (queryKey[0] === "/api/checkout/config") return { configured: true };
          throw new Error(`Unexpected query: ${String(queryKey[0])}`);
        },
      },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={client}>
      <Router hook={hook}>
        <Route path="/draft-generating/:ownerToken" component={DraftGenerating} />
      </Router>
    </QueryClientProvider>,
  );
}

function callsTo(path: string) {
  return apiRequestJson.mock.calls.filter(([, url]) => url === path);
}

beforeEach(() => {
  apiRequestJson.mockReset();
});

describe("DraftGenerating pre-payment preview", () => {
  it("reveals the personalized preview before allowing a Spark checkout", async () => {
    const preview = deferred<{ ready: boolean }>();
    const checkout = deferred<{ url: string }>();

    apiRequestJson.mockImplementation((method: string, url: string) => {
      if (method === "GET" && url.endsWith("/master-planner/entitlement")) {
        return Promise.resolve({
          eventId: 91,
          freeDraftState: "none",
          emailCaptured: false,
          planTier: "spark",
          sparkUnlocked: false,
          canGenerate: false,
        });
      }
      if (method === "POST" && url.endsWith("/prepayment-preview")) return preview.promise;
      if (method === "POST" && url === "/api/checkout/create-session") return checkout.promise;
      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    renderPaywall();

    const email = await screen.findByTestId("input-spark-email");
    const cta = screen.getByTestId("button-unlock-spark");
    expect(cta.textContent).toContain("Show me my personalized preview");

    fireEvent.change(email, { target: { value: EMAIL } });
    fireEvent.click(cta);

    await waitFor(() => {
      expect(callsTo(`/api/events/owner/${OWNER}/prepayment-preview`)).toHaveLength(1);
    });
    expect(callsTo("/api/checkout/create-session")).toHaveLength(0);
    expect(screen.getByTestId("button-unlock-spark").textContent).toContain("Creating your personal preview");

    await act(async () => preview.resolve({ ready: true }));

    const previewImage = await screen.findByTestId("img-prepayment-preview");
    expect(screen.getByTestId("button-unlock-spark").textContent).toContain("Revealing your personal preview");
    expect(callsTo("/api/checkout/create-session")).toHaveLength(0);

    fireEvent.load(previewImage);
    expect(screen.getByTestId("button-unlock-spark").textContent).toContain("Unlock this event — $9.99");
    expect(callsTo("/api/checkout/create-session")).toHaveLength(0);

    fireEvent.click(screen.getByTestId("button-unlock-spark"));
    await waitFor(() => expect(callsTo("/api/checkout/create-session")).toHaveLength(1));
  });

  it("renders the preview at its natural aspect ratio instead of a forced square crop", async () => {
    // Regression guard: the generated illustration's aspect ratio depends on the
    // AI concept's layoutStyle (banner => 3:2 landscape, full-bleed => 2:3
    // portrait, other styles => square). Forcing a fixed aspect-square box with
    // object-cover silently crops every non-square result — confirmed in
    // production, where both real preview images ever generated were non-square
    // and both were cropped. This asserts the container never reintroduces a
    // fixed-ratio crop class and instead lets the image size itself naturally.
    const preview = deferred<{ ready: boolean }>();

    apiRequestJson.mockImplementation((method: string, url: string) => {
      if (method === "GET" && url.endsWith("/master-planner/entitlement")) {
        return Promise.resolve({
          eventId: 94,
          freeDraftState: "none",
          emailCaptured: false,
          planTier: "spark",
          sparkUnlocked: false,
          canGenerate: false,
        });
      }
      if (method === "POST" && url.endsWith("/prepayment-preview")) return preview.promise;
      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    renderPaywall();

    fireEvent.change(await screen.findByTestId("input-spark-email"), { target: { value: EMAIL } });
    fireEvent.click(screen.getByTestId("button-unlock-spark"));

    await act(async () => preview.resolve({ ready: true }));

    const previewImage = await screen.findByTestId("img-prepayment-preview");
    expect(previewImage.className).not.toMatch(/aspect-square/);
    expect(previewImage.className).not.toMatch(/object-cover/);
    expect(previewImage.className).toMatch(/h-auto/);
  });

  it("allows checkout after a preview-provider failure instead of trapping the host", async () => {
    const checkout = deferred<{ url: string }>();

    apiRequestJson.mockImplementation((method: string, url: string) => {
      if (method === "GET" && url.endsWith("/master-planner/entitlement")) {
        return Promise.resolve({
          eventId: 92,
          freeDraftState: "none",
          emailCaptured: false,
          planTier: "spark",
          sparkUnlocked: false,
          canGenerate: false,
        });
      }
      if (method === "POST" && url.endsWith("/prepayment-preview")) {
        return Promise.reject(new Error("preview provider unavailable"));
      }
      if (method === "POST" && url === "/api/checkout/create-session") return checkout.promise;
      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    renderPaywall();

    fireEvent.change(await screen.findByTestId("input-spark-email"), { target: { value: EMAIL } });
    fireEvent.click(screen.getByTestId("button-unlock-spark"));

    await screen.findByText(/Your preview took too long this time/);
    expect(screen.getByTestId("button-unlock-spark").textContent).toContain("Continue to checkout — $9.99");
    expect(callsTo("/api/checkout/create-session")).toHaveLength(0);

    fireEvent.click(screen.getByTestId("button-unlock-spark"));
    await waitFor(() => expect(callsTo("/api/checkout/create-session")).toHaveLength(1));
  });

  it("allows checkout if the generated preview asset itself cannot render", async () => {
    const checkout = deferred<{ url: string }>();

    apiRequestJson.mockImplementation((method: string, url: string) => {
      if (method === "GET" && url.endsWith("/master-planner/entitlement")) {
        return Promise.resolve({
          eventId: 93,
          freeDraftState: "none",
          emailCaptured: false,
          planTier: "spark",
          sparkUnlocked: false,
          canGenerate: false,
        });
      }
      if (method === "POST" && url.endsWith("/prepayment-preview")) {
        return Promise.resolve({ ready: true });
      }
      if (method === "POST" && url === "/api/checkout/create-session") return checkout.promise;
      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    renderPaywall();

    fireEvent.change(await screen.findByTestId("input-spark-email"), { target: { value: EMAIL } });
    fireEvent.click(screen.getByTestId("button-unlock-spark"));

    fireEvent.error(await screen.findByTestId("img-prepayment-preview"));
    await screen.findByText(/Your preview took too long this time/);
    expect(screen.getByTestId("button-unlock-spark").textContent).toContain("Continue to checkout — $9.99");
    expect(callsTo("/api/checkout/create-session")).toHaveLength(0);

    fireEvent.click(screen.getByTestId("button-unlock-spark"));
    await waitFor(() => expect(callsTo("/api/checkout/create-session")).toHaveLength(1));
  });
});

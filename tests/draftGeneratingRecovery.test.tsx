import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/queryClient", () => ({ apiRequestJson: mocks.request }));
vi.mock("@/lib/eventRecovery", () => ({ touchRecentEvent: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/components/AIDemoShowcase", () => ({ default: () => null }));
const DraftGenerating = (await import("@/pages/DraftGenerating")).default;

const owner = "interrupted-owner";
const generationPath = `/api/events/owner/${owner}/master-planner/generate`;
const readinessPath = `/api/events/owner/${owner}/prepayment-preview/readiness`;
const clients: QueryClient[] = [];

beforeEach(() => {
  vi.resetAllMocks();
  window.history.replaceState({}, "", "/");
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

function show() {
  const { hook } = memoryLocation({ path: `/draft-generating/${owner}` });
  const client = new QueryClient({ defaultOptions: {
    queries: { retry: false, queryFn: async ({ queryKey }) => {
      if (queryKey[0] === "/api/checkout/config") return { configured: true };
      throw new Error(`Unexpected query ${String(queryKey[0])}`);
    } },
    mutations: { retry: false },
  } });
  clients.push(client);
  return render(
    <QueryClientProvider client={client}>
      <Router hook={hook}>
        <Route path="/draft-generating/:ownerToken" component={DraftGenerating} />
      </Router>
    </QueryClientProvider>,
  );
}

function readResponse(method: string, url: string) {
  if (method === "GET" && url === readinessPath) return {
    ready: true, generationState: "ready", kind: "approved-image",
    pollAfterMs: null, namedReference: null,
  };
  if (method === "GET" && url.endsWith("/master-planner/entitlement")) return {
    eventId: 42, freeDraftState: "reserved", emailCaptured: true,
    planTier: "plus", sparkUnlocked: false, canGenerate: true,
  };
  throw new Error(`Unexpected request ${method} ${url}`);
}
function generationCalls() {
  return mocks.request.mock.calls.filter(([method, url]) => method === "POST" && url === generationPath);
}

describe("first-plan recovery requires an explicit resume decision", () => {
  it("guides an unbound existing member to recovery without typed-email unlock or automatic messages", async () => {
    mocks.request.mockImplementation(async (method: string, url: string) => {
      if (method === 'GET' && url.endsWith('/master-planner/entitlement')) return {
        eventId: 42, freeDraftState: 'none', emailCaptured: true, planTier: 'spark',
        sparkUnlocked: false, canGenerate: false,
      };
      if (method === 'GET' && url === readinessPath) return { ready: false, generationState: 'idle', kind: 'none', pollAfterMs: null };
      if (method === 'GET' && url.endsWith('/plus-link')) return { enabled: false, linked: false };
      if (method === 'GET' && url.endsWith('/master-planner/status')) return { draftStatus: 'none' };
      throw Error(`Unexpected request ${method} ${url}`);
    });
    show();
    fireEvent.click(await screen.findByTestId('button-show-plus-access'));
    expect(screen.getByRole('link', { name: 'Find my paid event' }).getAttribute('href')).toBe('/recover');
    expect(screen.getByText(/don't need to purchase again/)).toBeTruthy();
    expect(screen.queryByTestId('input-plus-email')).toBeNull();
    expect(mocks.request.mock.calls.filter(([method]) => method === 'POST')).toHaveLength(0);
  });
  it("holds verified membership access through mount, pageshow, and reload until Build my plan is explicitly chosen", async () => {
    let started = false;
    mocks.request.mockImplementation(async (method: string, url: string) => {
      if (method === "GET" && url.endsWith("/master-planner/entitlement")) return {
        ...readResponse(method, url), requiresExplicitStart: true, freeDraftState: "none",
      };
      if (method === "POST" && url === generationPath) { started = true; return { started: true }; }
      if (method === "GET" && url.endsWith("/master-planner/status")) return {
        draftStatus: started ? "generating" : "none", draftStage: null, completedStages: [], failedStage: null,
      };
      return readResponse(method, url);
    });
    const first = show();
    await screen.findByRole("button", { name: "Build my plan" });
    expect(generationCalls()).toHaveLength(0);
    fireEvent(window, new Event("pageshow"));
    await waitFor(() => expect(mocks.request.mock.calls.filter(([, url]) => url === readinessPath).length).toBeGreaterThan(1));
    expect(generationCalls()).toHaveLength(0);
    first.unmount();
    show();
    const buildButton = await screen.findByRole("button", { name: "Build my plan" });
    await waitFor(() => expect((buildButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(buildButton);
    await waitFor(() => expect(generationCalls()).toEqual([["POST", generationPath, { resumeInterrupted: false, confirmMembershipStart: true }]]));
    await waitFor(() => expect(mocks.request.mock.calls.filter(([, url]) => url.endsWith("/master-planner/status"))).toHaveLength(3));
    expect(await screen.findByTestId("draft-generating-checklist")).toBeTruthy();
  });

  it("keeps the artwork approval gate ahead of an explicitly linked membership's Build action", async () => {
    mocks.request.mockImplementation(async (method: string, url: string) => {
      if (method === "GET" && url.endsWith("/master-planner/entitlement")) return {
        ...readResponse(method, url), requiresExplicitStart: true, freeDraftState: "none",
      };
      if (method === "GET" && url === readinessPath) return {
        ready: false, generationState: "idle", kind: "none", humanReview: true,
        checkoutAllowed: false, reviewState: "pending-review", pollAfterMs: null,
      };
      if (method === "GET" && url.endsWith("/master-planner/status")) return { draftStatus: "none" };
      return readResponse(method, url);
    });
    show();
    await screen.findByText("Your existing access is saved. Planning can continue after artwork approval.");
    expect(screen.queryByRole("button", { name: "Build my plan" })).toBeNull();
    expect(generationCalls()).toHaveLength(0);
  });

  it("refreshes entitlement after code verification while waiting for an explicit Build decision", async () => {
    let membershipLinked = false;
    mocks.request.mockImplementation(async (method: string, url: string) => {
      if (method === "GET" && url.endsWith("/master-planner/entitlement")) return {
        ...readResponse(method, url), canGenerate: membershipLinked,
        requiresExplicitStart: membershipLinked, freeDraftState: "none",
      };
      if (method === "GET" && url.endsWith("/plus-link")) return {
        enabled: true, linked: false,
        challenge: { id: "retained-link", expiresAt: Date.now() + 600_000, resendAt: Date.now() + 60_000 },
      };
      if (method === "POST" && url.endsWith("/plus-link/confirm")) {
        membershipLinked = true;
        return { ok: true, linked: true };
      }
      if (method === "GET" && url.endsWith("/master-planner/status")) return { draftStatus: "none" };
      return readResponse(method, url);
    });
    show();
    fireEvent.click(await screen.findByTestId("button-show-plus-access"));
    fireEvent.change(await screen.findByLabelText("8-digit verification code"), { target: { value: "12345678" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect my Plus membership" }));
    await screen.findByRole("button", { name: "Build my plan" });
    expect(generationCalls()).toHaveLength(0);
    expect(mocks.request.mock.calls.filter(([method]) => method === "POST")).toEqual([
      ["POST", `/api/events/owner/${owner}/plus-link/confirm`, { challengeId: "retained-link", code: "12345678" }],
    ]);
  });

  it("reads an already running verified-membership draft without offering Build or dispatching generation", async () => {
    mocks.request.mockImplementation(async (method: string, url: string) => {
      if (method === "GET" && url.endsWith("/master-planner/entitlement")) return {
        ...readResponse(method, url), requiresExplicitStart: true,
      };
      if (method === "GET" && url.endsWith("/master-planner/status")) return {
        draftStatus: "generating", draftStage: "budget_menu", completedStages: ["theme"], failedStage: null,
      };
      return readResponse(method, url);
    });
    show();
    await screen.findByTestId("draft-generating-checklist");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Build my plan" })).toBeNull());
    expect(generationCalls()).toHaveLength(0);
  });

  it("requires an explicit Try again confirmation to resume failed verified-membership work", async () => {
    mocks.request.mockImplementation(async (method: string, url: string) => {
      if (method === "GET" && url.endsWith("/master-planner/entitlement")) return {
        ...readResponse(method, url), requiresExplicitStart: true,
      };
      if (method === "GET" && url.endsWith("/master-planner/status")) return {
        draftStatus: "failed_partial", draftStage: "budget_menu", completedStages: ["theme"], failedStage: "budget",
      };
      if (method === "POST" && url === generationPath) return { started: true };
      return readResponse(method, url);
    });
    show();
    await screen.findByTestId("draft-generating-failed");
    expect(generationCalls()).toHaveLength(0);
    fireEvent.click(screen.getByTestId("button-retry-draft"));
    await waitFor(() => expect(generationCalls()).toEqual([["POST", generationPath, { resumeInterrupted: true, confirmMembershipStart: true }]]));
  });
  it("does not authorize interrupted work on mount, pageshow, or reload; Try again alone sends resume intent", async () => {
    mocks.request.mockImplementation(async (method: string, url: string, body?: { resumeInterrupted: boolean }) => {
      if (method === "POST" && url === generationPath) {
        if (!body?.resumeInterrupted) throw new Error("The previous attempt stopped before finishing. Your saved progress is intact. Choose Try again to continue.");
        return { started: true };
      }
      if (method === "GET" && url.endsWith("/master-planner/status")) return {
        draftStatus: "generating", draftStage: "budget_menu", completedStages: ["theme"], failedStage: null,
      };
      return readResponse(method, url);
    });
    const initial = show();
    await screen.findByTestId("draft-generating-startup-failed");
    expect(generationCalls()).toEqual([["POST", generationPath, { resumeInterrupted: false }]]);
    fireEvent(window, new Event("pageshow"));
    await waitFor(() => expect(mocks.request.mock.calls.filter(([, url]) => url === readinessPath).length).toBeGreaterThan(1));
    expect(generationCalls()).toHaveLength(1);

    initial.unmount();
    show();
    await screen.findByTestId("draft-generating-startup-failed");
    expect(generationCalls()).toHaveLength(2);
    expect(generationCalls().every(([, , body]) => body.resumeInterrupted === false)).toBe(true);

    fireEvent.click(screen.getByTestId("button-retry-start"));
    await waitFor(() => expect(generationCalls()).toHaveLength(3));
    expect(generationCalls()[2]).toEqual(["POST", generationPath, { resumeInterrupted: true }]);
    await waitFor(() => expect(screen.queryByTestId("draft-generating-startup-failed")).toBeNull());
  });

  it("waits for explicit Try again when status reports a partially failed draft", async () => {
    let resumed = false;
    mocks.request.mockImplementation(async (method: string, url: string, body?: { resumeInterrupted: boolean }) => {
      if (method === "POST" && url === generationPath) {
        resumed = body?.resumeInterrupted === true;
        return { started: true };
      }
      if (method === "GET" && url.endsWith("/master-planner/status")) return {
        draftStatus: resumed ? "generating" : "failed_partial", draftStage: "budget_menu",
        completedStages: ["theme"], failedStage: resumed ? null : "budget",
      };
      return readResponse(method, url);
    });
    show();
    await screen.findByTestId("draft-generating-failed");
    expect(generationCalls()).toEqual([["POST", generationPath, { resumeInterrupted: false }]]);
    expect(screen.getByText(/Completed sections are saved/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("button-retry-draft"));
    await waitFor(() => expect(generationCalls()).toHaveLength(2));
    expect(generationCalls()[1]).toEqual(["POST", generationPath, { resumeInterrupted: true }]);
  });

  it("opens the existing plan when generation is already consumed instead of offering retry", async () => {
    mocks.request.mockImplementation(async (method: string, url: string) => {
      if (method === "POST" && url === generationPath) throw new Error("A draft has already been generated for this event.");
      return readResponse(method, url);
    });
    show();
    const link = await screen.findByRole("link", { name: "Open my plan" });
    expect(link.getAttribute("href")).toBe(`/dashboard/${owner}`);
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(generationCalls()).toEqual([["POST", generationPath, { resumeInterrupted: false }]]);
  });
});

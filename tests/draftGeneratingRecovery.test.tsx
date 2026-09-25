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

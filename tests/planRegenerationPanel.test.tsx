import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PlanContent, PlanRegenerationResponse, PlanRegenerationView } from "@shared/planRegeneration";

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/queryClient", () => ({ apiRequestJson: mocks.request }));
const PlanRegenerationPanel = (await import("@/components/PlanRegenerationPanel")).default;
const path = "/api/events/owner/local-owner/plan-regeneration";
const plan: PlanContent = {
  eventIdentity: "A sunny garden lunch",
  budgetItems: [{ name: "Tables", estimatedCost: 60 }],
  menuItems: [{ itemName: "Garden sandwiches", servesCount: 12, costEstimate: 30 }],
  shoppingItems: [{ itemName: "Napkins", quantity: "24", estimatedCost: 5 }],
  timelineItems: [{ title: "Welcome guests", time: "12:00 PM" }],
};
const noOperation: PlanRegenerationResponse = { eligible: true, operation: null };
function withOperation(overrides: Partial<PlanRegenerationView> = {}): PlanRegenerationResponse {
  return {
    eligible: true,
    operation: {
      id: "operation-one", state: "running", stage: "menu", error: null,
      createdAt: 1, canApply: false, baseChanged: false, candidate: null,
      previousAvailable: false, ...overrides,
    },
  };
}
let client: QueryClient;
beforeEach(() => {
  vi.resetAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
});
afterEach(() => { cleanup(); client.clear(); });
function show() {
  return render(<QueryClientProvider client={client}><PlanRegenerationPanel ownerToken="local-owner" /></QueryClientProvider>);
}
function posts() { return mocks.request.mock.calls.filter(([method]) => method === "POST"); }

describe("explicit Plus plan regeneration", () => {
  it("reads access on mount without generating and hides the action for an ineligible event", async () => {
    mocks.request.mockResolvedValue({ eligible: false, operation: null });
    show();
    await waitFor(() => expect(mocks.request).toHaveBeenCalledWith("GET", path));
    expect(screen.queryByRole("button", { name: "Regenerate plan" })).toBeNull();
    expect(posts()).toHaveLength(0);
  });

  it("creates one request from a click and reloads saved running state without another POST", async () => {
    mocks.request.mockImplementation(async (method: string) => method === "POST" ? withOperation() : noOperation);
    const firstRender = show();
    fireEvent.click(await screen.findByRole("button", { name: "Regenerate plan" }));
    await screen.findByText("Planning your menu…");
    expect(posts()).toHaveLength(1);
    expect(posts()[0]).toEqual(["POST", path, { requestId: expect.stringMatching(/^[a-f0-9-]{36}$/i) }]);
    firstRender.unmount();
    client.clear();
    mocks.request.mockResolvedValue(withOperation());
    show();
    await screen.findByText("Planning your menu…");
    expect(screen.getByText(/You can leave this page and return/)).toBeTruthy();
    expect(posts()).toHaveLength(1);
  });

  it("reuses the request UUID for an explicit retry after an uncertain network response", async () => {
    let postCount = 0;
    mocks.request.mockImplementation(async (method: string) => {
      if (method === "GET") return noOperation;
      if (++postCount === 1) throw new Error("Connection interrupted");
      return withOperation();
    });
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Regenerate plan" }));
    const retry = await screen.findByRole("button", { name: "Retry request" });
    await waitFor(() => expect((retry as HTMLButtonElement).disabled).toBe(false));
    expect(posts()).toHaveLength(1);
    fireEvent.click(retry);
    await screen.findByText("Planning your menu…");
    expect(posts()).toHaveLength(2);
    expect(posts()[1][2]).toEqual(posts()[0][2]);
  });

  it("recovers a saved operation after a lost start response without offering a second generation", async () => {
    let started = false;
    mocks.request.mockImplementation(async (method: string) => {
      if (method === "GET") return started ? withOperation() : noOperation;
      started = true;
      throw new Error("Response lost");
    });
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Regenerate plan" }));
    await screen.findByText("Planning your menu…");
    expect(screen.queryByRole("button", { name: "Retry request" })).toBeNull();
    expect(posts()).toHaveLength(1);
  });

  it("shows all candidate sections and applies only after deliberate replacement confirmation", async () => {
    const ready = withOperation({ state: "ready", candidate: plan, canApply: true });
    mocks.request.mockImplementation(async (method: string) => method === "GET" ? ready : withOperation({ state: "applied", previousAvailable: true }));
    const eventKey = ["/api/events/owner/local-owner"];
    const menuKey = ["/api/events/owner/local-owner/menu-items"];
    const otherKey = ["/api/events/owner/another-owner/menu-items"];
    client.setQueryData(eventKey, { event: {} });
    client.setQueryData(menuKey, ["old menu"]);
    client.setQueryData(otherKey, ["unrelated menu"]);
    show();
    await screen.findByText("Your new plan is ready to review");
    expect(screen.getByText("A sunny garden lunch")).toBeTruthy();
    expect(screen.getByText("Tables")).toBeTruthy();
    expect(screen.getByText("Garden sandwiches")).toBeTruthy();
    expect(screen.getByText("Napkins · 24")).toBeTruthy();
    expect(screen.getByText("12:00 PM · Welcome guests")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Use this plan" }));
    await screen.findByRole("alertdialog");
    expect(posts()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Replace plan" }));
    await screen.findByText("Your new plan is in use. Your previous plan is saved.");
    expect(posts()).toEqual([["POST", `${path}/operation-one/apply`, {}]]);
    expect(client.getQueryState(eventKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(menuKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(otherKey)?.isInvalidated).toBe(false);
  });

  it("blocks application after customer edits and discards only the candidate", async () => {
    mocks.request.mockImplementation(async (method: string) => method === "GET"
      ? withOperation({ state: "ready", candidate: plan, canApply: false, baseChanged: true })
      : withOperation({ state: "discarded" }));
    show();
    const apply = await screen.findByRole("button", { name: "Use this plan" });
    expect((apply as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Your event details or plan changed/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Discard this version" }));
    await screen.findByText("This version was discarded. Your current plan is still in place.");
    expect(posts()).toEqual([["POST", `${path}/operation-one/discard`, {}]]);
    expect(screen.getByRole("button", { name: "Regenerate plan" })).toBeTruthy();
  });

  it("lets an owner apply a saved candidate after Plus expires without offering a new generation", async () => {
    mocks.request.mockImplementation(async (method: string) => ({
      ...(method === "GET"
        ? withOperation({ state: "ready", candidate: plan, canApply: true })
        : withOperation({ state: "applied", previousAvailable: true })),
      eligible: false,
    }));
    show();
    const apply = await screen.findByRole("button", { name: "Use this plan" });
    expect((apply as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole("button", { name: "Regenerate plan" })).toBeNull();
    fireEvent.click(apply);
    fireEvent.click(await screen.findByRole("button", { name: "Replace plan" }));
    await screen.findByText("Your new plan is in use. Your previous plan is saved.");
    expect(posts()).toEqual([["POST", `${path}/operation-one/apply`, {}]]);
    expect(screen.queryByRole("button", { name: "Regenerate plan" })).toBeNull();
  });

  it("does not offer a new generation after a failed status read even with cached eligibility", async () => {
    client.setQueryData([path], noOperation);
    mocks.request.mockRejectedValue(new Error("Status unavailable"));
    show();
    await screen.findByText("We couldn’t check your new plan. Your current plan is still available.");
    expect(screen.queryByRole("button", { name: "Regenerate plan" })).toBeNull();
    expect(posts()).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Check status" })).toBeTruthy();
  });

  it("keeps a failed operation read-only until the customer dismisses it", async () => {
    mocks.request.mockImplementation(async (method: string) => method === "GET"
      ? withOperation({ state: "failed", error: "Provider timed out" })
      : withOperation({ state: "discarded" }));
    show();
    await screen.findByText(/Your current plan and edits are still in place/);
    expect(posts()).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Regenerate plan" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss this version" }));
    await screen.findByRole("button", { name: "Regenerate plan" });
    expect(posts()).toEqual([["POST", `${path}/operation-one/discard`, {}]]);
  });

  it("refreshes planning data when an apply response is lost but GET confirms application", async () => {
    let applied = false;
    mocks.request.mockImplementation(async (method: string) => {
      if (method === "GET") return applied
        ? withOperation({ state: "applied", previousAvailable: true })
        : withOperation({ state: "ready", candidate: plan, canApply: true });
      applied = true;
      throw new Error("Connection interrupted");
    });
    const budgetKey = ["/api/events/owner/local-owner/budget-items"];
    client.setQueryData(budgetKey, ["old budget"]);
    show();
    fireEvent.click(await screen.findByRole("button", { name: "Use this plan" }));
    fireEvent.click(await screen.findByRole("button", { name: "Replace plan" }));
    await screen.findByText("Your new plan is in use. Your previous plan is saved.");
    expect(client.getQueryState(budgetKey)?.isInvalidated).toBe(true);
    expect(posts()).toHaveLength(1);
  });
});

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

const apiRequest = vi.fn();
const apiRequestJson = vi.fn();
const startEventWithRecovery = vi.fn();
const clearPendingEventStartKey = vi.fn();

vi.mock("@/lib/queryClient", () => ({
  apiRequest: (...args: unknown[]) => apiRequest(...args),
  apiRequestJson: (...args: unknown[]) => apiRequestJson(...args),
  queryClient: { invalidateQueries: vi.fn() },
}));

vi.mock("@/lib/eventStartup", () => ({
  startEventWithRecovery: (...args: unknown[]) => startEventWithRecovery(...args),
  clearPendingEventStartKey: (...args: unknown[]) => clearPendingEventStartKey(...args),
}));

const Intake = (await import("@/pages/Intake")).default;

const event = {
  id: 1,
  ownerToken: "owner-token-recovered",
  eventName: "My Celebration",
  eventType: "Birthday Party",
  eventDate: "",
  vibeDescription: "",
  estimatedGuestCount: null,
  budgetCeiling: null,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderFreshIntake() {
  const { hook } = memoryLocation({ path: "/intake", record: true });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router hook={hook}>
        <Route path="/intake/:ownerToken?" component={Intake} />
      </Router>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiRequest.mockReset();
  apiRequestJson.mockReset();
  startEventWithRecovery.mockReset();
  clearPendingEventStartKey.mockReset();
  apiRequest.mockResolvedValue({ json: async () => event });
  apiRequestJson.mockResolvedValue({ freeDraftState: "none" });
});

describe("fresh intake startup recovery", () => {
  it("shows the actual form while the resumable event is still being secured", async () => {
    const pending = deferred<{ event: typeof event; startKey: string }>();
    startEventWithRecovery.mockReturnValue(pending.promise);

    renderFreshIntake();

    expect(screen.getByTestId("input-intake-event-name")).toBeTruthy();
    expect(screen.getByTestId("text-intake-starting").textContent).toContain("start filling this out now");

    await act(async () => {
      pending.resolve({ event, startKey: "stable-event-start-key-1234567890" });
      await pending.promise;
    });

    await waitFor(() => expect(screen.queryByTestId("text-intake-starting")).toBeNull());
    expect(clearPendingEventStartKey).toHaveBeenCalledWith("stable-event-start-key-1234567890");
  });

  it("never dead-ends: preserves typed answers and provides a working Try again action", async () => {
    startEventWithRecovery
      .mockRejectedValueOnce(new Error("temporarily unavailable"))
      .mockResolvedValueOnce({ event, startKey: "stable-event-start-key-1234567890" });

    renderFreshIntake();

    const name = screen.getByTestId("input-intake-event-name") as HTMLInputElement;
    fireEvent.change(name, { target: { value: "Hayden's Celebration" } });

    await screen.findByTestId("card-intake-start-recovery");
    expect(name.value).toBe("Hayden's Celebration");
    expect(screen.queryByText("Couldn't start your event")).toBeNull();

    fireEvent.click(screen.getByTestId("button-retry-event-start"));

    await waitFor(() => expect(startEventWithRecovery).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByTestId("card-intake-start-recovery")).toBeNull());
    expect((screen.getByTestId("input-intake-event-name") as HTMLInputElement).value).toBe("Hayden's Celebration");
  });
});

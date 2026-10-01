import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ContinuePlanning from "@/components/ContinuePlanningCard";
import { getRecentEvents, touchRecentEvent } from "@/lib/eventRecovery";

const fetchMock = vi.fn();
const token = "saved-recovery-test-event";
const event = { eventName: "Garden celebration", eventDate: "2027-01-16" };

function renderRecovery() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ContinuePlanning />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  touchRecentEvent(token);
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("saved event recovery after a failed read", () => {
  it.each(["offline", 401, 429, 503])("preserves the saved event after %s and lets the host retry", async (failure) => {
    if (failure === "offline") {
      fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    } else {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "Temporarily unavailable" }), { status: Number(failure) }));
    }
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ event }), { status: 200 }));

    renderRecovery();

    const retry = await screen.findByRole("button", { name: "Try again" });
    expect(getRecentEvents().map((entry) => entry.token)).toEqual([token]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(retry);

    await screen.findByText("Garden celebration");
    expect(screen.getByRole("link", { name: "Continue" }).getAttribute("href")).toBe(`/dashboard/${token}`);
    expect(getRecentEvents().map((entry) => entry.token)).toEqual([token]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([, options]) => options.method === "GET")).toBe(true);
  });

  it("forgets an event only after the API confirms it no longer exists", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: "Event not found" }), { status: 404 }));
    renderRecovery();

    await waitFor(() => expect(getRecentEvents()).toEqual([]));
    expect(screen.queryByTestId("section-continue-planning")).toBeNull();
  });

  it("still lets the host explicitly forget a saved event", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ event }), { status: 200 }));
    renderRecovery();

    await screen.findByText("Garden celebration");
    fireEvent.click(screen.getByTitle("Forget this event"));
    expect(getRecentEvents()).toEqual([]);
  });
});

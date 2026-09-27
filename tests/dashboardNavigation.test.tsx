import { StrictMode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { useDashboardNavigation } from "@/hooks/useDashboardNavigation";

const scrollIntoView = vi.fn();
const originalScroll = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
function Harness({ owner = "event-a", ready = true }) {
  const { activeTab, setActiveTab } = useDashboardNavigation(owner, ready);
  return <>
    <output>{activeTab}</output>
    <button onClick={() => setActiveTab("guests")}>Invitation &amp; Guests</button>
    <button onClick={() => setActiveTab("budget")}>Budget</button>
    {ready && <div id="event-tabs-section">Workspace</div>}
  </>;
}

function setup(path = "/dashboard/event-a", owner = "event-a") {
  const location = memoryLocation({ path, record: true });
  const view = render(<StrictMode><Router hook={location.hook}><Harness owner={owner} /></Router></StrictMode>);
  return { ...view, location };
}

beforeEach(() => {
  localStorage.clear();
  scrollIntoView.mockClear();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => setTimeout(() => callback(0), 0));
  vi.stubGlobal("cancelAnimationFrame", clearTimeout);
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
  vi.stubGlobal("fetch", vi.fn(() => { throw Error("Navigation must not call providers or send messages"); }));
});

afterEach(() => {
  cleanup();
  if (originalScroll) Object.defineProperty(Element.prototype, "scrollIntoView", originalScroll);
  else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("dashboard workspace recovery", () => {
  it("keeps the initial overview for a first visit", () => {
    setup();
    expect(screen.getByRole("status").textContent).toBe("theme");
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("retains the chosen tab through refresh and preserves unrelated query values", async () => {
    const first = setup("/dashboard/event-a?retainedReviewAttempt=example");
    fireEvent.click(screen.getByRole("button", { name: "Invitation & Guests" }));
    expect(screen.getByRole("status").textContent).toBe("guests");
    const url = first.location.history![0];
    expect(url).toBe("/dashboard/event-a?retainedReviewAttempt=example&tab=guests");
    expect(first.location.history).toHaveLength(1);
    first.unmount();
    setup(url);
    expect(screen.getByRole("status").textContent).toBe("guests");
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    expect(fetch).not.toHaveBeenCalled();
  });

  it("restores the same event from a plain recovery link without leaking selection to another event", async () => {
    const first = setup();
    fireEvent.click(screen.getByRole("button", { name: "Budget" }));
    first.unmount();
    const second = setup();
    expect(screen.getByRole("status").textContent).toBe("budget");
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    second.unmount();
    setup("/dashboard/event-b", "event-b");
    expect(screen.getByRole("status").textContent).toBe("theme");
  });

  it("honors an explicit tab over remembered state and keeps it on later plain-link returns", () => {
    localStorage.setItem("pp_dashboard_tab:event-a", "budget");
    const first = setup("/dashboard/event-a?tab=guests");
    expect(screen.getByRole("status").textContent).toBe("guests");
    first.unmount();
    setup();
    expect(screen.getByRole("status").textContent).toBe("guests");
  });

  it("rejects unknown tabs in the URL and storage", () => {
    localStorage.setItem("pp_dashboard_tab:event-a", "not-a-tab");
    setup("/dashboard/event-a?tab=not-a-tab");
    expect(screen.getByRole("status").textContent).toBe("theme");
  });

  it("still restores from the URL when local storage is blocked", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    const first = setup();
    fireEvent.click(screen.getByRole("button", { name: "Invitation & Guests" }));
    const url = first.location.history![0];
    first.unmount();
    setup(url);
    expect(screen.getByRole("status").textContent).toBe("guests");
  });

  it("waits for event loading before restoring the workspace and does not scroll again on data refresh", async () => {
    const location = memoryLocation({ path: "/dashboard/event-a?tab=guests" });
    const view = render(<Router hook={location.hook}><Harness ready={false} /></Router>);
    expect(scrollIntoView).not.toHaveBeenCalled();
    view.rerender(<Router hook={location.hook}><Harness ready /></Router>);
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalledTimes(1));
    view.rerender(<Router hook={location.hook}><Harness ready /></Router>);
    await act(async () => {});
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
  });
});

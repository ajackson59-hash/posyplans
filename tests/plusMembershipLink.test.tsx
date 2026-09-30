import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/queryClient", () => ({ apiRequestJson: mocks.request }));
const PlusMembershipLink = (await import("@/components/PlusMembershipLink")).default;
const base = "/api/events/owner/private-event-owner/plus-link";
const clients: QueryClient[] = [];
const linked = vi.fn();
const challenge = () => ({ id: "saved-challenge-id", expiresAt: Date.now() + 600_000, resendAt: Date.now() + 60_000 });

beforeEach(() => {
  vi.resetAllMocks();
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach(client => client.clear());
  vi.useRealTimers();
});
function show() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(client);
  const { hook } = memoryLocation({ path: "/" });
  return render(<QueryClientProvider client={client}><Router hook={hook}>
    <PlusMembershipLink ownerToken="private-event-owner" onLinked={linked} />
  </Router></QueryClientProvider>);
}
function posts() { return mocks.request.mock.calls.filter(([method]) => method === "POST"); }
async function expand() { fireEvent.click(await screen.findByTestId("button-show-plus-access")); }
async function enterEmail() { fireEvent.change(await screen.findByLabelText("Plus billing email"), { target: { value: "member@example.test" } }); }

describe("verified Plus membership linking", () => {
  it("keeps disabled or unavailable linking on recovery/support without sending anything", async () => {
    mocks.request.mockResolvedValue({ enabled: false, linked: false });
    show();
    await expand();
    await waitFor(() => expect(screen.queryByText("Checking your saved access…")).toBeNull());
    expect(screen.queryByLabelText("Plus billing email")).toBeNull();
    expect(screen.getByRole("link", { name: "Find my paid event" }).getAttribute("href")).toBe("/recover");
    expect(posts()).toHaveLength(0);
  });

  it("sends one email request only after explicit submission and enforces the returned cooldown", async () => {
    const saved = challenge();
    mocks.request.mockImplementation(async (method: string) => method === "GET"
      ? { enabled: true, linked: false }
      : { ok: true, challengeId: saved.id, expiresAt: saved.expiresAt, resendAt: saved.resendAt });
    show();
    await expand();
    await enterEmail();
    fireEvent.blur(screen.getByLabelText("Plus billing email"));
    expect(posts()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Email my code" }));
    await screen.findByLabelText("8-digit verification code");
    expect(posts()).toHaveLength(1);
    expect(posts()[0]).toEqual(["POST", `${base}/request`, { email: "member@example.test", requestKey: expect.stringMatching(/^[a-f0-9-]{36}$/) }]);
    expect(screen.getByText(/If an active Plus membership uses this billing email/)).toBeTruthy();
    expect((screen.getByRole("button", { name: /Resend available in/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(screen.getByLabelText("Plus billing email").closest("form")!);
    expect(posts()).toHaveLength(1);
    expect(linked).not.toHaveBeenCalled();
  });

  it("restores a retained challenge after refresh without sending a new code", async () => {
    mocks.request.mockResolvedValue({ enabled: true, linked: false, challenge: challenge() });
    const first = show();
    await expand();
    await screen.findByLabelText("8-digit verification code");
    first.unmount();
    show();
    await expand();
    expect(await screen.findByLabelText("8-digit verification code")).toBeTruthy();
    expect(posts()).toHaveLength(0);
    expect(linked).not.toHaveBeenCalled();
  });

  it("refreshes stale entitlement once when saved status is already linked, without a POST", async () => {
    mocks.request.mockResolvedValue({ enabled: true, linked: true });
    show();
    await expand();
    await screen.findByText("Plus is connected to this event.");
    await waitFor(() => expect(linked).toHaveBeenCalledOnce());
    expect(posts()).toHaveLength(0);
  });

  it("requires exactly eight digits, keeps the code out of storage/URLs, and only refreshes access on success", async () => {
    const saved = challenge();
    mocks.request.mockImplementation(async (method: string) => method === "GET"
      ? { enabled: true, linked: false, challenge: saved } : { ok: true, linked: true });
    show();
    await expand();
    const input = await screen.findByLabelText("8-digit verification code") as HTMLInputElement;
    expect(input.getAttribute("autocomplete")).toBe("one-time-code");
    expect(input.getAttribute("inputmode")).toBe("numeric");
    expect((screen.getByRole("checkbox", { name: "Use this verified billing email to recover this event" }) as HTMLInputElement).checked).toBe(false);
    fireEvent.change(input, { target: { value: "1234" } });
    fireEvent.submit(input.closest("form")!);
    expect(posts()).toHaveLength(0);
    fireEvent.change(input, { target: { value: "12345678" } });
    expect(posts()).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Connect my Plus membership" }));
    await waitFor(() => expect(linked).toHaveBeenCalledOnce());
    expect(posts()).toEqual([["POST", `${base}/confirm`, { challengeId: saved.id, code: "12345678" }]]);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(window.location.href).not.toContain("12345678");
    expect(screen.queryByLabelText("8-digit verification code")).toBeNull();
    expect(await screen.findByText("Plus is connected to this event.")).toBeTruthy();
  });

  it("saves a recovery-email preference only after explicit opt-in and code submission", async () => {
    const saved = challenge();
    mocks.request.mockImplementation(async (method: string) => method === "GET"
      ? { enabled: true, linked: false, challenge: saved } : { ok: true, linked: true });
    show();
    await expand();
    const input = await screen.findByLabelText("8-digit verification code");
    const consent = screen.getByRole("checkbox", { name: "Use this verified billing email to recover this event" }) as HTMLInputElement;
    expect(consent.checked).toBe(false);
    fireEvent.click(consent);
    expect(consent.checked).toBe(true);
    expect(posts()).toHaveLength(0);
    fireEvent.change(input, { target: { value: "12345678" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect my Plus membership" }));
    await waitFor(() => expect(linked).toHaveBeenCalledOnce());
    expect(posts()).toEqual([["POST", `${base}/confirm`, {
      challengeId: saved.id, code: "12345678", saveRecoveryEmail: true,
    }]]);
  });

  it("resets recovery-email consent on reload and omits it from confirmation until chosen again", async () => {
    const saved = challenge();
    mocks.request.mockImplementation(async (method: string) => method === "GET"
      ? { enabled: true, linked: false, challenge: saved } : { ok: true, linked: true });
    const first = show();
    await expand();
    const consent = await screen.findByRole("checkbox", { name: "Use this verified billing email to recover this event" }) as HTMLInputElement;
    fireEvent.click(consent);
    expect(consent.checked).toBe(true);
    expect(posts()).toHaveLength(0);
    first.unmount();
    show();
    await expand();
    const restored = await screen.findByRole("checkbox", { name: "Use this verified billing email to recover this event" }) as HTMLInputElement;
    expect(restored.checked).toBe(false);
    fireEvent.change(screen.getByLabelText("8-digit verification code"), { target: { value: "12345678" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect my Plus membership" }));
    await waitFor(() => expect(linked).toHaveBeenCalledOnce());
    expect(posts()).toEqual([["POST", `${base}/confirm`, { challengeId: saved.id, code: "12345678" }]]);
  });

  it("shows a neutral failure without retrying a rejected code or refreshing entitlement", async () => {
    mocks.request.mockImplementation(async (method: string) => {
      if (method === "GET") return { enabled: true, linked: false, challenge: challenge() };
      throw Error("provider internal detail must not be displayed");
    });
    show();
    await expand();
    fireEvent.change(await screen.findByLabelText("8-digit verification code"), { target: { value: "87654321" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect my Plus membership" }));
    await screen.findByRole("alert");
    expect(screen.queryByText(/provider internal detail/)).toBeNull();
    expect(posts()).toHaveLength(1);
    expect(linked).not.toHaveBeenCalled();
  });

  it("resolves a lost request response with a read and never automatically resends", async () => {
    let requested = false;
    const saved = challenge();
    mocks.request.mockImplementation(async (method: string) => {
      if (method === "GET") return { enabled: true, linked: false, ...(requested ? { challenge: saved } : {}) };
      requested = true;
      throw Error("connection lost");
    });
    show();
    await expand();
    await enterEmail();
    fireEvent.click(screen.getByRole("button", { name: "Email my code" }));
    expect(await screen.findByLabelText("8-digit verification code")).toBeTruthy();
    expect(mocks.request.mock.calls.filter(([method]) => method === "GET")).toHaveLength(2);
    expect(posts()).toHaveLength(1);
    expect(linked).not.toHaveBeenCalled();
  });

  it("reuses the idempotency key only when the host explicitly retries an uncertain email request", async () => {
    mocks.request.mockImplementation(async (method: string) => {
      if (method === "GET") return { enabled: true, linked: false };
      throw Error("connection lost before acceptance");
    });
    show();
    await expand();
    await enterEmail();
    fireEvent.click(screen.getByRole("button", { name: "Email my code" }));
    await screen.findByRole("alert");
    expect(posts()).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Email my code" }));
    await waitFor(() => expect(posts()).toHaveLength(2));
    expect(posts()[0][2].requestKey).toBe(posts()[1][2].requestKey);
  });

  it("recovers a saved binding after a lost confirmation response without another POST", async () => {
    let savedBinding = false;
    mocks.request.mockImplementation(async (method: string) => {
      if (method === "GET") return savedBinding ? { enabled: true, linked: true }
        : { enabled: true, linked: false, challenge: challenge() };
      savedBinding = true;
      throw Error("response lost after binding");
    });
    show();
    await expand();
    fireEvent.change(await screen.findByLabelText("8-digit verification code"), { target: { value: "12345678" } });
    fireEvent.click(screen.getByRole("button", { name: "Connect my Plus membership" }));
    await waitFor(() => expect(linked).toHaveBeenCalledOnce());
    expect(posts()).toHaveLength(1);
    expect(await screen.findByText("Plus is connected to this event.")).toBeTruthy();
  });

  it("shows expiry and allows a new request only from the host's action", async () => {
    mocks.request.mockResolvedValue({ enabled: true, linked: false, challenge: { id: "expired", expiresAt: Date.now() - 1, resendAt: Date.now() - 1 } });
    show();
    await expand();
    await screen.findByText(/This code has expired/);
    expect(screen.queryByLabelText("8-digit verification code")).toBeNull();
    await enterEmail();
    expect((screen.getByRole("button", { name: "Email a new code" }) as HTMLButtonElement).disabled).toBe(false);
    expect(posts()).toHaveLength(0);
  });

  it("ending the resend cooldown never sends another email automatically", async () => {
    const saved = { ...challenge(), resendAt: Date.now() + 2000 };
    mocks.request.mockResolvedValue({ enabled: true, linked: false, challenge: saved });
    show();
    await expand();
    await enterEmail();
    await screen.findByRole("button", { name: /Resend available in/ });
    vi.useFakeTimers();
    vi.setSystemTime(saved.resendAt + 1);
    // Re-render with a fresh challenge mounts the timer under the fake clock.
    cleanup();
    show();
    await act(async () => { await Promise.resolve(); });
    fireEvent.click(screen.getByTestId("button-show-plus-access"));
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(screen.getByRole("button", { name: "Email a new code" })).toBeTruthy();
    expect(posts()).toHaveLength(0);
  });
});

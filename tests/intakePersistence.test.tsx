// QA reported typed intake values reverting to defaults — an event name coming
// back as "My Celebration", the date reading "Not set yet" on Review. The cause
// is a race, not a browser-automation artefact: the fresh-start path creates the
// event and then navigates the new token into the URL, which re-triggers the
// resume fetch while the host is already typing. When that response lands it
// used to overwrite live state with the server's defaults.
//
// These tests drive the real component through both paths with a deliberately
// slow GET, so the response always arrives after the keystrokes.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

const apiRequest = vi.fn();
const apiRequestJson = vi.fn();

vi.mock("@/lib/queryClient", () => ({
  apiRequest: (...args: unknown[]) => apiRequest(...args),
  apiRequestJson: (...args: unknown[]) => apiRequestJson(...args),
  queryClient: { invalidateQueries: vi.fn() },
}));

const Intake = (await import("@/pages/Intake")).default;

const TOKEN = "owner-token-abc";

/** The server record as it exists immediately after the bare event is created. */
const SERVER_DEFAULTS = {
  id: 1,
  ownerToken: TOKEN,
  eventName: "My Celebration",
  eventType: "Birthday Party",
  eventDate: "",
  vibeDescription: "",
  estimatedGuestCount: null,
  budgetCeiling: null,
};

/** A promise we resolve by hand, so the GET always lands after the typing. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function renderIntake(path: string) {
  const { hook } = memoryLocation({ path, record: true });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Router hook={hook}>
        <Route path="/intake/:ownerToken?" component={Intake} />
      </Router>
    </QueryClientProvider>,
  );
}

/** The value currently in a text field, read the way a host would see it. */
function valueOf(testId: string) {
  return (screen.getByTestId(testId) as HTMLInputElement | HTMLTextAreaElement).value;
}

beforeEach(() => {
  apiRequest.mockReset();
  apiRequestJson.mockReset();
  window.localStorage.clear();
  // Every PATCH (autosave between steps) simply echoes success back.
  apiRequest.mockImplementation(async (method: string) => {
    if (method === "POST") return { json: async () => ({ ...SERVER_DEFAULTS }) };
    return { json: async () => ({ ...SERVER_DEFAULTS }) };
  });
});

describe("Intake — typed values survive the fresh-start resume race", () => {
  it("keeps a typed event name when the resume fetch resolves afterwards", async () => {
    const late = deferred<{ event: typeof SERVER_DEFAULTS }>();
    apiRequestJson.mockImplementation(async (_m: string, url: string) =>
      url.includes("/master-planner/entitlement") ? { freeDraftState: "none" } : late.promise,
    );

    renderIntake("/intake");

    const nameInput = await screen.findByTestId("input-intake-event-name");
    fireEvent.change(nameInput, { target: { value: "Nina's Fortieth" } });
    expect(valueOf("input-intake-event-name")).toBe("Nina's Fortieth");

    // The server answers now, with the placeholder it stored at creation time.
    // Two macrotask turns is more than enough for a resolved fetch to flush its
    // setState calls, so reaching the assertion still holding the typed value
    // is meaningful rather than a race the test happened to win.
    late.resolve({ event: { ...SERVER_DEFAULTS } });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    expect(valueOf("input-intake-event-name")).toBe("Nina's Fortieth");
  });

  it("carries typed basics and vibe all the way to the Review step", async () => {
    const late = deferred<{ event: typeof SERVER_DEFAULTS }>();
    apiRequestJson.mockImplementation(async (_m: string, url: string) =>
      url.includes("/master-planner/entitlement") ? { freeDraftState: "none" } : late.promise,
    );

    renderIntake("/intake");

    fireEvent.change(await screen.findByTestId("input-intake-event-name"), {
      target: { value: "Nina's Fortieth" },
    });
    late.resolve({ event: { ...SERVER_DEFAULTS } });

    fireEvent.click(screen.getByTestId("button-intake-next-basics"));

    const vibe = await screen.findByTestId("input-intake-vibe");
    fireEvent.change(vibe, { target: { value: "Candlelit garden dinner" } });
    fireEvent.click(screen.getByTestId("button-intake-next-vibe"));

    await screen.findByTestId("button-intake-next-sizing");
    fireEvent.click(screen.getByTestId("button-intake-next-sizing"));

    await screen.findByTestId("button-intake-finish");
    expect(screen.getByText("Nina's Fortieth")).toBeTruthy();
    expect(screen.getByText("Candlelit garden dinner")).toBeTruthy();
    // The reported symptom: the placeholder the server stored at creation
    // reappearing in place of what the host typed.
    expect(screen.queryByText("My Celebration")).toBeNull();
  });
});

describe("Intake — genuine resume path", () => {
  it("seeds untouched fields from the server but never overwrites a typed one", async () => {
    const late = deferred<{ event: typeof SERVER_DEFAULTS }>();
    apiRequestJson.mockImplementation(async (_m: string, url: string) =>
      url.includes("/master-planner/entitlement") ? { freeDraftState: "none" } : late.promise,
    );

    renderIntake(`/intake/${TOKEN}`);

    // Resuming shows a loading state until the saved values arrive.
    expect(screen.getByTestId("text-intake-loading")).toBeTruthy();

    late.resolve({
      event: { ...SERVER_DEFAULTS, eventName: "Saved Name", vibeDescription: "Saved vibe" },
    });

    const nameInput = await screen.findByTestId("input-intake-event-name");
    expect((nameInput as HTMLInputElement).value).toBe("Saved Name");

    fireEvent.change(nameInput, { target: { value: "Renamed By Host" } });
    expect(valueOf("input-intake-event-name")).toBe("Renamed By Host");
  });

  it("does not re-fetch over an event this session just created", async () => {
    apiRequestJson.mockImplementation(async (_m: string, url: string) =>
      url.includes("/master-planner/entitlement")
        ? { freeDraftState: "none" }
        : { event: { ...SERVER_DEFAULTS } },
    );

    renderIntake("/intake");
    await screen.findByTestId("input-intake-event-name");

    // The token landing in the URL must not trigger a resume read of an event
    // whose only content is the placeholder we just wrote.
    await waitFor(() => {
      const reads = apiRequestJson.mock.calls.filter(([, url]) =>
        typeof url === "string" && url === `/api/events/owner/${TOKEN}`,
      );
      expect(reads).toHaveLength(0);
    });
  });
});

describe("Intake — clearing a previously-saved budget", () => {
  // QA found that a host who set a budget, then went back and cleared the
  // field, kept the old budget on the server: the client only included
  // `budgetCeiling` in the PATCH body when it parsed to a number, so an
  // empty field sent no key at all, and the intake route only ever sets
  // keys present in the request body. The screen showed "Not set" locally
  // while the server silently kept the stale value.
  it("sends an explicit null, not an omitted key, when the budget field is cleared", async () => {
    apiRequestJson.mockImplementation(async (_m: string, url: string) =>
      url.includes("/master-planner/entitlement")
        ? { freeDraftState: "none" }
        : { event: { ...SERVER_DEFAULTS, budgetCeiling: 750 } },
    );

    renderIntake(`/intake/${TOKEN}`);

    await screen.findByTestId("input-intake-event-name");
    fireEvent.click(screen.getByTestId("button-intake-next-basics"));
    await screen.findByTestId("input-intake-vibe");
    fireEvent.click(screen.getByTestId("button-intake-next-vibe"));

    const budgetInput = await screen.findByTestId("input-intake-budget");
    expect((budgetInput as HTMLInputElement).value).toBe("750");

    fireEvent.change(budgetInput, { target: { value: "" } });
    apiRequest.mockClear();
    fireEvent.click(screen.getByTestId("button-intake-next-sizing"));

    await waitFor(() => expect(apiRequest).toHaveBeenCalled());
    const [, , body] = apiRequest.mock.calls.find(([method]) => method === "PATCH")!;
    expect(body).toHaveProperty("budgetCeiling", null);
  });

  it("sends an explicit null from the finish step too, not an omitted key", async () => {
    apiRequestJson.mockImplementation(async (_m: string, url: string) =>
      url.includes("/master-planner/entitlement")
        ? { freeDraftState: "none" }
        : { event: { ...SERVER_DEFAULTS, budgetCeiling: 750 } },
    );

    renderIntake(`/intake/${TOKEN}`);

    await screen.findByTestId("input-intake-event-name");
    fireEvent.click(screen.getByTestId("button-intake-next-basics"));
    await screen.findByTestId("input-intake-vibe");
    fireEvent.click(screen.getByTestId("button-intake-next-vibe"));

    const budgetInput = await screen.findByTestId("input-intake-budget");
    fireEvent.change(budgetInput, { target: { value: "" } });
    fireEvent.click(screen.getByTestId("button-intake-next-sizing"));

    await screen.findByTestId("button-intake-finish");
    apiRequest.mockClear();
    fireEvent.click(screen.getByTestId("button-intake-finish"));

    await waitFor(() => expect(apiRequest).toHaveBeenCalled());
    const [, , body] = apiRequest.mock.calls.find(([method]) => method === "PATCH")!;
    expect(body).toHaveProperty("budgetCeiling", null);
  });
});

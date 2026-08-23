// The flagged experience as a host meets it.
//
// Two things are load-bearing and neither is visible from the server tests.
// With the flag off nothing changes — the collection is still the first thing
// rendered. With it on, switching to the collection and back must not throw
// away four generated directions, because that state lives in a subtree the
// switch unmounts.

import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, act } from "@testing-library/react";
import { DEFAULT_FEATURE_FLAGS } from "@shared/featureFlags";
import { INVITATION_ASK_POSY_ACTIONS } from "@shared/aiFirstAskPosy";
import { useAiFirstSession } from "@/lib/aiFirstSession";
import type { FinishedDirection } from "@shared/aiFirstStream";
import type { EventRecord } from "@/lib/types";
import { concept } from "./aiFirstFixtures";

vi.mock("@/lib/queryClient", () => ({
  API_BASE: "",
  apiRequest: vi.fn(),
  apiRequestJson: vi.fn(async () => ({})),
  queryClient: { invalidateQueries: vi.fn() },
}));

const AiFirstInvitations = (await import("@/components/AiFirstInvitations")).default;
const { apiRequestJson } = await import("@/lib/queryClient");

const event = (): EventRecord =>
  ({
    id: 1,
    shareSlug: "slug",
    eventName: "Ada's 4th Birthday",
    eventType: "birthday",
    eventDate: "12 September 2026",
    location: "our back garden",
  }) as unknown as EventRecord;

const direction = (index: number): FinishedDirection => ({
  index,
  concept: concept({ conceptName: `Direction ${index}` }),
  source: "ai-generated",
  previewId: `preview-${index}`,
  assetHash: `hash-${index}`,
  illustrationUrl: `/api/ai-first/preview/preview-${index}`,
  overlay: "veil",
  attempts: [],
});

function session(over: Partial<ReturnType<typeof useAiFirstSession>> = {}) {
  return {
    directions: [],
    savedDirections: [],
    concepts: [],
    progress: [],
    warnings: [],
    summary: null,
    error: null,
    running: false,
    hasRun: false,
    completedCount: 0,
    fallbackCount: 0,
    currentRunId: null,
    typedDirection: "",
    setTypedDirection: vi.fn(),
    inspirationNotes: "",
    setInspirationNotes: vi.fn(),
    vibeAnswer: "",
    setVibeAnswer: vi.fn(),
    selectedPreviewId: null,
    setSelectedPreviewId: vi.fn(),
    browsingCollection: false,
    setBrowsingCollection: vi.fn(),
    filters: { style: "all", occasion: "all" },
    setFilters: vi.fn(),
    run: vi.fn(),
    cancel: vi.fn(),
    ...over,
  } as ReturnType<typeof useAiFirstSession>;
}

const status = {
  plan: "spark",
  ceilings: { eventSoft: 12, eventHard: 12, monthlySoft: 48, monthlyHard: 80 },
  usage: { eventBilled: 0, monthlyBilled: 0, activeGenerations: 0 },
  killSwitch: false,
  automaticRetryDisabled: true,
  additionalGenerationConfirmationRequired: false,
  briefQuestion: null,
  askPosyActions: INVITATION_ASK_POSY_ACTIONS,
};

const approvedDesigns = {
  appliedPreviewId: null as string | null,
  directions: [] as FinishedDirection[],
};

function renderExperience(
  over: Partial<ReturnType<typeof useAiFirstSession>> = {},
  statusBody: typeof status = status,
  approvedBody: typeof approvedDesigns = approvedDesigns,
) {
  const onBrowseCollection = vi.fn();
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: async ({ queryKey }) =>
          String(queryKey[0]).endsWith("/approved-designs") ? approvedBody : statusBody,
      },
    },
  });
  render(
    <QueryClientProvider client={client}>
      <AiFirstInvitations
        ownerToken="token"
        event={event()}
        session={session(over)}
        onBrowseCollection={onBrowseCollection}
      />
    </QueryClientProvider>,
  );
  return { onBrowseCollection };
}

describe("the flag itself", () => {
  it("is off by default, so the live experience is unchanged", () => {
    expect(DEFAULT_FEATURE_FLAGS.aiFirstInvitations).toBe(false);
  });
});

describe("what the host is told", () => {
  const CLAIM = "Your four invitation ideas are ready.";

  it("claims the four directions only once all four are on screen", () => {
    renderExperience({ directions: [0, 1, 2, 3].map(direction), hasRun: true });
    expect(screen.getByTestId("text-ai-first-heading").textContent).toBe(CLAIM);
  });

  it("makes no completion claim before a run has started", () => {
    renderExperience();
    const heading = screen.getByTestId("text-ai-first-heading").textContent ?? "";
    expect(heading).not.toBe(CLAIM);
    // AI is the primary path, and it works from details the host already gave.
    expect(document.body.textContent).toContain("event details you've already shared");
    expect(document.body.textContent).toContain("You do not need to type your theme again");
    expect(screen.getAllByTestId("button-generate-directions")).toHaveLength(1);
  });

  it("makes no completion claim while the run is still in flight", () => {
    renderExperience({ running: true, directions: [0, 1, 2].map(direction) });
    expect(screen.getByTestId("text-ai-first-heading").textContent).not.toBe(CLAIM);
  });

  it("keeps the curated collection reachable under its own name", () => {
    const { onBrowseCollection } = renderExperience();
    const browse = screen.getByTestId("button-browse-collection");
    expect(browse.textContent).toBe("Choose from ready-made designs");
    fireEvent.click(browse);
    expect(onBrowseCollection).toHaveBeenCalled();
  });

  it("does not frame itself as advanced, slower or unfinished", () => {
    renderExperience({ directions: [direction(0)] });
    const text = document.body.textContent ?? "";
    for (const banned of ["Advanced", "Slower", "not studio", "experimental", "beta"]) {
      expect(text.toLowerCase()).not.toContain(banned.toLowerCase());
    }
  });

  it("shows the run's own progress message, never a countdown", () => {
    renderExperience({ running: true, progress: ["Creating the first invitation direction…"] });
    expect(screen.getByTestId("text-progress").textContent).toContain(
      "Creating the first invitation direction…",
    );
  });

  it("makes the first event generation one click", async () => {
    const run = vi.fn();
    renderExperience({ run });
    await waitFor(() =>
      expect((screen.getByTestId("button-generate-directions") as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByTestId("button-generate-directions"));
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith({});
    expect(screen.queryByTestId("card-confirm-additional-generation")).toBeNull();
  });

  it("requires a separate confirmation before any later paid generation", async () => {
    const run = vi.fn();
    renderExperience(
      { run },
      {
        ...status,
        usage: { ...status.usage, eventBilled: 1 },
        additionalGenerationConfirmationRequired: true,
        directionLimit: 1,
      },
    );

    // First press is intentionally free: it only opens the warning.
    await waitFor(() =>
      expect((screen.getByTestId("button-generate-directions") as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByTestId("button-generate-directions"));
    expect(run).not.toHaveBeenCalled();
    expect(screen.getByTestId("card-confirm-additional-generation").textContent).toContain(
      "another generation from your plan",
    );
    expect(screen.getByTestId("card-confirm-additional-generation").textContent).toContain(
      "current ideas will remain available",
    );
    expect(screen.getByTestId("button-confirm-additional-generation").textContent).toContain(
      "Confirm and create",
    );

    // Only the explicitly labeled second press may mint another run.
    fireEvent.click(screen.getByTestId("button-confirm-additional-generation"));
    expect(run).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledWith({ confirmAdditionalGeneration: true });
  });

  it("also protects a second generation in the same mounted session", async () => {
    const run = vi.fn();
    renderExperience({ run, hasRun: true });
    await waitFor(() =>
      expect((screen.getByTestId("button-generate-directions") as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByTestId("button-generate-directions"));
    expect(run).not.toHaveBeenCalled();
    expect(screen.getByTestId("card-confirm-additional-generation")).toBeTruthy();
  });
});

describe("cards appear as they are approved", () => {
  it("renders one card per approved direction and nothing before the first", () => {
    renderExperience();
    expect(screen.queryByTestId("grid-ai-directions")).toBeNull();
  });

  it("shows two cards while the other two are still being made", () => {
    renderExperience({ directions: [direction(1), direction(0)], running: true });
    expect(screen.getByTestId("card-ai-direction-0")).toBeTruthy();
    expect(screen.getByTestId("card-ai-direction-1")).toBeTruthy();
    expect(screen.queryByTestId("card-ai-direction-2")).toBeNull();
  });

  it("requires an intentional press to change the live invitation", () => {
    renderExperience({ directions: [direction(0)] });
    // Selecting a card is a preview. Only "Use this design" applies it.
    expect(screen.getByTestId("button-select-direction-0")).toBeTruthy();
    expect(screen.getByTestId("button-use-direction-0").textContent).toContain("Use this design");
  });

  it("restores an accepted direction after refresh and applies it without generating again", async () => {
    const run = vi.fn();
    vi.mocked(apiRequestJson).mockClear();
    renderExperience(
      { run },
      {
        ...status,
        usage: { ...status.usage, eventBilled: 1 },
        additionalGenerationConfirmationRequired: true,
        directionLimit: 1,
      },
      { appliedPreviewId: null, directions: [direction(0)] },
    );

    await waitFor(() => expect(screen.getByTestId("button-use-direction-0")).toBeTruthy());
    expect(screen.getByTestId("text-ai-first-heading").textContent).toContain("approved invitation design");
    expect(document.body.textContent).toContain("no new artwork or charge");

    fireEvent.click(screen.getByTestId("button-use-direction-0"));
    await waitFor(() =>
      expect(apiRequestJson).toHaveBeenCalledWith(
        "POST",
        "/api/events/owner/token/ai-first/apply",
        expect.objectContaining({ previewId: "preview-0", assetHash: "hash-0" }),
      ),
    );
    expect(run).not.toHaveBeenCalled();
  });

  it("offers the invitation Ask Posy actions once there is a card to act on", async () => {
    renderExperience({ directions: [direction(0)] });
    await waitFor(() => expect(screen.getByTestId("section-ask-posy")).toBeTruthy());
    for (const action of INVITATION_ASK_POSY_ACTIONS) {
      expect(screen.getByTestId(`button-ask-posy-${action.id}`).textContent).toBe(action.label);
    }
  });

  it("makes a single invitation visibly selected for refinement", async () => {
    renderExperience({ directions: [direction(0)], hasRun: true });

    await waitFor(() => expect(screen.getByTestId("section-ask-posy")).toBeTruthy());
    expect(screen.getByTestId("button-select-direction-0").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("text-direction-selection-0").textContent).toContain("Selected to refine");
    expect(screen.getByTestId("section-ask-posy").textContent).toContain("Refining Direction 0");
  });

  it("makes selection explicit before direction-specific actions when there are multiple invitations", async () => {
    const setSelectedPreviewId = vi.fn();
    renderExperience({
      directions: [direction(0), direction(1)],
      hasRun: true,
      setSelectedPreviewId,
    });

    await waitFor(() => expect(screen.getByTestId("button-ask-posy-refine")).toBeTruthy());
    expect((screen.getByTestId("button-ask-posy-refine") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("text-direction-selection-1").textContent).toContain("Select to refine");

    fireEvent.click(screen.getByTestId("button-select-direction-1"));
    expect(setSelectedPreviewId).toHaveBeenCalledWith("preview-1");
  });

  it("makes Help me choose advisory and never starts generation", async () => {
    const run = vi.fn();
    renderExperience({ directions: [direction(0), direction(1)], hasRun: true, run });
    await waitFor(() => expect(screen.getByTestId("button-ask-posy-help-choose")).toBeTruthy());

    fireEvent.click(screen.getByTestId("button-ask-posy-help-choose"));

    expect(run).not.toHaveBeenCalled();
    expect(screen.getByTestId("text-help-choose").textContent).toContain(
      "Choose the invitation whose overall feeling and composition is closest",
    );
    expect(screen.queryByTestId("card-confirm-additional-generation")).toBeNull();
  });

  it("requests two focused variations and preserves the current ideas until confirmation", async () => {
    const run = vi.fn();
    renderExperience({ directions: [direction(0)], hasRun: true, run });
    await waitFor(() => expect(screen.getByTestId("button-ask-posy-more-modern")).toBeTruthy());

    fireEvent.click(screen.getByTestId("button-ask-posy-more-modern"));
    expect(run).not.toHaveBeenCalled();
    const askPosy = screen.getByTestId("section-ask-posy");
    const confirmation = within(askPosy).getByTestId("card-confirm-additional-generation");
    expect(confirmation.getAttribute("data-placement")).toBe("refinement");
    expect(confirmation.textContent).toContain("Update this invitation?");

    fireEvent.click(screen.getByTestId("button-confirm-additional-generation"));
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "more-modern",
        directionCount: 2,
        confirmAdditionalGeneration: true,
      }),
    );
  });

  it("keeps a typed update and its spend confirmation beside the refinement controls", async () => {
    const run = vi.fn();
    renderExperience({
      directions: [direction(0)],
      hasRun: true,
      typedDirection: "less literal, more atmospheric",
      run,
    });

    await waitFor(() => expect(screen.getByTestId("button-submit-ask-posy-direction")).toBeTruthy());
    expect(screen.getByTestId("button-submit-ask-posy-direction").textContent).toContain("Update my invitation");
    fireEvent.click(screen.getByTestId("button-submit-ask-posy-direction"));

    expect(run).not.toHaveBeenCalled();
    const confirmation = within(screen.getByTestId("section-ask-posy")).getByTestId(
      "card-confirm-additional-generation",
    );
    expect(confirmation.textContent).toContain("nothing starts until you confirm");

    fireEvent.click(within(confirmation).getByTestId("button-confirm-additional-generation"));
    expect(run).toHaveBeenCalledWith(
      expect.objectContaining({
        direction: "less literal, more atmospheric",
        concept: expect.objectContaining({ conceptName: "Direction 0" }),
        directionCount: 2,
        confirmAdditionalGeneration: true,
      }),
    );
  });

  it("says artwork is paused without hiding the designs already made", async () => {
    status.killSwitch = true;
    try {
      renderExperience({ directions: [direction(0)] });
      await waitFor(() => expect(screen.getByTestId("text-generation-paused")).toBeTruthy());
      expect(screen.getByTestId("card-ai-direction-0")).toBeTruthy();
      expect((screen.getByTestId("button-generate-directions") as HTMLButtonElement).disabled).toBe(true);
    } finally {
      status.killSwitch = false;
    }
  });
});

describe("exploration state survives a switch to the collection", () => {
  it("keeps directions, the typed steer and the filters across a round trip", () => {
    const { result } = renderHook(() => useAiFirstSession("token"));

    act(() => {
      result.current.setTypedDirection("less literal, more atmospheric");
      result.current.setInspirationNotes("brass and dusty rose");
      result.current.setSelectedPreviewId("preview-2");
      result.current.setFilters({ style: "editorial", occasion: "birthday" });
    });

    act(() => result.current.setBrowsingCollection(true));
    act(() => result.current.setBrowsingCollection(false));

    expect(result.current.typedDirection).toBe("less literal, more atmospheric");
    expect(result.current.inspirationNotes).toBe("brass and dusty rose");
    expect(result.current.selectedPreviewId).toBe("preview-2");
    expect(result.current.filters).toEqual({ style: "editorial", occasion: "birthday" });
  });

  it("supersedes a re-run of the same index rather than showing it twice", async () => {
    const { result } = renderHook(() => useAiFirstSession("token"));
    const body = [
      `data: ${JSON.stringify({ type: "direction", direction: direction(0) })}\n\n`,
      `data: ${JSON.stringify({ type: "direction", direction: { ...direction(0), previewId: "preview-redo" } })}\n\n`,
    ].join("");

    vi.stubGlobal("fetch", async () => ({
      ok: true,
      body: {
        getReader: () => {
          let sent = false;
          return {
            read: async () =>
              sent
                ? { done: true, value: undefined }
                : ((sent = true), { done: false, value: new TextEncoder().encode(body) }),
          };
        },
      },
    }));

    await act(() => result.current.run());
    await waitFor(() => expect(result.current.directions).toHaveLength(1));
    expect(result.current.directions[0].previewId).toBe("preview-redo");
    vi.unstubAllGlobals();
  });
});

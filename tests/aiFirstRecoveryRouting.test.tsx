// A durable AI-first preview must remain reachable even when an older
// curated invitation is currently active. This is the exact return-visit
// shape that originally hid Grayson's accepted design after refresh.

import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { buildThemedConcept, LAUNCH_THEMES } from "@shared/themeCatalog";
import type { EventRecord } from "@/lib/types";

vi.mock("@/lib/queryClient", () => ({
  apiRequest: vi.fn(),
  apiRequestJson: vi.fn(async () => ({})),
  queryClient: { invalidateQueries: vi.fn() },
}));

vi.mock("@/lib/featureFlags", () => ({
  useFeatureFlags: () => ({
    aiFirstInvitations: true,
    invitationGenerationKillSwitch: false,
    aiFirstDisableAutomaticRetry: true,
  }),
}));

const session = {
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
};

vi.mock("@/lib/aiFirstSession", () => ({ useAiFirstSession: () => session }));
vi.mock("@/components/AiFirstInvitations", () => ({
  default: () => <div data-testid="approved-design-recovery">Approved design recovery</div>,
}));
vi.mock("@/components/InviteStudio", () => ({
  default: () => <div data-testid="legacy-theme-studio">Legacy theme studio</div>,
}));
vi.mock("@/components/LiveInviteEditor", () => ({
  default: () => <div data-testid="legacy-live-editor">Legacy live editor</div>,
}));
vi.mock("@/components/ThemeChooser", () => ({ default: () => <div>Theme chooser</div> }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const InviteDesignPicker = (await import("@/components/InviteDesignPicker")).default;

function curatedEvent(): EventRecord {
  const concept = buildThemedConcept(LAUNCH_THEMES[0]);
  return {
    id: 6,
    shareSlug: "grayson",
    eventName: "I'm 3 and Diggin' It",
    eventType: "birthday",
    eventDate: "Saturday, November 7, 2026",
    location: "",
    inviteSubject: "You're invited!",
    inviteMessage: "We can't wait to celebrate with you!",
    inviteDesignConceptJson: JSON.stringify(concept),
    inviteRenderMode: "posy",
    customInviteImageUrl: "",
  } as unknown as EventRecord;
}

function renderPicker(directions: Array<{ previewId: string }>) {
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: async ({ queryKey }) =>
          String(queryKey[0]).endsWith("/approved-designs")
            ? { appliedPreviewId: null, directions }
            : {},
      },
    },
  });
  render(
    <QueryClientProvider client={client}>
      <InviteDesignPicker ownerToken="owner-token" event={curatedEvent()} />
    </QueryClientProvider>,
  );
}

describe("approved-design recovery routing", () => {
  it("shows an unapplied durable preview ahead of the active legacy theme", async () => {
    renderPicker([{ previewId: "accepted-preview" }]);

    await waitFor(() => expect(screen.getByTestId("approved-design-recovery")).toBeTruthy());
    expect(screen.queryByTestId("legacy-theme-studio")).toBeNull();
  });

  it("keeps the current theme studio when there is no durable preview", async () => {
    renderPicker([]);

    await waitFor(() => expect(screen.getByTestId("legacy-theme-studio")).toBeTruthy());
    expect(screen.queryByTestId("approved-design-recovery")).toBeNull();
  });
});

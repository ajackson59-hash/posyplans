// The flagged AI-first experience, mounted as a host meets it.
//
// The component, the session hook, the SSE parser and the renderer are all the
// production ones. Only the API origin is a stand-in (see mockApi.mjs).

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import AiFirstInvitations from "@/components/AiFirstInvitations";
import { useAiFirstSession } from "@/lib/aiFirstSession";
import { Toaster } from "@/components/ui/toaster";
import type { EventRecord } from "@/lib/types";
import "@/index.css";

const client = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      queryFn: async ({ queryKey }) => {
        const response = await fetch(String(queryKey[0]));
        return response.json();
      },
    },
  },
});

const EVENTS: Record<string, Partial<EventRecord>> = {
  A: {
    eventName: "Ada's 4th Birthday",
    eventType: "birthday",
    eventDate: "12 September 2026",
    location: "our back garden",
  },
  B: {
    eventName: "Marianne's 40th Birthday Dinner",
    eventType: "birthday",
    eventDate: "7 November 2026",
    location: "Ferrier's, 8 Lamb Street",
  },
  C: {
    eventName: "Theo's 3rd Birthday",
    eventType: "birthday",
    eventDate: "21 March 2027",
    location: "Weald Park Pavilion",
  },
};

const brief = new URLSearchParams(location.search).get("brief") ?? "A";
const autorun = new URLSearchParams(location.search).get("run") !== "0";

function Harness() {
  const session = useAiFirstSession("qa-token");
  useEffect(() => {
    if (autorun) void session.run();
    // Once, on mount — this is a screenshot harness, not a live surface.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Mirrors InviteDesignPicker: the session lives here, above the boundary,
  // and the AI subtree is genuinely unmounted while the collection is shown.
  // That is the arrangement requirement 9 is about.
  if (session.browsingCollection) {
    return (
      <div data-testid="card-theme-gallery">
        <button
          type="button"
          onClick={() => session.setBrowsingCollection(false)}
          data-testid="button-back-to-directions"
          className="mb-4 text-xs font-medium text-primary underline underline-offset-2"
        >
          Back to my invitation directions
        </button>
        <p className="text-sm text-neutral-600">
          The Posy collection renders here. Stubbed in this harness because it needs the events API.
        </p>
      </div>
    );
  }

  return (
    <div data-testid="card-ai-first-invitations">
      <AiFirstInvitations
        ownerToken="qa-token"
        event={{ id: 1, shareSlug: "qa", ...EVENTS[brief] } as EventRecord}
        session={session}
        onBrowseCollection={() => session.setBrowsingCollection(true)}
      />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={client}>
    <div className="mx-auto max-w-5xl p-6">
      <Harness />
    </div>
    <Toaster />
  </QueryClientProvider>,
);

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sparkles, X } from "lucide-react";
import type { EventRecord } from "@/lib/types";

// Design Spec §1, State 4 — once a host lands on the Dashboard from the AI
// Master Planner's Draft Overview, each of the six tabs shows this small,
// dismissible marker so it's always clear which content came from the AI
// draft versus what the host has typed in themselves. Reads the same
// `/api/events/owner/:ownerToken` query every tab already has cached
// (Dashboard.tsx's useEventData), so this adds zero extra requests.
//
// Dismissal is local component state only, by design — nothing is
// persisted. Switching tabs or reloading brings it back as long as
// event.draftStatus is still "ready", which matches the spec's framing of
// this as a lightweight, ambient reminder rather than a one-time toast.
export default function AiDraftedBadge({ ownerToken }: { ownerToken: string }) {
  const [dismissed, setDismissed] = useState(false);
  const { data } = useQuery<{ event: EventRecord }>({
    queryKey: [`/api/events/owner/${ownerToken}`],
  });

  if (dismissed || data?.event?.draftStatus !== "ready") return null;

  return (
    <Badge
      variant="secondary"
      className="mb-3 flex w-fit items-center gap-1.5 py-1 pl-2 pr-1 font-normal"
      data-testid="badge-ai-drafted"
    >
      <Sparkles className="h-3 w-3" />
      <span>I put this together for you — change anything</span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-4 w-4 flex-none p-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        data-testid="button-ai-drafted-dismiss"
      >
        <X className="h-3 w-3" />
      </Button>
    </Badge>
  );
}

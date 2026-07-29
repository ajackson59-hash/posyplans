import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PartyPopper, X } from "lucide-react";
import type { ReadinessScoreResult } from "@shared/readinessScore";
import { getReadinessMoment } from "@shared/readinessMoment";

// The "readiness moment" (Product Constitution "Quick Wow" — named in the
// Phase 3 report's Signature Wow Moments section): a single calm message
// during the final week before the event, once the Readiness Score says the
// plan is genuinely solid — the emotional payoff of the whole trust
// framework, timed to land right before the highest-anxiety period.
//
// Reads the same `/readiness` query ReadinessScoreCard.tsx and
// NextActions.tsx already use (shared React Query cache, no extra
// request) plus the event's own date — pure date math and a threshold
// check, zero new AI cost, zero schema change. Dismissible for the current
// visit only; it naturally stops showing on its own once the event passes
// or falls outside the 7-day window, so nothing needs to be persisted to
// keep it from nagging on a future visit.
export default function ReadinessMoment({
  ownerToken,
  eventDate,
  onNavigate,
}: {
  ownerToken: string;
  eventDate: string;
  onNavigate: (tab: string) => void;
}) {
  const [dismissed, setDismissed] = useState(false);
  const { data } = useQuery<ReadinessScoreResult>({
    queryKey: [`/api/events/owner/${ownerToken}/readiness`],
    staleTime: 30000,
  });

  if (!data || dismissed) return null;

  const { show, daysUntil } = getReadinessMoment(eventDate, data.overall);
  if (!show || daysUntil === null) return null;

  const dayLabel = daysUntil === 0 ? "Today's the day" : daysUntil === 1 ? "1 day to go" : `${daysUntil} days to go`;

  return (
    <Card className="border-secondary/40 bg-secondary/5" data-testid="card-readiness-moment">
      <CardContent className="flex items-start justify-between gap-3 p-4">
        <div className="flex items-start gap-3">
          <PartyPopper className="mt-0.5 h-5 w-5 flex-shrink-0 text-secondary" />
          <div>
            <p className="text-sm font-medium text-foreground" data-testid="text-readiness-moment-heading">
              {dayLabel} — your plan is solid.
            </p>
            <p className="text-xs text-muted-foreground">
              Every module is in good shape. Time to stop planning and start looking forward to it.
            </p>
            <Button
              type="button"
              variant="ghost"
              className="h-auto px-0 text-xs text-secondary underline-offset-2 hover:underline"
              onClick={() => onNavigate("timeline")}
              data-testid="button-readiness-moment-timeline"
            >
              Review your day-of timeline
            </Button>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-6 w-6 flex-none text-muted-foreground"
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          data-testid="button-readiness-moment-dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </CardContent>
    </Card>
  );
}

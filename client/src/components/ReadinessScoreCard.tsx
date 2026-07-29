import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Target } from "lucide-react";
import type { ReadinessScoreResult, ReadinessDimension } from "@shared/readinessScore";

// Dashboard header widget for the Event Readiness Score (see
// shared/readinessScore.ts) — one synthesized 0-100 number combining budget
// health, menu completeness, RSVP response rate, shopping-list coverage, and
// timeline planning. Purely rule-based, computed fresh on the server on
// every read, so this never triggers an AI call and never goes stale.
//
// Shows the score itself and the five dimension bars only. The "what to do
// about it" half of this same data — the ranked, tab-linked action queue—
// lives in the dedicated NextActions.tsx card (Engineering Backlog #29),
// which reads the same `/readiness` response so there is no extra request.
export default function ReadinessScoreCard({ ownerToken }: { ownerToken: string }) {
  const { data } = useQuery<ReadinessScoreResult>({
    queryKey: [`/api/events/owner/${ownerToken}/readiness`],
    staleTime: 30000,
  });

  if (!data) return null;

  const dimensionOrder: ReadinessDimension[] = ["rsvp", "budget", "menu", "shopping", "timeline"];
  const scoreColorClass =
    data.overall >= 75 ? "text-secondary" : data.overall >= 50 ? "text-accent" : "text-foreground";

  return (
    <Card className="border-card-border" data-testid="card-readiness-score">
      <CardContent className="p-4 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2">
            <Target className="h-4 w-4 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium text-foreground">Event Readiness</p>
              <p className="text-xs text-muted-foreground" data-testid="text-readiness-band">
                {data.band}
              </p>
            </div>
          </div>
          <p
            className={`font-serif text-3xl font-semibold leading-none ${scoreColorClass}`}
            data-testid="text-readiness-score"
          >
            {data.overall}
            <span className="text-lg text-muted-foreground">%</span>
          </p>
        </div>

        <div className="grid grid-cols-1 gap-2 sm:grid-cols-5 sm:gap-3">
          {dimensionOrder.map((dim) => {
            const d = data.dimensions[dim];
            return (
              <div key={dim} className="space-y-1" data-testid={`readiness-dimension-${dim}`}>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{d.label}</span>
                  <span data-testid={`text-readiness-${dim}-score`}>{Math.round(d.score)}%</span>
                </div>
                <Progress value={d.score} className="h-1.5" />
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

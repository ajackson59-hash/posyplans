import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ListChecks, ArrowRight, CircleCheck } from "lucide-react";
import type { ReadinessScoreResult } from "@shared/readinessScore";

// "What's actually left to decide" (Engineering Backlog #29): a re-ranking
// and UI layer over the Event Readiness Score (#28) that already exists —
// no new server logic, no new AI cost, no new network request (this reads
// the same `/readiness` endpoint ReadinessScoreCard.tsx uses, sharing its
// React Query cache under the identical queryKey).
//
// The Readiness Score already ranks every dimension's gap biggest-first
// internally; this component is the promoted, actionable version of that —
// every open gap as a clickable "go fix this" row that jumps straight to
// the right tab, instead of a flat two-line summary buried under a score
// bar. Dashboard.tsx passes its `setActiveTab` state setter in as
// `onNavigate` so a click here switches tabs directly.
export default function NextActions({
  ownerToken,
  onNavigate,
}: {
  ownerToken: string;
  onNavigate: (tab: string) => void;
}) {
  const { data } = useQuery<ReadinessScoreResult>({
    queryKey: [`/api/events/owner/${ownerToken}/readiness`],
    staleTime: 30000,
  });

  if (!data) return null;

  return (
    <Card className="border-card-border" data-testid="card-next-actions">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-serif text-lg">
          <ListChecks className="h-4 w-4" /> What's left to decide
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          The biggest open gaps right now, ranked — tap one to jump straight to it.
        </p>
      </CardHeader>
      <CardContent>
        {data.nextActions.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground" data-testid="text-next-actions-empty">
            <CircleCheck className="h-4 w-4 flex-shrink-0 text-secondary" />
            Every module looks in good shape — you're close to fully ready.
          </p>
        ) : (
          <div className="space-y-2">
            {data.nextActions.map((item, i) => (
              <Button
                key={item.dimension}
                type="button"
                variant="outline"
                className="h-auto w-full justify-between gap-3 whitespace-normal px-3 py-2.5 text-left"
                onClick={() => onNavigate(item.tab)}
                data-testid={`button-next-action-${item.dimension}`}
              >
                <span className="flex items-start gap-2.5">
                  <span
                    className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium text-muted-foreground"
                    aria-hidden="true"
                  >
                    {i + 1}
                  </span>
                  <span className="flex flex-col">
                    <span className="text-xs font-medium text-foreground">{item.label}</span>
                    <span className="text-xs text-muted-foreground">{item.action}</span>
                  </span>
                </span>
                <ArrowRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
              </Button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

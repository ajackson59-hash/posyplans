import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { AlertTriangle, Info } from "lucide-react";
import type { Contradiction } from "@shared/contradictions";
import type { TimelineConflict } from "@shared/timelineConflicts";
import type { MissingItemSuggestion } from "@shared/missingItems";
import type { BudgetFeasibilityFlag, BudgetFeasibilityResult } from "@shared/budgetFeasibility";
import type { MenuThemeCoherenceFlag } from "@shared/menuThemeCoherence";

// Surfaces every rule-based planning alert in one quiet feed: cross-module
// contradictions (shared/contradictions.ts), timeline scheduling conflicts
// (shared/timelineConflicts.ts), missing-item suggestions
// (shared/missingItems.ts), budget-feasibility flags
// (shared/budgetFeasibility.ts), and menu-to-theme coherence
// (shared/menuThemeCoherence.ts). All five are computed fresh on the server
// on every read, so none of this ever triggers an AI call or goes stale.
// Renders nothing when there is nothing to flag, by design — this should
// stay quiet unless it has something genuinely useful to say.
type AlertSeverity = "notice" | "warning";
interface UnifiedAlert {
  id: string;
  severity: AlertSeverity;
  title: string;
  detail: string;
}

export default function PlanningAlerts({ ownerToken }: { ownerToken: string }) {
  const { data: contradictionsData } = useQuery<{ contradictions: Contradiction[] }>({
    queryKey: [`/api/events/owner/${ownerToken}/contradictions`],
    staleTime: 30000,
  });
  const { data: timelineData } = useQuery<{ conflicts: TimelineConflict[] }>({
    queryKey: [`/api/events/owner/${ownerToken}/timeline-conflicts`],
    staleTime: 30000,
  });
  const { data: missingItemsData } = useQuery<{ suggestions: MissingItemSuggestion[] }>({
    queryKey: [`/api/events/owner/${ownerToken}/missing-items`],
    staleTime: 30000,
  });
  const { data: budgetFeasibilityData } = useQuery<BudgetFeasibilityResult>({
    queryKey: [`/api/events/owner/${ownerToken}/budget-feasibility`],
    staleTime: 30000,
  });
  const { data: menuThemeData } = useQuery<{ flags: MenuThemeCoherenceFlag[] }>({
    queryKey: [`/api/events/owner/${ownerToken}/menu-theme-coherence`],
    staleTime: 30000,
  });

  const alerts: UnifiedAlert[] = [
    ...(contradictionsData?.contradictions ?? []),
    ...(timelineData?.conflicts ?? []),
    ...(missingItemsData?.suggestions ?? []),
    ...((budgetFeasibilityData?.flags ?? []) as BudgetFeasibilityFlag[]),
    ...(menuThemeData?.flags ?? []),
  ];
  // Warnings first, so the most actionable items surface at the top.
  alerts.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "warning" ? -1 : 1));

  if (alerts.length === 0) return null;

  return (
    <div className="space-y-2" data-testid="section-planning-alerts">
      {alerts.map((a) => {
        const isWarning = a.severity === "warning";
        return (
          <Card
            key={a.id}
            className={
              isWarning
                ? "border-destructive/30 bg-destructive/5"
                : "border-accent/40 bg-accent/10"
            }
            data-testid={`alert-${a.id}`}
          >
            <CardContent className="flex gap-3 py-3">
              {isWarning ? (
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-destructive" />
              ) : (
                <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent-foreground" />
              )}
              <div className="space-y-0.5">
                <p
                  className={`text-sm font-medium ${isWarning ? "text-destructive" : "text-foreground"}`}
                  data-testid={`text-alert-title-${a.id}`}
                >
                  {a.title}
                </p>
                <p className="text-sm text-muted-foreground" data-testid={`text-alert-detail-${a.id}`}>
                  {a.detail}
                </p>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

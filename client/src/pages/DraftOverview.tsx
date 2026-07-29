import { useParams, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Wordmark } from "@/components/Logo";
import {
  Sparkles,
  Wallet,
  ChefHat,
  Clock,
  Mail,
  Target,
  Info,
  ArrowRight,
} from "lucide-react";
import type { ReadinessScoreResult } from "@shared/readinessScore";

// Design Spec §1, State 3 — "the single most important screen in this
// spec." A one-page synthesis a host lands on right after the AI Master
// Planner finishes, before going into the familiar six tabs. Every field
// here is read from the live GET .../master-planner/draft-overview payload
// (server/routes.ts) — nothing is computed or duplicated client-side.
//
// Purely functional per the deferred-visual-polish instruction — real
// styling comes once Brand Standards / Design DNA are finalized.

interface DraftOverviewData {
  eventIdentity: string;
  theme: { name: string; paletteColors: string[] };
  budget: { total: number | null; topCategories: { category: string; total: number }[] };
  menuHighlights: { id: number; itemName: string; course: string }[];
  timelineHighlights: { id: number; time: string; title: string; category: string }[];
  invitationConcept: {
    conceptName: string;
    description: string;
    paletteColors: string[];
    fontPairingLabel: string;
    borderStyle: string;
    layoutStyle: string;
    illustrationUrl: string;
  } | null;
  readiness: ReadinessScoreResult;
  thingsToDoubleCheck: { id: string; severity: "notice" | "warning"; title: string; detail: string }[];
}

export default function DraftOverview() {
  const { ownerToken } = useParams<{ ownerToken: string }>();
  const [, navigate] = useLocation();

  const { data, isLoading } = useQuery<DraftOverviewData>({
    queryKey: [`/api/events/owner/${ownerToken}/master-planner/draft-overview`],
    enabled: !!ownerToken,
  });

  if (isLoading || !data) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-6 py-16">
        <p className="text-sm text-muted-foreground" data-testid="text-draft-overview-loading">
          Pulling your draft together...
        </p>
      </div>
    );
  }

  const formattedBudgetTotal =
    data.budget.total != null ? `$${data.budget.total.toLocaleString()}` : "Not yet estimated";

  return (
    <div className="min-h-screen bg-background px-6 py-12">
      <div className="mx-auto w-full max-w-2xl space-y-6" data-testid="page-draft-overview">
        <Wordmark className="mb-2" />

        {/* Event Identity line */}
        <p className="text-lg text-foreground" data-testid="text-event-identity">
          {data.eventIdentity || "Your draft is ready — here's a first look."}
        </p>

        {/* Theme */}
        <Card data-testid="card-theme">
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">Theme</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center gap-3">
            <p className="text-sm text-foreground" data-testid="text-theme-name">
              {data.theme.name || "Not yet named"}
            </p>
            <div className="flex gap-1.5">
              {data.theme.paletteColors.map((color, i) => (
                <span
                  key={`${color}-${i}`}
                  className="h-4 w-4 rounded-full border border-card-border"
                  style={{ backgroundColor: color }}
                  data-testid={`swatch-theme-${i}`}
                />
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Budget */}
        <Card data-testid="card-budget">
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <Wallet className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">Budget</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <p className="text-lg font-semibold text-foreground" data-testid="text-budget-total">
              {formattedBudgetTotal}
            </p>
            {data.budget.topCategories.length > 0 && (
              <ul className="space-y-1 text-sm text-muted-foreground">
                {data.budget.topCategories.map((c) => (
                  <li key={c.category} data-testid={`text-budget-category-${c.category}`}>
                    {c.category} — ${c.total.toLocaleString()}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Menu */}
        {data.menuHighlights.length > 0 && (
          <Card data-testid="card-menu">
            <CardHeader className="flex flex-row items-center gap-2 pb-2">
              <ChefHat className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-sm font-medium">Menu</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1 text-sm text-muted-foreground">
                {data.menuHighlights.map((m) => (
                  <li key={m.id} data-testid={`text-menu-item-${m.id}`}>
                    {m.itemName}{" "}
                    <span className="text-muted-foreground/60">({m.course})</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Timeline */}
        {data.timelineHighlights.length > 0 && (
          <Card data-testid="card-timeline">
            <CardHeader className="flex flex-row items-center gap-2 pb-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-sm font-medium">Timeline highlights</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1 text-sm text-muted-foreground">
                {data.timelineHighlights.map((t) => (
                  <li key={t.id} data-testid={`text-timeline-item-${t.id}`}>
                    {t.time ? `${t.time} — ` : ""}
                    {t.title}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Invitation concept */}
        {data.invitationConcept && (
          <Card data-testid="card-invitation-concept">
            <CardHeader className="flex flex-row items-center gap-2 pb-2">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-sm font-medium">Invitation look</CardTitle>
            </CardHeader>
            <CardContent className="flex gap-3">
              {data.invitationConcept.illustrationUrl && (
                <img
                  src={data.invitationConcept.illustrationUrl}
                  alt=""
                  className="h-16 w-16 shrink-0 rounded object-cover"
                  data-testid="img-invitation-preview"
                />
              )}
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-foreground" data-testid="text-invitation-concept-name">
                  {data.invitationConcept.conceptName}
                </p>
                <p className="text-sm text-muted-foreground" data-testid="text-invitation-concept-description">
                  {data.invitationConcept.description}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Readiness Score */}
        <Card data-testid="card-readiness">
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <Target className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">Readiness</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground" data-testid="text-readiness-band">
              {data.readiness.band}
            </p>
            <p className="text-2xl font-semibold text-foreground" data-testid="text-readiness-score">
              {data.readiness.overall}
              <span className="text-sm text-muted-foreground">%</span>
            </p>
          </CardContent>
        </Card>

        {/* Things I'd double check — calmly worded, capped at 3 */}
        {data.thingsToDoubleCheck.length > 0 && (
          <Card data-testid="card-double-check">
            <CardHeader className="flex flex-row items-center gap-2 pb-2">
              <Info className="h-4 w-4 text-muted-foreground" />
              <CardTitle className="text-sm font-medium">A few things I'd double check</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                {data.thingsToDoubleCheck.map((item) => (
                  <li key={item.id} data-testid={`text-double-check-${item.id}`}>
                    <span className="font-medium text-foreground">{item.title}</span>
                    <span className="text-muted-foreground"> — {item.detail}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Reassurance line — verbatim from Design Spec §1, State 3 */}
        <p className="text-center text-sm text-muted-foreground" data-testid="text-reassurance">
          Everything below is a starting point — nothing is final until you say so.
        </p>

        <div className="flex justify-center pt-2">
          <Button
            onClick={() => navigate(`/dashboard/${ownerToken}`)}
            data-testid="button-open-editor"
          >
            Take me to the full plan
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

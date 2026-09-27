import { Mail, Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { getInvitationJourneyState } from "@/lib/invitationState";
import type { EventRecord } from "@/lib/types";

export default function InvitationOverview({ event, ownerToken, onOpenEditor }: {
  event: EventRecord;
  ownerToken: string;
  onOpenEditor: () => void;
}) {
  const state = getInvitationJourneyState(event);
  const hasDesign = state !== "not_started";

  return (
    <Card className="border-primary/25 bg-primary/[0.03]" data-testid="card-invitation-next-step">
      <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-full bg-primary/10 p-2 text-primary">
            <Mail className="h-4 w-4" />
          </div>
          <div>
            <h2 className="font-serif text-lg font-semibold text-foreground">
              {state === "live" ? "Your invitation is live" : hasDesign ? "Your saved invitation" : "Create your invitation"}
            </h2>
            <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">
              {hasDesign
                ? "View your saved design and wording. Open Invitation & Guests to make changes, manage guests, and share when you're ready."
                : "Start with a custom idea, choose a ready-made design, or upload your own in Invitation & Guests."}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:items-stretch">
          {hasDesign && (
            <Button asChild data-testid="button-view-saved-invitation">
              <a href={`/dashboard/${encodeURIComponent(ownerToken)}/invitation-preview`}>
                <Eye className="mr-1.5 h-4 w-4" /> View invitation
              </a>
            </Button>
          )}
          <Button
            variant={hasDesign ? "outline" : "default"}
            onClick={onOpenEditor}
            data-testid="button-open-invitation-workspace"
          >
            {hasDesign ? "Invitation & Guests" : "Create invitation"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

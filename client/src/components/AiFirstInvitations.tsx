// The AI-first invitation experience. Rendered only when the
// `aiFirstInvitations` flag is on; with it off this component is never
// mounted and the curated collection is the first thing a host sees, exactly
// as today.
//
// Two rules shape it. Cards appear the moment the gate approves them, one at
// a time, because waiting for the slowest of four is what made the old flow
// feel broken. And a card on screen is a preview only — the live invitation
// changes when the host presses "Use this design" and not before.

import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequestJson, queryClient } from "@/lib/queryClient";
import { themeCopyForEvent } from "@shared/themeCatalog";
import { themeForResolvedConcept } from "@shared/aiFirstTheme";
import type { AskPosyAction } from "@shared/aiFirstAskPosy";
import { TARGET_DIRECTION_COUNT, type FinishedDirection } from "@shared/aiFirstStream";
import type { EventRecord } from "@/lib/types";
import type { AiFirstRunOptions, AiFirstSession } from "@/lib/aiFirstSession";
import { ThemeInvitation } from "@/components/ThemeInvitation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Check, Loader2, Sparkles } from "lucide-react";

interface AiFirstStatus {
  plan: string;
  ceilings: { eventSoft: number; eventHard: number; monthlySoft: number; monthlyHard: number };
  usage: { eventBilled: number; monthlyBilled: number; activeGenerations: number };
  killSwitch: boolean;
  directionLimit: number;
  automaticRetryDisabled: boolean;
  additionalGenerationConfirmationRequired: boolean;
  briefQuestion: string | null;
  askPosyActions: AskPosyAction[];
}

interface AiFirstInvitationsProps {
  ownerToken: string;
  event: EventRecord;
  session: AiFirstSession;
  /** Hands the host to the curated collection without losing this state. */
  onBrowseCollection: () => void;
}

export default function AiFirstInvitations({
  ownerToken,
  event,
  session,
  onBrowseCollection,
}: AiFirstInvitationsProps) {
  const { toast } = useToast();
  const [pendingAdditionalRun, setPendingAdditionalRun] = useState<AiFirstRunOptions | null>(null);

  const status = useQuery<AiFirstStatus>({
    queryKey: [`/api/events/owner/${ownerToken}/ai-first/status`],
  });

  const apply = useMutation({
    mutationFn: (direction: FinishedDirection) =>
      apiRequestJson<{ event: EventRecord }>("POST", `/api/events/owner/${ownerToken}/ai-first/apply`, {
        previewId: direction.previewId,
        // The hash the host approved. The server refuses the apply if the
        // stored bytes no longer match it.
        assetHash: direction.assetHash,
        artworkOpacity: direction.artworkOpacity,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/events/owner/${ownerToken}`] });
      toast({ title: "Design applied", description: "Now make it yours." });
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't apply that design", description: err.message, variant: "destructive" });
    },
  });

  const ordered = useMemo(
    () => session.directions.slice().sort((a, b) => a.index - b.index),
    [session.directions],
  );

  const needsVibe = status.data?.briefQuestion && !session.vibeAnswer.trim() && !session.hasRun;
  const latestProgress = session.progress[session.progress.length - 1] ?? "";
  const actions = status.data?.askPosyActions ?? [];
  // The server's own idea of "already active" (durable, not this tab's
  // memory) keeps the button locked even after a reload or in a second tab
  // — not just while this component's local `running` state says so.
  const serverSaysActive = (status.data?.usage?.activeGenerations ?? 0) > 0;
  // Do not let a click race the spend status query. The server would still
  // refuse an unconfirmed later run, but waiting for this read means the
  // host sees the confirmation instead of a preventable 409 error.
  const generateDisabled = status.isLoading || session.running || serverSaysActive || Boolean(status.data?.killSwitch);
  const targetCount = status.data?.directionLimit ?? TARGET_DIRECTION_COUNT;
  const isReviewCanary = targetCount === 1;
  const confirmationRequired =
    Boolean(status.data?.additionalGenerationConfirmationRequired) || session.hasRun;

  const requestRun = (options: AiFirstRunOptions = {}) => {
    if (!status.data) return;
    if (confirmationRequired) {
      // This first press is deliberately non-provider. It only opens the
      // confirmation below; the second, labeled press is the one that may
      // start another paid run.
      setPendingAdditionalRun(options);
      return;
    }
    void session.run(options);
  };

  const confirmAdditionalRun = () => {
    if (!pendingAdditionalRun || generateDisabled) return;
    const options = pendingAdditionalRun;
    setPendingAdditionalRun(null);
    void session.run({ ...options, confirmAdditionalGeneration: true });
  };

  // The header states only what is true at the moment it renders. The
  // completion sentence is claimed once the four directions are actually on
  // screen — never while the run is still in flight.
  const complete = !session.running && ordered.length >= targetCount;
  const heading = complete
    ? isReviewCanary
      ? "Your review invitation direction is ready."
      : targetCount === TARGET_DIRECTION_COUNT
        ? "I created four invitation directions for your event."
        : `I created ${targetCount} invitation directions for your event.`
    : session.running
      ? isReviewCanary
        ? "Posy is creating one invitation direction for review."
        : "Posy is creating your invitation directions."
      : ordered.length > 0
        ? `${ordered.length} of ${targetCount} directions are ready.`
        : "Posy designs your invitation.";
  const subheading = complete
    ? isReviewCanary
      ? "It is designed around your event's details and checked before you see it. Nothing changes until you choose it."
      : "Each one is designed around your event's details and checked before you see it. Pick the one you like and make it yours — nothing changes until you do."
    : session.running
      ? "Each direction appears as soon as it passes Posy's checks, so you can start looking before the set is finished."
      : ordered.length > 0
        ? `The run finished short of ${targetCount}. What's here is yours to use, or ask Posy for another set.`
        : isReviewCanary
          ? "This protected review creates one quality-gated direction so the full experience can be verified with one paid image call. Nothing on your invitation changes until you choose it."
          : `Posy reads the event details you've already entered and designs ${targetCount} invitation directions to choose from. Nothing on your invitation changes until you pick one.`;

  return (
    <div data-testid="ai-first-invitations">
      <header className="mb-6">
        <h2 className="font-serif text-2xl tracking-tight text-foreground sm:text-3xl" data-testid="text-ai-first-heading">
          {heading}
        </h2>
        <p className="mt-1.5 max-w-xl text-sm text-muted-foreground">{subheading}</p>
      </header>

      {status.data?.killSwitch && (
        <p
          className="mb-4 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground"
          data-testid="text-generation-paused"
        >
          New artwork is paused right now. Designs you've already made are still available, and the Posy collection is
          open below.
        </p>
      )}

      {needsVibe && (
        <div className="mb-5 rounded-md border border-border bg-background p-4" data-testid="card-brief-question">
          <label htmlFor="ai-first-vibe" className="text-sm font-medium text-foreground">
            {status.data?.briefQuestion}
          </label>
          <Input
            id="ai-first-vibe"
            value={session.vibeAnswer}
            onChange={(e) => session.setVibeAnswer(e.target.value)}
            placeholder="Warm, a little glamorous, candlelit"
            className="mt-2"
            data-testid="input-brief-question"
          />
        </div>
      )}

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Button
          onClick={() => requestRun()}
          disabled={generateDisabled}
          data-testid="button-generate-directions"
        >
          {session.running ? (
            <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Sparkles className="mr-1.5 h-4 w-4" aria-hidden />
          )}
          {session.hasRun
            ? isReviewCanary
              ? "Create a different review direction"
              : "Create different directions"
            : isReviewCanary
              ? "Create review direction"
              : "Create my invitation directions"}
        </Button>
        <button
          type="button"
          onClick={onBrowseCollection}
          className="text-xs font-medium text-primary underline underline-offset-2"
          data-testid="button-browse-collection"
        >
          Browse the Posy collection
        </button>
      </div>

      {pendingAdditionalRun && (
        <div
          className="mb-6 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-foreground"
          data-testid="card-confirm-additional-generation"
          role="alert"
        >
          <p className="font-semibold">
            {isReviewCanary ? "Create one more review direction?" : "Create another set of directions?"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            This is a separate generation request. Nothing starts until you confirm
            {isReviewCanary && status.data?.automaticRetryDisabled
              ? ", and Posy will make exactly one image call with no automatic retry."
              : "."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              onClick={confirmAdditionalRun}
              disabled={generateDisabled}
              data-testid="button-confirm-additional-generation"
            >
              {isReviewCanary && status.data?.automaticRetryDisabled
                ? "Confirm one image call"
                : "Confirm new generation"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setPendingAdditionalRun(null)}
              data-testid="button-cancel-additional-generation"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Progress is the run's own events, never a timer. */}
      {session.running && (
        <div className="mb-5 space-y-1" data-testid="text-progress">
          <p className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            {latestProgress}
          </p>
          <p className="text-xs text-muted-foreground" data-testid="text-progress-counts">
            {session.completedCount} of {targetCount} {targetCount === 1 ? "direction" : "directions"} ready
            {session.fallbackCount > 0
              ? ` (${session.fallbackCount} from the Posy collection, adapted to your event)`
              : ""}
          </p>
        </div>
      )}

      {!session.running && session.hasRun && !session.error && ordered.length > 0 && session.fallbackCount > 0 && (
        <p className="mb-5 text-xs text-muted-foreground" data-testid="text-fallback-summary">
          {session.fallbackCount} of {ordered.length} directions used an adapted Posy collection design because the
          generated artwork didn't clear Posy's quality check.
        </p>
      )}

      {session.error && (
        <p className="mb-5 text-sm text-destructive" data-testid="text-generation-error">
          {session.error}
        </p>
      )}

      {ordered.length > 0 && (
        <div className="grid gap-6 sm:grid-cols-2" data-testid="grid-ai-directions">
          {ordered.map((direction) => (
            <DirectionCard
              key={direction.previewId || direction.index}
              direction={direction}
              event={event}
              selected={session.selectedPreviewId === direction.previewId}
              applying={apply.isPending}
              onSelect={() => session.setSelectedPreviewId(direction.previewId)}
              onApply={() => apply.mutate(direction)}
            />
          ))}
        </div>
      )}

      {/* Ask Posy — invitation-specific, and only once there is something to
          act on, since every action but "different directions" refers to a
          card the host is looking at. */}
      {ordered.length > 0 && actions.length > 0 && (
        <section className="mt-8 rounded-md border border-border bg-muted/30 p-4" data-testid="section-ask-posy">
          <p className="text-sm font-semibold text-foreground">Ask Posy</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {actions.map((action) => (
              <button
                key={action.id}
                type="button"
                disabled={session.running}
                onClick={() => {
                  const selected = ordered.find((d) => d.previewId === session.selectedPreviewId) ?? ordered[0];
                  requestRun({
                    action: action.id,
                    concept: selected?.concept,
                    avoidConceptNames: ordered.map((d) => d.concept.conceptName),
                  });
                }}
                className="rounded-full border border-border bg-background px-3.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-60"
                data-testid={`button-ask-posy-${action.id}`}
              >
                {action.label}
              </button>
            ))}
          </div>
          <Input
            value={session.typedDirection}
            onChange={(e) => session.setTypedDirection(e.target.value)}
            placeholder="Or tell Posy in your own words"
            className="mt-3"
            data-testid="input-ask-posy-direction"
          />
        </section>
      )}

      {session.warnings.length > 0 && (
        <details className="mt-6 text-xs text-muted-foreground" data-testid="details-run-notes">
          <summary className="cursor-pointer">What Posy had to work around</summary>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            {session.warnings.map((warning, i) => (
              <li key={i}>{warning}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function DirectionCard({
  direction,
  event,
  selected,
  applying,
  onSelect,
  onApply,
}: {
  direction: FinishedDirection;
  event: EventRecord;
  selected: boolean;
  applying: boolean;
  onSelect: () => void;
  onApply: () => void;
}) {
  // The same renderer the curated studio uses. A generated direction is a
  // LaunchTheme whose artwork happens to have been generated, not a second
  // kind of card.
  const built = useMemo(
    () => themeForResolvedConcept(direction, `preview-${direction.previewId}`),
    [direction],
  );

  const headline = event.eventName?.trim() || built.theme.sample.headline;

  return (
    <figure className="m-0" data-testid={`card-ai-direction-${direction.index}`}>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={`block w-full overflow-hidden rounded-sm text-left transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
          selected ? "ring-2 ring-foreground" : "ring-1 ring-black/5"
        }`}
        data-testid={`button-select-direction-${direction.index}`}
      >
        <ThemeInvitation
          theme={built.theme}
          headline={headline}
          copy={themeCopyForEvent(built.theme, event)}
          paletteVariantId={built.palette.id}
          overlay={direction.overlay}
          fontPairingId={direction.concept.fontPairingId}
          artworkOpacity={direction.artworkOpacity}
          decorative
        />
      </button>
      <figcaption className="mt-2.5">
        <p className="text-sm font-medium text-foreground">{direction.concept.conceptName}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{direction.concept.description}</p>
        <Button
          size="sm"
          className="mt-3"
          disabled={applying}
          onClick={onApply}
          data-testid={`button-use-direction-${direction.index}`}
        >
          <Check className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Use this design
        </Button>
      </figcaption>
    </figure>
  );
}

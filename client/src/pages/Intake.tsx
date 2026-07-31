import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { Link } from "wouter";
import { apiRequest, apiRequestJson } from "@/lib/queryClient";
import { Wordmark } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import DatePickerField from "@/components/DatePickerField";
import CountStepper from "@/components/CountStepper";
import { EVENT_TYPES } from "@/lib/types";
import type { EventRecord } from "@/lib/types";
import { touchRecentEvent } from "@/lib/eventRecovery";
import { useToast } from "@/hooks/use-toast";
import { Sparkles, ArrowLeft, ArrowRight, Loader2 } from "lucide-react";

const STEPS = ["basics", "vibe", "sizing", "review"] as const;
type Step = (typeof STEPS)[number];

const STEP_LABELS: Record<Step, string> = {
  basics: "The basics",
  vibe: "Describe it",
  sizing: "Guests & budget",
  review: "Review",
};

// The AI Master Planner Intake wizard. This is Phase 1 (foundation) only:
// it creates the event and progressively saves intake fields via
// PATCH .../intake so nothing is lost if the host closes the browser
// mid-wizard. It does NOT run any AI generation yet — that's the Phase 3
// orchestrator. Finishing the wizard here hands off to the normal dashboard,
// same destination the manual create-event flow reaches.
export default function Intake() {
  const [, navigate] = useLocation();
  const params = useParams<{ ownerToken?: string }>();
  const { toast } = useToast();

  const [ownerToken, setOwnerToken] = useState(params.ownerToken || "");
  const [step, setStep] = useState<Step>("basics");
  const [creating, setCreating] = useState(!params.ownerToken);
  // Separate from `creating` (brand-new event) — this covers the resume
  // path, where an ownerToken is already in the URL but the saved fields
  // haven't been fetched yet. Without this, the wizard briefly renders
  // blank/default fields, then visibly jumps to the real saved values a
  // moment later, which reads as the page reloading or the form glitching.
  const [resuming, setResuming] = useState(!!params.ownerToken);

  const [eventName, setEventName] = useState("");
  const [eventType, setEventType] = useState("Birthday Party");
  const [eventDate, setEventDate] = useState("");
  const [vibeDescription, setVibeDescription] = useState("");
  const [estimatedGuestCount, setEstimatedGuestCount] = useState(15);
  const [budgetCeiling, setBudgetCeiling] = useState<string>("");

  // Fields the host has typed into during this session. The resume fetch below
  // lands asynchronously and must never overwrite them.
  const editedRef = useRef(new Set<string>());
  const markEdited = (field: string) => editedRef.current.add(field);

  // True once this session has created the event itself. A brand-new event has
  // nothing to resume, so the fetch is skipped entirely rather than racing the
  // host's first keystrokes.
  const createdHereRef = useRef(false);

  // ownerToken IS in the URL -> the host is resuming a wizard they already
  // started (bookmarked link, or simply a page refresh mid-wizard). Local
  // state always starts blank on mount, so without this fetch, everything
  // already saved via PATCH .../intake would silently disappear from the
  // screen -- including on the Review step -- even though it's safe on the
  // server.
  //
  // The form stays interactive while this request is in flight, and on the
  // fresh-start path the create effect below navigates a token into the URL,
  // which re-triggers this effect. Both mean the response can arrive after the
  // host has already typed -- so a seed is only applied to fields they have not
  // touched. Without that guard the response overwrites a typed event name with
  // the "My Celebration" default and blanks the date and vibe, which is exactly
  // what surfaces as "Not set yet" on Review.
  useEffect(() => {
    if (!params.ownerToken) return;
    if (createdHereRef.current) {
      setResuming(false);
      return;
    }
    (async () => {
      try {
        const data = await apiRequestJson<{ event: EventRecord }>(
          "GET",
          `/api/events/owner/${params.ownerToken}`,
        );
        const event = data.event;
        const edited = editedRef.current;
        if (!edited.has("eventName")) setEventName(event.eventName || "");
        if (!edited.has("eventType")) setEventType(event.eventType || "Birthday Party");
        if (!edited.has("eventDate")) setEventDate(event.eventDate || "");
        if (!edited.has("vibeDescription")) setVibeDescription(event.vibeDescription || "");
        if (event.estimatedGuestCount != null && !edited.has("estimatedGuestCount")) {
          setEstimatedGuestCount(event.estimatedGuestCount);
        }
        if (event.budgetCeiling != null && !edited.has("budgetCeiling")) {
          setBudgetCeiling(String(event.budgetCeiling));
        }
        touchRecentEvent(params.ownerToken || "");
      } catch {
        toast({
          title: "Couldn't load your saved progress",
          description: "You can keep going, but double-check the details on Review before finishing.",
          variant: "destructive",
        });
      } finally {
        setResuming(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.ownerToken]);

  // No ownerToken in the URL yet -> this is a fresh wizard start. Create a
  // bare event immediately (same defaults as the manual flow) so every step
  // from here on has a real event to autosave against, and the URL becomes
  // bookmarkable/resumable.
  useEffect(() => {
    if (params.ownerToken) return;
    (async () => {
      try {
        const res = await apiRequest("POST", "/api/events", {
          eventName: "My Celebration",
          eventType,
          eventDate: "",
          inviteSubject: "You're invited!",
          inviteMessage: "",
        });
        const event = (await res.json()) as EventRecord;
        createdHereRef.current = true;
        setOwnerToken(event.ownerToken || "");
        setCreating(false);
        touchRecentEvent(event.ownerToken || "");
        navigate(`/intake/${event.ownerToken}`, { replace: true });
      } catch {
        toast({
          title: "Couldn't start your event",
          description: "Please try again.",
          variant: "destructive",
        });
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Plan-status awareness for the Review step (secondary UX fix): lets us
  // tell a returning host up front if this event already has its full plan,
  // instead of only finding out from a generic message after clicking
  // "Start my event". A brand-new event always comes back "none" here, so
  // this never fires for first-time hosts.
  const { data: entitlement } = useQuery({
    queryKey: ["master-planner-entitlement", ownerToken],
    queryFn: () =>
      apiRequestJson<{ freeDraftState: string }>(
        "GET",
        `/api/events/owner/${ownerToken}/master-planner/entitlement`,
      ),
    enabled: step === "review" && !!ownerToken,
  });
  const freeDraftAlreadyUsed = entitlement?.freeDraftState === "ready";

  const saveIntake = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      const res = await apiRequest("PATCH", `/api/events/owner/${ownerToken}/intake`, patch);
      return (await res.json()) as EventRecord;
    },
  });

  const goNext = async (patch: Record<string, unknown>, next: Step | null) => {
    if (ownerToken) {
      try {
        await saveIntake.mutateAsync(patch);
      } catch {
        toast({
          title: "Couldn't save that step",
          description: "Your progress up to the previous step is still safe. Please try again.",
          variant: "destructive",
        });
        return;
      }
    }
    if (next) setStep(next);
  };

  const finish = useMutation({
    mutationFn: async () => {
      const parsedBudget = budgetCeiling.trim() ? Number(budgetCeiling) : undefined;
      await apiRequest("PATCH", `/api/events/owner/${ownerToken}/intake`, {
        estimatedGuestCount,
        ...(parsedBudget !== undefined && !Number.isNaN(parsedBudget) ? { budgetCeiling: parsedBudget } : {}),
      });
    },
    onSuccess: () => {
      navigate(`/draft-generating/${ownerToken}`);
    },
    onError: () => {
      toast({ title: "I couldn't get that saved", description: "Please try again.", variant: "destructive" });
    },
  });

  const stepIndex = STEPS.indexOf(step);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-6 py-5">
          <Link href="/" data-testid="link-logo-home">
            <Wordmark />
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-2xl px-6 py-14">
        <div className="mb-8 flex items-center gap-2" data-testid="text-intake-eyebrow">
          <Sparkles className="h-4 w-4 text-accent" />
          <p className="text-sm font-semibold uppercase tracking-wide text-primary">
            Step {stepIndex + 1} of {STEPS.length} — {STEP_LABELS[step]}
          </p>
        </div>

        <div className="mb-8 flex gap-1.5" aria-hidden="true">
          {STEPS.map((s, i) => (
            <div
              key={s}
              className={`h-1.5 flex-1 rounded-full ${i <= stepIndex ? "bg-primary" : "bg-muted"}`}
            />
          ))}
        </div>

        <Card className="border-card-border shadow-sm" data-testid="card-intake-wizard">
          <CardContent className="p-6 sm:p-8">
            {(creating || resuming) && (
              <p
                className="flex items-center gap-2 text-sm text-muted-foreground"
                data-testid="text-intake-loading"
              >
                <Loader2 className="h-4 w-4 animate-spin" />
                {creating ? "Setting things up…" : "Picking up where you left off…"}
              </p>
            )}

            {!creating && !resuming && step === "basics" && (
              <div className="space-y-4">
                <h2 className="font-serif text-lg font-semibold text-foreground">What are we planning?</h2>
                <p className="text-sm text-muted-foreground" data-testid="text-intake-basics-subtitle">
                  Just the essentials to start — next I'll ask you to describe it in your own words, and I'll take it from there.
                </p>
                <div>
                  <Label htmlFor="intakeEventName">Event name</Label>
                  <Input
                    id="intakeEventName"
                    data-testid="input-intake-event-name"
                    placeholder="e.g. Maren's Golf-Themed 1st Birthday"
                    value={eventName}
                    onChange={(e) => {
                      markEdited("eventName");
                      setEventName(e.target.value);
                    }}
                  />
                </div>
                <div>
                  <Label htmlFor="intakeEventType">Event type</Label>
                  <Select
                    value={eventType}
                    onValueChange={(v) => {
                      markEdited("eventType");
                      setEventType(v);
                    }}
                  >
                    <SelectTrigger id="intakeEventType" data-testid="select-intake-event-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EVENT_TYPES.map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="intakeEventDate">Date</Label>
                  <DatePickerField
                    id="intakeEventDate"
                    testId="input-intake-event-date"
                    value={eventDate}
                    onChange={(v) => {
                      markEdited("eventDate");
                      setEventDate(v);
                    }}
                  />
                </div>
                <div className="flex justify-end pt-2">
                  <Button
                    data-testid="button-intake-next-basics"
                    disabled={saveIntake.isPending}
                    onClick={() =>
                      goNext(
                        { eventName: eventName || "My Celebration", eventType, eventDate },
                        "vibe",
                      )
                    }
                  >
                    {saveIntake.isPending ? (
                      <>
                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Saving…
                      </>
                    ) : (
                      <>
                        Next <ArrowRight className="ml-1.5 h-4 w-4" />
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}

            {!creating && !resuming && step === "vibe" && (
              <div className="space-y-4">
                <h2 className="font-serif text-lg font-semibold text-foreground">
                  Describe it in a sentence or two
                </h2>
                <p className="text-sm text-muted-foreground">
                  Mood, colors, must-haves, anything that captures the feel you're going for. This helps
                  shape everything else we build for you.
                </p>
                <Textarea
                  data-testid="input-intake-vibe"
                  rows={4}
                  placeholder="e.g. A cozy backyard bonfire birthday with s'mores, string lights, and a flannel dress code"
                  value={vibeDescription}
                  onChange={(e) => {
                    markEdited("vibeDescription");
                    setVibeDescription(e.target.value);
                  }}
                />
                <div className="flex justify-between pt-2">
                  <Button
                    variant="outline"
                    data-testid="button-intake-back-vibe"
                    onClick={() => setStep("basics")}
                  >
                    <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
                  </Button>
                  <Button
                    data-testid="button-intake-next-vibe"
                    disabled={saveIntake.isPending}
                    onClick={() => goNext({ vibeDescription }, "sizing")}
                  >
                    {saveIntake.isPending ? (
                      <>
                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Saving…
                      </>
                    ) : (
                      <>
                        Next <ArrowRight className="ml-1.5 h-4 w-4" />
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}

            {!creating && !resuming && step === "sizing" && (
              <div className="space-y-4">
                <h2 className="font-serif text-lg font-semibold text-foreground">Roughly how big?</h2>
                <p className="text-sm text-muted-foreground">
                  Ballpark numbers are fine — you can always add real guests and exact costs later.
                </p>
                <CountStepper
                  label="Estimated guests"
                  value={estimatedGuestCount}
                  min={1}
                  max={500}
                  onChange={(v) => {
                    markEdited("estimatedGuestCount");
                    setEstimatedGuestCount(v);
                  }}
                  testId="intake-guest-count"
                />
                <div>
                  <Label htmlFor="intakeBudget">Budget ceiling (optional)</Label>
                  <Input
                    id="intakeBudget"
                    data-testid="input-intake-budget"
                    type="number"
                    min={0}
                    placeholder="e.g. 500"
                    value={budgetCeiling}
                    onChange={(e) => {
                      markEdited("budgetCeiling");
                      setBudgetCeiling(e.target.value);
                    }}
                  />
                </div>
                <div className="flex justify-between pt-2">
                  <Button
                    variant="outline"
                    data-testid="button-intake-back-sizing"
                    onClick={() => setStep("vibe")}
                  >
                    <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
                  </Button>
                  <Button
                    data-testid="button-intake-next-sizing"
                    disabled={saveIntake.isPending}
                    onClick={() => {
                      const parsedBudget = budgetCeiling.trim() ? Number(budgetCeiling) : undefined;
                      goNext(
                        {
                          estimatedGuestCount,
                          ...(parsedBudget !== undefined && !Number.isNaN(parsedBudget)
                            ? { budgetCeiling: parsedBudget }
                            : {}),
                        },
                        "review",
                      );
                    }}
                  >
                    {saveIntake.isPending ? (
                      <>
                        <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Saving…
                      </>
                    ) : (
                      <>
                        Next <ArrowRight className="ml-1.5 h-4 w-4" />
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}

            {!creating && !resuming && step === "review" && (
              <div className="space-y-4">
                <h2 className="font-serif text-lg font-semibold text-foreground">Ready to go</h2>
                <dl className="space-y-2 rounded-md border border-border p-4 text-sm">
                  <Row label="Event" value={eventName || "My Celebration"} />
                  <Row label="Type" value={eventType} />
                  <Row label="Date" value={eventDate || "Not set yet"} />
                  <Row label="Guests" value={`~${estimatedGuestCount}`} />
                  <Row label="Budget" value={budgetCeiling ? `$${budgetCeiling}` : "Not set"} />
                  <Row label="Vibe" value={vibeDescription || "Not set"} />
                </dl>

                {freeDraftAlreadyUsed ? (
                  <p
                    className="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm text-foreground"
                    data-testid="text-free-draft-used-notice"
                  >
                    This event already has a full plan. Starting this will create a new plan for this
                    event — Spark unlocks one event, and{" "}
                    <Link href="/pricing" className="font-medium text-primary underline-offset-2 hover:underline">
                      Plus
                    </Link>{" "}
                    gives you unlimited.
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground" data-testid="text-free-draft-notice">
                    Spark unlocks one full plan for this event.{" "}
                    <Link href="/pricing" className="font-medium text-primary underline-offset-2 hover:underline">
                      Plus
                    </Link>{" "}
                    gives you unlimited plans across everything you host.
                  </p>
                )}

                <div className="flex justify-between pt-2">
                  <Button
                    variant="outline"
                    data-testid="button-intake-back-review"
                    onClick={() => setStep("sizing")}
                  >
                    <ArrowLeft className="mr-1.5 h-4 w-4" /> Back
                  </Button>
                  <Button
                    data-testid="button-intake-finish"
                    disabled={finish.isPending}
                    onClick={() => finish.mutate()}
                  >
                    {finish.isPending ? "Starting…" : "Start my event"}
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <dt className="flex-none text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium text-foreground">{value}</dd>
    </div>
  );
}

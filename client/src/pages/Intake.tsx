import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { Link } from "wouter";
import { apiRequest, apiRequestJson } from "@/lib/queryClient";
import { clearPendingEventStartKey, startEventWithRecovery } from "@/lib/eventStartup";
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
import { Sparkles, ArrowLeft, ArrowRight, Loader2, RefreshCw } from "lucide-react";

const STEPS = ["basics", "vibe", "sizing", "review"] as const;
type Step = (typeof STEPS)[number];

const STEP_LABELS: Record<Step, string> = {
  basics: "The basics",
  vibe: "Describe it",
  sizing: "Guests & budget",
  review: "Review",
};

const START_RECOVERY_MESSAGE =
  "Posy couldn't finish securing this event yet. Your answers are still here.";

// The AI Master Planner Intake wizard. It creates the event in the background
// and progressively saves each step. A fresh-start connection failure must
// never replace the form with a dead loader: hosts can keep typing, and every
// retry resolves to the same event rather than creating duplicates.
export default function Intake() {
  const [, navigate] = useLocation();
  const params = useParams<{ ownerToken?: string }>();
  const { toast } = useToast();

  const [ownerToken, setOwnerToken] = useState(params.ownerToken || "");
  const [step, setStep] = useState<Step>("basics");
  const [creating, setCreating] = useState(!params.ownerToken);
  const [startError, setStartError] = useState<string | null>(null);
  const [transitioning, setTransitioning] = useState(false);
  // Separate from `creating` (brand-new event) — this covers the resume path,
  // where a private owner token is already in the URL but saved fields have not
  // been fetched yet.
  const [resuming, setResuming] = useState(!!params.ownerToken);

  const [eventName, setEventName] = useState("");
  const [eventType, setEventType] = useState("Birthday Party");
  const [eventDate, setEventDate] = useState("");
  const [vibeDescription, setVibeDescription] = useState("");
  const [estimatedGuestCount, setEstimatedGuestCount] = useState(15);
  const [budgetCeiling, setBudgetCeiling] = useState<string>("");

  // Fields the host has typed into during this session. A late resume read must
  // never overwrite them.
  const editedRef = useRef(new Set<string>());
  const markEdited = (field: string) => editedRef.current.add(field);

  // Synchronous refs close the small gaps before React paints state changes:
  // one logical event start and one step transition can be in flight at a time.
  const createdHereRef = useRef(false);
  const ownerTokenRef = useRef(params.ownerToken || "");
  const startInFlightRef = useRef<Promise<string> | null>(null);
  const transitionInFlightRef = useRef(false);
  const finishInFlightRef = useRef(false);

  const ensureEvent = async (): Promise<string> => {
    const existing = ownerTokenRef.current || params.ownerToken || ownerToken;
    if (existing) return existing;
    if (startInFlightRef.current) return startInFlightRef.current;

    setCreating(true);
    setStartError(null);

    const startPromise = (async () => {
      const { event, startKey } = await startEventWithRecovery({
        eventName: eventName.trim() || "My Celebration",
        eventType,
        eventDate,
        inviteSubject: "You're invited!",
        inviteMessage: "",
      });
      const token = event.ownerToken?.trim();
      if (!token) throw new Error("Posy couldn't confirm the private event link.");

      // Record the token synchronously before navigation so a quick Next click
      // can save against the event even before React renders the new URL.
      ownerTokenRef.current = token;
      createdHereRef.current = true;
      setOwnerToken(token);
      touchRecentEvent(token);
      navigate(`/intake/${token}`, { replace: true });
      clearPendingEventStartKey(startKey);
      setCreating(false);
      setStartError(null);
      return token;
    })();

    startInFlightRef.current = startPromise;
    try {
      return await startPromise;
    } catch (error) {
      setCreating(false);
      setStartError(START_RECOVERY_MESSAGE);
      throw error;
    } finally {
      if (startInFlightRef.current === startPromise) startInFlightRef.current = null;
    }
  };

  // ownerToken IS in the URL -> the host is resuming a wizard they already
  // started. Seed only untouched fields so a slow response cannot replace
  // something the host has already typed.
  useEffect(() => {
    const resumeToken = params.ownerToken;
    if (!resumeToken) return;
    ownerTokenRef.current = resumeToken;
    setOwnerToken(resumeToken);
    if (createdHereRef.current) {
      setResuming(false);
      return;
    }
    (async () => {
      try {
        const data = await apiRequestJson<{ event: EventRecord }>(
          "GET",
          `/api/events/owner/${resumeToken}`,
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
        touchRecentEvent(resumeToken);
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

  // A fresh form starts securing its resumable event immediately, but the form
  // remains visible and usable throughout. Automatic retries are bounded and
  // idempotent; after that, an inline Try again action uses the same start key.
  useEffect(() => {
    if (params.ownerToken) return;
    void ensureEvent().catch(() => {
      // The inline recovery state above is the customer-facing outcome. Do not
      // add a destructive toast or leave the page trapped behind a spinner.
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Plan-status awareness for the Review step.
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
    mutationFn: async ({ token, patch }: { token: string; patch: Record<string, unknown> }) => {
      const res = await apiRequest("PATCH", `/api/events/owner/${token}/intake`, patch);
      return (await res.json()) as EventRecord;
    },
  });

  const goNext = async (patch: Record<string, unknown>, next: Step | null) => {
    if (transitionInFlightRef.current) return;
    transitionInFlightRef.current = true;
    setTransitioning(true);

    let token = "";
    try {
      token = await ensureEvent();
    } catch {
      transitionInFlightRef.current = false;
      setTransitioning(false);
      return;
    }

    try {
      await saveIntake.mutateAsync({ token, patch });
      if (next) setStep(next);
    } catch {
      toast({
        title: "Couldn't save that step",
        description: "Your progress up to the previous step is still safe. Please try again.",
        variant: "destructive",
      });
    } finally {
      transitionInFlightRef.current = false;
      setTransitioning(false);
    }
  };

  const finish = useMutation({
    mutationFn: async () => {
      const token = await ensureEvent();
      // Always send budgetCeiling explicitly (a number, or null to clear) —
      // never omit the key, which would leave an old server value in place.
      const parsedBudget = budgetCeiling.trim() ? Number(budgetCeiling) : NaN;
      await apiRequest("PATCH", `/api/events/owner/${token}/intake`, {
        estimatedGuestCount,
        budgetCeiling: Number.isNaN(parsedBudget) ? null : parsedBudget,
      });
      return token;
    },
    onSuccess: (token) => {
      navigate(`/draft-generating/${token}`);
    },
    onError: () => {
      // Startup failures already have a calm, persistent inline recovery. Only
      // show a save error once an event token actually exists.
      if (ownerTokenRef.current) {
        toast({ title: "I couldn't get that saved", description: "Please try again.", variant: "destructive" });
      }
    },
    onSettled: () => {
      finishInFlightRef.current = false;
    },
  });

  const stepIndex = STEPS.indexOf(step);
  const stepPending = saveIntake.isPending || transitioning;

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
            {resuming && (
              <p
                className="flex items-center gap-2 text-sm text-muted-foreground"
                data-testid="text-intake-loading"
              >
                <Loader2 className="h-4 w-4 animate-spin" />
                Picking up where you left off…
              </p>
            )}

            {!resuming && creating && (
              <p
                className="mb-4 flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
                data-testid="text-intake-starting"
                aria-live="polite"
              >
                <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                Securing your event in the background. You can start filling this out now.
              </p>
            )}

            {!resuming && startError && !creating && (
              <div
                className="mb-4 rounded-md border border-primary/25 bg-primary/5 p-4"
                data-testid="card-intake-start-recovery"
                role="status"
              >
                <p className="text-sm font-medium text-foreground">{startError}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  Nothing you typed has been lost. Try again when your connection is ready.
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-3"
                  data-testid="button-retry-event-start"
                  onClick={() => void ensureEvent().catch(() => undefined)}
                >
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  Try again
                </Button>
              </div>
            )}

            {!resuming && step === "basics" && (
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
                    disabled={stepPending}
                    onClick={() =>
                      goNext(
                        { eventName: eventName || "My Celebration", eventType, eventDate },
                        "vibe",
                      )
                    }
                  >
                    {stepPending ? (
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

            {!resuming && step === "vibe" && (
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
                    disabled={stepPending}
                    onClick={() => goNext({ vibeDescription }, "sizing")}
                  >
                    {stepPending ? (
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

            {!resuming && step === "sizing" && (
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
                    disabled={stepPending}
                    onClick={() => {
                      const parsedBudget = budgetCeiling.trim() ? Number(budgetCeiling) : NaN;
                      goNext(
                        {
                          estimatedGuestCount,
                          budgetCeiling: Number.isNaN(parsedBudget) ? null : parsedBudget,
                        },
                        "review",
                      );
                    }}
                  >
                    {stepPending ? (
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

            {!resuming && step === "review" && (
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
                    onClick={() => {
                      if (finishInFlightRef.current) return;
                      finishInFlightRef.current = true;
                      finish.mutate();
                    }}
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

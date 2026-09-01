import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequestJson } from "@/lib/queryClient";
import { getCheckoutHandoffPhase } from "@/lib/checkoutHandoff";
import { touchRecentEvent } from "@/lib/eventRecovery";
import { Wordmark } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, Loader2, CircleDashed, Check, Play } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import AIDemoShowcase from "@/components/AIDemoShowcase";

// Loading screen shown right after intake finishes, while the AI Master
// Planner drafts the whole first pass (theme, budget, menu, shopping,
// timeline, invitation design, and rule-based checks) in the background.
// Purely functional per the deferred-visual-polish instruction — real
// styling comes once Brand Standards / Design DNA are finalized. Narration
// copy is verbatim from PartyPilot_AI_Master_Planner_Design_Spec.md (filename predates the Posy rebrand) §1.

interface MasterPlannerStatus {
  draftStatus: "none" | "generating" | "ready" | "failed_partial";
  draftStage: string | null;
  completedStages: string[];
  failedStage: string | null;
}

interface EntitlementSummary {
  eventId: number;
  freeDraftState: string;
  emailCaptured: boolean;
  planTier: string;
  sparkUnlocked: boolean;
  canGenerate: boolean;
}

type PrePaymentPreviewKind = "direction-card" | "reference-board" | "approved-image" | "none";
type PrePaymentPreviewGenerationState = "idle" | "generating" | "ready" | "fallback";

interface PrePaymentPreviewReadiness {
  ready: boolean;
  generationState: PrePaymentPreviewGenerationState;
  pollAfterMs: number | null;
  kind: PrePaymentPreviewKind;
  namedReference: { id: string; label: string } | null;
  automaticReferenceResolutionEnabled?: boolean;
  automaticReferenceAttempted?: boolean;
}

type PrePaymentPreviewStart = PrePaymentPreviewReadiness;

// Same plausibility check the server applies on capture — just enough to
// avoid firing a network request on every keystroke/blur of a clearly
// unfinished address.
const EMAIL_LOOKS_VALID = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface ChecklistLine {
  label: string;
  coarseStage: string;
  isDone: (completed: string[]) => boolean;
}

// 6 narration lines mapped onto the orchestrator's 5 coarse stages (Design
// Spec §1 State 2 / §4) — budget_menu covers two lines since it runs two
// parallel AI calls (budget + menu), the rest map one-to-one.
const CHECKLIST: ChecklistLine[] = [
  {
    label: "Picking a theme that fits what you described...",
    coarseStage: "theme",
    isDone: (c) => c.includes("theme"),
  },
  {
    label: "Sketching your budget...",
    coarseStage: "budget_menu",
    isDone: (c) => c.includes("budget"),
  },
  {
    label: "Building a menu...",
    coarseStage: "budget_menu",
    isDone: (c) => c.includes("menu"),
  },
  {
    label: "Mapping out your day...",
    coarseStage: "shopping_timeline",
    isDone: (c) => c.includes("shopping") && c.includes("timeline"),
  },
  {
    label: "Putting together a few invitation looks...",
    coarseStage: "invites",
    isDone: (c) => c.includes("invites"),
  },
  {
    label: "Double-checking everything lines up...",
    coarseStage: "checks",
    isDone: (c) => c.includes("checks"),
  },
];

const STAGE_ORDER = ["theme", "budget_menu", "shopping_timeline", "invites", "checks", "done"];

export default function DraftGenerating() {
  const { ownerToken } = useParams<{ ownerToken: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const startedGenerationRef = useRef(false);
  const confirmedRef = useRef(false);
  const previewTriggeredRef = useRef(false);
  const previewCardRef = useRef<HTMLDivElement>(null);
  const [email, setEmail] = useState("");
  const [plusEmail, setPlusEmail] = useState("");
  // The paywall shows Spark and Plus side by side rather than burying Plus in a
  // secondary link — repeat hosts were only being offered the per-event unlock.
  const [selectedPlan, setSelectedPlan] = useState<"spark" | "plus">("spark");
  const [plusInterval, setPlusInterval] = useState<"annual" | "monthly">("annual");
  const [showPlusEmail, setShowPlusEmail] = useState(false);
  const [demoOpen, setDemoOpen] = useState(false);
  const [previewImageLoaded, setPreviewImageLoaded] = useState(false);
  const [previewImageFailed, setPreviewImageFailed] = useState(false);
  // A finished preview belongs to the event, not to one fragile browser
  // mutation. Probe the private asset when this page opens so a refresh,
  // mobile tab suspension, or return from another app restores it instantly.
  const [persistedPreviewReady, setPersistedPreviewReady] = useState(false);
  const [backgroundPreviewStarted, setBackgroundPreviewStarted] = useState(false);
  const [previewAssetVersion, setPreviewAssetVersion] = useState(0);

  const previewAssetUrl = ownerToken
    ? `/api/events/owner/${ownerToken}/prepayment-preview/asset?v=${previewAssetVersion}`
    : "";

  const bringPreviewIntoView = useCallback((behavior: ScrollBehavior = "smooth") => {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
    window.setTimeout(() => {
      previewCardRef.current?.scrollIntoView?.({ behavior, block: "center" });
    }, 0);
  }, []);

  const focusPreviewEmail = useCallback(() => {
    const input = document.getElementById("sparkEmail") as HTMLInputElement | null;
    input?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    window.setTimeout(() => input?.focus({ preventScroll: true }), 300);
  }, []);

  // Returning from a Spark checkout lands back here with these params (see
  // server/routes.ts create-session success_url). We confirm the session to
  // mark the event unlocked before generation can proceed.
  const searchParams = new URLSearchParams(window.location.search);
  const sessionId = searchParams.get("session_id") || undefined;
  const checkoutStatus = searchParams.get("checkout") || undefined;
  const returningFromCheckout = checkoutStatus === "success" && !!sessionId;

  useEffect(() => {
    if (ownerToken) touchRecentEvent(ownerToken);
  }, [ownerToken]);

  useEffect(() => {
    if (!previewAssetUrl) return;
    let active = true;
    const probe = new Image();
    probe.onload = () => {
      if (active) setPersistedPreviewReady(true);
    };
    // A 404 simply means this event has not made its one preview yet. Do not
    // turn that normal first-visit state into an error or unlock checkout.
    probe.onerror = () => undefined;
    probe.src = previewAssetUrl;
    return () => {
      active = false;
    };
  }, [previewAssetUrl]);

  const { data: config } = useQuery<{ configured: boolean }>({
    queryKey: ["/api/checkout/config"],
  });

  const entitlement = useQuery<EntitlementSummary>({
    queryKey: ["master-planner-entitlement", ownerToken],
    queryFn: () =>
      apiRequestJson<EntitlementSummary>("GET", `/api/events/owner/${ownerToken}/master-planner/entitlement`),
    enabled: !!ownerToken,
  });

  const previewReadiness = useQuery<PrePaymentPreviewReadiness>({
    queryKey: ["prepayment-preview-readiness", ownerToken],
    queryFn: () => apiRequestJson<PrePaymentPreviewReadiness>(
      "GET",
      `/api/events/owner/${ownerToken}/prepayment-preview/readiness`,
    ),
    enabled: !!ownerToken,
    retry: false,
    refetchInterval: (query) => {
      const current = query.state.data as PrePaymentPreviewReadiness | undefined;
      return current?.generationState === "generating"
        ? current.pollAfterMs ?? 2500
        : false;
    },
  });

  // If we came back from a completed Spark checkout, activate the unlock
  // (pull-based, mirrors the Plus success page) before anything else.
  const confirmCheckout = useMutation({
    mutationFn: () =>
      apiRequestJson<{ plan: string; unlocked: boolean }>(
        "GET",
        `/api/checkout/confirm?sessionId=${encodeURIComponent(sessionId || "")}`,
      ),
    onSettled: () => {
      entitlement.refetch();
    },
  });

  useEffect(() => {
    if (!returningFromCheckout || confirmedRef.current) return;
    confirmedRef.current = true;
    confirmCheckout.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returningFromCheckout]);

  const checkoutHandoffPhase = getCheckoutHandoffPhase(
    returningFromCheckout,
    confirmCheckout.isSuccess,
    confirmCheckout.isError,
  );

  const startGeneration = useMutation({
    mutationFn: () =>
      apiRequestJson("POST", `/api/events/owner/${ownerToken}/master-planner/generate`, {}),
  });

  // Start a Spark checkout for this specific event, then hand off to Stripe.
  const startSparkCheckout = useMutation({
    mutationFn: () =>
      apiRequestJson<{ url: string }>("POST", "/api/checkout/create-session", {
        email,
        plan: "spark",
        returnToken: ownerToken,
      }),
    onSuccess: (result) => {
      window.location.href = result.url;
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't start checkout", description: err.message, variant: "destructive" });
    },
  });

  // Subscribing to Plus from the paywall, so hosts who plan more than one event
  // aren't forced through the per-event unlock to get here.
  const startPlusCheckout = useMutation({
    mutationFn: () =>
      apiRequestJson<{ url: string }>("POST", "/api/checkout/create-session", {
        email,
        plan: "plus",
        billingInterval: plusInterval,
        returnToken: ownerToken,
      }),
    onSuccess: (result) => {
      window.location.href = result.url;
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't start checkout", description: err.message, variant: "destructive" });
    },
  });

  // Existing Plus members reach this event with no captured email on it, so
  // the gate can't see their plan and shows the paywall. Letting them supply
  // the email on their Plus plan stamps it onto the event; the refetched
  // entitlement then flips canGenerate true and the auto-start effect fires.
  const captureEmail = useMutation({
    mutationFn: () => {
      const eventId = entitlement.data?.eventId;
      if (!eventId) throw new Error("We couldn't load this event just yet — please try again.");
      return apiRequestJson<EntitlementSummary>("POST", `/api/events/${eventId}/email-capture`, {
        email: plusEmail,
        ownerToken,
      });
    },
    onSuccess: (summary) => {
      entitlement.refetch();
      if (!summary.canGenerate) {
        toast({
          title: "We couldn't find a Plus plan for that email",
          description: "Double-check the address, or unlock just this event with Spark below.",
        });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't check that email", description: err.message, variant: "destructive" });
    },
  });

  // Kicks off the real, capped, low-resolution invitation preview without
  // persisting this provisional field value as the event's recovery identity.
  // Checkout submission and the explicit Plus lookup capture the email later;
  // Stripe's verified address remains authoritative after payment.
  const startPrePaymentPreview = useMutation({
    mutationFn: (candidateEmail: string) =>
      apiRequestJson<PrePaymentPreviewStart>("POST", `/api/events/owner/${ownerToken}/prepayment-preview`, {
        email: candidateEmail,
      }),
    onSuccess: (result) => {
      if (result.ready) {
        setBackgroundPreviewStarted(false);
        setPreviewImageLoaded(false);
        setPreviewImageFailed(false);
        setPersistedPreviewReady(true);
        setPreviewAssetVersion((current) => current + 1);
      } else {
        setBackgroundPreviewStarted(true);
        void previewReadiness.refetch();
      }
    },
    onError: () => {
      setBackgroundPreviewStarted(false);
      previewTriggeredRef.current = false;
    },
  });

  const requestPersonalizedPreview = useCallback(() => {
    const candidateEmail = email.trim();
    if (!EMAIL_LOOKS_VALID.test(candidateEmail) || previewTriggeredRef.current) return;
    previewTriggeredRef.current = true;
    setPreviewImageLoaded(false);
    setPreviewImageFailed(false);
    bringPreviewIntoView("smooth");
    startPrePaymentPreview.mutate(candidateEmail);
  }, [bringPreviewIntoView, email, startPrePaymentPreview]);

  const readinessKind = previewReadiness.data?.kind ?? "none";
  const readinessState = previewReadiness.data?.generationState ?? "idle";
  const previewInProgress =
    startPrePaymentPreview.isPending
    || backgroundPreviewStarted
    || readinessState === "generating";
  const previewReady =
    persistedPreviewReady
    || (readinessKind !== "none" && readinessState !== "generating");

  useEffect(() => {
    if (readinessState === "generating") {
      previewTriggeredRef.current = true;
      setBackgroundPreviewStarted(true);
      setPersistedPreviewReady(false);
      bringPreviewIntoView("smooth");
      return;
    }
    if (readinessKind === "none") return;

    previewTriggeredRef.current = true;
    setBackgroundPreviewStarted(false);
    setPreviewImageLoaded(false);
    setPreviewImageFailed(false);
    setPersistedPreviewReady(true);
    setPreviewAssetVersion((current) => current + 1);
    bringPreviewIntoView("smooth");
  }, [bringPreviewIntoView, readinessKind, readinessState]);

  // Move the host to the visible spinner as soon as generation starts—not
  // only after a long image call finishes—and move them back again when the
  // pixels are ready. This directly covers the mobile checkout layout where
  // the email field sits well below the preview card.
  useEffect(() => {
    if (!previewInProgress) return;
    bringPreviewIntoView("smooth");
  }, [bringPreviewIntoView, previewInProgress]);

  useEffect(() => {
    if (!previewImageLoaded) return;
    bringPreviewIntoView("smooth");
  }, [bringPreviewIntoView, previewImageLoaded]);

  // Mobile browsers may suspend smooth scrolling while another app or tab is
  // open. Re-run the reveal when the page becomes visible again, and on the
  // browser's pageshow restoration event, so a completed preview is never left
  // silently above the fold.
  useEffect(() => {
    const restorePreview = () => {
      if (document.visibilityState !== "visible") return;
      if (previewInProgress || previewReady || previewImageLoaded) {
        bringPreviewIntoView("auto");
      }
    };
    document.addEventListener("visibilitychange", restorePreview);
    window.addEventListener("pageshow", restorePreview);
    return () => {
      document.removeEventListener("visibilitychange", restorePreview);
      window.removeEventListener("pageshow", restorePreview);
    };
  }, [bringPreviewIntoView, previewImageLoaded, previewInProgress, previewReady]);

  const previewIsVisible = previewReady && previewImageLoaded;
  const previewCouldNotBeShown = startPrePaymentPreview.isError || (previewReady && previewImageFailed);
  const previewAssetLoading = previewReady && !previewImageLoaded && !previewImageFailed;
  const checkoutPending = startSparkCheckout.isPending || startPlusCheckout.isPending;

  let paywallCtaLabel = "Show me my personalized first look";
  if (checkoutPending) {
    paywallCtaLabel = "Starting checkout…";
  } else if (previewInProgress) {
    paywallCtaLabel = "Creating your personalized first look…";
  } else if (previewAssetLoading) {
    paywallCtaLabel = "Revealing your personalized first look…";
  } else if (previewCouldNotBeShown) {
    paywallCtaLabel =
      selectedPlan === "spark"
        ? "Continue to checkout — $9.99"
        : `Continue to Plus — ${plusInterval === "annual" ? "$99/yr" : "$11.99/mo"}`;
  } else if (previewIsVisible) {
    paywallCtaLabel =
      selectedPlan === "spark"
        ? "Unlock this event — $9.99"
        : `Subscribe to Plus — ${plusInterval === "annual" ? "$99/yr" : "$11.99/mo"}`;
  }

  // Only auto-fire generation once we know this event is allowed to draft
  // (Spark unlocked or Plus). Never before entitlement resolves, and never
  // while a returning checkout is still being confirmed.
  useEffect(() => {
    if (startedGenerationRef.current || !ownerToken) return;
    if (checkoutHandoffPhase === "confirming" || checkoutHandoffPhase === "failed") return;
    if (!entitlement.data?.canGenerate) return;
    startedGenerationRef.current = true;
    startGeneration.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerToken, entitlement.data?.canGenerate, checkoutHandoffPhase]);

  const { data: status } = useQuery<MasterPlannerStatus>({
    queryKey: ["master-planner-status", ownerToken],
    queryFn: () => apiRequestJson<MasterPlannerStatus>("GET", `/api/events/owner/${ownerToken}/master-planner/status`),
    enabled: !!ownerToken && startGeneration.isSuccess,
    refetchInterval: (query) => {
      const current = query.state.data as MasterPlannerStatus | undefined;
      if (current?.draftStatus === "ready" || current?.draftStatus === "failed_partial") return false;
      return 2000;
    },
  });

  useEffect(() => {
    if (status?.draftStatus === "ready" && ownerToken) {
      navigate(`/draft-overview/${ownerToken}`);
    }
  }, [status?.draftStatus, ownerToken, navigate]);

  const completedStages = status?.completedStages ?? [];
  const currentCoarseStage = status?.draftStage ?? null;
  const currentStageIndex = currentCoarseStage ? STAGE_ORDER.indexOf(currentCoarseStage) : -1;
  const hasFailed = status?.draftStatus === "failed_partial";

  const startError = startGeneration.error as Error | undefined;
  // This event has already spent its one plan (409). An expected, non-broken
  // state — not a technical failure.
  const capExceeded = startGeneration.isError && !!startError?.message?.includes("already been generated");
  // Payment is required before this event can draft anything (402). Show the
  // same paywall the pre-generation entitlement check would.
  const needsPaymentFromStart = startGeneration.isError && !!startError?.message?.includes("needs Spark or Plus");
  const startupFailed = startGeneration.isError && !capExceeded && !needsPaymentFromStart;

  // The paywall shows when the event isn't yet allowed to draft: either the
  // upfront entitlement check says so, or the generate call came back 402.
  const showPaywall =
    checkoutHandoffPhase === "none" &&
    ((entitlement.isSuccess && !entitlement.data.canGenerate && !startGeneration.isSuccess) || needsPaymentFromStart);

  const checkoutConfigured = config?.configured ?? false;

  if (checkoutHandoffPhase === "confirming") {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 py-16">
        <Link href="/" data-testid="link-logo-home">
          <Wordmark className="mb-10" />
        </Link>
        <div className="w-full max-w-md space-y-4 text-center" data-testid="checkout-handoff-confirming">
          <Loader2 className="mx-auto h-9 w-9 animate-spin text-primary" />
          <h1 className="font-serif text-2xl font-semibold text-foreground">Payment received</h1>
          <p className="text-sm text-muted-foreground">
            Securing your event now. Posy will start building your plan as soon as the unlock is confirmed.
          </p>
        </div>
      </div>
    );
  }

  if (checkoutHandoffPhase === "failed") {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 py-16">
        <Link href="/" data-testid="link-logo-home">
          <Wordmark className="mb-10" />
        </Link>
        <div className="w-full max-w-md space-y-4 text-center" data-testid="checkout-handoff-failed">
          <h1 className="font-serif text-2xl font-semibold text-foreground">Let's finish unlocking your event</h1>
          <p className="text-sm text-muted-foreground">
            Stripe sent you back successfully, but Posy couldn't confirm the unlock just yet. Trying again will not create another charge.
          </p>
          <Button
            onClick={() => confirmCheckout.mutate()}
            disabled={confirmCheckout.isPending}
            data-testid="button-retry-checkout-confirmation"
          >
            {confirmCheckout.isPending ? "Confirming…" : "Try unlocking again"}
          </Button>
        </div>
      </div>
    );
  }

  if (showPaywall) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 py-16">
        <Link href="/" data-testid="link-logo-home">
          <Wordmark className="mb-10" />
        </Link>
        <div className="w-full max-w-2xl space-y-5" data-testid="draft-generating-paywall">
          <div className="text-center">
            <h1 className="font-serif text-2xl font-semibold text-foreground">
              Your event details are saved
            </h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Choose how you’d like Posy to build your complete first draft: pay once for this
              event, or go Plus for every event you host.
            </p>
          </div>

          {/* See-how-it-works button — opens demo in a dialog so users stay on the paywall */}
          <div className="text-center">
            <button
              type="button"
              onClick={() => setDemoOpen(true)}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline underline-offset-2 hover:text-primary/80"
              data-testid="link-paywall-see-demo"
            >
              <Play className="h-3.5 w-3.5" />
              See how Posy builds your plan
            </button>
          </div>

          {/* Real, capped, low-resolution invitation preview (B2a). The server
              destroys production-quality detail before these bytes reach the
              browser, so the composition can remain visible and useful here. */}
          <div
            ref={previewCardRef}
            className="mx-auto w-full max-w-sm overflow-hidden rounded-2xl border border-border bg-card shadow-sm"
            data-testid="prepayment-preview-card"
            aria-live="polite"
          >
            {previewReady && !previewImageFailed ? (
              // The generated illustration's aspect ratio depends on the AI-chosen
              // concept's layoutStyle (currently always full-bleed => native 9:16
              // portrait, but this must stay correct even if that changes). A fixed
              // aspect-[9/16] + object-cover box silently crops the moment the real
              // image differs from that exact ratio (rounding, future layout changes,
              // etc.) — the same forced-crop bug PR #41 already fixed once. Let the
              // image render at its own natural aspect ratio (w-full h-auto) instead.
              // min-h keeps the loading spinner and card frame visible before the
              // image has painted.
              <div className="relative min-h-[240px]">
                <img
                  src={previewAssetUrl}
                  alt="A personalized first look built from your event direction"
                  className="block w-full h-auto"
                  data-testid="img-prepayment-preview"
                  onLoad={() => setPreviewImageLoaded(true)}
                  onError={() => setPreviewImageFailed(true)}
                />
                {!previewImageLoaded && (
                  <div className="absolute inset-0 flex items-center justify-center gap-2 bg-card px-6 text-center text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Revealing your personalized first look…
                  </div>
                )}
                <span className="absolute right-3 top-3 rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground shadow-sm">
                  Posy first look
                </span>
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/35 to-transparent px-5 pb-4 pt-16 text-white">
                  <p className="font-serif text-lg font-semibold">A first look, made from your details</p>
                  <p className="mt-1 text-xs text-white/85">Unlock your complete plan and full invitation designs.</p>
                </div>
              </div>
            ) : previewInProgress ? (
              <div className="flex aspect-[9/16] items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
                <Loader2 className="h-5 w-5 shrink-0 animate-spin" />
                <div>
                  <p className="font-medium text-foreground">Creating your personalized first look…</p>
                  <p className="mt-1 text-xs leading-relaxed">
                    Posy is finding the right visual references and reviewing the artwork privately. You can leave this tab and return—this will keep working.
                  </p>
                </div>
              </div>
            ) : previewCouldNotBeShown ? (
              <div className="flex aspect-[9/16] items-center justify-center px-6 text-center text-sm text-muted-foreground">
                Posy couldn't complete the first look this time. You can still continue—your full invitation is included once unlocked.
              </div>
            ) : (
              <div className="flex aspect-[9/16] flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
                <p>Posy will create a personalized first look before checkout.</p>
                <button
                  type="button"
                  onClick={focusPreviewEmail}
                  className="font-medium text-primary underline underline-offset-2 hover:text-primary/80"
                  data-testid="button-anchor-preview-email"
                >
                  Enter your email below
                </button>
              </div>
            )}
          </div>

          {/* Side-by-side plan choice */}
          <div className="grid gap-3 sm:grid-cols-2">
            {/* Spark */}
            <button
              type="button"
              onClick={() => setSelectedPlan("spark")}
              data-testid="option-plan-spark"
              aria-pressed={selectedPlan === "spark"}
              className={`relative rounded-xl border-2 bg-card p-4 text-left transition-all ${
                selectedPlan === "spark"
                  ? "border-primary shadow-sm ring-1 ring-primary/20"
                  : "border-border hover:border-primary/40"
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-semibold text-foreground">Spark</p>
                  <p className="text-xs text-muted-foreground">This event only</p>
                </div>
                {selectedPlan === "spark" && (
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Check className="h-3 w-3" />
                  </span>
                )}
              </div>
              <div className="mt-3 flex items-baseline gap-1.5">
                <span className="text-sm text-muted-foreground line-through">$12.99</span>
                <span className="text-2xl font-semibold text-foreground">$9.99</span>
                <span className="text-xs text-muted-foreground">once</span>
              </div>
              <ul className="mt-3 space-y-1.5">
                {[
                  "One full AI-drafted plan",
                  "Guests, RSVPs & invitations",
                  "Budget, menu & timeline",
                  "No subscription",
                ].map((f) => (
                  <li key={f} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <Check className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                    {f}
                  </li>
                ))}
              </ul>
            </button>

            {/* Plus */}
            <button
              type="button"
              onClick={() => setSelectedPlan("plus")}
              data-testid="option-plan-plus"
              aria-pressed={selectedPlan === "plus"}
              className={`relative rounded-xl border-2 bg-card p-4 text-left transition-all ${
                selectedPlan === "plus"
                  ? "border-primary shadow-sm ring-1 ring-primary/20"
                  : "border-border hover:border-primary/40"
              }`}
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
                    Plus
                    <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary">
                      Best value
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">Every event you host</p>
                </div>
                {selectedPlan === "plus" && (
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Check className="h-3 w-3" />
                  </span>
                )}
              </div>
              <div className="mt-3 flex items-baseline gap-1.5">
                <span className="text-sm text-muted-foreground line-through">
                  {plusInterval === "annual" ? "$129" : "$13.99"}
                </span>
                <span className="text-2xl font-semibold text-foreground">
                  {plusInterval === "annual" ? "$99" : "$11.99"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {plusInterval === "annual" ? "/yr" : "/mo"}
                </span>
              </div>

              {/* Interval toggle */}
              <div className="mt-2 inline-flex rounded-full border border-border p-0.5">
                <span
                  role="button"
                  tabIndex={0}
                  data-testid="toggle-paywall-annual"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedPlan("plus");
                    setPlusInterval("annual");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.stopPropagation();
                      setSelectedPlan("plus");
                      setPlusInterval("annual");
                    }
                  }}
                  className={`cursor-pointer rounded-full px-2.5 py-0.5 text-[10px] font-medium transition-colors ${
                    plusInterval === "annual"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground"
                  }`}
                >
                  Annual
                </span>
                <span
                  role="button"
                  tabIndex={0}
                  data-testid="toggle-paywall-monthly"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedPlan("plus");
                    setPlusInterval("monthly");
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.stopPropagation();
                      setSelectedPlan("plus");
                      setPlusInterval("monthly");
                    }
                  }}
                  className={`cursor-pointer rounded-full px-2.5 py-0.5 text-[10px] font-medium transition-colors ${
                    plusInterval === "monthly"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground"
                  }`}
                >
                  Monthly
                </span>
              </div>
              {plusInterval === "annual" && (
                <p className="mt-1.5 text-[10px] font-medium text-primary">Save $44.88 vs monthly</p>
              )}

              <ul className="mt-2.5 space-y-1.5">
                {[
                  "Unlimited plans, every event",
                  "Unlimited plan regenerations",
                  "Alternate menu, timeline & invite drafts",
                  "Priority AI generation queue",
                ].map((f) => (
                  <li key={f} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <Check className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                    {f}
                  </li>
                ))}
              </ul>
            </button>
          </div>

          {/* Single email + CTA that follows the selection */}
          {checkoutConfigured ? (
            <form
              className="mx-auto max-w-sm space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                // The first submit is intentionally the preview reveal. The
                // checkout action only becomes available after real personal
                // value is visible. If the optional preview provider fails,
                // never block a host who is ready to buy.
                if (!previewIsVisible && !previewCouldNotBeShown) {
                  requestPersonalizedPreview();
                  return;
                }
                if (selectedPlan === "spark") startSparkCheckout.mutate();
                else startPlusCheckout.mutate();
              }}
            >
              <div>
                <Label htmlFor="sparkEmail">Email</Label>
                <Input
                  id="sparkEmail"
                  type="email"
                  required
                  data-testid="input-spark-email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={() => {
                    // Generate early without turning a provisional field
                    // value into the event's permanent recovery identity.
                    requestPersonalizedPreview();
                  }}
                />
                <p className="mt-1.5 text-xs text-muted-foreground">
                  When you continue to checkout, Posy will also email your private return link.
                </p>
              </div>
              {previewIsVisible && (
                <button
                  type="button"
                  onClick={() => bringPreviewIntoView("smooth")}
                  className="flex w-full items-center justify-center gap-1.5 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs font-medium text-primary"
                  data-testid="button-view-personalized-preview"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Your first look is ready — view it above
                </button>
              )}
              <Button
                type="submit"
                className="w-full"
                data-testid="button-unlock-spark"
                disabled={
                  previewInProgress ||
                  previewAssetLoading ||
                  checkoutPending
                }
              >
                {paywallCtaLabel}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                {selectedPlan === "spark"
                  ? "One-time payment. No subscription, no auto-renew."
                  : "Cancel anytime. Unlocks this event and every event after."}
              </p>
            </form>
          ) : (
            <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
              Checkout is launching soon — please check back shortly.
            </p>
          )}

          {/* Existing Plus members — collapsed so it doesn't compete with the choice above */}
          <div className="mx-auto max-w-sm text-center" data-testid="already-plus-panel">
            {!showPlusEmail ? (
              <button
                type="button"
                onClick={() => setShowPlusEmail(true)}
                data-testid="button-show-plus-email"
                className="text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground"
              >
                Already on Plus? Unlock with your Plus email
              </button>
            ) : (
              <form
                className="space-y-2 rounded-lg border border-border p-4 text-left"
                onSubmit={(e) => {
                  e.preventDefault();
                  captureEmail.mutate();
                }}
              >
                <Label htmlFor="plusEmail" className="text-xs">
                  Email on your Plus plan
                </Label>
                <Input
                  id="plusEmail"
                  type="email"
                  required
                  data-testid="input-plus-email"
                  placeholder="you@example.com"
                  value={plusEmail}
                  onChange={(e) => setPlusEmail(e.target.value)}
                />
                <Button
                  type="submit"
                  variant="outline"
                  className="w-full"
                  data-testid="button-use-plus-email"
                  disabled={captureEmail.isPending}
                >
                  {captureEmail.isPending ? "Checking…" : "Use my Plus email"}
                </Button>
              </form>
            )}
          </div>

          <p className="text-center">
            <Link
              href={`/pricing?returnToken=${ownerToken}`}
              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
              data-testid="button-paywall-plus"
            >
              Compare all plans →
            </Link>
          </p>
        </div>

        {/* Demo dialog — opens in-place so users see how Posy works without leaving the paywall */}
        <Dialog open={demoOpen} onOpenChange={setDemoOpen}>
          <DialogContent className="max-w-2xl overflow-y-auto max-h-[90vh]">
            <DialogHeader>
              <DialogTitle>See how Posy builds your plan</DialogTitle>
              <DialogDescription>
                Watch Posy turn one sentence into a complete event plan — timeline, guests,
                invitation concepts, envelope customization, and checklist — in 30 seconds.
              </DialogDescription>
            </DialogHeader>
            <AIDemoShowcase bare autoPlay />
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 py-16">
      <Link href="/" data-testid="link-logo-home">
        <Wordmark className="mb-10" />
      </Link>
      {checkoutHandoffPhase === "confirmed" && !capExceeded && !startupFailed && !hasFailed && (
        <div className="mb-8 max-w-md space-y-2 text-center" data-testid="checkout-handoff-confirmed">
          <CheckCircle2 className="mx-auto h-8 w-8 text-primary" />
          <h1 className="font-serif text-2xl font-semibold text-foreground">
            Payment confirmed — Posy is building your plan
          </h1>
          <p className="text-sm text-muted-foreground">
            Keep this page open. Your first draft will open automatically when it's ready.
          </p>
        </div>
      )}
      <div className="w-full max-w-md space-y-4" data-testid="draft-generating-checklist">
        {CHECKLIST.map((line) => {
          const done = line.isDone(completedStages);
          const isActive = !done && !hasFailed && STAGE_ORDER.indexOf(line.coarseStage) === currentStageIndex;
          return (
            <div
              key={line.label}
              className="flex items-center gap-3 text-sm"
              data-testid={`checklist-item-${line.coarseStage}-${line.label.slice(0, 10).replace(/\W+/g, "")}`}
            >
              {done ? (
                <CheckCircle2 className="h-5 w-5 shrink-0 text-primary" />
              ) : isActive ? (
                <Loader2 className="h-5 w-5 shrink-0 animate-spin text-muted-foreground" />
              ) : (
                <CircleDashed className="h-5 w-5 shrink-0 text-muted-foreground/40" />
              )}
              <span className={done || isActive ? "text-foreground" : "text-muted-foreground/60"}>{line.label}</span>
            </div>
          );
        })}
      </div>

      {capExceeded && (
        <div className="mt-10 max-w-md space-y-3 text-center" data-testid="draft-generating-cap-exceeded">
          <p className="text-sm text-muted-foreground">
            This event's plan is ready. To regenerate, unlock again with Spark or go Plus for unlimited plans.
          </p>
          <Button asChild data-testid="button-cap-exceeded-pricing">
            <Link href={`/pricing?returnToken=${ownerToken}`}>Go Plus</Link>
          </Button>
        </div>
      )}

      {startupFailed && (
        <div className="mt-10 max-w-md space-y-3 text-center" data-testid="draft-generating-startup-failed">
          <p className="text-sm text-muted-foreground">
            I couldn't get started just now. Nothing has been spent yet, so it's safe to try again.
          </p>
          <Button
            onClick={() => startGeneration.mutate()}
            disabled={startGeneration.isPending}
            data-testid="button-retry-start"
          >
            {startGeneration.isPending ? "Trying again..." : "Try again"}
          </Button>
        </div>
      )}

      {hasFailed && (
        <div className="mt-10 max-w-md space-y-3 text-center" data-testid="draft-generating-failed">
          <p className="text-sm text-muted-foreground">
            That draft didn't finish this time — nothing was lost. Whatever's already done is saved, and picking up won't redo it.
          </p>
          <Button
            onClick={() => startGeneration.mutate()}
            disabled={startGeneration.isPending}
            data-testid="button-retry-draft"
          >
            {startGeneration.isPending ? "Picking up where I left off..." : "Try again"}
          </Button>
        </div>
      )}
    </div>
  );
}

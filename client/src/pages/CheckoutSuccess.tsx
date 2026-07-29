import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { apiRequestJson } from "@/lib/queryClient";
import { Wordmark } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { trackEvent, isMarketingConsentGranted, type AnalyticsEventName } from "@/lib/analytics";
import { CheckCircle2, XCircle } from "lucide-react";

interface CheckoutConfirmResult {
  plan?: "plus" | "spark";
  // Spark one-time unlock fields.
  unlocked?: boolean;
  returnToken?: string;
  // Plus subscription fields.
  planTier?: string;
  trialEndsAt?: number | null;
  billingInterval?: string | null;
  firedEvent?: AnalyticsEventName | null;
  // Stable conversion id (Stripe session id for Spark, subscription id for
  // Plus) + USD amount, used for GA4 transaction_id and Meta Pixel/CAPI dedup.
  eventId?: string;
  value?: number;
  email: string | null;
}

function useUrlParam(name: string): string | undefined {
  // This app uses real browser-path routing (see App.tsx), so
  // success_url's query string always lands in window.location.search
  // directly — no hash fragment involved.
  if (typeof window === "undefined") return undefined;
  return new URLSearchParams(window.location.search).get(name) ?? undefined;
}

export default function CheckoutSuccess() {
  const sessionId = useUrlParam("session_id");
  const returnToken = useUrlParam("returnToken");
  const [, navigate] = useLocation();

  const { data, isLoading, isError, error } = useQuery<CheckoutConfirmResult>({
    queryKey: ["/api/checkout/confirm", sessionId],
    queryFn: () => apiRequestJson<CheckoutConfirmResult>("GET", `/api/checkout/confirm?sessionId=${encodeURIComponent(sessionId || "")}`),
    enabled: !!sessionId,
    retry: false,
  });

  const isSpark = data?.plan === "spark";
  const sparkReturnToken = returnToken || data?.returnToken;

  // If the host upgraded from mid-build on a specific event, send them right
  // back to that event's dashboard — their plan was never lost, they just
  // had no way back to it. Otherwise fall back to the "How do you want to
  // start?" chooser on the homepage.
  const goToGetStarted = () => {
    // A Spark purchase unlocks one specific event's plan — take the host
    // straight back to generation so the plan they just paid for gets built.
    if (isSpark && sparkReturnToken) {
      navigate(`/draft-generating/${sparkReturnToken}`);
      return;
    }
    if (returnToken) {
      navigate(`/dashboard/${returnToken}`);
      return;
    }
    navigate("/");
    let attempts = 0;
    const tryScroll = () => {
      const target = document.getElementById("get-started");
      if (target) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      attempts += 1;
      if (attempts < 30) requestAnimationFrame(tryScroll);
    };
    requestAnimationFrame(tryScroll);
  };

  useEffect(() => {
    if (!data?.firedEvent) return;
    trackEvent(data.firedEvent, {
      value: data.value,
      currency: "USD",
      transaction_id: data.eventId,
      billing_interval: data.billingInterval ?? undefined,
    });
    // Client-side Meta Pixel Purchase, gated on Marketing consent. The eventID
    // (4th arg) matches the server-side CAPI event_id so Meta dedupes the two
    // into one conversion.
    if (isMarketingConsentGranted() && data.eventId && data.value != null) {
      window.fbq?.("track", "Purchase", { value: data.value, currency: "USD" }, { eventID: data.eventId });
    }
  }, [data?.firedEvent, data?.billingInterval, data?.eventId, data?.value]);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
          <Link href="/">
            <Wordmark />
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-lg px-6 py-16">
        <Card className="border-card-border">
          <CardContent className="space-y-4 p-8 text-center">
            {!sessionId ? (
              <>
                <XCircle className="mx-auto h-10 w-10 text-destructive" />
                <h1 className="font-serif text-xl font-semibold text-foreground" data-testid="text-checkout-error-title">
                  I couldn't find your checkout
                </h1>
                <p className="text-sm text-muted-foreground">
                  We couldn't find a checkout session to confirm. If you just completed checkout,
                  try refreshing this page.
                </p>
              </>
            ) : isLoading ? (
              <>
                <Skeleton className="mx-auto h-10 w-10 rounded-full" />
                <Skeleton className="mx-auto h-5 w-48" />
                <Skeleton className="mx-auto h-4 w-64" />
              </>
            ) : isError ? (
              <>
                <XCircle className="mx-auto h-10 w-10 text-destructive" />
                <h1 className="font-serif text-xl font-semibold text-foreground" data-testid="text-checkout-error-title">
                  Couldn't confirm your checkout
                </h1>
                <p className="text-sm text-muted-foreground" data-testid="text-checkout-error-detail">
                  {error instanceof Error ? error.message : "Please contact support if this persists."}
                </p>
              </>
            ) : (
              <>
                <CheckCircle2 className="mx-auto h-10 w-10 text-primary" />
                {data?.email && (
                  <p className="text-sm text-muted-foreground" data-testid="text-checkout-welcome-email">
                    Welcome, {data.email}
                  </p>
                )}
                <h1 className="font-serif text-xl font-semibold text-foreground" data-testid="text-checkout-success-title">
                  {isSpark ? "Your event is unlocked" : "You're on Plus"}
                </h1>
                <p className="text-sm text-muted-foreground" data-testid="text-checkout-success-detail">
                  {isSpark
                    ? "Your plan is ready to build — let's put it together now."
                    : "Your Plus subscription is active. Head back to any of your events to use it."}
                </p>
              </>
            )}
            <Button className="w-full" data-testid="button-back-home" onClick={goToGetStarted}>
              {isSpark ? "Build my plan" : returnToken ? "Back to my event" : "Start planning"}
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}

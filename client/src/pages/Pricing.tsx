import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequestJson } from "@/lib/queryClient";
import { Wordmark } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Check, Sparkles, Lock, Play } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import AIDemoShowcase from "@/components/AIDemoShowcase";

type BillingInterval = "annual" | "monthly";

// Pricing (PartyPilot_GTM_Strategy_Master.md, filename predates the Posy
// rebrand): Spark is a one-time $9.99 unlock for a single event. Plus is a
// paid-from-day-one subscription at $99/yr or $11.99/mo (no free trial). The
// strikethrough "regular" prices anchor the summer-savings framing.
const SPARK_REGULAR_PRICE = "$12.99";
const SPARK_PRICE = "$9.99";

const ANNUAL_REGULAR_PRICE = "$129/yr";
const ANNUAL_PRICE = "$99/yr";
const MONTHLY_REGULAR_PRICE = "$13.99/mo";
const MONTHLY_PRICE = "$11.99/mo";
// $11.99 × 12 − $99 = $44.88 saved by paying annually vs. monthly for a year.
const ANNUAL_SAVINGS = "$44.88";

const SPARK_FEATURES = [
  "One full AI-drafted plan for one event",
  "Guest list, RSVP tracking, and invitations",
  "Budget, menu, and timeline tools",
  "One-time payment — no subscription",
];

const PLUS_FEATURES = [
  "Unlimited full plan regenerations",
  "Alternate menu, timeline, and invite drafts",
  "AI cascade suggestions across every tab",
  "Priority AI generation queue",
];

const CONCIERGE_FEATURES = [
  "A dedicated planner who reviews and refines your plan",
  "Personal check-ins at the moments that matter most",
  "Vendor sourcing and outreach handled on your behalf",
  "Priority phone and email support",
];

export default function Pricing() {
  const { toast } = useToast();
  const [billingInterval, setBillingInterval] = useState<BillingInterval>("annual");
  // Plays the A-to-Z demo in a dialog so shoppers never leave the pricing page.
  const [demoOpen, setDemoOpen] = useState(false);
  const [email, setEmail] = useState("");

  // Carries the event a host was mid-build on when they clicked "Upgrade to
  // Plus", so checkout success can send them back to that same event instead
  // of stranding them on the homepage with their in-progress plan seemingly
  // gone (it's still there — they just couldn't get back to it).
  const returnToken = new URLSearchParams(window.location.search).get("returnToken") || undefined;

  const { data: config } = useQuery<{ configured: boolean }>({
    queryKey: ["/api/checkout/config"],
  });

  const startCheckout = useMutation({
    mutationFn: async () => {
      return apiRequestJson<{ url: string }>("POST", "/api/checkout/create-session", {
        email,
        plan: "plus",
        billingInterval,
        returnToken,
      });
    },
    onSuccess: (result) => {
      window.location.href = result.url;
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't start checkout", description: err.message, variant: "destructive" });
    },
  });

  const configured = config?.configured ?? false;

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
          <Link href="/" data-testid="link-logo-home">
            <Wordmark />
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-14">
        <div className="mb-8 text-center">
          <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-primary" data-testid="text-eyebrow">
            Simple, honest pricing
          </p>
          <h1 className="font-serif text-3xl font-semibold leading-tight text-foreground sm:text-4xl" data-testid="text-pricing-title">
            Plans for every kind of host.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-muted-foreground">
            Start with a single event, or go Plus for unlimited plans, more options, and
            regenerations across everything you host.
          </p>
        </div>

        <div className="mb-8 flex justify-center gap-3">
          <span
            className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-4 py-1.5 text-sm font-medium text-primary"
            data-testid="banner-summer-savings"
          >
            ☀️ Exclusive Summer Savings
          </span>
          <button
            type="button"
            onClick={() => setDemoOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted/50"
            data-testid="link-pricing-see-demo"
          >
            <Play className="h-3.5 w-3.5 text-primary" />
            See what Posy does in 30 seconds
          </button>
        </div>

        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <Card className="border-card-border" data-testid="card-plan-spark">
            <CardHeader>
              <CardTitle className="font-serif text-xl">Spark</CardTitle>
              <p className="text-sm text-muted-foreground">For your one big event</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <div className="flex items-baseline gap-2">
                  <span className="text-lg text-muted-foreground line-through" data-testid="text-spark-regular-price">
                    {SPARK_REGULAR_PRICE}
                  </span>
                  <span className="text-3xl font-semibold text-foreground" data-testid="text-spark-price">
                    {SPARK_PRICE}
                  </span>
                  <span className="text-sm text-muted-foreground">/event</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">For 1 event use</p>
              </div>
              <ul className="space-y-2 text-sm text-foreground">
                {SPARK_FEATURES.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 flex-none text-primary" />
                    {feature}
                  </li>
                ))}
              </ul>
              <Button asChild className="w-full" data-testid="button-start-spark">
                <Link href="/intake">Start with Spark</Link>
              </Button>
            </CardContent>
          </Card>

          <Card className="border-primary/40 shadow-sm" data-testid="card-plan-plus">
            <CardHeader>
              <div className="flex items-center gap-2">
                <CardTitle className="font-serif text-xl">Plus</CardTitle>
                <Badge variant="secondary" className="gap-1">
                  <Sparkles className="h-3 w-3" /> Best Value
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">For hosts who want every option</p>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2 rounded-lg border border-border p-1" data-testid="toggle-billing-interval">
                <button
                  type="button"
                  data-testid="button-billing-annual"
                  onClick={() => setBillingInterval("annual")}
                  className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    billingInterval === "annual" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Annual
                </button>
                <button
                  type="button"
                  data-testid="button-billing-monthly"
                  onClick={() => setBillingInterval("monthly")}
                  className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    billingInterval === "monthly" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Monthly
                </button>
              </div>

              <div>
                <div className="flex items-baseline gap-2">
                  <span className="text-lg text-muted-foreground line-through" data-testid="text-plus-regular-price">
                    {billingInterval === "annual" ? ANNUAL_REGULAR_PRICE : MONTHLY_REGULAR_PRICE}
                  </span>
                  <span className="text-3xl font-semibold text-foreground" data-testid="text-plus-price">
                    {billingInterval === "annual" ? ANNUAL_PRICE : MONTHLY_PRICE}
                  </span>
                </div>
                {billingInterval === "annual" && (
                  <Badge variant="secondary" className="mt-2" data-testid="badge-annual-savings">
                    Save {ANNUAL_SAVINGS}
                  </Badge>
                )}
              </div>

              <ul className="space-y-2 text-sm text-foreground">
                {PLUS_FEATURES.map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 flex-none text-primary" />
                    {feature}
                  </li>
                ))}
              </ul>

              {configured ? (
                <form
                  className="space-y-3 pt-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    startCheckout.mutate();
                  }}
                >
                  <div>
                    <Label htmlFor="checkoutEmail">Email</Label>
                    <Input
                      id="checkoutEmail"
                      type="email"
                      required
                      data-testid="input-checkout-email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                    />
                  </div>
                  <Button
                    type="submit"
                    className="w-full"
                    data-testid="button-subscribe-plus"
                    disabled={startCheckout.isPending}
                  >
                    {startCheckout.isPending ? "Starting checkout…" : "Subscribe to Plus"}
                  </Button>
                  <p className="text-center text-xs text-muted-foreground">
                    Cancel anytime from your billing settings.
                  </p>
                  <p className="text-center text-xs text-muted-foreground" data-testid="text-checkout-legal-disclosure">
                    By subscribing, you agree to our{" "}
                    <Link href="/terms" className="underline hover:text-foreground">
                      Terms of Service
                    </Link>{" "}
                    and{" "}
                    <Link href="/refund-policy" className="underline hover:text-foreground">
                      Refund Policy
                    </Link>
                    .
                  </p>
                </form>
              ) : (
                <div className="rounded-lg border border-dashed border-border p-4 text-center" data-testid="card-checkout-coming-soon">
                  <p className="text-sm font-medium text-foreground">Checkout is launching soon</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    We're finishing setup with our payment provider — Plus subscriptions will be
                    available here shortly.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="relative overflow-hidden border-card-border" data-testid="card-plan-concierge">
            <div className="pointer-events-none select-none opacity-40">
              <CardHeader>
                <CardTitle className="font-serif text-xl">Concierge</CardTitle>
                <p className="text-sm text-muted-foreground">For hosts who'd rather hand it off entirely</p>
              </CardHeader>
              <CardContent className="space-y-4">
                <ul className="space-y-2 text-sm text-foreground">
                  {CONCIERGE_FEATURES.map((feature) => (
                    <li key={feature} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-4 w-4 flex-none text-primary" />
                      {feature}
                    </li>
                  ))}
                </ul>
                <Button className="w-full" disabled>
                  Get started
                </Button>
              </CardContent>
            </div>
            <div
              className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/75 px-6 text-center backdrop-blur-[1px]"
              data-testid="overlay-concierge-coming-soon"
            >
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                <Lock className="h-4 w-4 text-primary" />
              </div>
              <p className="text-sm font-semibold text-foreground" data-testid="text-concierge-coming-soon">
                Coming soon
              </p>
              <p className="max-w-[220px] text-xs text-muted-foreground">
                A fully human-assisted planning tier. We're putting the finishing touches on it.
              </p>
            </div>
          </Card>
        </div>
      </main>

      {/* A-to-Z demo, played in place so shoppers stay on the pricing page */}
      <Dialog open={demoOpen} onOpenChange={setDemoOpen}>
        <DialogContent
          className="max-h-[92vh] max-w-4xl overflow-y-auto"
          data-testid="dialog-pricing-demo"
        >
          <DialogHeader>
            <DialogTitle className="font-serif text-xl">
              Tell her once. Watch her build the whole plan.
            </DialogTitle>
            <DialogDescription>
              Describe your event and Posy builds the timeline, guest list, invitation design, and
              checklist — then you fine-tune the invite live.
            </DialogDescription>
          </DialogHeader>
          {demoOpen && <AIDemoShowcase bare autoPlay />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

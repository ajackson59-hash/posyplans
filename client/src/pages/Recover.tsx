import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequestJson } from "@/lib/queryClient";
import { Wordmark } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Mail, ArrowLeft, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Recover() {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [requested, setRequested] = useState(false);

  const lookup = useMutation({
    mutationFn: () =>
      apiRequestJson<{ ok: true; message: string }>("POST", "/api/events/lookup", { email }),
    onSuccess: () => {
      setRequested(true);
      toast({
        title: "Check your inbox",
        description: "If that email is connected to an event, its private dashboard link is on the way.",
      });
    },
    onError: () => {
      toast({
        title: "Couldn't look up events",
        description: "Please check your email and try again.",
        variant: "destructive",
      });
    },
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <Link href="/" data-testid="link-logo-home">
            <Wordmark />
          </Link>
          <Link
            href="/"
            className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Back to home
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-md px-6 py-16">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            <Mail className="h-6 w-6 text-primary" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Find your event</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Enter the email you used when creating your event and we'll send you right back to your dashboard.
          </p>
        </div>

        <Card className="mt-8 border-card-border shadow-sm">
          <CardContent className="p-6">
            {requested ? (
              <div className="space-y-4 text-center" data-testid="event-recovery-confirmation">
                <CheckCircle2 className="mx-auto h-10 w-10 text-primary" />
                <div>
                  <h2 className="font-serif text-xl font-semibold">Check your inbox</h2>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    If an event is connected to that email, we sent its private dashboard link.
                    Check spam or promotions if it doesn't arrive in a few minutes.
                  </p>
                </div>
                <p className="rounded-lg bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">
                  For your security, Posy never displays private event links on this page.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => {
                    setRequested(false);
                    setEmail("");
                  }}
                >
                  Use another email
                </Button>
              </div>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  lookup.mutate();
                }}
                className="space-y-4"
              >
                <div className="space-y-2">
                  <Label htmlFor="email">Email address</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    data-testid="input-recover-email"
                  />
                </div>
                <Button
                  type="submit"
                  className="w-full"
                  disabled={lookup.isPending || !email.trim()}
                  data-testid="button-recover-lookup"
                >
                  {lookup.isPending ? "Sending securely..." : "Email my event link"}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Private event links are sent only to the email associated with the event.
        </p>
      </main>
    </div>
  );
}

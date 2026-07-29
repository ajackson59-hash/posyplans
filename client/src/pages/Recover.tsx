import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { apiRequestJson } from "@/lib/queryClient";
import { Wordmark } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Mail, ArrowLeft, CalendarDays, Users } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface LookupEvent {
  ownerToken: string;
  eventName: string;
  eventType: string;
  eventDate: string | null;
  createdAt: number | null;
}

export default function Recover() {
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [results, setResults] = useState<LookupEvent[] | null>(null);

  const lookup = useMutation({
    mutationFn: () =>
      apiRequestJson<{ events: LookupEvent[] }>("POST", "/api/events/lookup", { email }),
    onSuccess: (data) => {
      setResults(data.events);
      if (data.events.length === 0) {
        toast({
          title: "No events found",
          description: "We couldn't find any events for that email address.",
        });
      } else {
        toast({
          title: `${data.events.length} event${data.events.length > 1 ? "s" : ""} found`,
          description: "Tap any event to go to your dashboard.",
        });
      }
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
          <Link href="/">
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
                  data-testid="input-recover-email"
                />
              </div>
              <Button
                type="submit"
                className="w-full"
                disabled={lookup.isPending || !email.trim()}
                data-testid="button-recover-lookup"
              >
                {lookup.isPending ? "Looking up..." : "Find my event"}
              </Button>
            </form>

            {results && results.length > 0 && (
              <div className="mt-6 space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Your events
                </p>
                {results.map((event) => (
                  <Link
                    key={event.ownerToken}
                    href={`/dashboard/${event.ownerToken}`}
                  >
                    <div
                      className="flex cursor-pointer items-center gap-3 rounded-lg border border-card-border p-3 transition-colors hover:bg-muted/50"
                      data-testid={`link-recover-event-${event.ownerToken}`}
                    >
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                        <CalendarDays className="h-5 w-5 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{event.eventName}</p>
                        <p className="text-xs text-muted-foreground">
                          {event.eventType}
                          {event.eventDate ? ` · ${event.eventDate}` : ""}
                        </p>
                      </div>
                      <ArrowLeft className="h-4 w-4 rotate-180 text-muted-foreground" />
                    </div>
                  </Link>
                ))}
              </div>
            )}

            {results && results.length === 0 && (
              <div className="mt-6 rounded-lg border border-dashed border-card-border p-6 text-center">
                <p className="text-sm text-muted-foreground">
                  No events found for that email. If you used a different email, try that instead.
                </p>
                <Link
                  href="/"
                  className="mt-3 inline-block text-sm font-medium text-primary underline-offset-2 hover:underline"
                >
                  Start a new event
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        <p className="mt-6 text-center text-xs text-muted-foreground">
          Lost your dashboard link? Just enter your email above and we'll find your event.
        </p>
      </main>
    </div>
  );
}

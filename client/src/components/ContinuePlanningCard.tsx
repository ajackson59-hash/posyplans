import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequestJson } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getRecentEvents, forgetRecentEvent } from "@/lib/eventRecovery";
import type { EventRecord } from "@/lib/types";
import { CalendarDays, X } from "lucide-react";

// Homepage affordance for returning hosts: if this browser has recently
// started events (tracked in localStorage via eventRecovery), offer a quick
// way straight back into each dashboard. Reads storage once on mount and
// hydrates each token from the API. Only confirmed missing events are
// forgotten; temporary failures must not erase the host's way back in.
export default function ContinuePlanning() {
  // Guard the initial read: getRecentEvents already swallows storage errors,
  // but keeping it in lazy state means we touch storage exactly once.
  const [tokens, setTokens] = useState<string[]>(() =>
    getRecentEvents()
      .slice(0, 3)
      .map((e) => e.token),
  );

  const queryClient = useQueryClient();

  const removeToken = (token: string) => {
    forgetRecentEvent(token);
    setTokens((prev) => prev.filter((t) => t !== token));
    queryClient.invalidateQueries({ queryKey: ["/api/events/owner", token] });
  };

  if (tokens.length === 0) return null;

  return (
    <section
      className="mx-auto max-w-6xl px-6 pt-10"
      data-testid="section-continue-planning"
    >
      <Card className="border-card-border shadow-sm">
        <CardContent className="p-5 sm:p-6">
          <p className="text-sm font-semibold uppercase tracking-wide text-primary">
            Find my event
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Pick up where you left off.
          </p>
          <div className="mt-4 space-y-2">
            {tokens.map((token) => (
              <EventRow
                key={token}
                token={token}
                onInvalid={removeToken}
                onForget={removeToken}
              />
            ))}
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            Don't see your event?{" "}
            <Link
              href="/intake"
              className="font-medium text-primary underline-offset-2 hover:underline"
              data-testid="link-continue-start-new"
            >
              Start a new one
            </Link>
          </p>
        </CardContent>
      </Card>
    </section>
  );
}

function EventRow({
  token,
  onInvalid,
  onForget,
}: {
  token: string;
  onInvalid: (token: string) => void;
  onForget: (token: string) => void;
}) {
  const { data, isError, error, refetch, isFetching } = useQuery({
    queryKey: ["/api/events/owner", token],
    queryFn: () =>
      apiRequestJson<{ event: EventRecord }>(
        "GET",
        `/api/events/owner/${token}`,
      ),
    retry: false,
  });

  const isMissing = isError && error instanceof Error
    && "status" in error && error.status === 404;

  // An offline browser, expired session, or temporary server failure does not
  // establish that an event is gone. Retain its private link for recovery.
  useEffect(() => {
    if (isMissing) onInvalid(token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMissing]);

  if (isMissing) return null;

  if (isError || (isFetching && !data?.event)) {
    return (
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3">
        <p role="status" className="min-w-0 flex-1 text-sm text-muted-foreground">
          {isFetching ? "Loading your saved event…" : "We couldn't load your saved event. Your link is still saved."}
        </p>
        {isError && (
          <Button size="sm" disabled={isFetching} onClick={() => void refetch()}>
            {isFetching ? "Trying again…" : "Try again"}
          </Button>
        )}
      </div>
    );
  }

  if (!data?.event) return null;

  const event = event2Label(data.event);

  return (
    <div className="flex items-center gap-3 rounded-lg border border-border p-3">
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium text-foreground">{event.title}</p>
        {event.date && (
          <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
            <CalendarDays className="h-3 w-3" /> {event.date}
          </p>
        )}
      </div>
      <Button asChild size="sm" data-testid={`button-continue-${token}`}>
        <Link href={`/dashboard/${token}`}>Continue</Link>
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 flex-none text-muted-foreground"
        title="Forget this event"
        data-testid={`button-forget-${token}`}
        onClick={() => onForget(token)}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}

function event2Label(event: EventRecord): { title: string; date: string } {
  const type = (event.eventType || "").trim();
  let title: string;
  if (event.hostNames?.trim()) {
    title = type
      ? `${event.hostNames.trim()}'s ${type.toLowerCase()}`
      : event.hostNames.trim();
  } else {
    title = event.eventName?.trim() || type || "Your event";
  }
  return { title, date: event.eventDate?.trim() || "" };
}

import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, RefreshCw } from "lucide-react";
import type { PlanContent, PlanRegenerationResponse } from "@shared/planRegeneration";
import { apiRequestJson } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

type PlanAction = "apply" | "discard";

const STAGE_LABELS: Record<string, string> = {
  identity: "Shaping your event plan",
  event_identity: "Shaping your event plan",
  budget: "Planning your budget",
  menu: "Planning your menu",
  shopping: "Preparing your shopping list",
  timeline: "Planning your timeline",
};

function money(value: number | null | undefined) {
  return (value ?? 0).toLocaleString("en-US", {
    style: "currency", currency: "USD", maximumFractionDigits: 0,
  });
}

function CandidatePlan({ plan }: { plan: PlanContent }) {
  return (
    <div className="space-y-3" data-testid="regeneration-candidate">
      {plan.eventIdentity ? <p className="whitespace-pre-wrap text-sm">{plan.eventIdentity}</p> : null}
      <details className="rounded-lg border p-3" open>
        <summary className="cursor-pointer font-medium">Budget · {plan.budgetItems.length} items</summary>
        {plan.budgetItems.length ? (
          <ul className="mt-3 divide-y text-sm">
            {plan.budgetItems.map((item, index) => (
              <li key={index} className="py-2">
                <div className="flex justify-between gap-4"><span>{item.name}</span><span className="shrink-0">{money(item.estimatedCost)}</span></div>
                <p className="text-xs text-muted-foreground">{[item.category, item.vendor].filter(Boolean).join(" · ")}</p>
                {item.notes ? <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{item.notes}</p> : null}
              </li>
            ))}
          </ul>
        ) : <p className="mt-2 text-sm text-muted-foreground">No budget items in this version.</p>}
      </details>
      <details className="rounded-lg border p-3">
        <summary className="cursor-pointer font-medium">Menu · {plan.menuItems.length} items</summary>
        {plan.menuItems.length ? (
          <ul className="mt-3 divide-y text-sm">
            {plan.menuItems.map((item, index) => (
              <li key={index} className="py-2">
                <div className="flex justify-between gap-4"><span>{item.itemName}</span><span className="shrink-0">{money(item.costEstimate)}</span></div>
                <p className="text-xs text-muted-foreground">{[item.course, item.source, item.servesCount != null ? `Serves ${item.servesCount}` : null, item.dietaryTags].filter(Boolean).join(" · ")}</p>
                {item.notes ? <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{item.notes}</p> : null}
              </li>
            ))}
          </ul>
        ) : <p className="mt-2 text-sm text-muted-foreground">No menu items in this version.</p>}
      </details>
      <details className="rounded-lg border p-3">
        <summary className="cursor-pointer font-medium">Shopping list · {plan.shoppingItems.length} items</summary>
        {plan.shoppingItems.length ? (
          <ul className="mt-3 divide-y text-sm">
            {plan.shoppingItems.map((item, index) => (
              <li key={index} className="py-2">
                <div className="flex justify-between gap-4"><span>{item.itemName}{item.quantity ? ` · ${item.quantity}` : ""}</span><span className="shrink-0">{money(item.estimatedCost)}</span></div>
                <p className="text-xs text-muted-foreground">{[item.category, item.source].filter(Boolean).join(" · ")}</p>
                {item.notes ? <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{item.notes}</p> : null}
              </li>
            ))}
          </ul>
        ) : <p className="mt-2 text-sm text-muted-foreground">No shopping items in this version.</p>}
      </details>
      <details className="rounded-lg border p-3">
        <summary className="cursor-pointer font-medium">Timeline · {plan.timelineItems.length} steps</summary>
        {plan.timelineItems.length ? (
          <ol className="mt-3 divide-y text-sm">
            {plan.timelineItems.map((item, index) => (
              <li key={index} className="py-2">
                <p>{item.time ? `${item.time} · ` : ""}{item.title}</p>
                <p className="text-xs text-muted-foreground">{[item.category, item.assignedTo].filter(Boolean).join(" · ")}</p>
                {item.notes ? <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{item.notes}</p> : null}
              </li>
            ))}
          </ol>
        ) : <p className="mt-2 text-sm text-muted-foreground">No timeline steps in this version.</p>}
      </details>
    </div>
  );
}

/** Mounted only once the event has an existing ready plan. Reads never start generation. */
export default function PlanRegenerationPanel({ ownerToken }: { ownerToken: string }) {
  const queryClient = useQueryClient();
  const eventPath = `/api/events/owner/${ownerToken}`;
  const path = `${eventPath}/plan-regeneration`;
  const queryKey = [path];
  // Keep the same key for an explicitly retried request whose response was lost.
  const pendingRequestId = useRef<string | null>(null);
  const status = useQuery<PlanRegenerationResponse>({
    queryKey,
    queryFn: () => apiRequestJson<PlanRegenerationResponse>("GET", path),
    enabled: Boolean(ownerToken),
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchInterval: (query) => query.state.data?.operation?.state === "running" ? 3000 : false,
  });

  function acceptResponse(response: PlanRegenerationResponse) {
    queryClient.setQueryData(queryKey, response);
  }

  const start = useMutation({
    mutationFn: async (requestId: string) => {
      await queryClient.cancelQueries({ queryKey });
      return apiRequestJson<PlanRegenerationResponse>("POST", path, { requestId });
    },
    retry: false,
    onSuccess: (response) => { pendingRequestId.current = null; acceptResponse(response); },
    // A lost response may still have started the operation. First recover its saved state.
    onError: () => { void status.refetch(); },
  });
  const action = useMutation({
    mutationFn: async ({ id, action: nextAction }: { id: string; action: PlanAction }) => {
      await queryClient.cancelQueries({ queryKey });
      return apiRequestJson<PlanRegenerationResponse>("POST", `${path}/${id}/${nextAction}`, {});
    },
    retry: false,
    onSuccess: (response) => { pendingRequestId.current = null; start.reset(); acceptResponse(response); },
    onError: () => { void status.refetch(); },
  });

  const operation = status.data?.operation;
  const busy = start.isPending || action.isPending;
  const canStart = !status.isError && status.data?.eligible && (!operation || operation.state === "applied" || operation.state === "discarded");
  const canApply = Boolean(operation?.state === "ready" && operation.candidate && operation.canApply && !operation.baseChanged);
  const actionConfirmed = (action.variables?.action === "apply" && operation?.state === "applied") ||
    (action.variables?.action === "discard" && operation?.state === "discarded");
  const mutationError = (!actionConfirmed ? action.error : null) || (canStart ? start.error : null);

  // Also refresh after a lost apply response or a change made in another tab.
  useEffect(() => {
    if (operation?.state !== "applied") return;
    void queryClient.invalidateQueries({
      predicate: (query) => {
        const first = query.queryKey[0];
        return typeof first === "string" && first !== path && (
          first === eventPath || first.startsWith(`${eventPath}/`) ||
          (first === "/api/events/owner" && query.queryKey[1] === ownerToken)
        );
      },
    });
  }, [operation?.id, operation?.state, queryClient, path, eventPath, ownerToken]);

  if (!status.data && !status.isError) return null;
  if (status.data && !status.data.eligible && !operation) return null;

  return (
    <Card data-testid="plan-regeneration-panel">
      <CardHeader className="pb-3">
        <h2 className="font-serif text-lg font-semibold">A fresh plan with Plus</h2>
        <p className="text-sm text-muted-foreground">
          Create a new version from your saved event details, then review it before replacing your current plan.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {status.isError ? (
          <div role="alert" className="space-y-2 text-sm">
            <p>We couldn’t check your new plan. Your current plan is still available.</p>
            <Button variant="outline" size="sm" disabled={status.isFetching} onClick={() => void status.refetch()}>Check status</Button>
          </div>
        ) : null}

        {operation?.state === "running" ? (
          <div role="status" className="space-y-2 text-sm">
            <p className="flex items-center gap-2 font-medium"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />{STAGE_LABELS[operation.stage ?? ""] ?? "Creating your new plan"}…</p>
            <p className="text-muted-foreground">Your current plan stays available. You can leave this page and return to check progress.</p>
          </div>
        ) : null}

        {operation?.state === "ready" ? (
          <section aria-label="Review new plan" className="space-y-4">
            <p className="font-medium">Your new plan is ready to review</p>
            <p className="text-sm text-muted-foreground">Using it replaces your event summary, budget, menu, shopping list and timeline, including edits in those sections. Your previous plan will be saved. Your invitation, artwork and guest list stay as they are.</p>
            {operation.candidate ? <CandidatePlan plan={operation.candidate} /> : <p role="alert" className="text-sm">We couldn’t load the new plan. Check its status before continuing.</p>}
            {operation.baseChanged ? (
              <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">Your event details or plan changed after this version started. Keep those edits by discarding this version, then regenerate from your latest saved details.</p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button disabled={!canApply || busy} data-testid="button-use-regenerated-plan">Use this plan</Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Replace your current plan?</AlertDialogTitle>
                    <AlertDialogDescription>This replaces your event summary, budget, menu, shopping list and timeline, including your edits in those sections. Your previous version will be saved. Your invitation, artwork and guest list stay as they are.</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep reviewing</AlertDialogCancel>
                    <AlertDialogAction disabled={!canApply || busy} onClick={() => action.mutate({ id: operation.id, action: "apply" })}>Replace plan</AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <Button variant="outline" disabled={busy} onClick={() => action.mutate({ id: operation.id, action: "discard" })}>Discard this version</Button>
            </div>
          </section>
        ) : null}

        {operation?.state === "failed" ? (
          <div className="space-y-3">
            <p role="alert" className="text-sm">We couldn’t finish this version. Your current plan and edits are still in place.</p>
            <Button variant="outline" disabled={busy} onClick={() => action.mutate({ id: operation.id, action: "discard" })}>Dismiss this version</Button>
            <p className="text-xs text-muted-foreground">After dismissing it, you can choose to create another version.</p>
          </div>
        ) : null}

        {operation?.state === "applied" ? <p role="status" className="text-sm">Your new plan is in use.{operation.previousAvailable ? " Your previous plan is saved." : ""}</p> : null}
        {operation?.state === "discarded" ? <p role="status" className="text-sm">This version was discarded. Your current plan is still in place.</p> : null}

        {mutationError ? <p role="alert" className="text-sm text-destructive">{mutationError.message}</p> : null}
        {canStart ? (
          <Button
            variant="outline"
            className="gap-2"
            disabled={busy || status.isFetching}
            onClick={() => {
              action.reset();
              pendingRequestId.current ??= crypto.randomUUID();
              start.mutate(pendingRequestId.current);
            }}
          >
            <RefreshCw className={`h-4 w-4${start.isPending ? " animate-spin" : ""}`} aria-hidden="true" />
            {start.isPending ? "Starting…" : start.isError && pendingRequestId.current ? "Retry request" : "Regenerate plan"}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

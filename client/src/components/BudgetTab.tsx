import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, apiRequestJson } from "@/lib/queryClient";
import type { BudgetItemRecord, BudgetSuggestion, EventRecord } from "@/lib/types";
import { BUDGET_CATEGORIES } from "@/lib/types";
import { getBenchmarkForCategory, formatBenchmarkRange, type BudgetFeasibilityResult } from "@shared/budgetFeasibility";
import { groupByNoticeLevel, NOTICE_LEVEL_LABELS, type NoticeLevel } from "@shared/budgetPriorities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { useToast } from "@/hooks/use-toast";
import AiDraftedBadge from "@/components/AiDraftedBadge";
import { PlusCircle, Sparkles, Trash2, Wallet, Gauge, Scale } from "lucide-react";

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

const emptyDraft = { category: BUDGET_CATEGORIES[0], name: "", estimatedCost: "", vendor: "" };

export default function BudgetTab({
  ownerToken,
  event,
  confirmedHeadcount,
  invitedHeadcount,
}: {
  ownerToken: string;
  event: EventRecord;
  confirmedHeadcount: number;
  invitedHeadcount: number;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const queryKey = [`/api/events/owner/${ownerToken}/budget-items`];
  const { data: items, isLoading } = useQuery<BudgetItemRecord[]>({ queryKey });
  const { data: feasibility } = useQuery<BudgetFeasibilityResult>({
    queryKey: [`/api/events/owner/${ownerToken}/budget-feasibility`],
    staleTime: 30000,
  });

  const [draft, setDraft] = useState(emptyDraft);
  const [budgetDraft, setBudgetDraft] = useState(event.budgetTotal?.toString() ?? "");
  const [editingBudget, setEditingBudget] = useState(false);

  // AI budget starter: uses confirmed RSVPs if any exist yet, otherwise falls
  // back to invited headcount, so early planners (no RSVPs yet) still get
  // sensibly-scaled suggestions instead of a guess based on zero guests.
  const headcountForAi = confirmedHeadcount > 0 ? confirmedHeadcount : invitedHeadcount;
  const [suggestion, setSuggestion] = useState<BudgetSuggestion | null>(null);
  const [excludedSuggestions, setExcludedSuggestions] = useState<Set<number>>(new Set());

  const getBudgetSuggestions = useMutation({
    mutationFn: async () =>
      apiRequestJson<BudgetSuggestion>("POST", `/api/events/owner/${ownerToken}/budget/generate-suggestions`, {
        headcount: headcountForAi,
      }),
    onSuccess: (result) => {
      setSuggestion(result);
      setExcludedSuggestions(new Set());
      toast({ title: "Budget starter ready", description: `${result.items.length} suggested line items.` });
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't generate budget ideas", description: err.message, variant: "destructive" });
    },
  });

  const addSelectedSuggestions = useMutation({
    mutationFn: async (selected: BudgetSuggestion["items"]) => {
      await apiRequest("POST", `/api/events/owner/${ownerToken}/budget-items/bulk`, {
        items: selected.map((idea) => ({
          category: idea.category,
          name: idea.name,
          estimatedCost: idea.estimatedCost,
          vendor: "",
        })),
      });
    },
    onSuccess: (_, selected) => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: `${selected.length} budget item${selected.length === 1 ? "" : "s"} added` });
      setSuggestion(null);
    },
  });

  const addItem = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/events/owner/${ownerToken}/budget-items`, {
        category: draft.category,
        name: draft.name,
        estimatedCost: Math.max(0, Math.round(Number(draft.estimatedCost) || 0)),
        vendor: draft.vendor,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setDraft(emptyDraft);
      toast({ title: "Budget item added" });
    },
  });

  const updateItem = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<BudgetItemRecord> }) => {
      await apiRequest("PATCH", `/api/events/owner/${ownerToken}/budget-items/${id}`, data);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const deleteItem = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/events/owner/${ownerToken}/budget-items/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: "Budget item removed" });
    },
  });

  const saveBudgetTotal = useMutation({
    mutationFn: async () => {
      const value = budgetDraft.trim() === "" ? null : Math.max(0, Math.round(Number(budgetDraft) || 0));
      await apiRequest("PATCH", `/api/events/owner/${ownerToken}`, { budgetTotal: value });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/events/owner/${ownerToken}`] });
      setEditingBudget(false);
      toast({ title: "Budget updated" });
    },
  });

  const totals = useMemo(() => {
    const list = items ?? [];
    const estimated = list.reduce((sum, i) => sum + i.estimatedCost, 0);
    const spent = list.reduce((sum, i) => sum + (i.actualCost ?? i.depositPaid), 0);
    const deposits = list.reduce((sum, i) => sum + i.depositPaid, 0);
    const perGuest = confirmedHeadcount > 0 ? estimated / confirmedHeadcount : 0;
    return { estimated, spent, deposits, perGuest };
  }, [items, confirmedHeadcount]);

  const budgetTotal = event.budgetTotal;
  const pctUsed = budgetTotal ? Math.min(100, Math.round((totals.estimated / budgetTotal) * 100)) : null;
  const draftBenchmark = getBenchmarkForCategory(draft.category);
  const benchmarkedCategories = (feasibility?.categories ?? []).filter((c) => c.benchmark && c.status !== "not-benchmarked");
  const reallocationSuggestions = (feasibility?.flags ?? []).filter((f) => f.id.startsWith("budget-reallocation-"));
  const priorityGroups = useMemo(() => groupByNoticeLevel(), []);
  const noticeLevelOrder: NoticeLevel[] = ["high", "medium", "low"];
  const noticeLevelColumnClasses: Record<NoticeLevel, string> = {
    high: "border-accent/40 bg-accent/5",
    medium: "border-border bg-muted/30",
    low: "border-secondary/30 bg-secondary/5",
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AiDraftedBadge ownerToken={ownerToken} />
      <Card className="border-card-border">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 font-serif text-lg">
            <Wallet className="h-4 w-4" /> Budget overview
          </CardTitle>
          {!editingBudget && (
            <Button
              variant="outline"
              size="sm"
              data-testid="button-edit-budget-total"
              onClick={() => {
                setBudgetDraft(event.budgetTotal?.toString() ?? "");
                setEditingBudget(true);
              }}
            >
              {budgetTotal ? "Edit total budget" : "Set a total budget"}
            </Button>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {editingBudget ? (
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <Label htmlFor="budgetTotal" className="text-xs">Total budget ($)</Label>
                <Input
                  id="budgetTotal"
                  data-testid="input-budget-total"
                  type="number"
                  min={0}
                  placeholder="e.g. 2500"
                  value={budgetDraft}
                  onChange={(e) => setBudgetDraft(e.target.value)}
                  className="w-40"
                />
              </div>
              <Button size="sm" onClick={() => saveBudgetTotal.mutate()} data-testid="button-save-budget-total">
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setEditingBudget(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Metric label="Total budget" value={budgetTotal != null ? money(budgetTotal) : "Not set"} />
                <Metric label="Planned so far" value={money(totals.estimated)} />
                <Metric label="Paid / deposited" value={money(totals.spent)} />
                <Metric
                  label="Cost per confirmed guest"
                  value={confirmedHeadcount > 0 ? money(totals.perGuest) : "—"}
                />
              </div>
              {budgetTotal != null && (
                <div>
                  <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                    <span>{pctUsed}% of budget planned</span>
                    <span>{money(Math.max(0, budgetTotal - totals.estimated))} remaining</span>
                  </div>
                  <Progress value={pctUsed ?? 0} data-testid="progress-budget-used" />
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {benchmarkedCategories.length > 0 && (
        <Card className="border-card-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-serif text-lg">
              <Gauge className="h-4 w-4" /> Typical spend check
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              A rough guide for what similar-sized events typically spend per category — not a rule, just a sanity check.
            </p>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {benchmarkedCategories.map((c) => {
                const statusLabel = c.status === "over" ? "above typical" : c.status === "under" ? "below typical" : "typical";
                const statusClasses =
                  c.status === "over"
                    ? "border-destructive/30 bg-destructive/5 text-destructive"
                    : c.status === "under"
                      ? "border-accent/40 bg-accent/10 text-accent-foreground"
                      : "border-border bg-muted/40 text-muted-foreground";
                return (
                  <div
                    key={c.category}
                    className={`rounded-md border px-3 py-1.5 text-xs ${statusClasses}`}
                    data-testid={`chip-budget-feasibility-${c.category}`}
                  >
                    <span className="font-medium">{c.category}</span>: {money(c.allocated)} · {statusLabel}
                    {c.benchmark && <span className="opacity-80"> ({formatBenchmarkRange(c.benchmark)})</span>}
                  </div>
                );
              })}
            </div>
            {reallocationSuggestions.length > 0 && (
              <div className="mt-3 space-y-2 border-t border-border pt-3">
                {reallocationSuggestions.map((s) => (
                  <p key={s.id} className="text-xs text-muted-foreground" data-testid={`text-reallocation-${s.id}`}>
                    <span className="font-medium text-foreground">Suggestion:</span> {s.detail}
                  </p>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="border-card-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-serif text-lg">
            <Scale className="h-4 w-4" /> Splurge or save?
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            General planning wisdom on which categories guests tend to notice most — use it alongside the typical spend
            check above when deciding where to add or trim.
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-3">
            {noticeLevelOrder.map((level) => (
              <div
                key={level}
                className={`rounded-md border p-3 ${noticeLevelColumnClasses[level]}`}
                data-testid={`column-priority-${level}`}
              >
                <p className="mb-2 text-xs font-medium text-foreground">{NOTICE_LEVEL_LABELS[level]}</p>
                <ul className="space-y-2">
                  {priorityGroups[level].map((p) => (
                    <li key={p.category} className="text-xs text-muted-foreground" data-testid={`text-priority-${p.category}`}>
                      <span className="font-medium text-foreground">{p.category}:</span> {p.guidance}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="border-card-border">
        <CardHeader className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 font-serif text-lg">
              <Sparkles className="h-4 w-4" /> AI budget starter
            </CardTitle>
            <p className="mt-1 text-xs text-muted-foreground">
              Not sure what food or décor should cost? Get a headcount-scaled starting breakdown, then pick what to add.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="w-full sm:w-auto"
            data-testid="button-generate-budget-suggestions"
            disabled={getBudgetSuggestions.isPending}
            onClick={() => getBudgetSuggestions.mutate()}
          >
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            {getBudgetSuggestions.isPending ? "Thinking…" : suggestion ? "Regenerate" : "Get budget suggestions"}
          </Button>
        </CardHeader>
        {suggestion && (
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground" data-testid="text-budget-suggestion-tip">{suggestion.tip}</p>
            <div className="divide-y divide-border rounded-md border border-border">
              {suggestion.items.map((idea, i) => {
                const checked = !excludedSuggestions.has(i);
                return (
                  <label
                    key={i}
                    className="flex cursor-pointer items-center gap-3 px-3 py-2.5 text-sm"
                    data-testid={`row-budget-suggestion-${i}`}
                  >
                    <Checkbox
                      checked={checked}
                      data-testid={`checkbox-budget-suggestion-${i}`}
                      onCheckedChange={(v) =>
                        setExcludedSuggestions((prev) => {
                          const next = new Set(prev);
                          if (v) next.delete(i);
                          else next.add(i);
                          return next;
                        })
                      }
                    />
                    <span className="flex-1">
                      <span className="font-medium text-foreground">{idea.name}</span>
                      <span className="ml-2 text-xs text-muted-foreground">{idea.category}</span>
                    </span>
                    <span className="font-serif text-foreground">{money(idea.estimatedCost)}</span>
                  </label>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Suggested total: {money(suggestion.suggestedTotal)} for {headcountForAi > 0 ? `${headcountForAi} guests` : "a typical gathering"}. You can edit or delete any item after adding it.
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  data-testid="button-dismiss-budget-suggestions"
                  onClick={() => setSuggestion(null)}
                >
                  Dismiss
                </Button>
                <Button
                  size="sm"
                  disabled={addSelectedSuggestions.isPending || suggestion.items.length === excludedSuggestions.size}
                  data-testid="button-add-budget-suggestions"
                  onClick={() =>
                    addSelectedSuggestions.mutate(suggestion.items.filter((_, i) => !excludedSuggestions.has(i)))
                  }
                >
                  <PlusCircle className="mr-1.5 h-3.5 w-3.5" />
                  {addSelectedSuggestions.isPending
                    ? "Adding…"
                    : `Add ${suggestion.items.length - excludedSuggestions.size} selected to budget`}
                </Button>
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      <Card className="border-card-border">
        <CardHeader>
          <CardTitle className="font-serif text-lg">Budget items</CardTitle>
          <p className="text-sm text-muted-foreground">
            Every dollar in one place — no spreadsheet, no separate app, and nothing to reconcile later.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-6">
            <div className="sm:col-span-2">
              <Label className="text-xs">Item</Label>
              <Input
                data-testid="input-budget-item-name"
                placeholder="e.g. Caterer deposit"
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
              />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs">Category</Label>
              <Select value={draft.category} onValueChange={(v) => setDraft((d) => ({ ...d, category: v }))}>
                <SelectTrigger data-testid="select-budget-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BUDGET_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {draftBenchmark && (
                <p className="mt-1 text-xs text-muted-foreground" data-testid="text-category-benchmark-hint">
                  Typical: {formatBenchmarkRange(draftBenchmark)}
                </p>
              )}
            </div>
            <div>
              <Label className="text-xs">Estimated ($)</Label>
              <Input
                data-testid="input-budget-item-cost"
                type="number"
                min={0}
                placeholder="0"
                value={draft.estimatedCost}
                onChange={(e) => setDraft((d) => ({ ...d, estimatedCost: e.target.value }))}
              />
            </div>
            <div>
              <Label className="text-xs">Vendor</Label>
              <Input
                data-testid="input-budget-item-vendor"
                placeholder="optional"
                value={draft.vendor}
                onChange={(e) => setDraft((d) => ({ ...d, vendor: e.target.value }))}
              />
            </div>
            <div className="sm:col-span-6">
              <Button
                size="sm"
                disabled={!draft.name.trim() || addItem.isPending}
                onClick={() => addItem.mutate()}
                data-testid="button-add-budget-item"
              >
                <PlusCircle className="mr-1.5 h-3.5 w-3.5" />
                {addItem.isPending ? "Adding…" : "Add budget item"}
              </Button>
            </div>
          </div>

          {(items ?? []).length === 0 ? (
            <div className="rounded-md border border-dashed border-border py-10 text-center text-sm text-muted-foreground" data-testid="text-empty-budget">
              No budget items yet — track your first cost above (venue deposit, caterer, decorations…).
            </div>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Item</th>
                    <th className="px-3 py-2">Category</th>
                    <th className="px-3 py-2">Estimated ($, editable)</th>
                    <th className="px-3 py-2">Paid / deposit</th>
                    <th className="px-3 py-2">Paid in full</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(items ?? []).map((item) => (
                    <tr key={item.id} data-testid={`row-budget-item-${item.id}`}>
                      <td className="px-3 py-2.5 font-medium text-foreground">
                        {item.name}
                        {item.vendor && <div className="text-xs text-muted-foreground">{item.vendor}</div>}
                      </td>
                      <td className="px-3 py-2.5 text-muted-foreground">{item.category}</td>
                      <td className="px-3 py-2.5">
                        <Input
                          type="number"
                          min={0}
                          className="h-8 w-24"
                          defaultValue={item.estimatedCost}
                          data-testid={`input-budget-estimated-${item.id}`}
                          onBlur={(e) => {
                            const value = Math.max(0, Math.round(Number(e.target.value) || 0));
                            if (value !== item.estimatedCost) updateItem.mutate({ id: item.id, data: { estimatedCost: value } });
                          }}
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <Input
                          type="number"
                          min={0}
                          className="h-8 w-24"
                          defaultValue={item.depositPaid}
                          data-testid={`input-budget-deposit-${item.id}`}
                          onBlur={(e) => {
                            const value = Math.max(0, Math.round(Number(e.target.value) || 0));
                            if (value !== item.depositPaid) updateItem.mutate({ id: item.id, data: { depositPaid: value } });
                          }}
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <Checkbox
                          checked={item.isPaidInFull}
                          data-testid={`checkbox-paid-full-${item.id}`}
                          onCheckedChange={(checked) =>
                            updateItem.mutate({
                              id: item.id,
                              data: {
                                isPaidInFull: Boolean(checked),
                                actualCost: checked ? item.actualCost ?? item.estimatedCost : item.actualCost,
                              },
                            })
                          }
                        />
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-destructive"
                              data-testid={`button-delete-budget-item-${item.id}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Remove {item.name}?</AlertDialogTitle>
                              <AlertDialogDescription>This can't be undone.</AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction onClick={() => deleteItem.mutate(item.id)}>Remove</AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-serif text-xl font-semibold text-foreground" data-testid={`stat-budget-${label.toLowerCase().replace(/\s+/g, "-")}`}>
        {value}
      </p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

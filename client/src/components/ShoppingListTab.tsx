import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { ShoppingListItemRecord } from "@/lib/types";
import { SHOPPING_CATEGORIES, PROCUREMENT_STATUSES, SUGGESTED_SHOPPING_ITEMS } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
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
import { ClipboardList, PackageCheck, Plus, PlusCircle, Sparkles, Trash2, Palette } from "lucide-react";

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

const emptyDraft = {
  category: SHOPPING_CATEGORIES[0],
  itemName: "",
  quantity: "1",
  status: "need" as "need" | "have" | "borrowing",
  estimatedCost: "",
  source: "",
};

const STATUS_COLOR: Record<string, string> = {
  need: "bg-destructive/10 text-destructive",
  have: "bg-secondary text-secondary-foreground",
  borrowing: "bg-accent text-accent-foreground",
};

export default function ShoppingListTab({
  ownerToken,
  onNavigateToTab,
}: {
  ownerToken: string;
  onNavigateToTab?: (tab: string) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const queryKey = [`/api/events/owner/${ownerToken}/shopping-items`];
  const { data: items, isLoading } = useQuery<ShoppingListItemRecord[]>({ queryKey });

  const [draft, setDraft] = useState(emptyDraft);

  const addItem = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/events/owner/${ownerToken}/shopping-items`, {
        category: draft.category,
        itemName: draft.itemName,
        quantity: draft.quantity || "1",
        status: draft.status,
        estimatedCost: Math.max(0, Math.round(Number(draft.estimatedCost) || 0)),
        source: draft.source,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setDraft((d) => ({ ...emptyDraft, category: d.category }));
      toast({ title: "Item added" });
    },
  });

  const addSuggested = useMutation({
    mutationFn: async (payload: { category: string; itemName: string }[]) => {
      await apiRequest("POST", `/api/events/owner/${ownerToken}/shopping-items/bulk`, {
        items: payload.map((p) => ({
          category: p.category,
          itemName: p.itemName,
          quantity: "1",
          status: "need",
          estimatedCost: 0,
          source: "",
        })),
      });
    },
    onSuccess: (_, payload) => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: payload.length > 1 ? `${payload.length} items added` : "Item added" });
    },
  });

  const updateItem = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<ShoppingListItemRecord> }) => {
      await apiRequest("PATCH", `/api/events/owner/${ownerToken}/shopping-items/${id}`, data);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const deleteItem = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/events/owner/${ownerToken}/shopping-items/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: "Item removed" });
    },
  });

  const list = items ?? [];
  const existingNames = useMemo(
    () => new Set(list.map((i) => `${i.category}::${i.itemName.toLowerCase()}`)),
    [list]
  );

  const grouped = useMemo(() => {
    const map = new Map<string, ShoppingListItemRecord[]>();
    for (const cat of SHOPPING_CATEGORIES) map.set(cat, []);
    for (const item of list) {
      if (!map.has(item.category)) map.set(item.category, []);
      map.get(item.category)!.push(item);
    }
    return Array.from(map.entries()).filter(([, items]) => items.length > 0);
  }, [list]);

  const summary = useMemo(() => {
    const need = list.filter((i) => i.status === "need");
    const have = list.filter((i) => i.status === "have");
    const borrowing = list.filter((i) => i.status === "borrowing");
    const packed = list.filter((i) => i.isPacked);
    const needCost = need.reduce((sum, i) => sum + i.estimatedCost, 0);
    return { need: need.length, have: have.length, borrowing: borrowing.length, needCost, packed: packed.length, total: list.length };
  }, [list]);

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
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-serif text-lg">
            <ClipboardList className="h-4 w-4" /> Shopping &amp; packing list
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Everything you still need to buy, borrow, or pack — tracked in one list so nothing gets forgotten at the last minute.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {summary.total > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Metric label="Still need to get" value={String(summary.need)} />
              <Metric label="Already have" value={String(summary.have)} />
              <Metric label="Borrowing" value={String(summary.borrowing)} />
              <Metric label="Est. cost to buy" value={money(summary.needCost)} />
              <Metric label="Packed for the day" value={`${summary.packed} / ${summary.total}`} />
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-6">
            <div className="sm:col-span-2">
              <Label className="text-xs">Item</Label>
              <Input
                data-testid="input-shopping-item-name"
                placeholder="e.g. Welcome sign"
                value={draft.itemName}
                onChange={(e) => setDraft((d) => ({ ...d, itemName: e.target.value }))}
              />
            </div>
            <div>
              <Label className="text-xs">Category</Label>
              <Select value={draft.category} onValueChange={(v) => setDraft((d) => ({ ...d, category: v }))}>
                <SelectTrigger data-testid="select-shopping-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SHOPPING_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Status</Label>
              <Select value={draft.status} onValueChange={(v) => setDraft((d) => ({ ...d, status: v as typeof d.status }))}>
                <SelectTrigger data-testid="select-shopping-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROCUREMENT_STATUSES.map((s) => (
                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Qty</Label>
              <Input
                data-testid="input-shopping-item-qty"
                placeholder="1"
                value={draft.quantity}
                onChange={(e) => setDraft((d) => ({ ...d, quantity: e.target.value }))}
              />
            </div>
            <div>
              <Label className="text-xs">Est. cost ($)</Label>
              <Input
                data-testid="input-shopping-item-cost"
                type="number"
                min={0}
                placeholder="0"
                value={draft.estimatedCost}
                onChange={(e) => setDraft((d) => ({ ...d, estimatedCost: e.target.value }))}
              />
            </div>
            <div className="sm:col-span-5">
              <Label className="text-xs">Source / where from</Label>
              <Input
                data-testid="input-shopping-item-source"
                placeholder="e.g. Target, Amazon, borrowing from Mom, Party rental co."
                value={draft.source}
                onChange={(e) => setDraft((d) => ({ ...d, source: e.target.value }))}
              />
            </div>
            <div className="sm:col-span-6">
              <Button
                size="sm"
                disabled={!draft.itemName.trim() || addItem.isPending}
                onClick={() => addItem.mutate()}
                data-testid="button-add-shopping-item"
              >
                <PlusCircle className="mr-1.5 h-3.5 w-3.5" />
                {addItem.isPending ? "Adding…" : "Add item"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-card-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-serif text-lg">
            <Sparkles className="h-4 w-4" /> Commonly forgotten items
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            A starter checklist so you're not staring at a blank page — one click adds an item to your list as something you still need to get.
          </p>
        </CardHeader>
        <CardContent>
          <Accordion type="multiple" className="w-full">
            {SHOPPING_CATEGORIES.map((cat) => {
              const suggestions = SUGGESTED_SHOPPING_ITEMS[cat] ?? [];
              const remaining = suggestions.filter((s) => !existingNames.has(`${cat}::${s.toLowerCase()}`));
              return (
                <AccordionItem key={cat} value={cat} data-testid={`accordion-suggested-${cat}`}>
                  <AccordionTrigger className="text-sm">
                    {cat}
                    <span className="ml-2 text-xs text-muted-foreground">
                      {remaining.length === 0 ? "all added" : `${remaining.length} suggestion${remaining.length === 1 ? "" : "s"}`}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent>
                    {remaining.length === 0 ? (
                      <p className="text-sm text-muted-foreground">You've added every suggestion for this category.</p>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex flex-wrap gap-2">
                          {remaining.map((name) => (
                            <Button
                              key={name}
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              data-testid={`button-add-suggested-${cat}-${name}`}
                              disabled={addSuggested.isPending}
                              onClick={() => addSuggested.mutate([{ category: cat, itemName: name }])}
                            >
                              <Plus className="mr-1 h-3 w-3" /> {name}
                            </Button>
                          ))}
                        </div>
                        <Button
                          size="sm"
                          variant="secondary"
                          className="h-7 text-xs"
                          data-testid={`button-add-all-suggested-${cat}`}
                          disabled={addSuggested.isPending}
                          onClick={() => addSuggested.mutate(remaining.map((name) => ({ category: cat, itemName: name })))}
                        >
                          Add all {remaining.length} to my list
                        </Button>
                      </div>
                    )}
                  </AccordionContent>
                </AccordionItem>
              );
            })}
          </Accordion>
        </CardContent>
      </Card>

      <Card className="border-card-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-serif text-lg">
            <PackageCheck className="h-4 w-4" /> Your list
          </CardTitle>
        </CardHeader>
        <CardContent>
          {list.length === 0 ? (
            <div className="rounded-md border border-dashed border-border py-10 text-center text-sm text-muted-foreground" data-testid="text-empty-shopping-list">
              <p>Nothing on your list yet — add an item above or grab a few from the suggestions.</p>
              {onNavigateToTab && (
                <button
                  type="button"
                  onClick={() => onNavigateToTab("theme")}
                  data-testid="link-empty-shopping-goto-theme"
                  className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  <Palette className="h-3 w-3" /> Or get theme-matched shopping ideas from the Theme tab
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-5">
              {grouped.map(([category, categoryItems]) => (
                <div key={category}>
                  <h3 className="mb-2 text-sm font-semibold text-foreground">{category}</h3>
                  <div className="overflow-x-auto rounded-md border border-border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2">Item</th>
                          <th className="px-3 py-2">Qty</th>
                          <th className="px-3 py-2">Status</th>
                          <th className="px-3 py-2">Source</th>
                          <th className="px-3 py-2">Est. cost</th>
                          <th className="px-3 py-2">Packed</th>
                          <th className="px-3 py-2 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {categoryItems.map((item) => (
                          <tr key={item.id} data-testid={`row-shopping-item-${item.id}`}>
                            <td className="px-3 py-2.5 font-medium text-foreground">{item.itemName}</td>
                            <td className="px-3 py-2.5">
                              <Input
                                className="h-8 w-16"
                                defaultValue={item.quantity}
                                data-testid={`input-shopping-qty-${item.id}`}
                                onBlur={(e) => {
                                  if (e.target.value !== item.quantity) updateItem.mutate({ id: item.id, data: { quantity: e.target.value || "1" } });
                                }}
                              />
                            </td>
                            <td className="px-3 py-2.5">
                              <Select
                                value={item.status}
                                onValueChange={(v) => updateItem.mutate({ id: item.id, data: { status: v as "need" | "have" | "borrowing" } })}
                              >
                                <SelectTrigger className="h-8 w-32" data-testid={`select-shopping-item-status-${item.id}`}>
                                  <SelectValue>
                                    <Badge className={`${STATUS_COLOR[item.status]} border-0 font-normal`}>
                                      {PROCUREMENT_STATUSES.find((s) => s.value === item.status)?.label ?? item.status}
                                    </Badge>
                                  </SelectValue>
                                </SelectTrigger>
                                <SelectContent>
                                  {PROCUREMENT_STATUSES.map((s) => (
                                    <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </td>
                            <td className="px-3 py-2.5">
                              <Input
                                className="h-8 w-36"
                                defaultValue={item.source}
                                placeholder="—"
                                data-testid={`input-shopping-source-${item.id}`}
                                onBlur={(e) => {
                                  if (e.target.value !== item.source) updateItem.mutate({ id: item.id, data: { source: e.target.value } });
                                }}
                              />
                            </td>
                            <td className="px-3 py-2.5">
                              <Input
                                type="number"
                                min={0}
                                className="h-8 w-20"
                                defaultValue={item.estimatedCost}
                                data-testid={`input-shopping-cost-${item.id}`}
                                onBlur={(e) => {
                                  const value = Math.max(0, Math.round(Number(e.target.value) || 0));
                                  if (value !== item.estimatedCost) updateItem.mutate({ id: item.id, data: { estimatedCost: value } });
                                }}
                              />
                            </td>
                            <td className="px-3 py-2.5">
                              <Checkbox
                                checked={item.isPacked}
                                data-testid={`checkbox-packed-${item.id}`}
                                onCheckedChange={(checked) => updateItem.mutate({ id: item.id, data: { isPacked: Boolean(checked) } })}
                              />
                            </td>
                            <td className="px-3 py-2.5 text-right">
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-8 w-8 text-destructive"
                                    data-testid={`button-delete-shopping-item-${item.id}`}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Remove {item.itemName}?</AlertDialogTitle>
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
                </div>
              ))}
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
      <p className="font-serif text-xl font-semibold text-foreground" data-testid={`stat-shopping-${label.toLowerCase().replace(/\s+/g, "-")}`}>
        {value}
      </p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { MenuItemRecord } from "@/lib/types";
import { MENU_COURSES, MENU_SOURCES } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
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
import { ChefHat, PlusCircle, Trash2, Palette } from "lucide-react";

function money(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

const emptyDraft = {
  course: MENU_COURSES[1],
  itemName: "",
  source: MENU_SOURCES[2],
  costEstimate: "",
  dietaryTags: "",
};

const SOURCE_COLOR: Record<string, string> = {
  Caterer: "bg-secondary text-secondary-foreground",
  "Store-bought": "bg-accent text-accent-foreground",
  Homemade: "bg-primary/10 text-primary",
};

export default function MenuTab({
  ownerToken,
  onNavigateToTab,
}: {
  ownerToken: string;
  onNavigateToTab?: (tab: string) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const queryKey = [`/api/events/owner/${ownerToken}/menu-items`];
  const { data: items, isLoading } = useQuery<MenuItemRecord[]>({ queryKey });

  const [draft, setDraft] = useState(emptyDraft);

  const addItem = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", `/api/events/owner/${ownerToken}/menu-items`, {
        course: draft.course,
        itemName: draft.itemName,
        source: draft.source,
        costEstimate: Math.max(0, Math.round(Number(draft.costEstimate) || 0)),
        dietaryTags: draft.dietaryTags,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setDraft(emptyDraft);
      toast({ title: "Menu item added" });
    },
  });

  const deleteItem = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/events/owner/${ownerToken}/menu-items/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: "Menu item removed" });
    },
  });

  const grouped = useMemo(() => {
    const list = items ?? [];
    const map = new Map<string, MenuItemRecord[]>();
    for (const course of MENU_COURSES) map.set(course, []);
    for (const item of list) {
      if (!map.has(item.course)) map.set(item.course, []);
      map.get(item.course)!.push(item);
    }
    return Array.from(map.entries()).filter(([, list]) => list.length > 0);
  }, [items]);

  const totalCost = (items ?? []).reduce((sum, i) => sum + i.costEstimate, 0);

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
            <ChefHat className="h-4 w-4" /> Menu planner
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Plan the food once — courses, costs, and dietary notes all live in one place instead of scattered across texts and sticky notes.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-6">
            <div className="sm:col-span-2">
              <Label className="text-xs">Item</Label>
              <Input
                data-testid="input-menu-item-name"
                placeholder="e.g. Grilled ribeyes"
                value={draft.itemName}
                onChange={(e) => setDraft((d) => ({ ...d, itemName: e.target.value }))}
              />
            </div>
            <div>
              <Label className="text-xs">Course</Label>
              <Select value={draft.course} onValueChange={(v) => setDraft((d) => ({ ...d, course: v }))}>
                <SelectTrigger data-testid="select-menu-course">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MENU_COURSES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Source</Label>
              <Select value={draft.source} onValueChange={(v) => setDraft((d) => ({ ...d, source: v }))}>
                <SelectTrigger data-testid="select-menu-source">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MENU_SOURCES.map((s) => (
                    <SelectItem key={s} value={s}>{s}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Est. cost ($)</Label>
              <Input
                data-testid="input-menu-item-cost"
                type="number"
                min={0}
                placeholder="0"
                value={draft.costEstimate}
                onChange={(e) => setDraft((d) => ({ ...d, costEstimate: e.target.value }))}
              />
            </div>
            <div>
              <Label className="text-xs">Dietary notes</Label>
              <Input
                data-testid="input-menu-item-dietary"
                placeholder="e.g. GF, vegan option"
                value={draft.dietaryTags}
                onChange={(e) => setDraft((d) => ({ ...d, dietaryTags: e.target.value }))}
              />
            </div>
            <div className="sm:col-span-6">
              <Button
                size="sm"
                disabled={!draft.itemName.trim() || addItem.isPending}
                onClick={() => addItem.mutate()}
                data-testid="button-add-menu-item"
              >
                <PlusCircle className="mr-1.5 h-3.5 w-3.5" />
                {addItem.isPending ? "Adding…" : "Add menu item"}
              </Button>
              {(items ?? []).length > 0 && (
                <span className="ml-3 text-sm text-muted-foreground">
                  Estimated food &amp; drink total: <span className="font-medium text-foreground">{money(totalCost)}</span>
                </span>
              )}
            </div>
          </div>

          {(items ?? []).length === 0 ? (
            <div className="rounded-md border border-dashed border-border py-10 text-center text-sm text-muted-foreground" data-testid="text-empty-menu">
              <p>No menu items yet — add your first course above, whether it's catered, homemade, or store-bought.</p>
              {onNavigateToTab && (
                <button
                  type="button"
                  onClick={() => onNavigateToTab("theme")}
                  data-testid="link-empty-menu-goto-theme"
                  className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  <Palette className="h-3 w-3" /> Or get theme-matched menu ideas from the Theme tab
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-5">
              {grouped.map(([course, courseItems]) => (
                <div key={course}>
                  <h3 className="mb-2 text-sm font-semibold text-foreground">{course}</h3>
                  <div className="overflow-x-auto rounded-md border border-border">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                        <tr>
                          <th className="px-3 py-2">Item</th>
                          <th className="px-3 py-2">Source</th>
                          <th className="px-3 py-2">Dietary</th>
                          <th className="px-3 py-2">Est. cost</th>
                          <th className="px-3 py-2 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {courseItems.map((item) => (
                          <tr key={item.id} data-testid={`row-menu-item-${item.id}`}>
                            <td className="px-3 py-2.5 font-medium text-foreground">{item.itemName}</td>
                            <td className="px-3 py-2.5">
                              <Badge className={`${SOURCE_COLOR[item.source] ?? "bg-muted text-muted-foreground"} border-0 font-normal`}>
                                {item.source}
                              </Badge>
                            </td>
                            <td className="px-3 py-2.5 text-muted-foreground">{item.dietaryTags || "—"}</td>
                            <td className="px-3 py-2.5 text-muted-foreground">{money(item.costEstimate)}</td>
                            <td className="px-3 py-2.5 text-right">
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-8 w-8 text-destructive"
                                    data-testid={`button-delete-menu-item-${item.id}`}
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

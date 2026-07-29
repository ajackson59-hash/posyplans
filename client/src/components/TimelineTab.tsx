import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { TimelineItemRecord } from "@/lib/types";
import { TIMELINE_CATEGORIES, SUGGESTED_TIMELINE_TEMPLATES } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
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
import { CalendarClock, ListChecks, Plus, Sparkles, Trash2, Palette } from "lucide-react";

const emptyDraft = {
  time: "",
  title: "",
  category: TIMELINE_CATEGORIES[0],
  assignedTo: "",
  notes: "",
};

const CATEGORY_COLOR: Record<string, string> = {
  Setup: "bg-secondary text-secondary-foreground",
  Arrival: "bg-accent text-accent-foreground",
  Activities: "bg-primary/10 text-primary",
  "Food & Toasts": "bg-chart-2/20 text-foreground",
  "Special Moments": "bg-chart-4/20 text-foreground",
  "Wind Down": "bg-muted text-muted-foreground",
  Cleanup: "bg-destructive/10 text-destructive",
};

export default function TimelineTab({
  ownerToken,
  eventType,
  onNavigateToTab,
}: {
  ownerToken: string;
  eventType: string;
  onNavigateToTab?: (tab: string) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const queryKey = [`/api/events/owner/${ownerToken}/timeline-items`];
  const { data: items, isLoading } = useQuery<TimelineItemRecord[]>({ queryKey });

  const [draft, setDraft] = useState(emptyDraft);

  const addItem = useMutation({
    mutationFn: async () => {
      const list = items ?? [];
      await apiRequest("POST", `/api/events/owner/${ownerToken}/timeline-items`, {
        time: draft.time,
        title: draft.title,
        category: draft.category,
        assignedTo: draft.assignedTo,
        notes: draft.notes,
        isDone: false,
        sortOrder: list.length,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      setDraft((d) => ({ ...emptyDraft, category: d.category }));
      toast({ title: "Timeline item added" });
    },
  });

  const addTemplate = useMutation({
    mutationFn: async (template: { time: string; title: string; category: string }[]) => {
      const list = items ?? [];
      await apiRequest("POST", `/api/events/owner/${ownerToken}/timeline-items/bulk`, {
        items: template.map((t, i) => ({
          time: t.time,
          title: t.title,
          category: t.category,
          assignedTo: "",
          notes: "",
          isDone: false,
          sortOrder: list.length + i,
        })),
      });
    },
    onSuccess: (_, template) => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: `${template.length} timeline items added` });
    },
  });

  const updateItem = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<TimelineItemRecord> }) => {
      await apiRequest("PATCH", `/api/events/owner/${ownerToken}/timeline-items/${id}`, data);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
  });

  const deleteItem = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/events/owner/${ownerToken}/timeline-items/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      toast({ title: "Timeline item removed" });
    },
  });

  const list = useMemo(() => {
    return [...(items ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  }, [items]);

  const template = SUGGESTED_TIMELINE_TEMPLATES[eventType] ?? SUGGESTED_TIMELINE_TEMPLATES["Other Celebration"];
  const doneCount = list.filter((i) => i.isDone).length;

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
            <CalendarClock className="h-4 w-4" /> Event-day timeline
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Your run-of-show for the day itself — so you can check things off and actually be present at your own event.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {list.length > 0 && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Metric label="Total items" value={String(list.length)} />
              <Metric label="Checked off" value={`${doneCount} / ${list.length}`} />
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-6">
            <div>
              <Label className="text-xs">Time</Label>
              <Input
                data-testid="input-timeline-time"
                placeholder="e.g. 2:00 PM"
                value={draft.time}
                onChange={(e) => setDraft((d) => ({ ...d, time: e.target.value }))}
              />
            </div>
            <div className="sm:col-span-2">
              <Label className="text-xs">What happens</Label>
              <Input
                data-testid="input-timeline-title"
                placeholder="e.g. Cake & candles"
                value={draft.title}
                onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              />
            </div>
            <div>
              <Label className="text-xs">Category</Label>
              <Select value={draft.category} onValueChange={(v) => setDraft((d) => ({ ...d, category: v }))}>
                <SelectTrigger data-testid="select-timeline-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMELINE_CATEGORIES.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Assigned to</Label>
              <Input
                data-testid="input-timeline-assigned"
                placeholder="e.g. Host, DJ"
                value={draft.assignedTo}
                onChange={(e) => setDraft((d) => ({ ...d, assignedTo: e.target.value }))}
              />
            </div>
            <div>
              <Label className="text-xs">Notes</Label>
              <Input
                data-testid="input-timeline-notes"
                placeholder="Optional"
                value={draft.notes}
                onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
              />
            </div>
            <div className="sm:col-span-6">
              <Button
                size="sm"
                disabled={!draft.title.trim() || addItem.isPending}
                onClick={() => addItem.mutate()}
                data-testid="button-add-timeline-item"
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                {addItem.isPending ? "Adding…" : "Add to timeline"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-card-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-serif text-lg">
            <Sparkles className="h-4 w-4" /> Quick-start schedule for a {eventType || "celebration"}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            A suggested run-of-show for this event type — add it all at once, then adjust the times and details to fit your day.
          </p>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {template.map((t, i) => (
                <Badge key={i} variant="outline" className="gap-1.5 py-1.5 font-normal" data-testid={`badge-template-item-${i}`}>
                  <span className="text-muted-foreground">{t.time}</span> {t.title}
                </Badge>
              ))}
            </div>
            <Button
              size="sm"
              variant="secondary"
              disabled={addTemplate.isPending}
              onClick={() => addTemplate.mutate(template)}
              data-testid="button-add-all-template"
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add all {template.length} to my timeline
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card className="border-card-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-serif text-lg">
            <ListChecks className="h-4 w-4" /> Your schedule
          </CardTitle>
        </CardHeader>
        <CardContent>
          {list.length === 0 ? (
            <div className="rounded-md border border-dashed border-border py-10 text-center text-sm text-muted-foreground" data-testid="text-empty-timeline">
              <p>Nothing scheduled yet — add an item above or grab the quick-start schedule.</p>
              {onNavigateToTab && (
                <button
                  type="button"
                  onClick={() => onNavigateToTab("theme")}
                  data-testid="link-empty-timeline-goto-theme"
                  className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                >
                  <Palette className="h-3 w-3" /> Or get theme-matched timeline ideas from the Theme tab
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Done</th>
                    <th className="px-3 py-2">Time</th>
                    <th className="px-3 py-2">What happens</th>
                    <th className="px-3 py-2">Category</th>
                    <th className="px-3 py-2">Assigned to</th>
                    <th className="px-3 py-2">Notes</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {list.map((item) => (
                    <tr key={item.id} data-testid={`row-timeline-item-${item.id}`} className={item.isDone ? "bg-muted/30" : undefined}>
                      <td className="px-3 py-2.5">
                        <Checkbox
                          checked={item.isDone}
                          data-testid={`checkbox-timeline-done-${item.id}`}
                          onCheckedChange={(checked) => updateItem.mutate({ id: item.id, data: { isDone: Boolean(checked) } })}
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <Input
                          className="h-8 w-28"
                          defaultValue={item.time}
                          placeholder="—"
                          data-testid={`input-timeline-time-${item.id}`}
                          onBlur={(e) => {
                            if (e.target.value !== item.time) updateItem.mutate({ id: item.id, data: { time: e.target.value } });
                          }}
                        />
                      </td>
                      <td className={`px-3 py-2.5 font-medium text-foreground ${item.isDone ? "line-through text-muted-foreground" : ""}`}>
                        <Input
                          className="h-8 min-w-40 border-transparent bg-transparent font-medium shadow-none focus-visible:border-input focus-visible:bg-background"
                          defaultValue={item.title}
                          data-testid={`input-timeline-title-${item.id}`}
                          onBlur={(e) => {
                            if (e.target.value !== item.title && e.target.value.trim()) updateItem.mutate({ id: item.id, data: { title: e.target.value } });
                          }}
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <Select
                          value={item.category}
                          onValueChange={(v) => updateItem.mutate({ id: item.id, data: { category: v } })}
                        >
                          <SelectTrigger className="h-8 w-36" data-testid={`select-timeline-item-category-${item.id}`}>
                            <SelectValue>
                              <Badge className={`${CATEGORY_COLOR[item.category] ?? "bg-muted text-muted-foreground"} border-0 font-normal`}>
                                {item.category}
                              </Badge>
                            </SelectValue>
                          </SelectTrigger>
                          <SelectContent>
                            {TIMELINE_CATEGORIES.map((c) => (
                              <SelectItem key={c} value={c}>{c}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-3 py-2.5">
                        <Input
                          className="h-8 w-32"
                          defaultValue={item.assignedTo}
                          placeholder="—"
                          data-testid={`input-timeline-assigned-${item.id}`}
                          onBlur={(e) => {
                            if (e.target.value !== item.assignedTo) updateItem.mutate({ id: item.id, data: { assignedTo: e.target.value } });
                          }}
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <Input
                          className="h-8 w-40"
                          defaultValue={item.notes}
                          placeholder="—"
                          data-testid={`input-timeline-notes-${item.id}`}
                          onBlur={(e) => {
                            if (e.target.value !== item.notes) updateItem.mutate({ id: item.id, data: { notes: e.target.value } });
                          }}
                        />
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8 text-destructive"
                              data-testid={`button-delete-timeline-item-${item.id}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Remove {item.title}?</AlertDialogTitle>
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
      <p className="font-serif text-xl font-semibold text-foreground" data-testid={`stat-timeline-${label.toLowerCase().replace(/\s+/g, "-")}`}>
        {value}
      </p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

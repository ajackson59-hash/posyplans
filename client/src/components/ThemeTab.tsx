import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, apiRequestJson } from "@/lib/queryClient";
import type { EventRecord, ThemeSuggestion } from "@/lib/types";
import { POPULAR_THEME_PICKS } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { ToastAction } from "@/components/ui/toast";
import AiDraftedBadge from "@/components/AiDraftedBadge";
import PaletteEditor from "@/components/PaletteEditor";
import {
  Palette,
  Sparkles,
  ChefHat,
  ClipboardList,
  CalendarClock,
  Wallet,
  ExternalLink,
  Plus,
  Wand2,
  ArrowRight,
} from "lucide-react";

function parsePalette(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.filter((c) => typeof c === "string") : [];
  } catch {
    return [];
  }
}

export default function ThemeTab({
  ownerToken,
  event,
  onNavigateToTab,
}: {
  ownerToken: string;
  event: EventRecord;
  onNavigateToTab?: (tab: string) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const eventQueryKey = [`/api/events/owner/${ownerToken}`];

  const [themeDraft, setThemeDraft] = useState(event.themeName || "");
  const [suggestion, setSuggestion] = useState<ThemeSuggestion | null>(null);
  const [addedMenu, setAddedMenu] = useState<Set<number>>(new Set());
  const [addedShopping, setAddedShopping] = useState<Set<number>>(new Set());
  const [addedTimeline, setAddedTimeline] = useState<Set<number>>(new Set());

  const currentPalette = parsePalette(event.paletteColors);

  const saveTheme = useMutation({
    mutationFn: async (theme: string) => {
      await apiRequest("PATCH", `/api/events/owner/${ownerToken}`, { themeName: theme });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: eventQueryKey });
    },
  });

  const getSuggestions = useMutation({
    mutationFn: async (theme: string) =>
      apiRequestJson<ThemeSuggestion>("POST", `/api/events/owner/${ownerToken}/theme-suggestions`, { theme }),
    onSuccess: (result) => {
      setSuggestion(result);
      setAddedMenu(new Set());
      setAddedShopping(new Set());
      setAddedTimeline(new Set());
      if (result.error) {
        toast({ title: "Couldn't generate custom ideas", description: result.error, variant: "destructive" });
      } else {
        toast({
          title: result.source === "curated" ? "Ideas ready" : "Ideas generated",
          description: `Theme ideas for ${result.theme}.`,
        });
      }
    },
    onError: () => {
      toast({ title: "I couldn't come up with ideas just now", variant: "destructive" });
    },
  });

  const usePalette = useMutation({
    mutationFn: async (colors: string[]) => {
      // Update the event's overall palette
      await apiRequest("PATCH", `/api/events/owner/${ownerToken}`, { paletteColors: JSON.stringify(colors) });
      // If an invite concept is applied, sync its palette AND envelope suite
      // so the invite design matches the new theme instead of keeping stale colors.
      const hasConcept = event.inviteDesignConceptJson && event.inviteDesignConceptJson.trim() !== "{}" && event.inviteDesignConceptJson.trim() !== "";
      if (hasConcept) {
        try {
          await apiRequestJson("PATCH", `/api/events/owner/${ownerToken}/invite/concept-palette`, { paletteColors: colors });
        } catch {
          // If the concept palette sync fails, don't block the event palette update
        }
        try {
          // Sync envelope color to the first palette color so it matches the new theme
          await apiRequestJson("PATCH", `/api/events/owner/${ownerToken}/invite/suite`, {
            envelopeColor: colors[0],
            linerColor: colors[0],
            stampColor: colors[1] || colors[0],
          });
        } catch {
          // Suite sync is best-effort — don't block the palette update
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: eventQueryKey });
      toast({ title: "Palette applied to your event" });
    },
  });

  const addMenuItem = useMutation({
    mutationFn: async (idea: { course: string; itemName: string; notes?: string }) => {
      await apiRequest("POST", `/api/events/owner/${ownerToken}/menu-items`, {
        course: idea.course,
        itemName: idea.itemName,
        source: "",
        servesCount: null,
        costEstimate: 0,
        dietaryTags: "",
        notes: idea.notes || "",
        sortOrder: 0,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/events/owner/${ownerToken}/menu-items`] });
    },
  });

  const addAllMenu = useMutation({
    mutationFn: async (ideas: { course: string; itemName: string; notes?: string }[]) => {
      await apiRequest("POST", `/api/events/owner/${ownerToken}/menu-items/bulk`, {
        items: ideas.map((idea) => ({
          course: idea.course,
          itemName: idea.itemName,
          source: "",
          servesCount: null,
          costEstimate: 0,
          dietaryTags: "",
          notes: idea.notes || "",
          sortOrder: 0,
        })),
      });
    },
    onSuccess: (_, ideas) => {
      queryClient.invalidateQueries({ queryKey: [`/api/events/owner/${ownerToken}/menu-items`] });
      setAddedMenu(new Set(ideas.map((_, i) => i)));
      toast({
        title: `${ideas.length} menu ideas added`,
        action: onNavigateToTab ? (
          <ToastAction altText="Go to Menu" onClick={() => onNavigateToTab("menu")}>
            View Menu
          </ToastAction>
        ) : undefined,
      });
    },
  });

  const addShoppingItem = useMutation({
    mutationFn: async (idea: { category: string; itemName: string }) => {
      await apiRequest("POST", `/api/events/owner/${ownerToken}/shopping-items`, {
        category: idea.category,
        itemName: idea.itemName,
        quantity: "",
        status: "need",
        estimatedCost: 0,
        source: "",
        notes: "",
        isPacked: false,
        sortOrder: 0,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/events/owner/${ownerToken}/shopping-items`] });
    },
  });

  const addAllShopping = useMutation({
    mutationFn: async (ideas: { category: string; itemName: string }[]) => {
      await apiRequest("POST", `/api/events/owner/${ownerToken}/shopping-items/bulk`, {
        items: ideas.map((idea) => ({
          category: idea.category,
          itemName: idea.itemName,
          quantity: "",
          status: "need",
          estimatedCost: 0,
          source: "",
          notes: "",
          isPacked: false,
          sortOrder: 0,
        })),
      });
    },
    onSuccess: (_, ideas) => {
      queryClient.invalidateQueries({ queryKey: [`/api/events/owner/${ownerToken}/shopping-items`] });
      setAddedShopping(new Set(ideas.map((_, i) => i)));
      toast({
        title: `${ideas.length} shopping/décor ideas added`,
        action: onNavigateToTab ? (
          <ToastAction altText="Go to Shopping List" onClick={() => onNavigateToTab("shopping")}>
            View List
          </ToastAction>
        ) : undefined,
      });
    },
  });

  const addTimelineItem = useMutation({
    mutationFn: async (idea: { time: string; title: string }) => {
      await apiRequest("POST", `/api/events/owner/${ownerToken}/timeline-items`, {
        time: idea.time,
        title: idea.title,
        category: "Special Moments",
        assignedTo: "",
        notes: "",
        isDone: false,
        sortOrder: 0,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/events/owner/${ownerToken}/timeline-items`] });
    },
  });

  const addAllTimeline = useMutation({
    mutationFn: async (ideas: { time: string; title: string }[]) => {
      await apiRequest("POST", `/api/events/owner/${ownerToken}/timeline-items/bulk`, {
        items: ideas.map((idea) => ({
          time: idea.time,
          title: idea.title,
          category: "Special Moments",
          assignedTo: "",
          notes: "",
          isDone: false,
          sortOrder: 0,
        })),
      });
    },
    onSuccess: (_, ideas) => {
      queryClient.invalidateQueries({ queryKey: [`/api/events/owner/${ownerToken}/timeline-items`] });
      setAddedTimeline(new Set(ideas.map((_, i) => i)));
      toast({
        title: `${ideas.length} timeline moments added`,
        action: onNavigateToTab ? (
          <ToastAction altText="Go to Timeline" onClick={() => onNavigateToTab("timeline")}>
            View Timeline
          </ToastAction>
        ) : undefined,
      });
    },
  });

  const hasIdeas = suggestion && (suggestion.menuIdeas.length > 0 || suggestion.shoppingIdeas.length > 0 || suggestion.timelineIdeas.length > 0);

  const sourceBadge = useMemo(() => {
    if (!suggestion) return null;
    if (suggestion.source === "curated") {
      return <Badge className="gap-1 border-0 bg-secondary text-secondary-foreground font-normal">Curated for this theme</Badge>;
    }
    if (suggestion.source === "ai") {
      return <Badge className="gap-1 border-0 bg-accent text-accent-foreground font-normal">AI-generated — double-check details</Badge>;
    }
    return null;
  }, [suggestion]);

  function fetchFor(theme: string) {
    if (!theme.trim()) {
      toast({
        title: "What's the theme?",
        description: "Type a theme above (or pick a popular one below) and I'll take it from there.",
      });
      return;
    }
    setThemeDraft(theme);
    if (theme !== event.themeName) saveTheme.mutate(theme);
    getSuggestions.mutate(theme);
  }

  return (
    <div className="space-y-6">
      <AiDraftedBadge ownerToken={ownerToken} />
      <Card className="border-card-border">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-serif text-lg">
            <Palette className="h-4 w-4" /> Party theme
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Set a theme once and get a matching color palette plus ready-to-add menu, décor, and timeline ideas —
            so a golf-themed first birthday (or anything else) gets a real head start instead of a blank page.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              className="flex-1"
              data-testid="input-theme-name"
              placeholder="e.g. Golf / Hole in One, Under the Sea, or your own idea"
              value={themeDraft}
              onChange={(e) => setThemeDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") fetchFor(themeDraft);
              }}
            />
            <Button
              data-testid="button-get-theme-ideas"
              disabled={getSuggestions.isPending}
              onClick={() => fetchFor(themeDraft)}
            >
              <Wand2 className="mr-1.5 h-3.5 w-3.5" />
              {getSuggestions.isPending ? "Thinking…" : "Get theme ideas"}
            </Button>
          </div>

          <div>
            <Label className="text-xs text-muted-foreground">Popular picks</Label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {POPULAR_THEME_PICKS.map((theme) => (
                <button
                  key={theme}
                  type="button"
                  data-testid={`button-theme-pick-${theme.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
                  onClick={() => fetchFor(theme)}
                  className="rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-primary hover:text-primary"
                >
                  {theme}
                </button>
              ))}
            </div>
          </div>

          {currentPalette.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
              <span className="text-xs text-muted-foreground">Current palette:</span>
              <PaletteEditor
                colors={currentPalette}
                size="sm"
                testIdPrefix="swatch-current-palette"
                onChange={(i, color) => {
                  const next = [...currentPalette];
                  next[i] = color;
                  usePalette.mutate(next);
                }}
              />
              <span className="text-[11px] text-muted-foreground">Click a color to change it</span>
            </div>
          )}
        </CardContent>
      </Card>

      {getSuggestions.isPending && (
        <div className="rounded-md border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          Coming up with ideas…
        </div>
      )}

      {suggestion && !getSuggestions.isPending && (
        <>
          <Card className="border-card-border">
            <CardHeader className="flex flex-row items-center justify-between flex-wrap gap-2">
              <CardTitle className="flex items-center gap-2 font-serif text-lg">
                <Sparkles className="h-4 w-4" /> Ideas for {suggestion.theme}
              </CardTitle>
              {sourceBadge}
            </CardHeader>
            <CardContent className="space-y-5">
              {suggestion.paletteColors.length > 0 && (
                <div>
                  <p className="mb-2 text-sm font-medium text-foreground">Suggested palette</p>
                  <div className="flex flex-wrap items-center gap-3">
                    <PaletteEditor
                      colors={suggestion.paletteColors}
                      testIdPrefix="swatch-suggested-palette"
                      onChange={(i, color) => {
                        setSuggestion((prev) => {
                          if (!prev) return prev;
                          const next = [...prev.paletteColors];
                          next[i] = color;
                          return { ...prev, paletteColors: next };
                        });
                      }}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      data-testid="button-use-palette"
                      disabled={usePalette.isPending}
                      onClick={() => usePalette.mutate(suggestion.paletteColors)}
                    >
                      Use this palette
                    </Button>
                  </div>
                  <p className="mt-1.5 text-[11px] text-muted-foreground">Click any color above to adjust it before applying</p>
                  {event.inviteDesignConceptJson && event.inviteDesignConceptJson.trim() !== "{}" && event.inviteDesignConceptJson.trim() !== "" && (
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      Your invite design will update to match. To pick a new design direction,
                      <button
                        type="button"
                        className="ml-1 font-medium text-primary underline underline-offset-1 hover:text-primary/80"
                        onClick={() => onNavigateToTab?.("invite")}
                      >
                        browse invite concepts →
                      </button>
                    </p>
                  )}
                </div>
              )}

              {suggestion.budgetTip && (
                <div className="flex items-start gap-2 rounded-md border border-border bg-muted/50 p-3">
                  <Wallet className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <p className="text-sm text-foreground" data-testid="text-budget-tip">
                    {suggestion.budgetTip}
                  </p>
                </div>
              )}

              {!hasIdeas && (
                <p className="text-sm text-muted-foreground" data-testid="text-no-automated-ideas">
                  We don't have specific ideas ready for this one yet — use the search link below for inspiration.
                </p>
              )}

              <a
                href={suggestion.resourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                data-testid="link-theme-resource"
              >
                More inspiration for {suggestion.theme} <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </CardContent>
          </Card>

          {suggestion.menuIdeas.length > 0 && (
            <Card className="border-card-border">
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2 font-serif text-lg">
                  <ChefHat className="h-4 w-4" /> Menu ideas
                </CardTitle>
                <div className="flex items-center gap-2">
                  {onNavigateToTab && (
                    <button
                      type="button"
                      onClick={() => onNavigateToTab("menu")}
                      data-testid="link-goto-menu-tab"
                      className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                    >
                      Go to Menu tab <ArrowRight className="h-3 w-3" />
                    </button>
                  )}
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={addAllMenu.isPending}
                    onClick={() => addAllMenu.mutate(suggestion.menuIdeas)}
                    data-testid="button-add-all-menu-ideas"
                  >
                    <Plus className="mr-1.5 h-3.5 w-3.5" /> Add all to menu
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {suggestion.menuIdeas.map((idea, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between gap-3 rounded-md border border-border p-2.5"
                      data-testid={`row-menu-idea-${i}`}
                    >
                      <div>
                        <p className="text-sm font-medium text-foreground">{idea.itemName}</p>
                        <p className="text-xs text-muted-foreground">
                          {idea.course}
                          {idea.notes ? ` · ${idea.notes}` : ""}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={addMenuItem.isPending || addedMenu.has(i)}
                        onClick={() => {
                          addMenuItem.mutate(idea);
                          setAddedMenu((prev) => new Set(prev).add(i));
                        }}
                        data-testid={`button-add-menu-idea-${i}`}
                      >
                        {addedMenu.has(i) ? "Added" : <><Plus className="mr-1 h-3.5 w-3.5" /> Add</>}
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {suggestion.shoppingIdeas.length > 0 && (
            <Card className="border-card-border">
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2 font-serif text-lg">
                  <ClipboardList className="h-4 w-4" /> Décor &amp; shopping ideas
                </CardTitle>
                <div className="flex items-center gap-2">
                  {onNavigateToTab && (
                    <button
                      type="button"
                      onClick={() => onNavigateToTab("shopping")}
                      data-testid="link-goto-shopping-tab"
                      className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                    >
                      Go to Shopping List tab <ArrowRight className="h-3 w-3" />
                    </button>
                  )}
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={addAllShopping.isPending}
                    onClick={() => addAllShopping.mutate(suggestion.shoppingIdeas)}
                    data-testid="button-add-all-shopping-ideas"
                  >
                    <Plus className="mr-1.5 h-3.5 w-3.5" /> Add all to shopping list
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {suggestion.shoppingIdeas.map((idea, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between gap-3 rounded-md border border-border p-2.5"
                      data-testid={`row-shopping-idea-${i}`}
                    >
                      <div>
                        <p className="text-sm font-medium text-foreground">{idea.itemName}</p>
                        <p className="text-xs text-muted-foreground">{idea.category}</p>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={addShoppingItem.isPending || addedShopping.has(i)}
                        onClick={() => {
                          addShoppingItem.mutate(idea);
                          setAddedShopping((prev) => new Set(prev).add(i));
                        }}
                        data-testid={`button-add-shopping-idea-${i}`}
                      >
                        {addedShopping.has(i) ? "Added" : <><Plus className="mr-1 h-3.5 w-3.5" /> Add</>}
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {suggestion.timelineIdeas.length > 0 && (
            <Card className="border-card-border">
              <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
                <CardTitle className="flex items-center gap-2 font-serif text-lg">
                  <CalendarClock className="h-4 w-4" /> Timeline moments
                </CardTitle>
                <div className="flex items-center gap-2">
                  {onNavigateToTab && (
                    <button
                      type="button"
                      onClick={() => onNavigateToTab("timeline")}
                      data-testid="link-goto-timeline-tab"
                      className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                    >
                      Go to Timeline tab <ArrowRight className="h-3 w-3" />
                    </button>
                  )}
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={addAllTimeline.isPending}
                    onClick={() => addAllTimeline.mutate(suggestion.timelineIdeas)}
                    data-testid="button-add-all-timeline-ideas"
                  >
                    <Plus className="mr-1.5 h-3.5 w-3.5" /> Add all to timeline
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {suggestion.timelineIdeas.map((idea, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between gap-3 rounded-md border border-border p-2.5"
                      data-testid={`row-timeline-idea-${i}`}
                    >
                      <div>
                        <p className="text-sm font-medium text-foreground">{idea.title}</p>
                        <p className="text-xs text-muted-foreground">{idea.time}</p>
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={addTimelineItem.isPending || addedTimeline.has(i)}
                        onClick={() => {
                          addTimelineItem.mutate(idea);
                          setAddedTimeline((prev) => new Set(prev).add(i));
                        }}
                        data-testid={`button-add-timeline-idea-${i}`}
                      >
                        {addedTimeline.has(i) ? "Added" : <><Plus className="mr-1 h-3.5 w-3.5" /> Add</>}
                      </Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {!suggestion && !getSuggestions.isPending && (
        <div className="rounded-md border border-dashed border-border py-10 text-center text-sm text-muted-foreground" data-testid="text-empty-theme">
          Type a theme above (or pick a popular one) to get a matching palette and ready-to-add ideas.
        </div>
      )}
    </div>
  );
}

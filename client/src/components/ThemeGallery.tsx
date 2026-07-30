/**
 * ThemeGallery — first-class theme selection step.
 *
 * Shows a grid of curated, professionally designed themes. Selecting a theme
 * is INSTANT — no AI generation, no waiting. The theme applies immediately
 * and the user proceeds to customize details on top.
 *
 * AI concept generation is available as a secondary "Describe a custom theme"
 * path for users who want something the library doesn't cover.
 */

import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequestJson, queryClient } from "@/lib/queryClient";
import { CURATED_THEMES, type CuratedTheme, type ThemeCategory } from "@shared/themeLibrary";
import { themeToEventPatch } from "@shared/themeLibrary";
import type { EventRecord } from "@/lib/types";
import ThemeInviteCard from "./ThemeInviteCard";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Check, Sparkles, Wand2, X } from "lucide-react";

interface ThemeGalleryProps {
  ownerToken: string;
  event: EventRecord;
  /** Called when the user wants to use the AI custom theme path */
  onCustomTheme: () => void;
  /** Called when a theme is successfully applied */
  onThemeApplied?: () => void;
}

const CATEGORIES: { id: ThemeCategory | "all"; label: string }[] = [
  { id: "all", label: "All Themes" },
  { id: "elegant", label: "Elegant" },
  { id: "bold", label: "Bold & Vibrant" },
  { id: "playful", label: "Playful" },
];

export default function ThemeGallery({ ownerToken, event, onCustomTheme, onThemeApplied }: ThemeGalleryProps) {
  const { toast } = useToast();
  const [activeCategory, setActiveCategory] = useState<ThemeCategory | "all">("all");
  const [previewTheme, setPreviewTheme] = useState<CuratedTheme | null>(null);

  const filteredThemes = activeCategory === "all"
    ? CURATED_THEMES
    : CURATED_THEMES.filter((t) => t.category === activeCategory);

  const applyTheme = useMutation({
    mutationFn: async (theme: CuratedTheme) => {
      const patch = themeToEventPatch(theme);
      // Apply the concept first
      const updatedEvent = await apiRequestJson<EventRecord>(
        "POST",
        `/api/events/owner/${ownerToken}/invite/apply-concept`,
        { concept: patch.concept, illustrationUrl: null },
      );
      // Then patch the suite fields (envelope, liner, stamp)
      await apiRequestJson<EventRecord>(
        "PATCH",
        `/api/events/owner/${ownerToken}/invite/suite`,
        {
          envelopeColor: patch.envelopeColor,
          envelopeLinerPattern: patch.envelopeLinerPattern,
          linerColor: patch.linerColor,
          stampStyle: patch.stampStyle,
          stampColor: patch.stampColor,
        },
      );
      // Sync palette colors too
      await apiRequestJson<EventRecord>(
        "PATCH",
        `/api/events/owner/${ownerToken}`,
        { paletteColors: JSON.stringify(patch.paletteColors) },
      );
      return updatedEvent;
    },
    onSuccess: (_data, theme) => {
      queryClient.invalidateQueries({ queryKey: [`/api/events/owner/${ownerToken}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/events/owner/${ownerToken}/dna`] });
      setPreviewTheme(null);
      toast({ title: `${theme.name} applied`, description: "Your invite, envelope, and RSVP page now use this theme." });
      onThemeApplied?.();
    },
    onError: () => {
      toast({ title: "Couldn't apply theme", description: "Please try again in a moment.", variant: "destructive" });
    },
  });

  return (
    <div data-testid="theme-gallery">
      {/* Header */}
      <div className="mb-4">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <Sparkles className="h-4 w-4 text-primary" /> Choose a theme
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Professionally designed themes — pick one and it applies instantly. Customize colors, fonts, and details after.
        </p>
      </div>

      {/* Category filter */}
      <div className="mb-4 flex flex-wrap gap-1.5">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => setActiveCategory(cat.id)}
            className={`h-auto rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              activeCategory === cat.id
                ? "bg-primary text-primary-foreground"
                : "border border-border bg-background text-muted-foreground hover:bg-muted"
            }`}
            data-testid={`button-theme-cat-${cat.id}`}
          >
            {cat.label}
          </button>
        ))}
      </div>

      {/* Theme grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="grid-themes">
        {filteredThemes.map((theme) => (
          <div
            key={theme.id}
            className="group relative cursor-pointer"
            onClick={() => setPreviewTheme(theme)}
            data-testid={`card-theme-${theme.id}`}
          >
            <div className="overflow-hidden rounded-lg border border-border transition-all group-hover:border-primary/40 group-hover:shadow-lg">
              <ThemeInviteCard theme={theme} event={event} variant="thumb" />
            </div>
            <div className="mt-2 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-foreground">{theme.name}</p>
                <p className="text-[11px] text-muted-foreground">{theme.description}</p>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Custom theme entry */}
      <div className="mt-6 border-t border-border pt-4">
        <button
          type="button"
          onClick={onCustomTheme}
          className="flex w-full items-center gap-2 rounded-lg border border-dashed border-primary/40 bg-primary/5 p-3 text-left transition-colors hover:bg-primary/10"
          data-testid="button-custom-theme"
        >
          <Wand2 className="h-5 w-5 text-primary" />
          <div>
            <p className="text-sm font-medium text-foreground">Describe a custom theme</p>
            <p className="text-[11px] text-muted-foreground">
              Can't find what you're looking for? Let AI design something unique.
            </p>
          </div>
        </button>
      </div>

      {/* Full-size preview modal */}
      {previewTheme && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setPreviewTheme(null)}
          data-testid="modal-theme-preview"
        >
          <div
            className="relative max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-background p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setPreviewTheme(null)}
              className="absolute right-3 top-3 rounded-full p-1.5 text-muted-foreground hover:bg-muted"
              data-testid="button-close-preview"
            >
              <X className="h-4 w-4" />
            </button>

            <p className="mb-1 text-lg font-semibold text-foreground">{previewTheme.name}</p>
            <p className="mb-4 text-sm text-muted-foreground">{previewTheme.description}</p>

            <ThemeInviteCard theme={previewTheme} event={event} variant="full" />

            <div className="mt-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                {previewTheme.concept.paletteColors.map((color, i) => (
                  <div
                    key={i}
                    className="h-6 w-6 rounded-full border border-border"
                    style={{ backgroundColor: color }}
                    title={color}
                  />
                ))}
              </div>
              <Button
                onClick={() => applyTheme.mutate(previewTheme)}
                disabled={applyTheme.isPending}
                data-testid="button-apply-theme"
              >
                <Check className="mr-1.5 h-4 w-4" />
                {applyTheme.isPending ? "Applying…" : "Use this theme"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

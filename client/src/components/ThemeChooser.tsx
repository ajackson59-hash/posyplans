/**
 * Stage 1 — "Choose a design".
 *
 * A stationery catalogue: eight art-directed themes shown as large portrait
 * invitations with real hierarchy, filtered by style and occasion. Selection
 * only — no customisation controls live here.
 *
 * Applying a theme is instant. It writes static artwork plus design metadata
 * and never touches an image model; the AI path is a clearly-labelled
 * secondary route at the bottom of the page.
 */

import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequestJson, queryClient } from "@/lib/queryClient";
import {
  LAUNCH_THEMES,
  THEME_OCCASIONS,
  THEME_OCCASION_LABELS,
  THEME_STYLES,
  THEME_STYLE_LABELS,
  type LaunchTheme,
  type ThemeOccasion,
  type ThemeStyle,
} from "@shared/themeCatalog";
import type { EventRecord } from "@/lib/types";
import { previewCopyFor, resolveThemeView } from "@/lib/themeInvite";
import { ThemeInvitation } from "./ThemeInvitation";
import { useToast } from "@/hooks/use-toast";
import { ArrowRight, Check, Clock, Wand2 } from "lucide-react";

interface ThemeChooserProps {
  ownerToken: string;
  event: EventRecord;
  /**
   * Secondary, slower AI artwork path. Omitted inside the AI-first
   * experience, where generation is the primary flow and the "Advanced /
   * Slower / not studio-finished" framing no longer describes it.
   */
  onCustomTheme?: () => void;
  /** Advance to stage 2 once a theme is applied. */
  onThemeApplied: () => void;
  /**
   * Lifted filters. Passed only when the chooser sits inside a flow that can
   * unmount it — the host's filtering is exploration state, not a transient
   * view detail. Omitted, the chooser keeps its own, as it always has.
   */
  filters?: { style: string; occasion: string };
  onFiltersChange?: (filters: { style: string; occasion: string }) => void;
}

type StyleFilter = ThemeStyle | "all";
type OccasionFilter = ThemeOccasion | "all";

function FilterChip({
  active,
  onClick,
  children,
  testId,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-testid={testId}
      className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
        active
          ? "bg-foreground text-background"
          : "border border-border bg-background text-muted-foreground hover:bg-muted"
      }`}
    >
      {children}
    </button>
  );
}

export default function ThemeChooser({
  ownerToken,
  event,
  onCustomTheme,
  onThemeApplied,
  filters,
  onFiltersChange,
}: ThemeChooserProps) {
  const { toast } = useToast();
  const [ownFilters, setOwnFilters] = useState({ style: "all", occasion: "all" });
  const active = filters ?? ownFilters;
  const style = active.style as StyleFilter;
  const occasion = active.occasion as OccasionFilter;
  const update = onFiltersChange ?? setOwnFilters;
  const setStyle = (next: StyleFilter) => update({ style: next, occasion });
  const setOccasion = (next: OccasionFilter) => update({ style, occasion: next });

  const appliedThemeId = resolveThemeView(event)?.theme.id ?? null;

  const themes = useMemo(
    () =>
      LAUNCH_THEMES.filter(
        (t) =>
          (style === "all" || t.style === style) &&
          (occasion === "all" || t.occasions.includes(occasion)),
      ),
    [style, occasion],
  );

  const applyTheme = useMutation({
    mutationFn: (theme: LaunchTheme) =>
      apiRequestJson<EventRecord>("POST", `/api/events/owner/${ownerToken}/invite/apply-theme`, {
        themeId: theme.id,
      }),
    onSuccess: (_data, theme) => {
      queryClient.invalidateQueries({ queryKey: [`/api/events/owner/${ownerToken}`] });
      queryClient.invalidateQueries({ queryKey: [`/api/events/owner/${ownerToken}/dna`] });
      toast({ title: `${theme.name} applied`, description: "Now make it yours." });
      onThemeApplied();
    },
    onError: () => {
      toast({ title: "Couldn't apply that design", description: "Please try again in a moment.", variant: "destructive" });
    },
  });

  return (
    <div data-testid="theme-chooser">
      <header className="mb-6">
        <h2 className="font-serif text-2xl tracking-tight text-foreground sm:text-3xl">Choose a design</h2>
        <p className="mt-1.5 max-w-xl text-sm text-muted-foreground">
          Eight original designs from the Posy studio. Pick one to see it with your details — it applies instantly,
          and you can change every colour, typeface, and envelope next.
        </p>
      </header>

      <div className="mb-6 space-y-2.5">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by style">
          <FilterChip active={style === "all"} onClick={() => setStyle("all")} testId="filter-style-all">
            All styles
          </FilterChip>
          {THEME_STYLES.map((s) => (
            <FilterChip key={s} active={style === s} onClick={() => setStyle(s)} testId={`filter-style-${s}`}>
              {THEME_STYLE_LABELS[s]}
            </FilterChip>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter by occasion">
          <FilterChip active={occasion === "all"} onClick={() => setOccasion("all")} testId="filter-occasion-all">
            Any occasion
          </FilterChip>
          {THEME_OCCASIONS.map((o) => (
            <FilterChip key={o} active={occasion === o} onClick={() => setOccasion(o)} testId={`filter-occasion-${o}`}>
              {THEME_OCCASION_LABELS[o]}
            </FilterChip>
          ))}
        </div>
      </div>

      {themes.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
          No designs match those filters yet. Try widening your search.
        </p>
      ) : (
        <ul
          className="grid grid-cols-1 gap-x-6 gap-y-9 sm:grid-cols-2 xl:grid-cols-3"
          data-testid="grid-launch-themes"
        >
          {themes.map((theme) => {
            const { headline, copy } = previewCopyFor(theme, event);
            const isApplied = theme.id === appliedThemeId;
            const isPending = applyTheme.isPending && applyTheme.variables?.id === theme.id;

            return (
              <li key={theme.id}>
                <button
                  type="button"
                  onClick={() => applyTheme.mutate(theme)}
                  disabled={applyTheme.isPending}
                  aria-label={`Choose the ${theme.name} design and customise it`}
                  data-testid={`card-launch-theme-${theme.id}`}
                  className="group block w-full text-left focus-visible:outline-none disabled:cursor-wait"
                >
                  <div
                    className={`relative overflow-hidden rounded-sm shadow-[0_1px_2px_rgba(23,23,23,0.08),0_12px_28px_-14px_rgba(23,23,23,0.35)] ring-1 transition-all duration-300 motion-reduce:transition-none group-hover:-translate-y-1 group-hover:shadow-[0_2px_4px_rgba(23,23,23,0.08),0_22px_44px_-16px_rgba(23,23,23,0.42)] group-focus-visible:ring-2 group-focus-visible:ring-ring group-focus-visible:ring-offset-4 motion-reduce:group-hover:translate-y-0 ${
                      isApplied ? "ring-2 ring-foreground" : "ring-black/5"
                    }`}
                  >
                    <ThemeInvitation
                      theme={theme}
                      headline={headline}
                      copy={copy}
                      thumbnail
                      decorative
                    />

                    {/* Hover-capable pointers only. On touch there is no hover
                        state to reveal it, and leaving it permanently on would
                        darken the artwork of every card in the grid — the
                        persistent action below the card serves those devices. */}
                    <span
                      aria-hidden
                      className="pointer-events-none absolute inset-x-0 bottom-0 hidden items-center justify-center bg-gradient-to-t from-black/55 to-transparent pb-4 pt-10 text-[11px] font-medium uppercase tracking-[0.18em] text-white opacity-0 transition-opacity duration-300 group-hover:opacity-100 group-focus-visible:opacity-100 motion-reduce:transition-none [@media(hover:hover)]:flex"
                    >
                      {isPending ? "Applying…" : "Customize this design"}
                    </span>

                    {isApplied && (
                      <span className="absolute right-3 top-3 flex items-center gap-1 rounded-full bg-foreground px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-background">
                        <Check className="h-3 w-3" aria-hidden /> Selected
                      </span>
                    )}
                  </div>

                  <div className="mt-3.5 flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-serif text-[15px] leading-tight text-foreground">{theme.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{theme.tagline}</p>
                    </div>
                    <span className="flex shrink-0 gap-1 pt-1" aria-hidden>
                      {theme.palettes.map((p) => (
                        <span
                          key={p.id}
                          className="h-3 w-3 rounded-full ring-1 ring-black/10"
                          style={{ backgroundColor: p.ink }}
                        />
                      ))}
                    </span>
                  </div>

                  {/* Always rendered, so the action is discoverable without a
                      hover state. The card itself is the button; this is its
                      visible affordance, hence aria-hidden. */}
                  <span
                    aria-hidden
                    data-testid={`cta-launch-theme-${theme.id}`}
                    className="mt-2.5 inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-[11px] font-medium text-foreground transition-colors group-hover:border-foreground group-hover:bg-foreground group-hover:text-background group-focus-visible:border-foreground group-focus-visible:bg-foreground group-focus-visible:text-background motion-reduce:transition-none"
                  >
                    {isPending ? "Applying…" : isApplied ? "Keep customizing" : "Customize this design"}
                    <ArrowRight className="h-3 w-3" aria-hidden />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {onCustomTheme && (
      <div className="mt-12 border-t border-border pt-6">
        <button
          type="button"
          onClick={onCustomTheme}
          data-testid="button-custom-theme"
          className="flex w-full items-start gap-3 rounded-lg border border-dashed border-border p-4 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Wand2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
          <div>
            <p className="text-sm font-medium text-foreground">
              Advanced: create custom artwork
              <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 align-middle text-[10px] font-normal uppercase tracking-wider text-muted-foreground">
                <Clock className="h-2.5 w-2.5" aria-hidden /> Slower
              </span>
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Describe something the catalogue doesn't cover and Posy will design it from scratch. This takes up to a
              minute and the result won't be studio-finished like the designs above.
            </p>
          </div>
        </button>
      </div>
      )}
    </div>
  );
}

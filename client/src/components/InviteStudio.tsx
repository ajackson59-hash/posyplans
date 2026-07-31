/**
 * Stage 2 — "Make it yours".
 *
 * A large live composed preview beside three organised control groups: Words,
 * Style, and Envelope. Every control is drawn from the applied theme's own
 * curated set, so a host can restyle freely without being able to produce an
 * incoherent card.
 *
 * Nothing here calls an image model. Edits are debounced and PATCHed to the
 * theme customisation route.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequestJson, queryClient } from "@/lib/queryClient";
import {
  OVERLAY_LABELS,
  getFontPairingIdFor,
  getPaletteVariant,
  getPostageStamp,
  type LaunchTheme,
  type OverlayTreatment,
  type ThemeCopy,
} from "@shared/themeCatalog";
import { getFontPairing } from "@shared/inviteDesign";
import { envelopeFinish, linerPatternStyle, type LinerPattern, type StampStyle } from "@shared/themeDna";
import type { EventRecord } from "@/lib/types";
import { resolveThemeView } from "@/lib/themeInvite";
import { ThemeInvitation } from "./ThemeInvitation";
import EnvelopeMockup, { PostageStamp } from "./EnvelopeMockup";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Check } from "lucide-react";

const SAVE_DEBOUNCE_MS = 900;

interface InviteStudioProps {
  ownerToken: string;
  event: EventRecord;
  /** Return to stage 1. */
  onChangeDesign: () => void;
  /**
   * Set when the host has just arrived from the chooser. They may have picked a
   * design from far down the gallery, which leaves the editor's controls above
   * the viewport; this brings the editor heading into view and moves focus to
   * it. Left off on a normal page load so returning hosts aren't yanked around.
   */
  focusOnMount?: boolean;
}

type Tab = "words" | "style" | "envelope";

const TABS: { id: Tab; label: string }[] = [
  { id: "words", label: "Words" },
  { id: "style", label: "Style" },
  { id: "envelope", label: "Envelope" },
];

const COPY_FIELDS: { key: keyof ThemeCopy; label: string }[] = [
  { key: "eyebrow", label: "Opening line" },
  { key: "dateLine", label: "Date" },
  { key: "timeLine", label: "Time" },
  { key: "locationLine", label: "Location" },
  { key: "rsvpLine", label: "RSVP cue" },
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="border-t border-border pt-4 first:border-0 first:pt-0">
      <legend className="sr-only">{title}</legend>
      <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{title}</p>
      {children}
    </fieldset>
  );
}

/** A radio-style option with a visual swatch and an accessible label. */
function SwatchOption({
  selected,
  onSelect,
  label,
  testId,
  children,
}: {
  selected: boolean;
  onSelect: () => void;
  label: string;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      role="radio"
      aria-checked={selected}
      aria-label={label}
      title={label}
      data-testid={testId}
      className={`relative rounded-md p-1 transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 ${
        selected ? "ring-2 ring-foreground" : "ring-1 ring-border hover:ring-foreground/40"
      }`}
    >
      {children}
    </button>
  );
}

export default function InviteStudio({
  ownerToken,
  event,
  onChangeDesign,
  focusOnMount = false,
}: InviteStudioProps) {
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("words");
  const [envelopeOpen, setEnvelopeOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (!focusOnMount) return;
    const prefersReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    rootRef.current?.scrollIntoView?.({ behavior: prefersReduced ? "auto" : "smooth", block: "start" });
    // Focus lands on the heading rather than the first control, so a screen
    // reader announces the stage change instead of an unexplained text field.
    headingRef.current?.focus?.({ preventScroll: true });
  }, [focusOnMount]);

  const view = resolveThemeView(event);

  // Local draft state so typing stays instant; saved on a debounce.
  const [draft, setDraft] = useState(() => ({
    headline: view?.headline ?? "",
    message: view?.message ?? "",
    copy: view?.selection.copy ?? ({} as ThemeCopy),
    paletteVariantId: view?.selection.paletteVariantId ?? "",
    placementId: view?.selection.placementId ?? "",
    overlay: (view?.selection.overlay ?? "none") as OverlayTreatment,
    postageStampId: view?.selection.postageStampId ?? "",
    fontPairingId: view?.fontPairingId ?? "",
  }));

  // Re-seed only when the server hands back a genuinely different design, so an
  // in-flight save never yanks the field the host is mid-sentence in.
  const syncedFrom = useRef(event.inviteDesignConceptJson);
  useEffect(() => {
    if (!view || syncedFrom.current === event.inviteDesignConceptJson) return;
    syncedFrom.current = event.inviteDesignConceptJson;
    setDraft({
      headline: view.headline,
      message: view.message,
      copy: view.selection.copy,
      paletteVariantId: view.selection.paletteVariantId,
      placementId: view.selection.placementId,
      overlay: view.selection.overlay,
      postageStampId: view.selection.postageStampId ?? "",
      fontPairingId: view.fontPairingId,
    });
  }, [event.inviteDesignConceptJson, view]);

  const save = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiRequestJson<EventRecord>("PATCH", `/api/events/owner/${ownerToken}/invite/theme`, body),
    onSuccess: (updated) => {
      // The design we just sent is the design we already show, so record it as
      // synced rather than letting the effect above reset the form.
      syncedFrom.current = updated.inviteDesignConceptJson;
      queryClient.invalidateQueries({ queryKey: [`/api/events/owner/${ownerToken}`] });
    },
    onError: () => {
      toast({ title: "Couldn't save that change", description: "Please try again.", variant: "destructive" });
    },
  });

  const pending = useRef<Record<string, unknown>>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveRef = useRef(save);
  saveRef.current = save;

  const scheduleSave = useCallback((patch: Record<string, unknown>) => {
    pending.current = {
      ...pending.current,
      ...patch,
      copy: { ...(pending.current.copy as object | undefined), ...(patch.copy as object | undefined) },
    };
    if (!Object.keys(pending.current.copy as object).length) delete pending.current.copy;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const body = pending.current;
      pending.current = {};
      saveRef.current.mutate(body);
    }, SAVE_DEBOUNCE_MS);
  }, []);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const suite = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiRequestJson<EventRecord>("PATCH", `/api/events/owner/${ownerToken}/invite/suite`, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [`/api/events/owner/${ownerToken}`] }),
    onError: () => {
      toast({ title: "Couldn't save the envelope", description: "Please try again.", variant: "destructive" });
    },
  });

  const theme: LaunchTheme | undefined = view?.theme;

  const envelope = useMemo(() => {
    if (!theme) return null;
    return {
      color: event.envelopeColor || theme.envelope.papers[0].color,
      linerPattern: (event.envelopeLinerPattern || theme.envelope.liners[0].pattern) as LinerPattern,
      linerColor: event.linerColor || theme.envelope.liners[0].color,
      stampStyle: (event.stampStyle || theme.envelope.seals[0].style) as StampStyle,
      stampColor: event.stampColor || theme.envelope.seals[0].color,
    };
  }, [theme, event.envelopeColor, event.envelopeLinerPattern, event.linerColor, event.stampStyle, event.stampColor]);

  if (!theme || !view || !envelope) {
    return (
      <p className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        Choose a design first.
      </p>
    );
  }

  const palette = getPaletteVariant(theme, draft.paletteVariantId);
  const postage = getPostageStamp(theme, draft.postageStampId);

  const setCopy = (key: keyof ThemeCopy, value: string) => {
    setDraft((d) => ({ ...d, copy: { ...d.copy, [key]: value } }));
    scheduleSave({ copy: { [key]: value } });
  };

  return (
    <div ref={rootRef} data-testid="invite-studio" className="scroll-mt-4">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="font-serif text-2xl tracking-tight text-foreground focus:outline-none sm:text-3xl"
            data-testid="heading-studio"
          >
            Make it yours
          </h2>
          <p className="mt-1.5 text-sm text-muted-foreground">
            {theme.name} — {theme.tagline}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={onChangeDesign} data-testid="button-change-design">
          <ArrowLeft className="mr-1.5 h-3.5 w-3.5" aria-hidden /> Change design
        </Button>
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* ── Live composed preview ─────────────────────────────── */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <div className="mx-auto max-w-md">
            <div
              className="overflow-hidden rounded-sm shadow-[0_2px_6px_rgba(23,23,23,0.09),0_28px_56px_-20px_rgba(23,23,23,0.4)] ring-1 ring-black/5"
              data-testid="studio-preview-card"
            >
              <ThemeInvitation
                theme={theme}
                headline={draft.headline || theme.sample.headline}
                copy={draft.copy}
                message={draft.message}
                paletteVariantId={draft.paletteVariantId}
                placementId={draft.placementId}
                overlay={draft.overlay}
                fontPairingId={draft.fontPairingId}
              />
            </div>

            <div className="mt-8">
              <p className="mb-2.5 text-center text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Arrives in
              </p>
              <EnvelopeMockup
                envelopeColor={envelope.color}
                linerPattern={envelope.linerPattern}
                linerColor={envelope.linerColor}
                linerBaseColor={palette.surface}
                stampStyle={envelope.stampStyle}
                stampColor={envelope.stampColor}
                postage={postage}
                finish={envelopeFinish(theme.styleLaneId)}
                addressee={event.hostNames ? `From ${event.hostNames}` : "Your guests"}
                opened={envelopeOpen}
                onOpen={() => setEnvelopeOpen((o) => !o)}
              />
            </div>

            <p className="mt-3 text-center text-xs text-muted-foreground" aria-live="polite">
              {save.isPending || suite.isPending ? "Saving…" : "All changes saved"}
            </p>
          </div>
        </div>

        {/* ── Controls ──────────────────────────────────────────── */}
        <div>
          {/* Sticky within the control column so the tabs stay reachable while
              scrolling a long panel. There is no fixed site header to clear, so
              top-0 is safe; the backdrop is opaque to stop panel content
              showing through as it scrolls beneath. */}
          <div
            className="sticky top-0 z-20 mb-5 flex gap-1 rounded-lg bg-muted p-1 shadow-[0_6px_10px_-8px_rgba(23,23,23,0.5)]"
            role="tablist"
            aria-label="Customisation controls"
            data-testid="studio-tablist"
          >
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`studio-tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls={`studio-panel-${t.id}`}
                onClick={() => setTab(t.id)}
                data-testid={`tab-${t.id}`}
                className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  tab === t.id ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === "words" && (
            <div id="studio-panel-words" role="tabpanel" aria-labelledby="studio-tab-words" className="space-y-4">
              <div>
                <Label htmlFor="studio-headline">Headline</Label>
                <Input
                  id="studio-headline"
                  value={draft.headline}
                  maxLength={200}
                  data-testid="input-headline"
                  onChange={(e) => {
                    setDraft((d) => ({ ...d, headline: e.target.value }));
                    scheduleSave({ inviteSubject: e.target.value });
                  }}
                />
              </div>

              {COPY_FIELDS.map((f) => (
                <div key={f.key}>
                  <Label htmlFor={`studio-${f.key}`}>{f.label}</Label>
                  <Input
                    id={`studio-${f.key}`}
                    value={draft.copy[f.key] ?? ""}
                    maxLength={160}
                    data-testid={`input-${f.key}`}
                    onChange={(e) => setCopy(f.key, e.target.value)}
                  />
                </div>
              ))}

              <div>
                <Label htmlFor="studio-message">A note to your guests</Label>
                <Textarea
                  id="studio-message"
                  rows={4}
                  value={draft.message}
                  maxLength={1000}
                  data-testid="input-message"
                  onChange={(e) => {
                    setDraft((d) => ({ ...d, message: e.target.value }));
                    scheduleSave({ inviteMessage: e.target.value });
                  }}
                />
              </div>
            </div>
          )}

          {tab === "style" && (
            <div id="studio-panel-style" role="tabpanel" aria-labelledby="studio-tab-style" className="space-y-5">
              <Section title="Colourway">
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Colourway">
                  {theme.palettes.map((p) => (
                    <SwatchOption
                      key={p.id}
                      selected={p.id === draft.paletteVariantId}
                      label={p.label}
                      testId={`swatch-palette-${p.id}`}
                      onSelect={() => {
                        setDraft((d) => ({ ...d, paletteVariantId: p.id }));
                        scheduleSave({ paletteVariantId: p.id });
                      }}
                    >
                      <span className="flex overflow-hidden rounded">
                        {[p.ink, p.accent, p.surface, p.body].map((c, i) => (
                          <span key={i} className="h-8 w-5" style={{ backgroundColor: c }} />
                        ))}
                      </span>
                    </SwatchOption>
                  ))}
                </div>
              </Section>

              <Section title="Typeface">
                <div className="space-y-1.5" role="radiogroup" aria-label="Typeface">
                  {theme.fontPairingIds.map((id) => {
                    const font = getFontPairing(getFontPairingIdFor(theme, id));
                    const selected = id === draft.fontPairingId;
                    return (
                      <button
                        key={id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        data-testid={`option-font-${id}`}
                        onClick={() => {
                          setDraft((d) => ({ ...d, fontPairingId: id }));
                          scheduleSave({ fontPairingId: id });
                        }}
                        className={`flex w-full items-baseline justify-between gap-3 rounded-md px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          selected ? "bg-foreground text-background" : "border border-border hover:bg-muted"
                        }`}
                      >
                        <span
                          className="truncate text-lg"
                          style={{
                            fontFamily: font.headingFontFamily,
                            fontWeight: font.headingWeight,
                            fontStyle: font.headingStyle,
                            letterSpacing: font.headingLetterSpacing,
                          }}
                        >
                          {theme.sample.headline}
                        </span>
                        <span className="shrink-0 text-[11px] opacity-70">{font.label}</span>
                      </button>
                    );
                  })}
                </div>
              </Section>

              <Section title="Text placement">
                <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Text placement">
                  {theme.placements.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      role="radio"
                      aria-checked={p.id === draft.placementId}
                      data-testid={`option-placement-${p.id}`}
                      onClick={() => {
                        setDraft((d) => ({ ...d, placementId: p.id }));
                        scheduleSave({ placementId: p.id });
                      }}
                      className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                        p.id === draft.placementId
                          ? "bg-foreground text-background"
                          : "border border-border hover:bg-muted"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </Section>

              {theme.overlayOptions.length > 1 && (
                <Section title="Legibility">
                  <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Overlay treatment">
                    {theme.overlayOptions.map((o) => (
                      <button
                        key={o}
                        type="button"
                        role="radio"
                        aria-checked={o === draft.overlay}
                        data-testid={`option-overlay-${o}`}
                        onClick={() => {
                          setDraft((d) => ({ ...d, overlay: o }));
                          scheduleSave({ overlay: o });
                        }}
                        className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                          o === draft.overlay ? "bg-foreground text-background" : "border border-border hover:bg-muted"
                        }`}
                      >
                        {OVERLAY_LABELS[o]}
                      </button>
                    ))}
                  </div>
                </Section>
              )}
            </div>
          )}

          {tab === "envelope" && (
            <div id="studio-panel-envelope" role="tabpanel" aria-labelledby="studio-tab-envelope" className="space-y-5">
              <Section title="Paper">
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Envelope paper">
                  {theme.envelope.papers.map((p) => (
                    <SwatchOption
                      key={p.id}
                      selected={p.color === envelope.color}
                      label={p.label}
                      testId={`swatch-paper-${p.id}`}
                      onSelect={() => suite.mutate({ envelopeColor: p.color })}
                    >
                      <span className="block h-10 w-14 rounded" style={{ backgroundColor: p.color }} />
                    </SwatchOption>
                  ))}
                </div>
              </Section>

              <Section title="Liner">
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Envelope liner">
                  {theme.envelope.liners.map((l) => (
                    <SwatchOption
                      key={l.id}
                      selected={l.pattern === envelope.linerPattern && l.color === envelope.linerColor}
                      label={l.label}
                      testId={`swatch-liner-${l.id}`}
                      onSelect={() => suite.mutate({ envelopeLinerPattern: l.pattern, linerColor: l.color })}
                    >
                      <span
                        className="block h-10 w-14 rounded"
                        style={linerPatternStyle(l.pattern, l.color, palette.surface)}
                      />
                    </SwatchOption>
                  ))}
                </div>
              </Section>

              {/* Postage and wax are two different objects on a real envelope —
                  franked in the corner, pressed on the flap — so they get two
                  controls rather than one that means both. */}
              <Section title="Postage stamp">
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Postage stamp">
                  {theme.envelope.stamps.map((s) => (
                    <SwatchOption
                      key={s.id}
                      selected={s.id === postage.id}
                      label={s.label}
                      testId={`swatch-postage-${s.id}`}
                      onSelect={() => {
                        setDraft((d) => ({ ...d, postageStampId: s.id }));
                        scheduleSave({ postageStampId: s.id });
                      }}
                    >
                      <span className="block h-12 w-[2.55rem]">
                        <PostageStamp
                          style={s.motif}
                          color={s.inkColor}
                          paperColor={s.paperColor}
                          denomination={s.denomination}
                          caption={s.caption}
                          label={s.label}
                        />
                      </span>
                    </SwatchOption>
                  ))}
                </div>
              </Section>

              <Section title="Wax seal">
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Wax seal">
                  {theme.envelope.seals.map((s) => (
                    <SwatchOption
                      key={s.id}
                      selected={s.style === envelope.stampStyle && s.color === envelope.stampColor}
                      label={s.label}
                      testId={`swatch-seal-${s.id}`}
                      onSelect={() => suite.mutate({ stampStyle: s.style, stampColor: s.color })}
                    >
                      <span
                        className="flex h-10 w-14 items-center justify-center rounded"
                        style={{ backgroundColor: palette.surface, color: s.color }}
                      >
                        <span className="text-lg leading-none">{s.style === "wax-seal" ? "⬤" : "✦"}</span>
                      </span>
                    </SwatchOption>
                  ))}
                </div>
              </Section>

              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Check className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
                Every option here is drawn from {theme.name}'s own palette, so the envelope always coordinates with the
                invitation.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

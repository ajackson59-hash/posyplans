/**
 * LiveInviteEditor — replaces the static "applied concept" view with a
 * real-time design editor. The host sees the full invite preview (envelope,
 * card, illustration, text) and can change fonts, colors, layout, borders,
 * and text with instant visual feedback. Changes save to the server via
 * a debounced PATCH (1.5s after the last edit) so the preview never stalls.
 *
 * AI concept generation is untouched — this only renders AFTER a host has
 * picked a concept. The illustration URL is preserved across all edits.
 */
import { useRef, useState, useEffect, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, apiRequestJson, queryClient } from "@/lib/queryClient";
import { readImageFileAsDataUrl } from "@/lib/imageUpload";
import {
  type InviteDesignConcept,
  parseInviteDesignConcept,
  getFontPairing,
  conceptHeadingStyle,
  conceptBodyStyle,
  conceptBorderStyle,
  FONT_PAIRINGS,
  LAYOUT_STYLES,
  BORDER_STYLES,
  type LayoutStyle,
  type BorderStyle,
} from "@shared/inviteDesign";
import {
  type LinerPattern,
  type StampStyle,
  LINER_PATTERNS,
  STAMP_STYLES,
  deriveThemeDna,
  linerPatternStyle,
  stampGlyph,
  envelopeFinish,
  shadeHex,
  isLinerPattern,
  isStampStyle,
} from "@shared/themeDna";
import type { EventRecord } from "@/lib/types";
import { applyInviteTokens } from "@shared/inviteTokens";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import PaletteEditor from "@/components/PaletteEditor";
import EnvelopeMockup, { PostageStamp } from "@/components/EnvelopeMockup";
import { useToast } from "@/hooks/use-toast";
import AskPosy from "@/components/AskPosy";
import {
  Sparkles,
  Wand2,
  X,
  Check,
  ImagePlus,
  Type,
  Layout as LayoutIcon,
  Palette as PaletteIcon,
  Save,
  Mail,
} from "lucide-react";

interface LiveInviteEditorProps {
  ownerToken: string;
  event: EventRecord;
  onBrowse: () => void;
}

// ── Layout label map for the switcher ──────────────────────────────
const LAYOUT_LABELS: Record<LayoutStyle, { label: string; icon: string }> = {
  banner: { label: "Banner", icon: "▬" },
  "full-bleed": { label: "Full Bleed", icon: "▣" },
  split: { label: "Split", icon: "▥" },
  centered: { label: "Centered", icon: "◉" },
  backdrop: { label: "Backdrop", icon: "▦" },
};

// ── Border label map ──────────────────────────────────────────────
const BORDER_LABELS: Record<BorderStyle, string> = {
  none: "None",
  "thin-frame": "Thin Frame",
  "double-frame": "Double Frame",
  "dashed-frame": "Dashed",
  "corner-flourish": "Rounded",
};

export default function LiveInviteEditor({ ownerToken, event, onBrowse }: LiveInviteEditorProps) {
  const { toast } = useToast();
  const appliedConcept = parseInviteDesignConcept(event.inviteDesignConceptJson);
  const illustrationUrl = event.inviteIllustrationUrl;

  // ── Local state — the source of truth for the live preview ───────
  // Initialized from the applied concept + event fields. Changes update
  // the preview instantly; saves are debounced.
  const [fontPairingId, setFontPairingId] = useState(appliedConcept?.fontPairingId ?? "editorial-serif");
  const [paletteColors, setPaletteColors] = useState<string[]>(appliedConcept?.paletteColors ?? ["#94a3b8", "#cbd5e1", "#e2e8f0", "#f1f5f9"]);
  const [layoutStyle, setLayoutStyle] = useState<LayoutStyle>(appliedConcept?.layoutStyle ?? "banner");
  const [borderStyle, setBorderStyle] = useState<BorderStyle>(appliedConcept?.borderStyle ?? "thin-frame");
  const [inviteSubject, setInviteSubject] = useState(event.inviteSubject || "You're invited to {{eventName}}!");
  const [inviteMessage, setInviteMessage] = useState(event.inviteMessage || "Join us on {{eventDate}} at {{location}}. We can't wait to celebrate with you!");

  // Drives the sealed-envelope opening animation in the preview so the host can
  // rehearse the guest's first impression without leaving the editor.
  const [sealedPreviewOpen, setSealedPreviewOpen] = useState(false);

  // Save status: "idle" | "saving" | "saved"
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);
  // Accumulates all pending patches so rapid multi-field edits within the
  // debounce window are saved together instead of dropping earlier changes.
  const pendingPatchRef = useRef<Record<string, unknown>>({});

  // Construct the live concept object from local state for rendering
  const liveConcept: InviteDesignConcept = {
    ...appliedConcept!,
    fontPairingId,
    paletteColors,
    layoutStyle,
    borderStyle,
  };

  // ── Debounced save ───────────────────────────────────────────────
  const saveMutation = useMutation({
    mutationFn: async (payload: Record<string, unknown>) =>
      apiRequestJson<EventRecord>("PATCH", `/api/events/owner/${ownerToken}/invite/live-design`, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/events/owner/${ownerToken}`] });
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
      dirtyRef.current = false;
    },
    onError: () => {
      setSaveStatus("idle");
      toast({ title: "Couldn't save changes", description: "Your edits are kept — try again in a moment.", variant: "destructive" });
    },
  });

  const scheduleSave = useCallback((patch: Record<string, unknown>) => {
    // Merge this patch into the pending accumulator so rapid multi-field
    // edits (e.g. font + layout + text within 1.5s) all persist together.
    pendingPatchRef.current = { ...pendingPatchRef.current, ...patch };
    dirtyRef.current = true;
    setSaveStatus("saving");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      const payload = pendingPatchRef.current;
      pendingPatchRef.current = {};
      saveMutation.mutate(payload);
    }, 1500);
  }, [saveMutation]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  // Sync local state when the concept is updated externally (e.g. palette
  // changed from the Theme tab, or a new concept was applied). We compare the
  // concept JSON string so we only re-sync when something actually changed
  // server-side — not on every event re-fetch.
  const conceptJsonRef = useRef(event.inviteDesignConceptJson);
  useEffect(() => {
    if (event.inviteDesignConceptJson === conceptJsonRef.current) return;
    conceptJsonRef.current = event.inviteDesignConceptJson;
    const refreshed = parseInviteDesignConcept(event.inviteDesignConceptJson);
    if (refreshed) {
      if (refreshed.paletteColors) setPaletteColors(refreshed.paletteColors);
      if (refreshed.fontPairingId) setFontPairingId(refreshed.fontPairingId);
      if (refreshed.layoutStyle) setLayoutStyle(refreshed.layoutStyle);
      if (refreshed.borderStyle) setBorderStyle(refreshed.borderStyle);
    }
  }, [event.inviteDesignConceptJson]);

  // ── Change handlers — update local state instantly, schedule save ─
  const onFontChange = (id: string) => {
    setFontPairingId(id);
    scheduleSave({ fontPairingId: id });
  };

  const onLayoutChange = (layout: LayoutStyle) => {
    setLayoutStyle(layout);
    scheduleSave({ layoutStyle: layout });
  };

  const onBorderChange = (border: BorderStyle) => {
    setBorderStyle(border);
    scheduleSave({ borderStyle: border });
  };

  const onColorChange = (index: number, color: string) => {
    const next = [...paletteColors];
    next[index] = color;
    setPaletteColors(next);
    scheduleSave({ paletteColors: next });
  };

  const onSubjectChange = (value: string) => {
    setInviteSubject(value);
    scheduleSave({ inviteSubject: value });
  };

  const onMessageChange = (value: string) => {
    setInviteMessage(value);
    scheduleSave({ inviteMessage: value });
  };

  // ── Suite handlers (reuse existing endpoint) ─────────────────────
  const updateSuite = useMutation({
    mutationFn: async (updates: { envelopeColor?: string; envelopeLinerPattern?: LinerPattern; stampStyle?: StampStyle; linerColor?: string; stampColor?: string }) =>
      apiRequestJson<EventRecord>("PATCH", `/api/events/owner/${ownerToken}/invite/suite`, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/events/owner/${ownerToken}`] });
    },
  });

  // ── Upload own photo (reuse existing endpoint) ──────────────────
  const uploadOwnImage = useMutation({
    mutationFn: async (file: File) => {
      const dataUrl = await readImageFileAsDataUrl(file);
      await apiRequest("PATCH", `/api/events/owner/${ownerToken}`, { inviteIllustrationUrl: dataUrl });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/events/owner/${ownerToken}`] });
      toast({ title: "Your photo is now on the invite" });
    },
    onError: () => {
      toast({ title: "Couldn't use that image", variant: "destructive" });
    },
  });

  // ── Clear concept ────────────────────────────────────────────────
  const clearConcept = useMutation({
    mutationFn: async () => apiRequestJson<EventRecord>("POST", `/api/events/owner/${ownerToken}/invite/clear-concept`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/events/owner/${ownerToken}`] });
      toast({ title: "AI design removed", description: "Back to manual styling." });
    },
  });

  // ── Upload finished custom design (reuse existing endpoint) ──────
  const customDesignInputRef = useRef<HTMLInputElement>(null);
  const uploadCustomDesign = useMutation({
    mutationFn: async (file: File) => {
      const dataUrl = await readImageFileAsDataUrl(file);
      await apiRequestJson<EventRecord>("PATCH", `/api/events/owner/${ownerToken}/invite/custom-design`, { imageDataUrl: dataUrl });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/events/owner/${ownerToken}`] });
      toast({ title: "Your design is live", description: "Guests will see your invitation exactly as you uploaded it." });
    },
    onError: () => {
      toast({ title: "Couldn't upload that design", variant: "destructive" });
    },
  });

  const artworkInputRef = useRef<HTMLInputElement>(null);

  // ── Tokenized preview text ───────────────────────────────────────
  const tokenCtx = {
    eventName: event.eventName,
    eventDate: event.eventDate,
    location: event.location,
    hostNames: event.hostNames,
  };
  const previewSubject = applyInviteTokens(inviteSubject, tokenCtx);
  const previewMessage = applyInviteTokens(inviteMessage, tokenCtx);

  // ── Suite rendering ──────────────────────────────────────────────
  const dna = deriveThemeDna(liveConcept);
  const envelopeColor = /^#[0-9a-fA-F]{6}$/.test(event.envelopeColor || "") ? (event.envelopeColor as string) : dna.backgroundColor;
  const linerPattern: LinerPattern = isLinerPattern(event.envelopeLinerPattern) ? event.envelopeLinerPattern : dna.linerPattern;
  const stamp: StampStyle = isStampStyle(event.stampStyle) ? event.stampStyle : dna.stampStyle;
  const stampMark = stampGlyph(stamp);
  const linerPatternColor = /^#[0-9a-fA-F]{6}$/.test(event.linerColor || "") ? (event.linerColor as string) : dna.accentColor;
  const stampColorVal = /^#[0-9a-fA-F]{6}$/.test(event.stampColor || "") ? (event.stampColor as string) : dna.accentColor;

  // ════════════════════════════════════════════════════════════════
  //  RENDER
  // ════════════════════════════════════════════════════════════════
  return (
    <div className="rounded-md border border-primary/30 bg-primary/5 p-4" data-testid="card-live-invite-editor">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-primary">
          <Sparkles className="h-3.5 w-3.5" /> Design Studio
        </p>
        <div className="flex items-center gap-1.5 text-[11px]">
          {saveStatus === "saving" && (
            <span className="flex items-center gap-1 text-muted-foreground">
              <Save className="h-3 w-3 animate-pulse" /> Saving…
            </span>
          )}
          {saveStatus === "saved" && (
            <span className="flex items-center gap-1 text-green-600">
              <Check className="h-3 w-3" /> Saved
            </span>
          )}
        </div>
      </div>

      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        {/* ═══ LEFT: Live Preview ═══════════════════════════════════ */}
        <div>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Live Preview</p>

          {/* The sealed envelope, rendered by the same component the guest page
              uses — so what the host tunes here is literally the first thing a
              guest sees, not an approximation of it. */}
          <div className="rounded-md border border-border bg-muted/40 p-4">
            <EnvelopeMockup
              envelopeColor={envelopeColor}
              linerPattern={linerPattern}
              linerColor={linerPatternColor}
              linerBaseColor={dna.backgroundColor}
              stampStyle={stamp}
              stampColor={stampColorVal}
              finish={envelopeFinish(appliedConcept?.styleLaneId)}
              addressee={sealedPreviewOpen ? "" : "For Maya"}
              opened={sealedPreviewOpen}
              onOpen={() => setSealedPreviewOpen(true)}
              className="max-w-[15rem]"
            />
            <button
              type="button"
              onClick={() => setSealedPreviewOpen((v) => !v)}
              className="mx-auto mt-2.5 block text-[11px] font-medium text-primary underline underline-offset-2"
              data-testid="button-toggle-sealed-preview"
            >
              {sealedPreviewOpen ? "Reset envelope" : "Preview the opening animation"}
            </button>
          </div>

          {/* The card itself, on a neutral mount. Kept separate from the envelope
              so the surface behind it never tints the artwork being judged. */}
          <div
            className="relative mt-3 overflow-hidden rounded-md border border-border bg-muted/40 p-3"
            data-testid="live-preview-envelope"
          >
            {/* ═══ The invite card — renders the live concept ════════ */}
            <div
              className="relative m-2 overflow-hidden rounded-md bg-background shadow-xl ring-1 ring-black/5"
              style={conceptBorderStyle(liveConcept)}
              data-testid="live-preview-card"
            >
              {/* BANNER layout */}
              {layoutStyle === "banner" && (
                <>
                  {illustrationUrl && (
                    <img src={illustrationUrl} alt="" className="h-40 w-full object-cover sm:h-52" data-testid="live-preview-image" />
                  )}
                  <div className="p-5">
                    <p className="text-base font-semibold" style={conceptHeadingStyle(liveConcept)} data-testid="live-preview-subject">
                      {previewSubject}
                    </p>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground" style={conceptBodyStyle(liveConcept)}>
                      {previewMessage}
                    </p>
                  </div>
                </>
              )}

              {/* FULL-BLEED layout */}
              {layoutStyle === "full-bleed" && (
                <div
                  className="relative min-h-[240px]"
                  style={illustrationUrl
                    ? { backgroundImage: `url(${illustrationUrl})`, backgroundSize: "cover", backgroundPosition: "center" }
                    : { backgroundColor: paletteColors[2] || paletteColors[0] }}
                >
                  {illustrationUrl && (
                    <img src={illustrationUrl} alt="" className="absolute inset-0 h-full w-full object-cover" data-testid="live-preview-image" />
                  )}
                  <div className="relative flex min-h-[240px] flex-col justify-end p-5">
                    <div className="rounded-md bg-background/90 p-4">
                      <p className="text-base font-semibold" style={conceptHeadingStyle(liveConcept)}>
                        {previewSubject}
                      </p>
                      <p className="mt-1.5 whitespace-pre-wrap text-sm text-muted-foreground" style={conceptBodyStyle(liveConcept)}>
                        {previewMessage}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* SPLIT layout */}
              {layoutStyle === "split" && (
                <div className="flex min-h-[200px]">
                  <div
                    className="w-2/5"
                    style={illustrationUrl
                      ? { backgroundImage: `url(${illustrationUrl})`, backgroundSize: "cover", backgroundPosition: "center" }
                      : { backgroundColor: paletteColors[2] || paletteColors[0] }}
                  >
                    {illustrationUrl && (
                      <img src={illustrationUrl} alt="" className="h-full w-full object-cover" data-testid="live-preview-image" />
                    )}
                  </div>
                  <div className="flex-1 p-5">
                    <p className="text-base font-semibold" style={conceptHeadingStyle(liveConcept)}>
                      {previewSubject}
                    </p>
                    <p className="mt-1.5 whitespace-pre-wrap text-sm text-muted-foreground" style={conceptBodyStyle(liveConcept)}>
                      {previewMessage}
                    </p>
                  </div>
                </div>
              )}

              {/* CENTERED layout */}
              {layoutStyle === "centered" && (
                <div className="flex flex-col items-center p-8">
                  {illustrationUrl && (
                    <img src={illustrationUrl} alt="" className="mb-5 h-28 w-28 rounded-full object-cover" data-testid="live-preview-image" />
                  )}
                  <p className="text-center text-base font-semibold" style={conceptHeadingStyle(liveConcept)}>
                    {previewSubject}
                  </p>
                  <p className="mt-2 text-center whitespace-pre-wrap text-sm text-muted-foreground" style={conceptBodyStyle(liveConcept)}>
                    {previewMessage}
                  </p>
                </div>
              )}

              {/* BACKDROP layout */}
              {layoutStyle === "backdrop" && (
                <div
                  className="p-5"
                  style={illustrationUrl
                    ? { backgroundImage: `url(${illustrationUrl})`, backgroundSize: "cover", backgroundPosition: "center" }
                    : undefined}
                >
                  <div className="rounded-md bg-white/85 p-4">
                    <p className="text-base font-semibold" style={conceptHeadingStyle(liveConcept)}>
                      {previewSubject}
                    </p>
                    <p className="mt-1.5 whitespace-pre-wrap text-sm text-muted-foreground" style={conceptBodyStyle(liveConcept)}>
                      {previewMessage}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          <p className="mt-1.5 text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">{appliedConcept?.conceptName}</span> — this is exactly what guests see.
          </p>

          {/* Suite previews */}
          <div className="mt-3 grid grid-cols-4 gap-2">
            <div className="rounded-md border border-border bg-background p-2">
              {/* Mirrors the real envelope's layer order at thumbnail scale: liner
                  clipped to the flap triangle, pocket over it, then the shaded flap. */}
              <div className="relative h-14 overflow-hidden rounded-sm" style={{ backgroundColor: shadeHex(envelopeColor, -0.03) }}>
                <div
                  className="absolute inset-x-0 top-0 h-8"
                  style={{ ...linerPatternStyle(linerPattern, linerPatternColor, dna.backgroundColor), clipPath: "polygon(0 0, 100% 0, 50% 100%)" }}
                />
                <div
                  className="absolute inset-x-0 bottom-0 h-8"
                  style={{ background: `linear-gradient(to bottom, ${shadeHex(envelopeColor, 0.04)}, ${shadeHex(envelopeColor, -0.06)})` }}
                />
                <div
                  className="absolute inset-x-0 top-0 h-8"
                  style={{
                    background: `linear-gradient(to bottom, ${envelopeColor}, ${shadeHex(envelopeColor, -0.18)})`,
                    clipPath: "polygon(0 0, 100% 0, 50% 100%)",
                  }}
                />
              </div>
              <p className="mt-1 text-[9px] text-muted-foreground">Envelope</p>
            </div>
            <div className="rounded-md border border-border bg-background p-2">
              <div className="flex h-14 items-center justify-center rounded-sm" style={{ backgroundColor: dna.backgroundColor }}>
                <span className="h-11 w-9" style={{ filter: "drop-shadow(0 1px 1.5px rgba(24,18,12,0.22))" }}>
                  <PostageStamp style={stamp} color={stampColorVal} paperColor={shadeHex(envelopeColor, 0.82)} />
                </span>
              </div>
              <p className="mt-1 text-[9px] text-muted-foreground">Stamp</p>
            </div>
            <div className="rounded-md border border-border bg-background p-2">
              <div className="flex h-14 items-center justify-center rounded-sm px-1 text-center" style={{ backgroundColor: dna.backgroundColor }}>
                <span className="text-[9px] capitalize" style={{ color: dna.accentColor }}>{dna.motifDescriptor}</span>
              </div>
              <p className="mt-1 text-[9px] text-muted-foreground">Backdrop</p>
            </div>
            <div className="rounded-md border border-border bg-background p-2">
              <div className="flex h-14 flex-col items-center justify-center rounded-sm px-1 text-center" style={{ backgroundColor: dna.backgroundColor, ...conceptBorderStyle(liveConcept) }}>
                <span className="text-[10px] font-semibold" style={conceptHeadingStyle(liveConcept)}>Thank you</span>
              </div>
              <p className="mt-1 text-[9px] text-muted-foreground">Thank-you</p>
            </div>
          </div>
        </div>

        {/* ═══ RIGHT: Controls ════════════════════════════════════ */}
        <div className="space-y-5">
          {/* ── Text Editor ─────────────────────────────────────────── */}
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-foreground">
              <Type className="h-3.5 w-3.5" /> Invitation Text
            </p>
            <label className="text-[11px] text-muted-foreground">Headline</label>
            <Input
              value={inviteSubject}
              onChange={(e) => onSubjectChange(e.target.value)}
              className="mt-1 mb-2"
              placeholder="You're invited to {{eventName}}!"
              data-testid="input-invite-subject"
            />
            <label className="text-[11px] text-muted-foreground">Message</label>
            <Textarea
              value={inviteMessage}
              onChange={(e) => onMessageChange(e.target.value)}
              rows={6}
              className="mt-1 min-h-[150px] resize-y text-sm leading-relaxed"
              placeholder="Join us on {{eventDate}} at {{location}}."
              data-testid="input-invite-message"
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              Use {"{{eventName}}"}, {"{{eventDate}}"}, {"{{location}}"}, {"{{hostNames}}"} — they auto-fill for each guest.
            </p>
          </div>

          {/* ── Font Picker ───────────────────────────────────────── */}
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-foreground">
              <Type className="h-3.5 w-3.5" /> Fonts
            </p>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {FONT_PAIRINGS.map((font) => {
                const selected = font.id === fontPairingId;
                return (
                  <button
                    key={font.id}
                    type="button"
                    onClick={() => onFontChange(font.id)}
                    className={`flex items-center justify-between rounded-md border px-3 py-2 text-left transition-colors ${
                      selected
                        ? "border-primary bg-primary/10 ring-1 ring-primary/30"
                        : "border-border bg-background hover:bg-muted"
                    }`}
                    data-testid={`button-font-${font.id}`}
                  >
                    <div className="min-w-0">
                      <p
                        className="truncate text-sm font-semibold"
                        style={{ fontFamily: font.headingFontFamily, fontWeight: font.headingWeight ?? 600 }}
                      >
                        {font.label}
                      </p>
                      <p
                        className="truncate text-[11px] text-muted-foreground"
                        style={{ fontFamily: font.bodyFontFamily }}
                      >
                        Aa Bb 123
                      </p>
                    </div>
                    {selected && <Check className="ml-2 h-4 w-4 shrink-0 text-primary" />}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Layout Switcher ────────────────────────────────────── */}
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-foreground">
              <LayoutIcon className="h-3.5 w-3.5" /> Layout
            </p>
            <div className="flex flex-wrap gap-1.5">
              {LAYOUT_STYLES.map((layout) => {
                const selected = layout === layoutStyle;
                const info = LAYOUT_LABELS[layout];
                return (
                  <button
                    key={layout}
                    type="button"
                    onClick={() => onLayoutChange(layout)}
                    className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                      selected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background text-muted-foreground hover:bg-muted"
                    }`}
                    data-testid={`button-layout-${layout}`}
                  >
                    <span className="text-sm">{info.icon}</span>
                    {info.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Border Style ──────────────────────────────────────── */}
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-foreground">
              <PaletteIcon className="h-3.5 w-3.5" /> Border
            </p>
            <div className="flex flex-wrap gap-1.5">
              {BORDER_STYLES.map((border) => {
                const selected = border === borderStyle;
                return (
                  <button
                    key={border}
                    type="button"
                    onClick={() => onBorderChange(border)}
                    className={`rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                      selected
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background text-muted-foreground hover:bg-muted"
                    }`}
                    data-testid={`button-border-${border}`}
                  >
                    {BORDER_LABELS[border]}
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── Color Palette ─────────────────────────────────────── */}
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-foreground">
              <PaletteIcon className="h-3.5 w-3.5" /> Colors
            </p>
            <div className="flex items-center gap-2">
              <PaletteEditor
                colors={paletteColors}
                size="md"
                testIdPrefix="swatch-live-palette"
                onChange={onColorChange}
              />
              <span className="text-[11px] text-muted-foreground">Click any color to change it</span>
            </div>
          </div>

          {/* ── Suite Controls ────────────────────────────────────── */}
          <div className="border-t border-border pt-3">
            <p className="mb-1 text-xs font-semibold text-foreground">Design Suite</p>
            <p className="mb-2 text-[11px] text-muted-foreground">Everything around the invite, matched automatically.</p>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">Envelope:</span>
                <PaletteEditor
                  colors={[envelopeColor]}
                  size="sm"
                  testIdPrefix="swatch-envelope-color"
                  onChange={(_i: number, color: string) => updateSuite.mutate({ envelopeColor: color })}
                />
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground">Liner:</span>
                {LINER_PATTERNS.map((p) => (
                  <Button
                    key={p}
                    size="sm"
                    variant={p === linerPattern ? "default" : "outline"}
                    className="h-7 px-2.5 text-[11px] capitalize"
                    onClick={() => updateSuite.mutate({ envelopeLinerPattern: p })}
                    disabled={updateSuite.isPending}
                  >
                    {p}
                  </Button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">Liner color:</span>
                <PaletteEditor
                  colors={[linerPatternColor]}
                  size="sm"
                  testIdPrefix="swatch-liner-color"
                  onChange={(_i: number, color: string) => updateSuite.mutate({ linerColor: color })}
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">Stamp:</span>
                {STAMP_STYLES.map((s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant={s === stamp ? "default" : "outline"}
                    className="h-7 px-2.5 text-[11px] capitalize"
                    onClick={() => updateSuite.mutate({ stampStyle: s })}
                    disabled={updateSuite.isPending}
                  >
                    {s.replace(/-/g, " ")}
                  </Button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">Stamp color:</span>
                <PaletteEditor
                  colors={[stampColorVal]}
                  size="sm"
                  testIdPrefix="swatch-stamp-color"
                  onChange={(_i: number, color: string) => updateSuite.mutate({ stampColor: color })}
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Action buttons ────────────────────────────────────────── */}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Button size="sm" variant="outline" onClick={onBrowse} data-testid="button-change-design">
          <Wand2 className="mr-1.5 h-3.5 w-3.5" /> Change design
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => artworkInputRef.current?.click()}
          disabled={uploadOwnImage.isPending}
          data-testid="button-upload-own-image"
        >
          <ImagePlus className="mr-1.5 h-3.5 w-3.5" /> {uploadOwnImage.isPending ? "Uploading…" : "Use your own photo"}
        </Button>
        <input
          ref={artworkInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) uploadOwnImage.mutate(file);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => customDesignInputRef.current?.click()}
          disabled={uploadCustomDesign.isPending}
          className="text-[11px] font-medium text-primary underline underline-offset-2 disabled:opacity-60"
        >
          {uploadCustomDesign.isPending ? "Uploading your design…" : "Already have a design? Upload it instead"}
        </button>
        <input
          ref={customDesignInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) uploadCustomDesign.mutate(file);
            e.target.value = "";
          }}
        />
        <Button
          size="sm"
          variant="ghost"
          onClick={() => clearConcept.mutate()}
          disabled={clearConcept.isPending}
          className="text-destructive hover:text-destructive"
          data-testid="button-remove-concept"
        >
          <X className="mr-1.5 h-3.5 w-3.5" /> Remove
        </Button>
      </div>
      <AskPosy page="editor" />
    </div>
  );
}

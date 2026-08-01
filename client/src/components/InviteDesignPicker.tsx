import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, apiRequestJson, queryClient } from "@/lib/queryClient";
import { readImageFileAsDataUrl } from "@/lib/imageUpload";
import {
  type InviteDesignConcept,
  parseInviteDesignConcept,
  getFontPairing,
  conceptHeadingStyle,
  conceptBodyStyle,
  conceptBorderStyle,
  STYLE_LANES,
  getStyleLane,
} from "@shared/inviteDesign";
import {
  type LinerPattern,
  type StampStyle,
  LINER_PATTERNS,
  STAMP_STYLES,
  deriveThemeDna,
  linerPatternStyle,
  stampGlyph,
  isLinerPattern,
  isStampStyle,
} from "@shared/themeDna";
import type { EventDnaProfile } from "@shared/eventDna";
import type { EventRecord } from "@/lib/types";
import { applyInviteTokens } from "@shared/inviteTokens";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import PaletteEditor from "@/components/PaletteEditor";
import LiveInviteEditor from "@/components/LiveInviteEditor";
import { useToast } from "@/hooks/use-toast";
import { Sparkles, Wand2, RotateCcw, X, Check, ImagePlus, Heart, ThumbsDown, ArrowLeft } from "lucide-react";
import ThemeChooser from "./ThemeChooser";
import InviteStudio from "./InviteStudio";
import AiFirstInvitations from "./AiFirstInvitations";
import { resolveThemeView } from "@/lib/themeInvite";
import { useFeatureFlags } from "@/lib/featureFlags";
import { useAiFirstSession } from "@/lib/aiFirstSession";

interface InviteDesignPickerProps {
  ownerToken: string;
  event: EventRecord;
}

// Contextual refinement options — plain language a non-designer would use.
// Replaces the old developer-oriented chips like "More elegant" / "More playful".
const REFINE_OPTIONS = [
  "Show me different colors",
  "Show me different artwork",
  "Show me completely different designs",
] as const;

export default function InviteDesignPicker({ ownerToken, event }: InviteDesignPickerProps) {
  const { toast } = useToast();
  const flags = useFeatureFlags();
  // Owned here rather than inside AiFirstInvitations so switching to the
  // collection and back does not discard generated directions or filters.
  const aiFirst = useAiFirstSession(ownerToken);
  const [themePromptDraft, setThemePromptDraft] = useState(event.themeName || "");
  const [concepts, setConcepts] = useState<InviteDesignConcept[] | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const [appliedConceptIndex, setAppliedConceptIndex] = useState<number | null>(null);
  // Real AI artwork a host has previewed per concept card (keyed by index),
  // so they can see the actual illustration before committing to one.
  const [previewUrls, setPreviewUrls] = useState<Record<number, string>>({});
  const [previewingIndexes, setPreviewingIndexes] = useState<Set<number>>(new Set());
  const [generatingAll, setGeneratingAll] = useState(false);
  // Tracks cards where artwork generation failed — used to show a graceful
  // fallback label instead of an error toast (Pattern 3: Resilient Fallback)
  const [failedPreviews, setFailedPreviews] = useState<Set<number>>(new Set());
  // Named stage label for the progress indicator (Pattern 2: Named Stages)
  const [stageLabel, setStageLabel] = useState<string>("");
  const [refineFeedback, setRefineFeedback] = useState("");
  // Selected vibe/style lanes — when the host picks exactly 4, concepts are
  // generated in those lanes. Empty array = let the AI choose 4 lanes.
  const [selectedStyleLanes, setSelectedStyleLanes] = useState<string[]>([]);
  // Per-card feedback: tracks which concepts the host loves or doesn't like,
  // so we can offer "show more like this" instead of generic refinement.
  const [likedConcepts, setLikedConcepts] = useState<Set<number>>(new Set());
  const [dislikedConcepts, setDislikedConcepts] = useState<Set<number>>(new Set());
  // Optional inspiration images (data URLs, up to 3) the host uploads to steer
  // the mood/style of generated concepts, plus the short style summary the
  // server extracts from them.
  const [inspirationImages, setInspirationImages] = useState<string[]>([]);
  const [inspirationNotes, setInspirationNotes] = useState<string | null>(null);
  const artworkInputRef = useRef<HTMLInputElement>(null);
  const inspirationInputRef = useRef<HTMLInputElement>(null);
  const customDesignInputRef = useRef<HTMLInputElement>(null);
  // When true, show the AI custom theme generation form instead of the gallery
  const [showCustomTheme, setShowCustomTheme] = useState(false);
  // Set when a curated design was applied in this session, so the studio knows
  // to pull itself into view. A host arriving on an already-themed event is
  // left where they are.
  const [cameFromChooser, setCameFromChooser] = useState(false);

  const appliedConcept = parseInviteDesignConcept(event.inviteDesignConceptJson);

  const invalidateEvent = () => {
    queryClient.invalidateQueries({ queryKey: [`/api/events/owner/${ownerToken}`] });
  };

  // Event DNA: a quiet, read-only style profile inferred from menu/budget/event-type
  // choices already made elsewhere. Shown as context, never as an editable form —
  // it exists to explain why generated concepts lean a certain way, not to be tuned.
  const dnaQuery = useQuery<EventDnaProfile>({
    queryKey: [`/api/events/owner/${ownerToken}/dna`],
  });

  const generateConcepts = useMutation({
    mutationFn: async () =>
      apiRequestJson<{ concepts: InviteDesignConcept[]; dnaProfile: EventDnaProfile; inspirationNotes?: string }>(
        "POST",
        `/api/events/owner/${ownerToken}/invite/generate-concepts`,
        { themePrompt: themePromptDraft, inspirationImages, preferredStyleLanes: selectedStyleLanes.length > 0 ? selectedStyleLanes : undefined },
      ),
    onSuccess: (result) => {
      setConcepts(result.concepts);
      setAppliedConceptIndex(null);
      setPreviewUrls({});
      setFailedPreviews(new Set());
      setInspirationNotes(result.inspirationNotes ?? null);
      setLikedConcepts(new Set());
      setDislikedConcepts(new Set());
      toast({ title: "4 design concepts ready", description: "Generating artwork — hang tight…" });
      // Auto-generate artwork for all concepts so the host sees real art immediately
      generateAllArtwork(result.concepts);
    },
    onError: () => {
      toast({ title: "Couldn't generate design concepts", description: "Please try again in a moment.", variant: "destructive" });
    },
  });

  // "Not quite right?" refinement: sends the 4 concepts the host is looking at
  // plus plain-English feedback, and swaps in 4 new concepts that address it.
  // The new set is fresh, so per-card previews and the applied badge reset.
  const refineConcepts = useMutation({
    mutationFn: async (feedback: string) =>
      apiRequestJson<{ concepts: InviteDesignConcept[]; dnaProfile: EventDnaProfile; inspirationNotes?: string }>(
        "POST",
        `/api/events/owner/${ownerToken}/invite/refine-concepts`,
        { themePrompt: themePromptDraft, previousConcepts: concepts ?? [], feedback, inspirationImages },
      ),
    onSuccess: (result) => {
      setConcepts(result.concepts);
      setAppliedConceptIndex(null);
      setPreviewUrls({});
      setFailedPreviews(new Set());
      setRefineFeedback("");
      setInspirationNotes(result.inspirationNotes ?? null);
      setLikedConcepts(new Set());
      setDislikedConcepts(new Set());
      toast({ title: "4 fresh concepts ready", description: "Generating artwork…" });
      generateAllArtwork(result.concepts);
    },
    onError: () => {
      toast({ title: "Couldn't refine the concepts", description: "Please try again in a moment.", variant: "destructive" });
    },
  });

  const applyConcept = useMutation({
    mutationFn: async ({ concept, index }: { concept: InviteDesignConcept; index: number }) =>
      apiRequestJson<EventRecord>("POST", `/api/events/owner/${ownerToken}/invite/apply-concept`, {
        concept,
        // Don't send the medium-quality preview URL — let the server generate
        // a high-quality, quality-gated final illustration that guests actually
        // see on the invite and RSVP page. The preview was good enough for
        // browsing/comparison but should not be the final artwork.
        illustrationUrl: null,
      }),
    onSuccess: (_data, variables) => {
      invalidateEvent();
      queryClient.invalidateQueries({ queryKey: [`/api/events/owner/${ownerToken}/dna`] });
      // Keep the 4 concepts in memory so "Change design" shows them again
      // instead of forcing a regenerate; just record which one is applied.
      setAppliedConceptIndex(variables.index);
      setBrowsing(false);
      toast({ title: "Design applied", description: "Your invite, RSVP page, and thank-you card now match this look." });
    },
    onError: () => {
      toast({ title: "Couldn't apply this design", description: "The illustration generator may be busy — please try again.", variant: "destructive" });
    },
  });

  const clearConcept = useMutation({
    mutationFn: async () => apiRequestJson<EventRecord>("POST", `/api/events/owner/${ownerToken}/invite/clear-concept`),
    onSuccess: () => {
      invalidateEvent();
      queryClient.invalidateQueries({ queryKey: [`/api/events/owner/${ownerToken}/dna`] });
      toast({ title: "AI design removed", description: "Back to your manual font and color choices." });
    },
  });

  // Palette-only tweak on an already-applied concept — free for every plan
  // tier, and never touches the illustration (no regeneration cost).
  const updateConceptPalette = useMutation({
    mutationFn: async (paletteColors: string[]) =>
      apiRequestJson<EventRecord>("PATCH", `/api/events/owner/${ownerToken}/invite/concept-palette`, { paletteColors }),
    onSuccess: () => {
      invalidateEvent();
      toast({ title: "Colors updated" });
    },
    onError: () => {
      toast({ title: "Couldn't update colors", description: "Please try again.", variant: "destructive" });
    },
  });

  // Coordinated stationery suite (envelope, liner, stamp). Each control sends
  // only the field it changed, so the other two keep whatever the host — or the
  // concept's derived defaults — already set.
  const updateSuite = useMutation({
    mutationFn: async (updates: { envelopeColor?: string; envelopeLinerPattern?: LinerPattern; stampStyle?: StampStyle; linerColor?: string; stampColor?: string }) =>
      apiRequestJson<EventRecord>("PATCH", `/api/events/owner/${ownerToken}/invite/suite`, updates),
    onSuccess: () => {
      invalidateEvent();
    },
    onError: () => {
      toast({ title: "Couldn't update the suite", description: "Please try again.", variant: "destructive" });
    },
  });

  // Swaps the AI-generated illustration for a host's own photo, while
  // keeping the applied concept's palette, fonts, and border — free for
  // every plan tier, no new illustration generation cost.
  const uploadOwnImage = useMutation({
    mutationFn: async (file: File) => {
      const dataUrl = await readImageFileAsDataUrl(file);
      await apiRequest("PATCH", `/api/events/owner/${ownerToken}`, { inviteIllustrationUrl: dataUrl });
    },
    onSuccess: () => {
      invalidateEvent();
      toast({ title: "Your photo is now on the invite", description: "The colors, fonts, and border from your design stay the same." });
    },
    onError: () => {
      toast({ title: "Couldn't use that image", description: "Please try a different photo.", variant: "destructive" });
    },
  });

  // "Upload my complete invitation design" — a finished invite used AS-IS,
  // with no Posy border, font overlay, or palette. Different from
  // uploadOwnImage above, which slots a photo INTO a Posy concept template.
  const uploadCustomDesign = useMutation({
    mutationFn: async (file: File) => {
      const dataUrl = await readImageFileAsDataUrl(file);
      await apiRequest("PATCH", `/api/events/owner/${ownerToken}/invite/custom-design`, { imageDataUrl: dataUrl });
    },
    onSuccess: () => {
      invalidateEvent();
      toast({ title: "Your design is live", description: "Guests will see your invitation exactly as you uploaded it." });
    },
    onError: () => {
      toast({ title: "Couldn't upload that design", description: "Please try a different image.", variant: "destructive" });
    },
  });

  // Non-destructive revert: clears only inviteRenderMode, so a previously
  // applied concept (and the uploaded design) both stay intact.
  const clearCustomDesign = useMutation({
    mutationFn: async () => apiRequest("PATCH", `/api/events/owner/${ownerToken}/invite/custom-design/clear`),
    onSuccess: () => {
      invalidateEvent();
      toast({ title: "Back to Posy's design tools", description: "Your uploaded design is saved if you want it again." });
    },
    onError: () => {
      toast({ title: "Couldn't switch back", description: "Please try again.", variant: "destructive" });
    },
  });

  // Generates the real AI artwork for one concept without committing it, so a
  // host can see the actual illustration on the card before applying. The url
  // is cached in previewUrls and later handed to apply-concept so the same
  // image isn't paid for twice.
  // Pattern 3: On failure, silently marks the card as fallback — no error toast.
  // The card stays in its styled CSS placeholder state with a subtle label.
  const runPreview = async (concept: InviteDesignConcept, index: number) => {
    if (previewingIndexes.has(index)) return;
    setPreviewingIndexes((prev) => new Set(prev).add(index));
    try {
      const result = await apiRequestJson<{ illustrationUrl: string | null; fallback?: boolean }>(
        "POST",
        `/api/events/owner/${ownerToken}/invite/preview-concept`,
        { concept },
      );
      if (result.illustrationUrl) {
        const url: string = result.illustrationUrl;
        setPreviewUrls((prev) => ({ ...prev, [index]: url }));
        // Clear any previous failure flag for this card
        setFailedPreviews((prev) => {
          const next = new Set(prev);
          next.delete(index);
          return next;
        });
      } else if (result.fallback) {
        // Server tried twice and failed — mark as fallback, no error toast
        setFailedPreviews((prev) => new Set(prev).add(index));
      }
    } catch {
      // Network error or unexpected failure — mark as fallback, no error toast
      setFailedPreviews((prev) => new Set(prev).add(index));
    } finally {
      setPreviewingIndexes((prev) => {
        const next = new Set(prev);
        next.delete(index);
        return next;
      });
    }
  };

  // Previews artwork for all 4 concepts that don't have one yet, two at a time
  // so the grid fills in progressively without hammering the image API.
  // Accepts an optional conceptList to avoid stale state when called from
  // onSuccess callbacks (where setConcepts hasn't flushed yet).
  const generateAllArtwork = async (conceptList?: InviteDesignConcept[]) => {
    const list = conceptList ?? concepts;
    if (!list || generatingAll) return;
    setGeneratingAll(true);
    setFailedPreviews(new Set());
    setStageLabel("Painting artwork…");
    try {
      const pending = list
        .map((concept, index) => ({ concept, index }))
        .filter(({ index }) => !previewUrls[index]);
      let cursor = 0;
      const worker = async () => {
        while (cursor < pending.length) {
          const item = pending[cursor++];
          await runPreview(item.concept, item.index);
          // Update stage label based on progress (Pattern 2: Named Stages)
          const completed = list.filter((_, i) => previewUrls[i] || failedPreviews.has(i)).length;
          if (completed < list.length) {
            setStageLabel(`Painting artwork (${completed} of ${list.length})…`);
          }
        }
      };
      await Promise.all([worker(), worker()]);
      setStageLabel("");
    } finally {
      setGeneratingAll(false);
    }
  };

  // Reads picked inspiration files into compressed data URLs (same helper as
  // "Use your own photo"), capping the total kept at 3.
  const addInspirationImages = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const room = 3 - inspirationImages.length;
    if (room <= 0) {
      toast({ title: "Up to 3 inspiration images", description: "Remove one to add another." });
      return;
    }
    try {
      const dataUrls = await Promise.all(Array.from(files).slice(0, room).map(readImageFileAsDataUrl));
      setInspirationImages((prev) => [...prev, ...dataUrls].slice(0, 3));
    } catch {
      toast({ title: "Couldn't add that image", description: "Please try a different file.", variant: "destructive" });
    }
  };

  // The "Add inspiration (optional)" control + thumbnails, reused near the
  // theme input and inside the refinement section. A single shared hidden file
  // input (rendered once below) is triggered by every "Add inspiration" button.
  const renderInspirationControl = (location: "theme" | "refine") => (
    <div className="mt-2" data-testid={`inspiration-control-${location}`}>
      <Button
        size="sm"
        variant="outline"
        className="h-auto px-2.5 py-1 text-[11px]"
        onClick={() => inspirationInputRef.current?.click()}
        disabled={inspirationImages.length >= 3}
        data-testid={`button-add-inspiration-${location}`}
      >
        <ImagePlus className="mr-1.5 h-3.5 w-3.5" />
        {inspirationImages.length > 0 ? `Inspiration (${inspirationImages.length}/3)` : "Add inspiration (optional)"}
      </Button>
      {inspirationImages.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1.5" data-testid={`inspiration-thumbs-${location}`}>
          {inspirationImages.map((src, i) => (
            <div key={i} className="relative h-12 w-12 overflow-hidden rounded border border-border">
              <img src={src} alt="" className="h-full w-full object-cover" data-testid={`img-inspiration-${location}-${i}`} />
              <button
                type="button"
                onClick={() => setInspirationImages((prev) => prev.filter((_, j) => j !== i))}
                className="absolute right-0 top-0 flex h-4 w-4 items-center justify-center rounded-bl bg-black/60 text-white"
                aria-label="Remove inspiration image"
                data-testid={`button-remove-inspiration-${location}-${i}`}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // The hidden file input + entry-point link for full-custom upload. Rendered
  // in every non-custom branch so a host can switch to their own finished
  // design whether or not they've generated or applied a concept yet.
  // The coordinated suite that surrounds the invite. Everything defaults to the
  // concept's derived Theme DNA, so an event whose suite fields are still empty
  // (any event created before this feature) shows a complete, sensible suite.
  const renderSuiteSection = (concept: InviteDesignConcept) => {
    const dna = deriveThemeDna(concept);
    const envelopeColor = /^#[0-9a-fA-F]{6}$/.test(event.envelopeColor || "") ? (event.envelopeColor as string) : dna.primaryColor;
    const linerPattern: LinerPattern = isLinerPattern(event.envelopeLinerPattern) ? event.envelopeLinerPattern : dna.linerPattern;
    const stamp: StampStyle = isStampStyle(event.stampStyle) ? event.stampStyle : dna.stampStyle;
    const stampMark = stampGlyph(stamp);
    // Custom colors override derived DNA colors — empty string means "use derived"
    const linerPatternColor = /^#[0-9a-fA-F]{6}$/.test(event.linerColor || "") ? (event.linerColor as string) : dna.accentColor;
    const stampColorVal = /^#[0-9a-fA-F]{6}$/.test(event.stampColor || "") ? (event.stampColor as string) : dna.accentColor;

    return (
      <div className="mt-4 border-t border-primary/20 pt-3" data-testid="section-design-suite">
        <p className="text-xs font-semibold text-foreground">Your design suite</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Everything around the invite, matched to it automatically. Adjust anything you like.
        </p>

        <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="row-suite-previews">
          <div className="rounded-md border border-border bg-background p-2" data-testid="preview-suite-envelope">
            <div
              className="relative h-16 overflow-hidden rounded-sm"
              style={{ backgroundColor: envelopeColor }}
            >
              {/* The liner shows as the inside of the open flap. */}
              <div className="absolute inset-x-0 bottom-0 h-8" style={linerPatternStyle(linerPattern, linerPatternColor, dna.backgroundColor)} />
              <div
                className="absolute inset-x-0 top-0 h-8"
                style={{ backgroundColor: envelopeColor, clipPath: "polygon(0 0, 100% 0, 50% 100%)" }}
              />
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">Envelope</p>
          </div>

          <div className="rounded-md border border-border bg-background p-2" data-testid="preview-suite-stamp">
            <div className="flex h-16 items-center justify-center rounded-sm" style={{ backgroundColor: dna.backgroundColor }}>
              <span
                className="flex h-10 w-9 items-center justify-center rounded-[2px] border-2 border-dashed text-lg"
                style={{ borderColor: stampColorVal, color: stampColorVal }}
                data-testid="glyph-suite-stamp"
              >
                {stampMark.glyph}
              </span>
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">Stamp — {stampMark.label}</p>
          </div>

          <div className="rounded-md border border-border bg-background p-2" data-testid="preview-suite-backdrop">
            <div
              className="flex h-16 items-center justify-center rounded-sm px-1 text-center"
              style={{ backgroundColor: dna.backgroundColor }}
            >
              <span className="text-[10px] capitalize" style={{ color: dna.accentColor }} data-testid="text-suite-motif">
                {dna.motifDescriptor}
              </span>
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">Backdrop</p>
          </div>

          <div className="rounded-md border border-border bg-background p-2" data-testid="preview-suite-thankyou">
            <div
              className="flex h-16 flex-col items-center justify-center rounded-sm px-1 text-center"
              style={{ backgroundColor: dna.backgroundColor, ...conceptBorderStyle(concept) }}
            >
              <span className="text-[11px] font-semibold" style={conceptHeadingStyle(concept)}>Thank you</span>
              <span className="text-[9px] text-muted-foreground" style={conceptBodyStyle(concept)}>for celebrating</span>
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">Thank-you card</p>
          </div>
        </div>

        <div className="mt-3 space-y-2.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Envelope color:</span>
            <PaletteEditor
              colors={[envelopeColor]}
              size="sm"
              testIdPrefix="swatch-envelope-color"
              onChange={(_i, color) => updateSuite.mutate({ envelopeColor: color })}
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
                data-testid={`button-liner-${p}`}
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
              onChange={(_i, color) => updateSuite.mutate({ linerColor: color })}
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Stamp:</span>
            <Select value={stamp} onValueChange={(v) => updateSuite.mutate({ stampStyle: v as StampStyle })}>
              <SelectTrigger className="h-7 w-36 text-xs" data-testid="select-stamp-style">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STAMP_STYLES.map((s) => (
                  <SelectItem key={s} value={s} className="capitalize">{s.replace("-", " ")}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs text-muted-foreground">Stamp color:</span>
            <PaletteEditor
              colors={[stampColorVal]}
              size="sm"
              testIdPrefix="swatch-stamp-color"
              onChange={(_i, color) => updateSuite.mutate({ stampColor: color })}
            />
          </div>
        </div>
      </div>
    );
  };

  const renderCustomDesignEntry = () => (
    <>
      <input
        ref={customDesignInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        data-testid="input-custom-design"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) uploadCustomDesign.mutate(file);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => customDesignInputRef.current?.click()}
        disabled={uploadCustomDesign.isPending}
        className="mt-2 text-left text-[11px] font-medium text-primary underline underline-offset-2 disabled:opacity-60"
        data-testid="button-upload-custom-design"
      >
        {uploadCustomDesign.isPending ? "Uploading your design…" : "Already have a design? Upload it instead"}
      </button>
    </>
  );

  // Full-custom mode: the host's finished invitation is shown exactly as
  // uploaded — no border, no font overlay, no palette. Takes priority over
  // the concept-driven views below. Gated on an explicit "custom" check so
  // every pre-existing event (inviteRenderMode "" or absent) is unaffected.
  if (event.inviteRenderMode === "custom" && event.customInviteImageUrl) {
    return (
      <div className="rounded-md border border-primary/30 bg-primary/5 p-4" data-testid="card-custom-invite-design">
        <p className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-primary">
          <ImagePlus className="h-3.5 w-3.5" /> Your own invitation design
        </p>
        <div className="overflow-hidden rounded-md bg-muted">
          <img
            src={event.customInviteImageUrl}
            alt="Your uploaded invitation design"
            className="max-h-[28rem] w-full object-contain"
            data-testid="img-custom-invite-design"
          />
        </div>
        <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-foreground" data-testid="text-custom-design-live">
          <Check className="h-3.5 w-3.5 text-primary" /> This design is now live — no Posy styling is applied.
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          Guests see your image exactly as uploaded. Event details and the RSVP form appear below it in the page's normal type.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            variant="outline"
            onClick={() => customDesignInputRef.current?.click()}
            disabled={uploadCustomDesign.isPending}
            data-testid="button-replace-custom-design"
          >
            <ImagePlus className="mr-1.5 h-3.5 w-3.5" /> {uploadCustomDesign.isPending ? "Uploading…" : "Replace design"}
          </Button>
          <button
            type="button"
            onClick={() => clearCustomDesign.mutate()}
            disabled={clearCustomDesign.isPending}
            className="text-[11px] font-medium text-primary underline underline-offset-2 disabled:opacity-60"
            data-testid="button-switch-back-to-posy"
          >
            {clearCustomDesign.isPending ? "Switching back…" : "Switch back to Posy's design tools"}
          </button>
        </div>
        <input
          ref={customDesignInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          data-testid="input-custom-design"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) uploadCustomDesign.mutate(file);
            e.target.value = "";
          }}
        />
      </div>
    );
  }

  // ═══ Stage 2: curated theme studio ════════════════════════════════════
  // A curated theme has its own composed-portrait studio. The AI concept path
  // below keeps the older live editor, which is built around a generated
  // illustration rather than art-directed artwork.
  if (resolveThemeView(event) && !browsing) {
    return (
      <div data-testid="card-invite-studio">
        <InviteStudio
          ownerToken={ownerToken}
          event={event}
          focusOnMount={cameFromChooser}
          onChangeDesign={() => {
            setBrowsing(true);
            setConcepts(null);
            setShowCustomTheme(false);
            setCameFromChooser(false);
          }}
        />
        {renderCustomDesignEntry()}
      </div>
    );
  }

  if (appliedConcept && !browsing) {
    return (
      <LiveInviteEditor
        ownerToken={ownerToken}
        event={event}
        onBrowse={() => { setBrowsing(true); setConcepts(null); setShowCustomTheme(false); }}
      />
    );
  }

  // ═══ Stage 1, flag on: the AI-first experience ════════════════════════
  // Four generated directions, revealed as the gate approves them. The
  // collection is one click away and keeps its place.
  if (flags.aiFirstInvitations && !showCustomTheme && !aiFirst.browsingCollection) {
    return (
      <div data-testid="card-ai-first-invitations">
        <AiFirstInvitations
          ownerToken={ownerToken}
          event={event}
          session={aiFirst}
          onBrowseCollection={() => aiFirst.setBrowsingCollection(true)}
        />
        {renderCustomDesignEntry()}
      </div>
    );
  }

  // ═══ Stage 1: curated design catalogue ════════════════════════════════
  // The primary experience. Applying a design is instant — static artwork plus
  // design metadata, no image model. AI generation is a secondary path.
  if (!showCustomTheme) {
    return (
      <div data-testid="card-theme-gallery">
        {aiFirst.browsingCollection && (
          <button
            type="button"
            onClick={() => aiFirst.setBrowsingCollection(false)}
            className="mb-4 flex items-center gap-1 text-xs font-medium text-primary underline underline-offset-2"
            data-testid="button-back-to-directions"
          >
            <ArrowLeft className="h-3 w-3" aria-hidden /> Back to my invitation directions
          </button>
        )}
        <ThemeChooser
          ownerToken={ownerToken}
          event={event}
          onCustomTheme={flags.aiFirstInvitations ? undefined : () => setShowCustomTheme(true)}
          filters={aiFirst.filters}
          onFiltersChange={aiFirst.setFilters}
          onThemeApplied={() => {
            // The event refetch resolves a theme view, which re-renders into
            // the studio automatically.
            setShowCustomTheme(false);
            setBrowsing(false);
            aiFirst.setBrowsingCollection(false);
            setCameFromChooser(true);
          }}
        />
        {renderCustomDesignEntry()}
      </div>
    );
  }

  // ═══ Secondary path: AI custom theme generation ════════════════════════
  return (
    <div className="rounded-md border border-dashed border-primary/40 bg-primary/5 p-4" data-testid="card-invite-design-picker">
      <div className="mb-2 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <Sparkles className="h-4 w-4 text-primary" /> Custom AI Theme
        </p>
        <button
          type="button"
          onClick={() => setShowCustomTheme(false)}
          className="flex items-center gap-1 text-[11px] font-medium text-primary underline underline-offset-2"
          data-testid="button-back-to-themes"
        >
          <ArrowLeft className="h-3 w-3" /> Back to themes
        </button>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Describe your party's theme and get 4 complete design concepts{" — "}palette, fonts, border, and a custom illustration{" — "}
        applied across your invite, RSVP page, and thank-you card in one click.
      </p>
      {renderCustomDesignEntry()}

      {dnaQuery.data && (
        <p
          className="mt-2 flex items-center gap-1 text-[11px] italic text-muted-foreground"
          data-testid="text-event-dna-summary"
          title={dnaQuery.data.reasons.join(" ")}
        >
          {dnaQuery.data.summary}
        </p>
      )}

      {/* Vibe Picker — optional. Host picks up to 4 style lanes to control which
          design directions the AI explores. When none are selected, the AI
          chooses 4 diverse lanes automatically. */}
      <div className="mt-3" data-testid="section-vibe-picker">
        <p className="text-xs font-medium text-foreground">Pick your vibes (optional)</p>
        <p className="mt-0.5 text-[11px] text-muted-foreground">
          Select up to 4 styles — each concept will use a different one. Pick fewer and we'll fill the rest. Or skip this and let the AI surprise you.
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {STYLE_LANES.map((lane) => {
            const selected = selectedStyleLanes.includes(lane.id);
            return (
              <button
                key={lane.id}
                type="button"
                onClick={() => {
                  if (selected) {
                    setSelectedStyleLanes(selectedStyleLanes.filter((id) => id !== lane.id));
                  } else if (selectedStyleLanes.length < 4) {
                    setSelectedStyleLanes([...selectedStyleLanes, lane.id]);
                  }
                }}
                className={
                  "h-auto rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors " +
                  (selected
                    ? "bg-primary text-primary-foreground"
                    : "border border-border bg-background text-muted-foreground hover:bg-muted")
                }
                data-testid={`chip-vibe-${lane.id}`}
              >
                {lane.label}
              </button>
            );
          })}
          {selectedStyleLanes.length > 0 && (
            <button
              type="button"
              onClick={() => setSelectedStyleLanes([])}
              className="h-auto rounded-full px-2 py-1 text-[11px] font-medium text-muted-foreground underline underline-offset-2"
              data-testid="button-clear-vibes"
            >
              Clear
            </button>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Input
          value={themePromptDraft}
          onChange={(e) => setThemePromptDraft(e.target.value)}
          placeholder="e.g. Enchanted garden tea party at golden hour"
          className="max-w-sm"
          data-testid="input-theme-prompt"
        />
        <Button
          size="sm"
          onClick={() => generateConcepts.mutate()}
          disabled={!themePromptDraft.trim() || generateConcepts.isPending}
          data-testid="button-generate-concepts"
        >
          {generateConcepts.isPending ? "Designing…" : "Generate 4 concepts"}
        </Button>
        {appliedConcept && browsing && (
          <Button size="sm" variant="ghost" onClick={() => { setBrowsing(false); setConcepts(null); }} data-testid="button-cancel-browse">
            Cancel
          </Button>
        )}
      </div>

      {/* Shared hidden file input for all "Add inspiration" buttons. */}
      <input
        ref={inspirationInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        data-testid="input-inspiration-images"
        onChange={(e) => {
          addInspirationImages(e.target.files);
          e.target.value = "";
        }}
      />
      {renderInspirationControl("theme")}
      <p className="mt-1 text-[11px] text-muted-foreground">
        Upload up to 3 images that capture the vibe you want (e.g. a Pinterest screenshot). We'll read the mood, colors, and style — never copy anyone's exact design.
      </p>

      {concepts && inspirationNotes && (
        <p className="mt-3 text-[11px] italic text-muted-foreground" data-testid="text-inspiration-notes">
          Inspired by your images: {inspirationNotes}
        </p>
      )}

      {concepts && (
        <div className="mt-4 flex items-center gap-2 text-[11px] font-medium" data-testid="progress-steps">
          <span className="flex items-center gap-1 text-primary">
            <Check className="h-3 w-3" /> Describe your vibe
          </span>
          <span className="text-muted-foreground/40">→</span>
          <span className="flex items-center gap-1 text-primary">
            <Check className="h-3 w-3" /> Browse designs
          </span>
          <span className="text-muted-foreground/40">→</span>
          <span className="flex items-center gap-1 text-muted-foreground">
            <span className="h-3 w-3 rounded-full border border-current" /> Make it yours
          </span>
        </div>
      )}

      {concepts && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          {generatingAll ? (
            <p className="flex items-center gap-1.5 text-xs font-medium text-primary" data-testid="text-auto-generating">
              <Sparkles className="h-3.5 w-3.5 animate-pulse" />
              {stageLabel || `Generating artwork (${concepts.filter((_, i) => previewUrls[i]).length} of ${concepts.length})…`}
            </p>
          ) : generateConcepts.isPending || refineConcepts.isPending ? (
            <p className="flex items-center gap-1.5 text-xs font-medium text-primary" data-testid="text-designing-concepts">
              <Sparkles className="h-3.5 w-3.5 animate-pulse" />
              Designing concepts…
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Preview the artwork on any design — then pick your favorite.
            </p>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => generateAllArtwork()}
            disabled={generatingAll || concepts.every((_, i) => previewUrls[i])}
            data-testid="button-generate-all-artwork"
          >
            <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            {generatingAll
              ? `${concepts.filter((_, i) => previewUrls[i]).length} of ${concepts.length} done`
              : "Generate artwork for all 4"}
          </Button>
        </div>
      )}

      {concepts && (
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2" data-testid="grid-invite-concepts">
          {concepts.map((concept, i) => {
            const font = getFontPairing(concept.fontPairingId);
            const isApplying = applyConcept.isPending && applyConcept.variables?.index === i;
            const isApplied = appliedConceptIndex === i;
            const previewUrl = previewUrls[i];
            const isPreviewing = previewingIndexes.has(i);
            const previewSubjectDraft = applyInviteTokens(event.inviteSubject || "You're invited to {{eventName}}!", {
              eventName: event.eventName,
              eventDate: event.eventDate,
              location: event.location,
              hostNames: event.hostNames,
            });
            const previewMessageDraft = applyInviteTokens(
              event.inviteMessage || "Join us on {{eventDate}} at {{location}}. We can't wait to celebrate with you!",
              { eventName: event.eventName, eventDate: event.eventDate, location: event.location, hostNames: event.hostNames },
            );
            // No illustration exists yet at this stage — a host is still choosing.
            // A soft gradient built from the concept's own palette stands in for
            // the AI artwork, so the mockup reads as "your actual invite" (real
            // text, real fonts, real border, real colors) rather than a generic
            // swatch row. The real illustration only generates after "Use this design."
            const placeholderArt = {
              backgroundImage: `linear-gradient(135deg, ${concept.paletteColors[2] || concept.paletteColors[0]}33, ${concept.paletteColors[3] || concept.paletteColors[1]}55)`,
            };
            // Derive the envelope/stationery DNA for this concept so we can
            // present it inside an envelope mockup during browsing — the same
            // presentation Punchbowl uses where invites are shown in envelope holders.
            const dna = deriveThemeDna(concept);
            const stampMark = stampGlyph(dna.stampStyle);
            const envelopeColor = dna.primaryColor;
            const flapColor = dna.primaryColor;
            const linerBg = linerPatternStyle(dna.linerPattern, dna.accentColor, dna.backgroundColor);
            return (
              <div
                key={i}
                className="flex flex-col justify-between rounded-md border border-border bg-background p-3"
                data-testid={`card-concept-${i}`}
              >
                <div>
                  {/* Envelope mockup */}
                  <div
                    className="relative overflow-hidden rounded-md p-1"
                    style={{ backgroundColor: envelopeColor }}
                    data-testid={`envelope-concept-${i}`}
                  >
                    {/* Envelope liner */}
                    <div className="absolute inset-0" style={linerBg} />

                    {/* Envelope flap — a triangular fold at the top, with a
                        gradient and bottom edge to create a visible fold seam. */}
                    <div
                      className="absolute inset-x-0 top-0 h-1/3"
                      style={{
                        background: `linear-gradient(to bottom, ${flapColor}, ${flapColor}dd)`,
                        clipPath: "polygon(0 0, 100% 0, 50% 100%)",
                        filter: "brightness(0.92)",
                        boxShadow: "0 1px 2px rgba(0,0,0,0.15)",
                      }}
                    />

                    {/* Postage stamp */}
                    <div
                      className="absolute right-1.5 top-1.5 z-10 flex h-7 w-6 items-center justify-center rounded-[2px] border border-dashed text-xs"
                      style={{ borderColor: dna.accentColor, color: dna.accentColor, backgroundColor: dna.backgroundColor + "cc" }}
                      data-testid={`stamp-concept-${i}`}
                    >
                      {stampMark.glyph}
                    </div>

                    {/* Invite card mockup */}
                    <div
                      className="relative m-3 overflow-hidden rounded-md bg-background shadow-xl ring-1 ring-black/5"
                      style={conceptBorderStyle(concept)}
                      data-testid={`preview-concept-${i}`}
                    >
                    {/* Layout archetype rendering — each layoutStyle has its own
                        visual structure. The placeholder art gradient stands in
                        for the real AI illustration until the host previews or applies. */}
                    {concept.layoutStyle === "banner" && (
                      previewUrl ? (
                        <img
                          src={previewUrl}
                          alt=""
                          className="h-20 w-full object-cover sm:h-24"
                          data-testid={`img-concept-preview-${i}`}
                        />
                      ) : (
                        <div className={`flex h-20 w-full items-center justify-center sm:h-24 ${(isPreviewing || (generatingAll && !failedPreviews.has(i))) ? "skeleton-shimmer animate-pulse" : ""}`} style={placeholderArt} data-testid={`art-placeholder-concept-${i}`}>
                          <span className="rounded-full bg-background/80 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                            {isPreviewing ? "Generating…" : failedPreviews.has(i) ? "Style shown — art still processing" : generatingAll ? "In queue…" : "Illustration generates after you apply"}
                          </span>
                        </div>
                      )
                    )}
                    {concept.layoutStyle === "full-bleed" && (
                      <div
                        className="relative min-h-[120px]"
                        style={previewUrl
                          ? { backgroundImage: `url(${previewUrl})`, backgroundSize: "cover", backgroundPosition: "center" }
                          : placeholderArt}
                        data-testid={previewUrl ? undefined : `art-placeholder-concept-${i}`}
                      >
                        <div className="flex min-h-[120px] flex-col justify-end p-3">
                          <div className="rounded-md bg-background/90 p-2">
                            <p className="truncate text-sm font-semibold" style={conceptHeadingStyle(concept)} data-testid={`text-concept-preview-subject-${i}`}>
                              {previewSubjectDraft}
                            </p>
                            <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground" style={conceptBodyStyle(concept)}>
                              {previewMessageDraft}
                            </p>
                          </div>
                          {!previewUrl && (
                            <span className={`mt-1.5 self-center rounded-full bg-background/80 px-2 py-0.5 text-[10px] font-medium text-muted-foreground ${(isPreviewing || generatingAll) && !failedPreviews.has(i) ? "animate-pulse" : ""}`}>
                              {isPreviewing ? "Generating…" : failedPreviews.has(i) ? "Style shown — art still processing" : generatingAll ? "In queue…" : "Illustration generates after you apply"}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                    {concept.layoutStyle === "split" && (
                      <div className="flex min-h-[100px]">
                        <div
                          className="flex w-2/5 items-center justify-center"
                          style={previewUrl
                            ? { backgroundImage: `url(${previewUrl})`, backgroundSize: "cover", backgroundPosition: "center" }
                            : placeholderArt}
                          data-testid={previewUrl ? `img-concept-preview-${i}` : `art-placeholder-concept-${i}`}
                        >
                          {!previewUrl && (
                            <span className={`rounded-full bg-background/80 px-2 py-0.5 text-[10px] font-medium text-muted-foreground ${(isPreviewing || generatingAll) && !failedPreviews.has(i) ? "animate-pulse" : ""}`}>
                              {isPreviewing ? "Generating…" : failedPreviews.has(i) ? "Art N/A" : generatingAll ? "…" : "Art"}
                            </span>
                          )}
                        </div>
                        <div className="flex-1 p-3">
                          <p className="truncate text-sm font-semibold" style={conceptHeadingStyle(concept)} data-testid={`text-concept-preview-subject-${i}`}>
                            {previewSubjectDraft}
                          </p>
                          <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs text-muted-foreground" style={conceptBodyStyle(concept)}>
                            {previewMessageDraft}
                          </p>
                        </div>
                      </div>
                    )}
                    {concept.layoutStyle === "centered" && (
                      <div className="flex flex-col items-center p-4">
                        <div
                          className="mb-3 flex h-16 w-16 items-center justify-center rounded-full"
                          style={previewUrl
                            ? { backgroundImage: `url(${previewUrl})`, backgroundSize: "cover", backgroundPosition: "center" }
                            : placeholderArt}
                          data-testid={previewUrl ? `img-concept-preview-${i}` : `art-placeholder-concept-${i}`}
                        >
                          {!previewUrl && (
                            <span className={`text-[9px] font-medium text-muted-foreground ${(isPreviewing || generatingAll) && !failedPreviews.has(i) ? "animate-pulse" : ""}`}>
                              {isPreviewing ? "..." : failedPreviews.has(i) ? "N/A" : generatingAll ? "..." : "Art"}
                            </span>
                          )}
                        </div>
                        <p className="text-center text-sm font-semibold" style={conceptHeadingStyle(concept)} data-testid={`text-concept-preview-subject-${i}`}>
                          {previewSubjectDraft}
                        </p>
                        <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-center text-xs text-muted-foreground" style={conceptBodyStyle(concept)}>
                          {previewMessageDraft}
                        </p>
                        {!previewUrl && (
                          <span className={`mt-2 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground ${(isPreviewing || generatingAll) && !failedPreviews.has(i) ? "animate-pulse" : ""}`}>
                            {isPreviewing ? "Generating…" : failedPreviews.has(i) ? "Style shown — art still processing" : generatingAll ? "In queue…" : "Illustration generates after you apply"}
                          </span>
                        )}
                      </div>
                    )}
                    {concept.layoutStyle === "backdrop" && (
                      <div
                        className="p-3"
                        style={previewUrl
                          ? { backgroundImage: `url(${previewUrl})`, backgroundSize: "cover", backgroundPosition: "center" }
                          : placeholderArt}
                        data-testid={previewUrl ? undefined : `art-placeholder-concept-${i}`}
                      >
                        <div className="rounded-md bg-background/85 p-2">
                          <p className="truncate text-sm font-semibold" style={conceptHeadingStyle(concept)} data-testid={`text-concept-preview-subject-${i}`}>
                            {previewSubjectDraft}
                          </p>
                          <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-xs text-muted-foreground" style={conceptBodyStyle(concept)}>
                            {previewMessageDraft}
                          </p>
                        </div>
                        {!previewUrl && (
                          <span className={`mt-1.5 inline-block rounded-full bg-background/80 px-2 py-0.5 text-[10px] font-medium text-muted-foreground ${(isPreviewing || generatingAll) && !failedPreviews.has(i) ? "animate-pulse" : ""}`}>
                            {isPreviewing ? "Generating…" : failedPreviews.has(i) ? "Style shown — art still processing" : generatingAll ? "In queue…" : "Illustration generates after you apply"}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  {/* End envelope mockup wrapper */}
                  </div>

                  <div className="mt-2 flex items-center gap-1.5" data-testid={`row-concept-palette-${i}`}>
                    {concept.paletteColors.map((c, ci) => (
                      <span
                        key={ci}
                        className="h-4 w-4 rounded-full border border-black/10"
                        style={{ backgroundColor: c }}
                        title={c}
                      />
                    ))}
                    <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {concept.styleLaneId ? (getStyleLane(concept.styleLaneId)?.label ?? concept.layoutStyle) : concept.layoutStyle === "banner" ? "Banner art" : "Backdrop art"}
                    </span>
                    {isApplied && (
                      <span
                        className="ml-auto flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary"
                        data-testid={`badge-applied-concept-${i}`}
                      >
                        <Check className="h-3 w-3" /> Applied
                      </span>
                    )}
                  </div>
                  <p className="mt-1 truncate text-sm font-medium" data-testid={`text-concept-name-${i}`}>
                    {concept.conceptName}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {concept.description}
                  </p>
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    {font.label} {"·"} {concept.borderStyle.replace("-", " ")}
                  </p>
                </div>
                <div className="mt-3 flex flex-col gap-2">
                  <Button
                    size="sm"
                    onClick={() => runPreview(concept, i)}
                    disabled={isPreviewing || generatingAll}
                    data-testid={`button-preview-concept-${i}`}
                  >
                    <Sparkles className={`mr-1.5 h-3.5 w-3.5 ${isPreviewing ? "animate-pulse" : ""}`} />
                    {isPreviewing ? "Generating artwork…" : previewUrl ? "Regenerate art" : generatingAll ? "In queue…" : "Preview artwork"}
                  </Button>
                  {(previewUrl || failedPreviews.has(i)) && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => applyConcept.mutate({ concept, index: i })}
                      disabled={applyConcept.isPending}
                      data-testid={`button-apply-concept-${i}`}
                    >
                      {isApplying ? "Polishing artwork…" : (
                        <>
                          <Check className="mr-1.5 h-3.5 w-3.5" /> Use this design
                        </>
                      )}
                    </Button>
                  )}
                  {/* Per-card feedback — intuitive love/pass that drives refinement */}
                  <div className="flex items-center gap-2" data-testid={`row-card-feedback-${i}`}>
                    <button
                      type="button"
                      onClick={() => {
                        setLikedConcepts((prev) => {
                          const next = new Set(prev);
                          if (next.has(i)) next.delete(i); else next.add(i);
                          return next;
                        });
                        setDislikedConcepts((prev) => {
                          const next = new Set(prev);
                          next.delete(i);
                          return next;
                        });
                      }}
                      className={`flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium transition-colors ${
                        likedConcepts.has(i)
                          ? "bg-primary/15 text-primary"
                          : "text-muted-foreground hover:bg-muted"
                      }`}
                      data-testid={`button-love-concept-${i}`}
                    >
                      <Heart className={`h-3 w-3 ${likedConcepts.has(i) ? "fill-current" : ""}`} />
                      {likedConcepts.has(i) ? "Love this" : "Love this"}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDislikedConcepts((prev) => {
                          const next = new Set(prev);
                          if (next.has(i)) next.delete(i); else next.add(i);
                          return next;
                        });
                        setLikedConcepts((prev) => {
                          const next = new Set(prev);
                          next.delete(i);
                          return next;
                        });
                      }}
                      className={`flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium transition-colors ${
                        dislikedConcepts.has(i)
                          ? "bg-muted text-muted-foreground"
                          : "text-muted-foreground hover:bg-muted"
                      }`}
                      data-testid={`button-pass-concept-${i}`}
                    >
                      <ThumbsDown className="h-3 w-3" />
                      Not my style
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {concepts && (
        <div className="mt-4 rounded-md border border-border bg-background/60 p-3" data-testid="section-refine-concepts">
          {/* If the host loved a concept, offer to show more like it */}
          {likedConcepts.size > 0 ? (
            <>
              <p className="text-xs font-medium text-foreground">
                Love the direction? Want more like it?
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                We'll generate new designs inspired by the one you loved.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    const liked = concepts.filter((_, i) => likedConcepts.has(i));
                    const feedback = `I love "${liked.map(c => c.conceptName).join(" and ")}" — show me more designs like these.`;
                    refineConcepts.mutate(feedback);
                    setLikedConcepts(new Set());
                    setDislikedConcepts(new Set());
                  }}
                  disabled={refineConcepts.isPending}
                  data-testid="button-more-like-loved"
                >
                  <Heart className="mr-1.5 h-3.5 w-3.5" /> Show me more like this
                </Button>
              </div>
            </>
          ) : (
            <>
              <p className="text-xs font-medium text-foreground">
                Don't love any of these?
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Tell us what you're looking for and we'll try again.
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {REFINE_OPTIONS.map((option) => (
                  <Button
                    key={option}
                    size="sm"
                    variant="outline"
                    className="h-auto rounded-full px-2.5 py-1 text-[11px]"
                    onClick={() => refineConcepts.mutate(option)}
                    disabled={refineConcepts.isPending}
                    data-testid={`chip-refine-${option.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`}
                  >
                    {option}
                  </Button>
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Input
                  value={refineFeedback}
                  onChange={(e) => setRefineFeedback(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && refineFeedback.trim() && !refineConcepts.isPending) {
                      refineConcepts.mutate(refineFeedback.trim());
                    }
                  }}
                  placeholder="e.g. I want something warm and cozy with flowers"
                  className="max-w-sm"
                  data-testid="input-refine-feedback"
                />
                <Button
                  size="sm"
                  onClick={() => refineConcepts.mutate(refineFeedback.trim())}
                  disabled={!refineFeedback.trim() || refineConcepts.isPending}
                  data-testid="button-refine-concepts"
                >
                  {refineConcepts.isPending ? "Designing…" : "Show me"}
                </Button>
              </div>
            </>
          )}
          {renderInspirationControl("refine")}
        </div>
      )}

      {concepts && (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => generateConcepts.mutate()}
            disabled={generateConcepts.isPending}
            data-testid="button-regenerate-concepts"
          >
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" /> Show me different designs
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setConcepts(null);
              setAppliedConceptIndex(null);
              setPreviewUrls({});
            }}
            data-testid="button-start-over-concepts"
          >
            Start over
          </Button>
        </div>
      )}
    </div>
  );
}

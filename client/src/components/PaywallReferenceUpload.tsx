import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "wouter";
import { CheckCircle2, ImagePlus, Loader2, X } from "lucide-react";
import { apiRequestJson } from "@/lib/queryClient";
import { readImageFileAsDataUrl } from "@/lib/imageUpload";
import { useToast } from "@/hooks/use-toast";

const EMAIL_LOOKS_VALID = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_REFERENCES = 2;

interface PreviewReadiness {
  mode: "off" | "direction-card" | "quality-image";
  kind: "direction-card" | "approved-image" | "none";
  imageGenerationEnabled: boolean;
  namedReference: { id: string; label: string } | null;
  referenceRecommended: boolean;
}

interface PreviewResponse {
  ready: boolean;
  kind: "direction-card" | "approved-image";
  referenceRecommended: boolean;
}

interface ReferenceFile {
  name: string;
  dataUrl: string;
}

function ownerTokenFromLocation(location: string): string | null {
  const match = /^\/draft-generating\/([^/?#]+)/.exec(location);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Exact entertainment references need visual evidence, not more confident
 * guessing. This enhancer appears after Posy's deterministic direction card
 * and lets a host provide up to two screenshots before checkout. It is hidden
 * while generated-preview mode is disabled, so the safe launch default stays
 * simple and no reference is collected without an active use for it.
 */
export default function PaywallReferenceUpload() {
  const [location] = useLocation();
  const { toast } = useToast();
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const [readiness, setReadiness] = useState<PreviewReadiness | null>(null);
  const [references, setReferences] = useState<ReferenceFile[]>([]);
  const [readingFiles, setReadingFiles] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [resultMessage, setResultMessage] = useState("");

  const ownerToken = ownerTokenFromLocation(location);

  const loadReadiness = useCallback(async () => {
    if (!ownerToken) return;
    try {
      const result = await apiRequestJson<PreviewReadiness>(
        "GET",
        `/api/events/owner/${encodeURIComponent(ownerToken)}/prepayment-preview/readiness`,
      );
      setReadiness(result);
    } catch {
      setReadiness(null);
    }
  }, [ownerToken]);

  useEffect(() => {
    setReferences([]);
    setResultMessage("");
    setReadiness(null);
    void loadReadiness();
  }, [loadReadiness]);

  useEffect(() => {
    if (!ownerToken) {
      setMount(null);
      return;
    }

    let insertedAnchor: HTMLElement | null = null;
    let lastImageSignal = "";

    const locate = () => {
      const card = document.querySelector<HTMLElement>("[data-testid='prepayment-preview-card']");
      if (!card) {
        setMount(null);
        return;
      }

      let anchor = document.querySelector<HTMLElement>("[data-posy-preview-reference-anchor='true']");
      if (!anchor) {
        anchor = document.createElement("div");
        anchor.dataset.posyPreviewReferenceAnchor = "true";
        card.insertAdjacentElement("afterend", anchor);
        insertedAnchor = anchor;
      }
      setMount(anchor);

      // The direction-card request changes the page from no image to an image.
      // Refresh readiness once for that structural change, but do not refetch on
      // every portal mutation inside this component.
      const image = document.querySelector<HTMLImageElement>("[data-testid='img-prepayment-preview']");
      const imageSignal = image ? `${image.getAttribute("src") || ""}:${image.complete}` : "none";
      if (imageSignal !== lastImageSignal) {
        lastImageSignal = imageSignal;
        void loadReadiness();
      }
    };

    locate();
    const observer = new MutationObserver(locate);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      insertedAnchor?.remove();
      setMount(null);
    };
  }, [loadReadiness, ownerToken]);

  const addReferences = async (files: FileList | null) => {
    if (!files?.length) return;
    const room = Math.max(0, MAX_REFERENCES - references.length);
    const selected = Array.from(files).slice(0, room);
    if (selected.length === 0) return;

    setReadingFiles(true);
    setResultMessage("");
    try {
      const encoded = await Promise.all(
        selected.map(async (file) => ({
          name: file.name,
          dataUrl: await readImageFileAsDataUrl(file),
        })),
      );
      setReferences((current) => [...current, ...encoded].slice(0, MAX_REFERENCES));
    } catch (error) {
      toast({
        title: "Couldn't read that image",
        description: error instanceof Error ? error.message : "Please try another screenshot.",
        variant: "destructive",
      });
    } finally {
      setReadingFiles(false);
    }
  };

  const createReviewedImage = async () => {
    if (!ownerToken || references.length === 0) return;
    const emailInput = document.querySelector<HTMLInputElement>("[data-testid='input-spark-email']");
    const email = (emailInput?.value || "").trim();
    if (!EMAIL_LOOKS_VALID.test(email)) {
      emailInput?.scrollIntoView({ behavior: "smooth", block: "center" });
      window.setTimeout(() => emailInput?.focus({ preventScroll: true }), 300);
      toast({
        title: "Enter your email first",
        description: "Posy uses it for checkout and your private return link.",
      });
      return;
    }

    setSubmitting(true);
    setResultMessage("");
    try {
      const result = await apiRequestJson<PreviewResponse>(
        "POST",
        `/api/events/owner/${encodeURIComponent(ownerToken)}/prepayment-preview`,
        {
          email,
          inspirationImages: references.map((reference) => reference.dataUrl),
        },
      );

      await loadReadiness();
      const card = document.querySelector<HTMLElement>("[data-testid='prepayment-preview-card']");
      if (result.kind === "approved-image") {
        // The existing paywall already owns image load/error state. Updating its
        // source lets those handlers run normally without a page refresh.
        const image = document.querySelector<HTMLImageElement>("[data-testid='img-prepayment-preview']");
        if (image) {
          image.src = `/api/events/owner/${encodeURIComponent(ownerToken)}/prepayment-preview/asset?v=${Date.now()}`;
        }
        setReadiness((current) => current ? { ...current, kind: "approved-image", referenceRecommended: false } : current);
        setResultMessage("Your reference-based preview passed Posy’s private review and is ready above.");
        card?.scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        setResultMessage(
          "The generated option did not clear Posy’s standard, so your reliable creative-direction card stayed in place. You can continue without showing weak artwork.",
        );
      }
    } catch (error) {
      setResultMessage(
        "Posy kept your reliable creative-direction card in place. No unapproved artwork was shown, and you can still continue to checkout.",
      );
      console.error("Reference-based prepayment preview failed closed:", error);
    } finally {
      setSubmitting(false);
    }
  };

  const shouldShow =
    readiness?.imageGenerationEnabled === true
    && readiness.referenceRecommended
    && readiness.kind === "direction-card";

  if (!mount || !shouldShow) return null;

  return createPortal(
    <section
      className="mx-auto mt-3 w-full max-w-sm rounded-xl border border-primary/20 bg-primary/5 p-4"
      data-testid="prepayment-preview-reference-upload"
      aria-label="Add design inspiration"
    >
      <div className="flex items-start gap-3">
        <ImagePlus className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            Want closer {readiness.namedReference?.label || "character"} detail?
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Add one clear screenshot. Posy uses its character and visual-world cues—not the screenshot’s exact invitation layout.
          </p>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {references.map((reference, index) => (
          <div
            key={`${reference.name}-${index}`}
            className="flex items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs"
          >
            <span className="min-w-0 truncate text-foreground">{reference.name}</span>
            <button
              type="button"
              onClick={() => setReferences((current) => current.filter((_, candidate) => candidate !== index))}
              className="shrink-0 text-muted-foreground hover:text-foreground"
              aria-label={`Remove ${reference.name}`}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}

        {references.length < MAX_REFERENCES && (
          <label className="flex cursor-pointer items-center justify-center gap-2 rounded-md border border-dashed border-primary/35 bg-card px-3 py-2.5 text-xs font-medium text-primary hover:border-primary/60">
            {readingFiles ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
            {readingFiles ? "Reading screenshot…" : references.length ? "Add another screenshot" : "Add design inspo"}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              className="sr-only"
              data-testid="input-prepayment-preview-reference"
              disabled={readingFiles || submitting}
              onChange={async (event) => {
                const input = event.currentTarget;
                await addReferences(input.files);
                input.value = "";
              }}
            />
          </label>
        )}

        <button
          type="button"
          onClick={createReviewedImage}
          disabled={references.length === 0 || readingFiles || submitting}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2.5 text-xs font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
          data-testid="button-create-reference-preview"
        >
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Creating and reviewing privately…
            </>
          ) : (
            <>
              <CheckCircle2 className="h-4 w-4" />
              Create a reviewed image from this reference
            </>
          )}
        </button>
      </div>

      {resultMessage && (
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground" aria-live="polite">
          {resultMessage}
        </p>
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        This is optional. You can keep the direction above and continue to checkout at any time.
      </p>
    </section>,
    mount,
  );
}

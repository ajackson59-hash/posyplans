import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "wouter";

interface PreviewReadiness {
  mode: "off" | "direction-card" | "quality-image";
  kind: "direction-card" | "approved-image" | "none";
  imageGenerationEnabled: boolean;
  namedReference: { id: string; label: string } | null;
  referenceRecommended: boolean;
}

function ownerTokenFromLocation(location: string): string | null {
  const match = /^\/draft-generating\/([^/?#]+)/.exec(location);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Small launch-QA affordances around the existing DraftGenerating paywall.
 * The quality-lock API owns whether pixels are safe to show; this component
 * explains the result and keeps the long mobile layout easy to follow.
 */
export default function PaywallPreviewGuide() {
  const [location] = useLocation();
  const [card, setCard] = useState<HTMLElement | null>(null);
  const [previewReady, setPreviewReady] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [readiness, setReadiness] = useState<PreviewReadiness | null>(null);

  const ownerToken = ownerTokenFromLocation(location);

  useEffect(() => {
    if (!ownerToken) {
      setReadiness(null);
      return;
    }
    let active = true;
    fetch(`/api/events/owner/${encodeURIComponent(ownerToken)}/prepayment-preview/readiness`, {
      credentials: "same-origin",
      cache: "no-store",
      headers: { Accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("preview readiness unavailable");
        return response.json() as Promise<PreviewReadiness>;
      })
      .then((result) => {
        if (active) setReadiness(result);
      })
      .catch(() => {
        if (active) setReadiness(null);
      });
    return () => {
      active = false;
    };
  }, [ownerToken, previewReady]);

  useEffect(() => {
    if (!location.startsWith("/draft-generating/")) {
      setCard(null);
      return;
    }

    const sync = () => {
      const nextCard = document.querySelector<HTMLElement>("[data-testid='prepayment-preview-card']");
      const cta = document.querySelector<HTMLButtonElement>("[data-testid='button-unlock-spark']");
      const image = document.querySelector<HTMLImageElement>("[data-testid='img-prepayment-preview']");
      const text = cta?.textContent ?? "";
      const busy = /Creating your personal preview|Revealing your personal preview/i.test(text);

      setCard(nextCard);
      setPreviewReady(Boolean(image?.complete && image.naturalWidth > 0));
      setPreviewBusy(busy);

      // Before an asset exists, the old square placeholder dominates a phone
      // screen. Keep the value-proof card present without making it the whole
      // viewport. Once generation begins or an asset arrives, normal sizing wins.
      const placeholder = nextCard?.firstElementChild as HTMLElement | null;
      if (placeholder) {
        const isEmptyPrompt = /Add your email below|Posy will create a personalized preview/i.test(
          placeholder.textContent ?? "",
        );
        if (isEmptyPrompt) {
          placeholder.style.aspectRatio = "auto";
          placeholder.style.minHeight = "10rem";
        } else {
          placeholder.style.removeProperty("aspect-ratio");
          placeholder.style.removeProperty("min-height");
        }
      }

      // After email submission, immediately return the host to the activity
      // they just started instead of leaving them beside a disabled CTA below.
      if (busy && nextCard) {
        nextCard.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    };

    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true });
    window.addEventListener("load", sync);
    return () => {
      observer.disconnect();
      window.removeEventListener("load", sync);
    };
  }, [location]);

  useEffect(() => {
    if (!card) return;
    const promotionalOverlay = card.querySelector<HTMLElement>(".bg-gradient-to-t");
    const image = card.querySelector<HTMLImageElement>("[data-testid='img-prepayment-preview']");
    const isDirectionCard = readiness?.kind === "direction-card";

    card.dataset.previewKind = readiness?.kind ?? "unknown";
    if (promotionalOverlay) promotionalOverlay.style.display = isDirectionCard ? "none" : "";
    if (image) {
      image.alt = isDirectionCard
        ? "A creative direction assembled from the event details you entered"
        : "A personalized invitation image that passed Posy's private quality review";
    }

    return () => {
      if (promotionalOverlay) promotionalOverlay.style.removeProperty("display");
      delete card.dataset.previewKind;
    };
  }, [card, readiness?.kind]);

  if (!card) return null;

  return createPortal(
    <div className="border-t border-border bg-card px-5 py-3 text-center">
      {!previewBusy && !previewReady ? (
        <button
          type="button"
          className="text-xs font-medium text-primary underline underline-offset-2"
          data-testid="button-jump-to-preview-email"
          onClick={() => {
            const email = document.querySelector<HTMLInputElement>("[data-testid='input-spark-email']");
            email?.scrollIntoView({ behavior: "smooth", block: "center" });
            window.setTimeout(() => email?.focus({ preventScroll: true }), 350);
          }}
        >
          Enter your email below to see yours
        </button>
      ) : previewReady && readiness?.kind === "direction-card" ? (
        <p className="text-xs leading-relaxed text-muted-foreground" data-testid="text-preview-quality-lock">
          {readiness.imageGenerationEnabled
            ? "Posy captured your creative direction. Generated artwork can replace this card only after it clears Posy’s private theme and quality review."
            : "Posy captured your creative direction. This reliable first look is shown instead of risking an off-brief generated image."}
        </p>
      ) : previewReady ? (
        <p className="text-xs leading-relaxed text-muted-foreground" data-testid="text-preview-expectation">
          This image passed Posy’s private theme and quality review. Once unlocked, you can still refine the invitation until it feels right.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          Posy is building this from the details you already shared. Unapproved artwork is never shown.
        </p>
      )}
    </div>,
    card,
  );
}

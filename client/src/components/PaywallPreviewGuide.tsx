import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "wouter";

/**
 * Small launch-QA affordances around the existing DraftGenerating paywall.
 * Keeps the underlying checkout / preview state machine untouched while making
 * its long mobile layout easier to follow.
 */
export default function PaywallPreviewGuide() {
  const [location] = useLocation();
  const [card, setCard] = useState<HTMLElement | null>(null);
  const [previewReady, setPreviewReady] = useState(false);
  const [previewBusy, setPreviewBusy] = useState(false);

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

      // Before an image exists, the old square placeholder dominates a phone
      // screen. Keep the value-proof card present without making it the whole
      // viewport. Once generation begins or an image arrives, normal sizing wins.
      const placeholder = nextCard?.firstElementChild as HTMLElement | null;
      if (placeholder) {
        const isEmptyPrompt = /Add your email below/i.test(placeholder.textContent ?? "");
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
      ) : previewReady ? (
        <p className="text-xs leading-relaxed text-muted-foreground" data-testid="text-preview-expectation">
          This is your first Posy direction, not the final word. Once unlocked, you can refine the invitation until it feels right.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground" aria-live="polite">
          Posy is building this from the details you already shared.
        </p>
      )}
    </div>,
    card,
  );
}

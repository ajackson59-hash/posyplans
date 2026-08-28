import { useEffect, useRef } from "react";
import { useLocation } from "wouter";

/**
 * Mobile generation can finish while the host has scrolled elsewhere or the
 * tab was backgrounded. Reveal the first finished direction exactly once when
 * the result grid actually exists; this is display-only and never starts or
 * retries generation.
 */
export default function GenerationResultGuide() {
  const [location] = useLocation();
  const revealed = useRef(false);

  useEffect(() => {
    revealed.current = false;
    if (!location.startsWith("/dashboard/")) return;

    const revealIfReady = () => {
      if (revealed.current) return;
      const grid = document.querySelector<HTMLElement>('[data-testid="grid-ai-directions"]');
      if (!grid || grid.children.length === 0) return;
      revealed.current = true;
      const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
      grid.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    };

    revealIfReady();
    const observer = new MutationObserver(revealIfReady);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [location]);

  return null;
}

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { apiRequestJson, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

/**
 * Paid hosts sometimes prefer the exact teaser artwork they saw before
 * checkout. Surface that saved direction on the dashboard instead of forcing
 * them to regenerate or recreate it.
 */
export default function InitialPreviewReuse() {
  const { toast } = useToast();
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const [available, setAvailable] = useState(false);
  const [pending, setPending] = useState(false);

  const ownerToken = window.location.pathname.startsWith("/dashboard/")
    ? window.location.pathname.split("/dashboard/")[1]?.split("/")[0] ?? ""
    : "";

  useEffect(() => {
    if (!ownerToken) {
      setMount(null);
      setAvailable(false);
      return;
    }

    let cancelled = false;
    const locate = () => {
      const card = document.querySelector<HTMLElement>("[data-testid='card-invitation-next-step']");
      setMount(card ?? null);
    };
    locate();
    const observer = new MutationObserver(locate);
    observer.observe(document.body, { childList: true, subtree: true });

    fetch(`/api/events/owner/${ownerToken}/prepayment-preview/asset`, { cache: "no-store" })
      .then((response) => {
        if (!cancelled) setAvailable(response.ok);
      })
      .catch(() => {
        if (!cancelled) setAvailable(false);
      });

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [ownerToken]);

  if (!mount || !available) return null;

  const usePreview = async () => {
    setPending(true);
    try {
      await apiRequestJson("POST", `/api/events/owner/${ownerToken}/invite/use-prepayment-preview`, {});
      await queryClient.invalidateQueries({ queryKey: [`/api/events/owner/${ownerToken}`] });
      toast({ title: "Your first preview is back", description: "Posy reused the artwork you already liked — no new image was generated." });
      requestAnimationFrame(() => {
        document.getElementById("invitation-design-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } catch (error) {
      toast({
        title: "Couldn't reuse that preview",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setPending(false);
    }
  };

  return createPortal(
    <div className="px-5 pb-5 text-center sm:text-left" data-testid="initial-preview-reuse">
      <button
        type="button"
        onClick={usePreview}
        disabled={pending}
        className="text-xs font-medium text-primary underline underline-offset-2 disabled:opacity-60"
        data-testid="button-use-initial-preview"
      >
        {pending ? "Restoring your first preview…" : "Liked your initial preview? Use it"}
      </button>
      <p className="mt-1 text-[11px] text-muted-foreground">Reuses the artwork already created before checkout. No new generation.</p>
    </div>,
    mount,
  );
}

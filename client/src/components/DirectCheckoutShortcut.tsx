import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { apiRequestJson } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const EMAIL_LOOKS_VALID = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Optional direct-to-checkout path for hosts who already know they want to buy.
 *
 * The personalized preview remains the primary CTA, but it must not become a
 * forced AI-spend step. This enhancer mounts a secondary action into the
 * existing paywall form without changing the preview flow itself. The shortcut
 * calls Stripe session creation directly, so it never starts the pre-payment
 * image endpoint on the way to checkout.
 */
export default function DirectCheckoutShortcut() {
  const { toast } = useToast();
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (!window.location.pathname.startsWith("/draft-generating/")) {
      setMount(null);
      return;
    }

    const locate = () => {
      const primary = document.querySelector<HTMLElement>("[data-testid='button-unlock-spark']");
      setMount(primary?.parentElement ?? null);
    };

    locate();
    const observer = new MutationObserver(locate);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  if (!mount) return null;

  const beginCheckout = async () => {
    const ownerToken = window.location.pathname.split("/draft-generating/")[1]?.split("/")[0] ?? "";
    const email = (document.querySelector<HTMLInputElement>("[data-testid='input-spark-email']")?.value ?? "").trim();
    if (!ownerToken || !EMAIL_LOOKS_VALID.test(email)) {
      document.querySelector<HTMLInputElement>("[data-testid='input-spark-email']")?.focus();
      toast({ title: "Enter your email first", description: "Posy uses it for checkout and your private return link." });
      return;
    }

    const plusSelected = document.querySelector("[data-testid='option-plan-plus'][aria-pressed='true']") != null;
    const annualSelected = document.querySelector("[data-testid='toggle-paywall-annual']")?.className.includes("bg-primary") ?? true;

    setPending(true);
    try {
      const result = await apiRequestJson<{ url: string }>("POST", "/api/checkout/create-session", {
        email,
        plan: plusSelected ? "plus" : "spark",
        ...(plusSelected ? { billingInterval: annualSelected ? "annual" : "monthly" } : {}),
        returnToken: ownerToken,
      });
      window.location.href = result.url;
    } catch (error) {
      toast({
        title: "Couldn't start checkout",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      });
      setPending(false);
    }
  };

  return createPortal(
    <div className="space-y-1.5 text-center" data-testid="direct-checkout-shortcut">
      <button
        type="button"
        onClick={beginCheckout}
        disabled={pending}
        className="text-xs font-medium text-muted-foreground underline underline-offset-2 hover:text-foreground disabled:opacity-60"
        data-testid="button-skip-preview-checkout"
      >
        {pending ? "Starting checkout…" : "Skip preview & continue to checkout"}
      </button>
      <p className="text-[11px] text-muted-foreground">
        No preview image is generated when you use this option.
      </p>
    </div>,
    mount,
  );
}

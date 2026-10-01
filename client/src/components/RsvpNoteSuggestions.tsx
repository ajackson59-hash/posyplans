import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const SUGGESTIONS = [
  "We can't wait to celebrate!",
  "One guest has a dietary restriction:",
  "Thank you for including us!",
];

export default function RsvpNoteSuggestions() {
  const [mount, setMount] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!window.location.pathname.startsWith("/rsvp/")) {
      setMount(null);
      return;
    }
    const locate = () => {
      const textarea = document.querySelector<HTMLTextAreaElement>("[data-testid='textarea-rsvp-note']");
      setMount(textarea?.parentElement ?? null);
    };
    locate();
    const observer = new MutationObserver(locate);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  if (!mount) return null;

  const choose = (suggestion: string) => {
    const textarea = document.querySelector<HTMLTextAreaElement>("[data-testid='textarea-rsvp-note']");
    if (!textarea) return;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(textarea, suggestion);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.focus();
    setOpen(false);
  };

  return createPortal(
    <div className="mt-1.5" data-testid="rsvp-note-suggestions">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="text-xs font-medium text-primary underline underline-offset-2"
        data-testid="button-rsvp-note-suggestions"
      >
        Need help with suggestions?
      </button>
      {open && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => choose(suggestion)}
              className="rounded-full border border-border bg-background px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground"
            >
              {suggestion}
            </button>
          ))}
        </div>
      )}
    </div>,
    mount,
  );
}

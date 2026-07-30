/**
 * AskPosy — a lightweight floating AI assistant button that opens a small
 * panel of contextual prompt chips. Not a freeform chatbot; each chip routes
 * the user to an existing product action or surfaces a helpful suggestion.
 *
 * Place on authenticated/working pages (Dashboard, Invite Editor) where users
 * might get stuck. Do NOT place on marketing pages — it distracts from conversion.
 *
 * Usage:
 *   <AskPosy page="dashboard" />      // shows dashboard-appropriate chips
 *   <AskPosy page="editor" />        // shows editor-appropriate chips
 */
import { useState, useEffect, useRef } from "react";
import { Sparkles, X, ArrowRight } from "lucide-react";

type PageContext = "dashboard" | "editor";

type Chip = {
  label: string;
  description: string;
  action: string; // What to tell the user or where to send them
  href?: string;
};

const CHIPS: Record<PageContext, Chip[]> = {
  dashboard: [
    {
      label: "What should I do next?",
      description: "Posy will look at your event and suggest the most important next step.",
      action: "Your invitations are ready to send. Tap \"Invitation Design\" to review them, or start adding guests to your list.",
    },
    {
      label: "Help me choose a theme",
      description: "Get AI-suggested themes based on your event type and vibe.",
      action: "Go to Invitation Design and tap \"Generate Concepts\" — Posy will create 4 invite directions to pick from.",
      href: "#invite",
    },
    {
      label: "Add guests to my list",
      description: "Jump straight to the guest management section.",
      action: "Scroll to the Guests section to add names, emails, and phone numbers. Posy can send invitations and track RSVPs automatically.",
      href: "#guests",
    },
    {
      label: "Explain the pricing",
      description: "Understand the difference between Spark and Plus.",
      action: "Spark is $9.99 one-time for this event. Plus is $99/yr or $11.99/mo for unlimited events, alternate drafts, and priority AI. Both unlock your current plan.",
      href: "/pricing",
    },
  ],
  editor: [
    {
      label: "Generate new invite concepts",
      description: "Get 4 fresh AI-generated design directions.",
      action: "Tap \"Generate Concepts\" above — Posy will create 4 new invite directions based on your theme and style lane.",
    },
    {
      label: "Rewrite my invite message",
      description: "Get AI help with wording.",
      action: "Tap the message field and type what you want to say. Posy can suggest formal, casual, or playful wording.",
    },
    {
      label: "Change the color palette",
      description: "Swap colors and see it update live.",
      action: "Use the Color section below — click any swatch to pick a new color, or type a prompt like \"softer, warmer colors\" and Posy will adjust.",
    },
    {
      label: "What does my guest see?",
      description: "Preview the RSVP page your guests will visit.",
      action: "Your guests see a sealed envelope that opens to reveal the invitation. They can RSVP yes/no, add plus-ones, and optionally RSVP by phone.",
    },
  ],
};

const FAB_LABEL: Record<PageContext, string> = {
  dashboard: "Ask Posy",
  editor: "Ask Posy",
};

export default function AskPosy({ page }: { page: PageContext }) {
  const [open, setOpen] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        setAnswer(null);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  const chips = CHIPS[page] ?? [];

  const handleChip = (chip: Chip) => {
    setAnswer(chip.action);
  };

  const reset = () => {
    setAnswer(null);
  };

  return (
    <>
      {/* Floating button */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Ask Posy for help"
        data-testid="button-ask-posy"
        className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-lg transition-all hover:shadow-xl hover:brightness-105 active:scale-95"
      >
        <Sparkles className="h-4 w-4" />
        <span className="hidden sm:inline">{FAB_LABEL[page]}</span>
      </button>

      {/* Help panel */}
      {open && (
        <div
          ref={panelRef}
          className="fixed bottom-20 right-5 z-50 w-[calc(100vw-2.5rem)] max-w-sm overflow-hidden rounded-2xl border border-card-border bg-background shadow-2xl"
          data-testid="panel-ask-posy"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
              </div>
              <span className="text-sm font-semibold text-foreground">Ask Posy</span>
            </div>
            <button
              type="button"
              onClick={() => { setOpen(false); setAnswer(null); }}
              aria-label="Close"
              className="rounded-full p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Body */}
          <div className="max-h-[60vh] overflow-y-auto p-4">
            {answer ? (
              /* Answer view */
              <div className="space-y-3">
                <div className="rounded-lg bg-muted/40 p-3">
                  <p className="text-sm leading-relaxed text-foreground">{answer}</p>
                </div>
                <button
                  type="button"
                  onClick={reset}
                  className="flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  data-testid="button-ask-posy-back"
                >
                  <ArrowRight className="h-3 w-3 rotate-180" /> Back to suggestions
                </button>
              </div>
            ) : (
              /* Chip list */
              <div className="space-y-2">
                <p className="mb-1 text-xs text-muted-foreground">
                  How can I help with your event?
                </p>
                {chips.map((chip, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => handleChip(chip)}
                    data-testid={`chip-ask-posy-${i}`}
                    className="group flex w-full items-start gap-2.5 rounded-lg border border-border p-3 text-left transition-colors hover:border-primary/40 hover:bg-muted/30"
                  >
                    <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/60 group-hover:text-primary" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-foreground">{chip.label}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{chip.description}</p>
                    </div>
                    <ArrowRight className="mt-1 h-3 w-3 shrink-0 text-muted-foreground/40 group-hover:text-primary" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

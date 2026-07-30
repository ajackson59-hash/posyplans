/**
 * AIDemoShowcase — a scripted, self-playing UI demo that shows a guest arriving
 * at Posy, describing their event in one sentence, and watching Posy build the
 * full plan: timeline, guest list, invitation design, checklist, and budget.
 *
 * This is NOT a video — it's a React component with timed CSS transitions, so
 * it stays crisp at every resolution, never goes stale when the product UI
 * changes, and weighs nothing on initial page load.
 *
 * Behaviour:
 *   - Auto-plays once when scrolled into view (IntersectionObserver).
 *   - Play / Replay button for manual control.
 *   - Respects prefers-reduced-motion: jumps to the final state instantly.
 *   - Each stage has a named label so the user always knows what's happening.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { Sparkles, Wand2, Check, Users, ClipboardList, Mail, DollarSign, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";

// ── Script ────────────────────────────────────────────────────────────────────
// Each step is a named stage with a duration (ms). The typing animation runs
// for the full duration; the next step begins when it ends.

interface DemoStep {
  label: string;
  duration: number;
  userTypes?: string;
  posySays?: string;
  // Cards that appear when this step completes
  reveal?: "thinking" | "timeline" | "guests" | "invite" | "checklist" | "budget" | "done";
}

const STEPS: DemoStep[] = [
  {
    label: "You describe your event",
    duration: 2600,
    userTypes: "Maren's 3rd birthday, construction theme, backyard, ~35 kids and parents, mid-August.",
  },
  {
    label: "Posy asks one quick question",
    duration: 2400,
    posySays: "Got it! Any must-haves — a cake moment, a piñata, a specific time for presents?",
  },
  {
    label: "You answer",
    duration: 2000,
    userTypes: "Definitely a cake moment and a hard-hat craft station.",
  },
  {
    label: "Posy builds your plan",
    duration: 1800,
    posySays: "Here's what I came up with. Your timeline, guest list, invitation, and checklist are ready to review.",
    reveal: "thinking",
  },
  {
    label: "Party timeline",
    duration: 1600,
    reveal: "timeline",
  },
  {
    label: "Guest list & RSVP tracking",
    duration: 1400,
    reveal: "guests",
  },
  {
    label: "Invitation design",
    duration: 1400,
    reveal: "invite",
  },
  {
    label: "Shopping list & budget",
    duration: 1400,
    reveal: "checklist",
  },
  {
    label: "Your plan is ready",
    duration: 1200,
    reveal: "done",
  },
];

// ── Fake data shown in the generated cards ────────────────────────────────────

const TIMELINE_ITEMS = [
  { time: "2:00 PM", title: "Guests arrive", icon: Users },
  { time: "2:15 PM", title: "Hard-hat craft station", icon: Wand2 },
  { time: "3:00 PM", title: "Cake moment & photos", icon: Sparkles },
  { time: "3:30 PM", title: "Open presents", icon: Check },
  { time: "4:00 PM", title: "Free play & send-off", icon: Check },
];

const GUESTS = [
  { name: "Sarah Chen", status: "Yes", color: "bg-green-500" },
  { name: "Marcus Reid", status: "Yes", color: "bg-green-500" },
  { name: "Priya Patel", status: "Maybe", color: "bg-yellow-500" },
  { name: "Tom Walsh", status: "Pending", color: "bg-gray-400" },
];

const CHECKLIST = [
  "Order construction-zone cake (Aug 10)",
  "Buy mini hard hats for craft station",
  "Send invitations (this week!)",
  "Confirm backyard tent rental",
  "Stock drinks & snacks for 35",
];

const BUDGET_ITEMS = [
  { label: "Cake", amount: "$65" },
  { label: "Decor & crafts", amount: "$40" },
  { label: "Food & drinks", amount: "$120" },
  { label: "Total so far", amount: "$225", bold: true },
];

// ── Typing hook ───────────────────────────────────────────────────────────────

function useTypewriter(text: string, duration: number, active: boolean, reducedMotion: boolean) {
  const [displayed, setDisplayed] = useState("");
  useEffect(() => {
    if (!active || !text) {
      setDisplayed("");
      return;
    }
    if (reducedMotion) {
      setDisplayed(text);
      return;
    }
    setDisplayed("");
    const chars = text.length;
    const interval = duration / chars;
    let i = 0;
    const timer = setInterval(() => {
      i++;
      setDisplayed(text.slice(0, i));
      if (i >= chars) clearInterval(timer);
    }, interval);
    return () => clearInterval(timer);
  }, [text, duration, active, reducedMotion]);
  return displayed;
}

// ── Component ─────────────────────────────────────────────────────────────────

type Revealed = Set<string>;

export default function AIDemoShowcase() {
  const [stepIndex, setStepIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [hasPlayed, setHasPlayed] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const prefersReducedMotion = useRef(false);

  useEffect(() => {
    prefersReducedMotion.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  const start = useCallback(() => {
    setStepIndex(0);
    setPlaying(true);
    setHasPlayed(true);
  }, []);

  const reset = useCallback(() => {
    setStepIndex(-1);
    setPlaying(false);
    setTimeout(() => start(), 100);
  }, [start]);

  // Auto-play when scrolled into view
  useEffect(() => {
    if (hasPlayed) return;
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !hasPlayed) {
          start();
        }
      },
      { threshold: 0.3 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasPlayed, start]);

  // Advance through steps
  useEffect(() => {
    if (!playing || stepIndex < 0) return;
    if (stepIndex >= STEPS.length) {
      setPlaying(false);
      return;
    }
    const step = STEPS[stepIndex];
    const dur = prefersReducedMotion.current ? 200 : step.duration;
    const timer = setTimeout(() => {
      setStepIndex((i) => i + 1);
    }, dur);
    return () => clearTimeout(timer);
  }, [playing, stepIndex]);

  const currentStep = stepIndex >= 0 && stepIndex < STEPS.length ? STEPS[stepIndex] : null;
  const isDone = stepIndex >= STEPS.length;
  const revealed: Revealed = new Set<string>();
  for (let i = 0; i <= stepIndex && i < STEPS.length; i++) {
    const r = STEPS[i].reveal;
    if (r) revealed.add(r);
  }

  const typedUser = useTypewriter(
    currentStep?.userTypes ?? "",
    currentStep?.duration ?? 1000,
    !!currentStep?.userTypes && playing,
    prefersReducedMotion.current,
  );
  const typedPosy = useTypewriter(
    currentStep?.posySays ?? "",
    currentStep?.duration ?? 1000,
    !!currentStep?.posySays && playing,
    prefersReducedMotion.current,
  );

  const stepLabel = isDone ? "Done" : currentStep?.label ?? (stepIndex === -1 ? "" : "");

  return (
    <section className="border-t border-border bg-card/40 px-6 py-16 sm:py-20" id="see-posy-build">
      <div className="mx-auto max-w-4xl">
        <div className="mx-auto mb-10 max-w-2xl text-center">
          <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-primary">
            See it happen
          </p>
          <h2 className="font-serif text-2xl font-semibold text-foreground sm:text-3xl" data-testid="text-demo-heading">
            Tell her once. Watch her build the whole plan.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground">
            No setup, no templates to pick. Just describe your event and Posy builds the timeline,
            guest list, invitation, and checklist in seconds.
          </p>
        </div>

        <div
          ref={containerRef}
          className="overflow-hidden rounded-2xl border border-card-border bg-background shadow-lg"
          data-testid="ai-demo-container"
        >
          {/* Browser chrome */}
          <div className="flex items-center gap-2 border-b border-border bg-muted/50 px-4 py-2.5">
            <span className="h-3 w-3 rounded-full bg-red-400/70" />
            <span className="h-3 w-3 rounded-full bg-yellow-400/70" />
            <span className="h-3 w-3 rounded-full bg-green-400/70" />
            <span className="ml-3 text-xs text-muted-foreground">posyplans.com/dashboard</span>
          </div>

          {/* Demo area */}
          <div className="grid gap-0 md:grid-cols-2">
            {/* LEFT: Conversation */}
            <div className="border-b border-border p-5 sm:p-6 md:border-b-0 md:border-r">
              <div className="mb-4 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <span className="text-sm font-semibold text-foreground">Your conversation with Posy</span>
              </div>

              <div className="min-h-[280px] space-y-3">
                {/* Step 0: user types */}
                {stepIndex >= 0 && STEPS[0].userTypes && (
                  <div className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground">
                      {stepIndex === 0 ? typedUser : STEPS[0].userTypes}
                      {stepIndex === 0 && playing && <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-primary-foreground/70 align-middle" />}
                    </div>
                  </div>
                )}

                {/* Step 1: posy asks */}
                {stepIndex >= 1 && (
                  <div className="flex justify-start">
                    <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-muted px-4 py-2.5 text-sm text-foreground">
                      {stepIndex === 1 ? typedPosy : STEPS[1].posySays}
                      {stepIndex === 1 && playing && <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-foreground/40 align-middle" />}
                    </div>
                  </div>
                )}

                {/* Step 2: user answers */}
                {stepIndex >= 2 && (
                  <div className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm text-primary-foreground">
                      {stepIndex === 2 ? typedUser : STEPS[2].userTypes}
                      {stepIndex === 2 && playing && <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-primary-foreground/70 align-middle" />}
                    </div>
                  </div>
                )}

                {/* Step 3: posy responds */}
                {stepIndex >= 3 && (
                  <div className="flex justify-start">
                    <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-muted px-4 py-2.5 text-sm text-foreground">
                      <span className="font-medium">Here's what I came up with. </span>
                      {stepIndex === 3 ? typedPosy?.replace("Here's what I came up with. ", "") : STEPS[3].posySays?.replace("Here's what I came up with. ", "")}
                      {stepIndex === 3 && playing && <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-foreground/40 align-middle" />}
                    </div>
                  </div>
                )}

                {/* Thinking dots while building */}
                {stepIndex >= 3 && stepIndex < STEPS.length - 1 && (
                  <div className="flex items-center gap-1.5 pl-1 text-xs text-muted-foreground">
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/50 [animation-delay:0ms]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/50 [animation-delay:150ms]" />
                    <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/50 [animation-delay:300ms]" />
                    <span className="ml-1">Building your plan…</span>
                  </div>
                )}

                {/* Done checkmark */}
                {isDone && (
                  <div className="flex items-center gap-2 pl-1 text-sm font-medium text-green-600">
                    <Check className="h-4 w-4" /> Your plan is ready.
                  </div>
                )}
              </div>
            </div>

            {/* RIGHT: Generated plan cards */}
            <div className="space-y-3 p-5 sm:p-6">
              {stepIndex === -1 && (
                <div className="flex h-full min-h-[280px] items-center justify-center text-center">
                  <div>
                    <Wand2 className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
                    <p className="text-sm text-muted-foreground">
                      Your plan will appear here as Posy builds it.
                    </p>
                  </div>
                </div>
              )}

              {/* Timeline card */}
              {revealed.has("timeline") && (
                <DemoCard icon={Calendar} title="Party Timeline" delay={0} testId="demo-timeline">
                  <div className="space-y-1.5">
                    {TIMELINE_ITEMS.map((item, i) => (
                      <div key={i} className="flex items-center gap-2.5 text-xs">
                        <span className="w-14 shrink-0 font-medium text-muted-foreground">{item.time}</span>
                        <item.icon className="h-3 w-3 shrink-0 text-primary" />
                        <span className="text-foreground">{item.title}</span>
                      </div>
                    ))}
                  </div>
                </DemoCard>
              )}

              {/* Guests card */}
              {revealed.has("guests") && (
                <DemoCard icon={Users} title="Guest List & RSVPs" delay={80} testId="demo-guests">
                  <div className="space-y-1.5">
                    {GUESTS.map((g, i) => (
                      <div key={i} className="flex items-center justify-between text-xs">
                        <span className="text-foreground">{g.name}</span>
                        <span className="flex items-center gap-1.5">
                          <span className={`h-1.5 w-1.5 rounded-full ${g.color}`} />
                          <span className="text-muted-foreground">{g.status}</span>
                        </span>
                      </div>
                    ))}
                    <div className="border-t border-border pt-1.5 text-[10px] text-muted-foreground">
                      2 yes · 1 maybe · 1 pending
                    </div>
                  </div>
                </DemoCard>
              )}

              {/* Invite card */}
              {revealed.has("invite") && (
                <DemoCard icon={Mail} title="Invitation Design" delay={80} testId="demo-invite">
                  <div className="flex items-center gap-3">
                    <div className="flex h-16 w-12 shrink-0 flex-col items-center justify-center rounded-md border-2 border-dashed border-orange-400/50 bg-orange-50 text-orange-600">
                      <Wand2 className="h-4 w-4" />
                      <span className="mt-0.5 text-[7px] font-bold uppercase">Dig It!</span>
                    </div>
                    <div className="text-xs">
                      <p className="font-medium text-foreground">Construction Zone Birthday</p>
                      <p className="mt-0.5 text-muted-foreground">Hard-hat theme · orange & black</p>
                      <div className="mt-1.5 flex gap-1">
                        <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary">envelope</span>
                        <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-medium text-primary">RSVP link</span>
                      </div>
                    </div>
                  </div>
                </DemoCard>
              )}

              {/* Checklist + Budget */}
              {revealed.has("checklist") && (
                <DemoCard icon={ClipboardList} title="Checklist & Budget" delay={80} testId="demo-checklist">
                  <div className="space-y-1">
                    {CHECKLIST.slice(0, 3).map((item, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <Check className="h-3 w-3 shrink-0 text-green-500" />
                        <span className="text-foreground">{item}</span>
                      </div>
                    ))}
                    <div className="mt-2 flex items-center justify-between border-t border-border pt-1.5 text-xs">
                      <span className="flex items-center gap-1.5 font-medium text-foreground">
                        <DollarSign className="h-3 w-3 text-primary" /> Budget
                      </span>
                      <span className="font-semibold text-foreground">$225 of $300</span>
                    </div>
                  </div>
                </DemoCard>
              )}

              {/* Done state */}
              {isDone && (
                <div className="flex items-center justify-center rounded-lg border border-green-200 bg-green-50 py-3" data-testid="demo-done">
                  <Check className="mr-2 h-4 w-4 text-green-600" />
                  <span className="text-sm font-medium text-green-700">Everything's ready. Start inviting!</span>
                </div>
              )}
            </div>
          </div>

          {/* Status bar */}
          <div className="flex items-center justify-between border-t border-border bg-muted/30 px-5 py-3">
            <span className="text-xs text-muted-foreground" data-testid="demo-step-label">
              {stepIndex === -1 ? "Ready to play" : stepLabel}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={stepIndex === -1 || isDone ? reset : undefined}
              disabled={playing && !isDone}
              data-testid="button-demo-replay"
              className="text-xs"
            >
              {stepIndex === -1 ? (
                <>
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Play demo
                </>
              ) : isDone ? (
                <>
                  <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Replay
                </>
              ) : (
                "Playing…"
              )}
            </Button>
          </div>
        </div>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          This is a simulated demo. <a href="/intake" className="font-medium text-primary underline underline-offset-2">Try it for real →</a>
        </p>
      </div>
    </section>
  );
}

// ── DemoCard sub-component ────────────────────────────────────────────────────

function DemoCard({
  icon: Icon,
  title,
  children,
  delay,
  testId,
}: {
  icon: typeof Calendar;
  title: string;
  children: React.ReactNode;
  delay: number;
  testId: string;
}) {
  return (
    <div
      className="rounded-lg border border-card-border bg-card p-3.5 opacity-0 shadow-sm transition-all duration-500 data-[visible=true]:opacity-100"
      style={{ animationDelay: `${delay}ms` }}
      data-testid={testId}
      data-visible="true"
    >
      <div className="mb-2 flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 text-primary" />
        <span className="text-xs font-semibold text-foreground">{title}</span>
      </div>
      {children}
    </div>
  );
}

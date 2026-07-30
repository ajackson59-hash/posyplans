/**
 * AIDemoShowcase — a scripted, self-playing UI demo that shows a guest arriving
 * at Posy, describing their event in one sentence, and watching Posy build the
 * full plan: timeline, guest list, invitation design, checklist, and budget.
 *
 * Design principles:
 *   - Single-frame guided sequence: the right panel swaps content per stage
 *     instead of stacking cards infinitely. Users never need to scroll to see
 *     what's happening.
 *   - Progress rail at the top shows all 4 stages so users know the full journey
 *     upfront (Describe → Plan → Concepts → Customize).
 *   - The customization stage shows the real EnvelopeMockup component alongside
 *     the invite card preview, so envelope color, liner, and stamp changes are
 *     visible — reflecting the latest product iteration.
 *   - Each stage has a named label so the user always knows what's happening.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { Sparkles, Wand2, Check, Users, ClipboardList, Mail, DollarSign, Calendar, Palette, Type as TypeIcon, Layout } from "lucide-react";
import { Button } from "@/components/ui/button";
import EnvelopeMockup from "@/components/EnvelopeMockup";

// ── Script ────────────────────────────────────────────────────────────────────
// Each step is a named stage with a duration (ms). The typing animation runs
// for the full duration; the next step begins when it ends.

type DemoStep = {
  label: string;
  duration: number;
  userTypes?: string;
  posySays?: string;
  reveal?: "thinking" | "timeline" | "guests" | "invite" | "inviteConcepts" | "inviteCustomize" | "checklist" | "budget" | "done";
};

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
    label: "Posy generates invite concepts",
    duration: 2200,
    posySays: "Here are four invitation directions. Pick one and I'll make it yours.",
    reveal: "inviteConcepts",
  },
  {
    label: "Customize invite + envelope",
    duration: 5800,
    posySays: "Now make it yours — swap fonts, colors, layout, envelope, liner, and stamp in real time.",
    reveal: "inviteCustomize",
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

const INVITE_CONCEPTS = [
  { name: "Hard Hat Zone", lane: "Bold Graphic", colors: ["#f97316", "#1e293b", "#fde047", "#fed7aa"] },
  { name: "Digging It", lane: "Playful Illustrated", colors: ["#fbbf24", "#1d4ed8", "#fef3c7", "#fca5a5"] },
  { name: "Construction Site", lane: "Handcrafted Rustic", colors: ["#d97706", "#451a03", "#fef3c7", "#84cc16"] },
  { name: "Little Builder", lane: "Storybook Whimsical", colors: ["#f59e0b", "#075985", "#fffbeb", "#fbbf24"] },
];

// Font samples for the customization card
const FONT_SAMPLES = [
  { name: "Editorial Serif", className: "font-serif" },
  { name: "Modern Sans", className: "font-sans" },
  { name: "Playful Rounded", className: "font-sans font-medium" },
];

// Layout options for the customization card
const LAYOUT_OPTIONS = [
  { name: "Banner", glyph: "\u25AC" },
  { name: "Split", glyph: "\u25A5" },
  { name: "Centered", glyph: "\u25C9" },
];

// Color palettes — each stage swaps the invite's colors
type Palette = { bg: string; text: string; dots: string[]; label: string };
const CUSTOMIZE_STAGES: { prompt: string; fontIdx: number; layoutIdx: number; palette: Palette; envelopeColor?: string; linerPattern?: "solid" | "dots" | "stripes" | "chevron" | "floral" | "waves" | "lattice" | "confetti" | "stars" | "hearts" | "diamonds" | "scallops"; stampStyle?: "classic" | "seal" | "postmark" | "motif" | "wax-seal" | "heart" | "star" | "floral" | "bow" | "monogram" }[] = [
  {
    prompt: "Try softer, warmer colors",
    fontIdx: 0,
    layoutIdx: 0,
    palette: { bg: "#fde047", text: "#1e293b", dots: ["#f97316", "#1e293b", "#fde047", "#fed7aa"], label: "Original" },
    envelopeColor: "#f97316",
    linerPattern: "dots",
    stampStyle: "classic",
  },
  {
    prompt: "Make it more playful",
    fontIdx: 2,
    layoutIdx: 0,
    palette: { bg: "#fce7f3", text: "#be185d", dots: ["#ec4899", "#831843", "#fce7f3", "#f9a8d4"], label: "Rose" },
    envelopeColor: "#ec4899",
    linerPattern: "stripes",
    stampStyle: "star",
  },
  {
    prompt: "Switch to a floral liner",
    fontIdx: 2,
    layoutIdx: 2,
    palette: { bg: "#fce7f3", text: "#be185d", dots: ["#ec4899", "#831843", "#fce7f3", "#f9a8d4"], label: "Rose" },
    envelopeColor: "#ec4899",
    linerPattern: "floral",
    stampStyle: "star",
  },
  {
    prompt: "Center the title",
    fontIdx: 2,
    layoutIdx: 2,
    palette: { bg: "#fce7f3", text: "#be185d", dots: ["#ec4899", "#831843", "#fce7f3", "#f9a8d4"], label: "Rose" },
    envelopeColor: "#ec4899",
    linerPattern: "floral",
    stampStyle: "star",
  },
  {
    prompt: "Perfect — your invite suite is ready!",
    fontIdx: 2,
    layoutIdx: 2,
    palette: { bg: "#fce7f3", text: "#be185d", dots: ["#ec4899", "#831843", "#fce7f3", "#f9a8d4"], label: "Rose" },
    envelopeColor: "#ec4899",
    linerPattern: "floral",
    stampStyle: "star",
  },
];

// ── Progress rail stages (shown at the top of the demo) ──────────────────────
const RAIL_STAGES = [
  { label: "Describe", icon: Wand2 },
  { label: "Build plan", icon: ClipboardList },
  { label: "Invite concepts", icon: Sparkles },
  { label: "Customize suite", icon: Palette },
];

// Map step index → rail stage (0-3). -1 means "not started".
const stepToRail = (stepIndex: number, isDone: boolean): number => {
  if (stepIndex < 0) return -1;
  if (isDone) return 4;
  if (stepIndex <= 2) return 0;
  if (stepIndex <= 6) return 1;
  if (stepIndex === 7) return 2;
  return 3;
};

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

export default function AIDemoShowcase({
  bare = false,
  autoPlay = false,
}: {
  /** Render only the demo window, without the surrounding section + heading.
   *  Used when embedding inside a dialog (e.g. the pricing page). */
  bare?: boolean;
  /** Start playing immediately on mount instead of waiting to scroll into view. */
  autoPlay?: boolean;
} = {}) {
  const [stepIndex, setStepIndex] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [hasPlayed, setHasPlayed] = useState(false);
  const [customizeStage, setCustomizeStage] = useState(0);
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
    setCustomizeStage(0);
    setTimeout(() => start(), 100);
  }, [start]);

  // Advance through the customize sub-stages during step 8.
  const CUSTOMIZE_STEP = 8;
  useEffect(() => {
    if (stepIndex !== CUSTOMIZE_STEP) {
      if (stepIndex < CUSTOMIZE_STEP) setCustomizeStage(0);
      return;
    }
    const stageMs = prefersReducedMotion.current ? 400 : 1100;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let s = 1; s < CUSTOMIZE_STAGES.length; s++) {
      timers.push(setTimeout(() => setCustomizeStage(s), stageMs * s));
    }
    return () => timers.forEach(clearTimeout);
  }, [stepIndex]);

  // Play immediately on mount when embedded in a dialog
  useEffect(() => {
    if (!autoPlay || hasPlayed) return;
    const t = setTimeout(() => start(), 250);
    return () => clearTimeout(t);
  }, [autoPlay, hasPlayed, start]);

  // Auto-play when scrolled into view
  useEffect(() => {
    if (autoPlay || hasPlayed) return;
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

  const railStage = stepToRail(stepIndex, isDone);
  const showPlanCards = revealed.has("timeline");
  const showConcepts = revealed.has("inviteConcepts");
  const showCustomize = revealed.has("inviteCustomize");

  const demoWindow = (
    <>
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

        {/* Progress rail — always visible so users see the full journey upfront */}
        <div className="flex items-center gap-1 border-b border-border bg-muted/20 px-3 py-2 sm:px-4">
          {RAIL_STAGES.map((stage, i) => {
            const completed = railStage > i || isDone;
            const active = railStage === i;
            return (
              <div key={i} className="flex flex-1 items-center gap-1">
                {i > 0 && <span className={`h-px flex-1 ${completed ? "bg-primary/40" : "bg-border"}`} />}
                <div
                  className={`flex items-center gap-1 rounded-full px-1.5 py-0.5 transition-all duration-300 ${
                    active ? "bg-primary/10 ring-1 ring-primary/30" : completed ? "" : "opacity-40"
                  }`}
                  data-testid={`rail-stage-${i}`}
                >
                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[8px] ${
                    completed && !active ? "bg-primary text-primary-foreground" : active ? "bg-primary text-primary-foreground" : "bg-muted-foreground/20 text-muted-foreground"
                  }`}>
                    {completed && !active ? <Check className="h-2.5 w-2.5" /> : i + 1}
                  </span>
                  <span className={`text-[9px] font-medium sm:text-[10px] ${active ? "text-primary" : "text-muted-foreground"}`}>
                    {stage.label}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Demo area — fixed height, content swaps per stage (no infinite stacking) */}
        <div className="grid gap-0 md:grid-cols-2 min-h-[340px]">
          {/* LEFT: Conversation */}
          <div className="border-b border-border p-4 sm:p-5 md:border-b-0 md:border-r">
            <div className="mb-3 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold text-foreground">Your conversation with Posy</span>
            </div>

            <div className="min-h-[260px] space-y-2.5">
              {stepIndex >= 0 && STEPS[0].userTypes && (
                <div className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground">
                    {stepIndex === 0 ? typedUser : STEPS[0].userTypes}
                    {stepIndex === 0 && playing && <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-primary-foreground/70 align-middle" />}
                  </div>
                </div>
              )}

              {stepIndex >= 1 && (
                <div className="flex justify-start">
                  <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-muted px-3.5 py-2 text-sm text-foreground">
                    {stepIndex === 1 ? typedPosy : STEPS[1].posySays}
                    {stepIndex === 1 && playing && <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-foreground/40 align-middle" />}
                  </div>
                </div>
              )}

              {stepIndex >= 2 && (
                <div className="flex justify-end">
                  <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-sm text-primary-foreground">
                    {stepIndex === 2 ? typedUser : STEPS[2].userTypes}
                    {stepIndex === 2 && playing && <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-primary-foreground/70 align-middle" />}
                  </div>
                </div>
              )}

              {stepIndex >= 3 && (
                <div className="flex justify-start">
                  <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-muted px-3.5 py-2 text-sm text-foreground">
                    <span className="font-medium">Here's what I came up with. </span>
                    {stepIndex === 3 ? typedPosy?.replace("Here's what I came up with. ", "") : STEPS[3].posySays?.replace("Here's what I came up with. ", "")}
                    {stepIndex === 3 && playing && <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-foreground/40 align-middle" />}
                  </div>
                </div>
              )}

              {stepIndex >= 7 && (
                <div className="flex justify-start">
                  <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-muted px-3.5 py-2 text-sm text-foreground">
                    {stepIndex === 7 ? typedPosy : STEPS[7].posySays}
                    {stepIndex === 7 && playing && <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-foreground/40 align-middle" />}
                  </div>
                </div>
              )}

              {stepIndex >= 8 && (
                <div className="flex justify-start">
                  <div className="max-w-[85%] rounded-2xl rounded-bl-sm bg-muted px-3.5 py-2 text-sm text-foreground">
                    {stepIndex === 8 ? typedPosy : STEPS[8].posySays}
                    {stepIndex === 8 && playing && <span className="ml-0.5 inline-block h-3.5 w-0.5 animate-pulse bg-foreground/40 align-middle" />}
                  </div>
                </div>
              )}

              {/* Thinking dots while building */}
              {stepIndex >= 3 && stepIndex < 4 && (
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

          {/* RIGHT: Single-frame active canvas — content swaps per stage */}
          <div className="relative p-4 sm:p-5" data-testid="demo-canvas">
            {stepIndex === -1 && (
              <div className="flex h-full min-h-[260px] items-center justify-center text-center">
                <div>
                  <Wand2 className="mx-auto mb-3 h-8 w-8 text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">
                    Your plan will appear here as Posy builds it.
                  </p>
                </div>
              </div>
            )}

            {/* Stage 2: Plan summary — compact 2x2 grid, no stacking */}
            {showPlanCards && !showConcepts && !showCustomize && (
              <div className="grid h-full grid-cols-2 gap-2.5" data-testid="demo-canvas-plan">
                <DemoCard icon={Calendar} title="Timeline" delay={0} testId="demo-timeline">
                  <div className="space-y-1">
                    {TIMELINE_ITEMS.slice(0, 3).map((item, i) => (
                      <div key={i} className="flex items-center gap-1.5 text-[10px]">
                        <span className="w-10 shrink-0 font-medium text-muted-foreground">{item.time}</span>
                        <item.icon className="h-2.5 w-2.5 shrink-0 text-primary" />
                        <span className="text-foreground">{item.title}</span>
                      </div>
                    ))}
                  </div>
                </DemoCard>
                <DemoCard icon={Users} title="Guests" delay={60} testId="demo-guests">
                  <div className="space-y-1">
                    {GUESTS.slice(0, 3).map((g, i) => (
                      <div key={i} className="flex items-center justify-between text-[10px]">
                        <span className="text-foreground">{g.name}</span>
                        <span className="flex items-center gap-1">
                          <span className={`h-1.5 w-1.5 rounded-full ${g.color}`} />
                          <span className="text-muted-foreground">{g.status}</span>
                        </span>
                      </div>
                    ))}
                    <div className="border-t border-border pt-0.5 text-[9px] text-muted-foreground">2 yes · 1 maybe</div>
                  </div>
                </DemoCard>
                <DemoCard icon={Mail} title="Invitation" delay={120} testId="demo-invite">
                  <div className="flex items-center gap-2">
                    <div className="flex h-10 w-8 shrink-0 flex-col items-center justify-center rounded border border-dashed border-orange-400/50 bg-orange-50 text-orange-600">
                      <Wand2 className="h-3 w-3" />
                    </div>
                    <div className="text-[10px]">
                      <p className="font-medium text-foreground">Construction Zone</p>
                      <p className="text-muted-foreground">Orange & black</p>
                    </div>
                  </div>
                </DemoCard>
                <DemoCard icon={ClipboardList} title="Checklist" delay={180} testId="demo-checklist">
                  <div className="space-y-0.5">
                    {CHECKLIST.slice(0, 3).map((item, i) => (
                      <div key={i} className="flex items-center gap-1.5 text-[10px]">
                        <Check className="h-2.5 w-2.5 shrink-0 text-green-500" />
                        <span className="text-foreground">{item.length > 28 ? item.slice(0, 26) + "…" : item}</span>
                      </div>
                    ))}
                  </div>
                </DemoCard>
              </div>
            )}

            {/* Stage 3: Invite concepts — 4 thumbnails in one frame */}
            {showConcepts && !showCustomize && (
              <div className="h-full" data-testid="demo-canvas-concepts">
                <div className="mb-2 flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  <span className="text-xs font-semibold text-foreground">4 concepts generated</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {INVITE_CONCEPTS.map((c, i) => (
                    <div
                      key={i}
                      className={`relative overflow-hidden rounded-md border p-2 transition-all ${i === 0 ? "border-primary ring-1 ring-primary/30" : "border-border"}`}
                      style={{ backgroundColor: c.colors[2] }}
                    >
                      <div className="flex gap-0.5">
                        {c.colors.map((color, ci) => (
                          <span key={ci} className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                        ))}
                      </div>
                      <p className="mt-1.5 text-[9px] font-bold leading-tight" style={{ color: c.colors[1] }}>
                        {c.name}
                      </p>
                      <p className="text-[7px] text-muted-foreground">{c.lane}</p>
                      {i === 0 && (
                        <span className="absolute right-1 top-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                          <Check className="h-2 w-2" />
                        </span>
                      )}
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[9px] text-muted-foreground">
                  Selected: Hard Hat Zone
                </p>
              </div>
            )}

            {/* Stage 4: Live customization — invite + envelope in one frame */}
            {showCustomize && (() => {
              const stage = CUSTOMIZE_STAGES[customizeStage];
              const palette = stage.palette;
              const fontIdx = stage.fontIdx;
              const layoutIdx = stage.layoutIdx;
              return (
              <div className="h-full space-y-2.5" data-testid="demo-canvas-customize">
                {/* Prompt bar */}
                <div className="flex items-center gap-1.5 rounded-md bg-primary/5 px-2.5 py-1.5" data-testid={`demo-customize-prompt-${customizeStage}`}>
                  <Sparkles className="h-2.5 w-2.5 shrink-0 text-primary" />
                  <span className="text-[10px] font-medium text-foreground">{stage.prompt}</span>
                </div>

                {/* Two-column: invite preview + envelope */}
                <div className="grid grid-cols-2 gap-2">
                  {/* Invite preview */}
                  <div
                    className="overflow-hidden rounded-md p-2.5 transition-all duration-500"
                    style={{ backgroundColor: palette.bg }}
                  >
                    <p
                      className={`${FONT_SAMPLES[fontIdx].className} text-center text-[10px] font-bold transition-all duration-500`}
                      style={{ color: palette.text }}
                    >
                      {layoutIdx === 2 ? "Maren is 3!" : "MAREN IS 3!"}
                    </p>
                    {layoutIdx === 0 && (
                      <p
                        className={`${FONT_SAMPLES[fontIdx].className} mt-0.5 text-center text-[6px] transition-all duration-500`}
                        style={{ color: palette.text, opacity: 0.7 }}
                      >
                        Aug 16 · 2pm
                      </p>
                    )}
                    <div className="mt-1 flex justify-center gap-0.5 transition-all duration-500">
                      {palette.dots.map((c, i) => (
                        <span key={i} className="h-1.5 w-1.5 rounded-full transition-all duration-500" style={{ backgroundColor: c }} />
                      ))}
                    </div>
                  </div>

                  {/* Envelope mockup — uses the real shared component */}
                  <div className="flex items-center justify-center rounded-md bg-muted/30 p-1.5 transition-all duration-500">
                    <EnvelopeMockup
                      envelopeColor={stage.envelopeColor || "#f97316"}
                      linerPattern={stage.linerPattern || "solid"}
                      linerColor={stage.envelopeColor || "#f97316"}
                      linerBaseColor={palette.dots[2]}
                      stampStyle={stage.stampStyle || "classic"}
                      stampColor={stage.envelopeColor || "#f97316"}
                      finish="premium"
                      addressee="Maren & friends"
                      opened={false}
                      className="max-w-[120px]"
                    />
                  </div>
                </div>

                {/* Font picker — compact */}
                <div>
                  <p className="mb-0.5 flex items-center gap-1 text-[9px] font-medium text-muted-foreground">
                    <TypeIcon className="h-2.5 w-2.5" /> Font
                  </p>
                  <div className="flex gap-1">
                    {FONT_SAMPLES.map((f, i) => (
                      <span
                        key={i}
                        className={`flex-1 truncate rounded px-1 py-0.5 text-center text-[8px] transition-all duration-300 ${f.className} ${i === fontIdx ? "bg-primary/15 text-primary ring-1 ring-primary/30" : "bg-muted text-muted-foreground"}`}
                      >
                        Aa
                      </span>
                    ))}
                  </div>
                </div>

                {/* Layout + Colors — compact */}
                <div className="flex gap-2">
                  <div className="flex-1">
                    <p className="mb-0.5 flex items-center gap-1 text-[9px] font-medium text-muted-foreground">
                      <Layout className="h-2.5 w-2.5" /> Layout
                    </p>
                    <div className="flex gap-0.5">
                      {LAYOUT_OPTIONS.map((l, i) => (
                        <span
                          key={i}
                          className={`flex h-4 w-4 items-center justify-center rounded text-[9px] transition-all duration-300 ${i === layoutIdx ? "bg-primary/15 text-primary ring-1 ring-primary/30" : "bg-muted text-muted-foreground"}`}
                        >
                          {l.glyph}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="mb-0.5 flex items-center gap-1 text-[9px] font-medium text-muted-foreground">
                      <Palette className="h-2.5 w-2.5" /> Colors
                    </p>
                    <div className="flex gap-0.5">
                      {palette.dots.map((c, i) => (
                        <span
                          key={i}
                          className="h-4 w-4 rounded-full border border-border transition-all duration-500"
                          style={{ backgroundColor: c }}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                <p className="text-[9px] text-muted-foreground">
                  Card, envelope, liner, stamp & RSVP update together
                </p>
              </div>
              );
            })()}

            {/* Done state */}
            {isDone && (
              <div className="flex h-full min-h-[260px] flex-col items-center justify-center gap-3" data-testid="demo-done">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-50">
                  <Check className="h-6 w-6 text-green-600" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium text-green-700">Everything's ready.</p>
                  <p className="mt-1 text-xs text-muted-foreground">Timeline, guests, invitations, envelope, and checklist — done.</p>
                </div>
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
    </>
  );

  // Embedded in a dialog — just the demo window, no section chrome or heading.
  if (bare) return demoWindow;

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
            guest list, invitation, envelope, and checklist — then you customize the full invite suite live.
          </p>
        </div>
        {demoWindow}
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
      className="rounded-lg border border-card-border bg-card p-3 opacity-0 shadow-sm transition-all duration-500 data-[visible=true]:opacity-100"
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

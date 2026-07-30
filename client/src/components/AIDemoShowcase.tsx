/**
 * AIDemoShowcase — a scripted, self-playing UI demo that shows a guest arriving
 * at Posy, describing their event in one sentence, and watching Posy build the
 * full plan: timeline, guest list, invitation design, checklist, and budget.
 *
 * Visual design principles:
 *   - ElegantInvitePreview component: real invitation hierarchy with decorative
 *     gold frames, floral SVG motifs, serif typography, paper texture.
 *   - Concept stage shows 4 distinct elegant invite designs side by side.
 *   - Customize stage: larger invite preview + opened envelope with visible liner.
 *   - Muted, sophisticated palette: dusty mauve, ivory, champagne, sage — not
 *     bright pink or orange.
 *   - Single-frame guided sequence with progress rail — no scrolling needed.
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { Sparkles, Wand2, Check, Users, ClipboardList, Mail, Calendar, Palette, Type as TypeIcon, Layout } from "lucide-react";
import { Button } from "@/components/ui/button";
import EnvelopeMockup from "@/components/EnvelopeMockup";

// ═══════════════════════════════════════════════════════════════════════════════
// SVG DECORATIVE COMPONENTS — reusable, no external dependencies
// ═══════════════════════════════════════════════════════════════════════════════

/** Stylized rose corner motif — petals + leaves in SVG */
function RoseCorner({ color = "#c084a3", leafColor = "#a3b8a3", className = "", size = 36 }: { color?: string; leafColor?: string; className?: string; size?: number }) {
  return (
    <svg viewBox="0 0 40 40" width={size} height={size} fill="none" className={className} aria-hidden>
      {/* Outer petals */}
      <path d="M22 8 C 16 8, 11 13, 11 19 C 11 25, 16 30, 22 30 C 28 30, 33 25, 33 19 C 33 13, 28 8, 22 8" fill={color} opacity="0.25" />
      {/* Middle petals */}
      <path d="M22 12 C 18 12, 15 15, 15 19 C 15 23, 18 26, 22 26 C 26 26, 29 23, 29 19 C 29 15, 26 12, 22 12" fill={color} opacity="0.4" />
      {/* Inner petals */}
      <path d="M22 15 C 19.5 15, 17.5 17, 17.5 19 C 17.5 21, 19.5 23, 22 23 C 24.5 23, 26.5 21, 26.5 19 C 26.5 17, 24.5 15, 22 15" fill={color} opacity="0.6" />
      {/* Center */}
      <circle cx="22" cy="19" r="2" fill={color} opacity="0.8" />
      {/* Leaves */}
      <path d="M8 22 C 11 20, 14 20, 16 22 C 14 24, 11 24, 8 22" fill={leafColor} opacity="0.4" />
      <path d="M28 22 C 31 20, 34 20, 36 22 C 34 24, 31 24, 28 22" fill={leafColor} opacity="0.4" />
      <path d="M14 28 C 16 26, 18 26, 20 28 C 18 30, 16 30, 14 28" fill={leafColor} opacity="0.3" />
    </svg>
  );
}

/** Botanical sprig — a simple leaf branch */
function BotanicalSprig({ color = "#a3b8a3", className = "", size = 28 }: { color?: string; className?: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 36" width={size} height={size * 1.5} fill="none" className={className} aria-hidden>
      <path d="M12 2 L 12 34" stroke={color} strokeWidth="0.8" opacity="0.5" />
      <path d="M12 8 C 8 6, 5 8, 4 11 C 7 12, 10 11, 12 8" fill={color} opacity="0.4" />
      <path d="M12 8 C 16 6, 19 8, 20 11 C 17 12, 14 11, 12 8" fill={color} opacity="0.4" />
      <path d="M12 15 C 8 13, 5 15, 4 18 C 7 19, 10 18, 12 15" fill={color} opacity="0.35" />
      <path d="M12 15 C 16 13, 19 15, 20 18 C 17 19, 14 18, 12 15" fill={color} opacity="0.35" />
      <path d="M12 22 C 9 20, 6 22, 5 25 C 8 26, 10 25, 12 22" fill={color} opacity="0.3" />
      <path d="M12 22 C 15 20, 18 22, 19 25 C 16 26, 14 25, 12 22" fill={color} opacity="0.3" />
    </svg>
  );
}

/** Single rose motif — compact, for minimalist designs */
function SingleRose({ color = "#c084a3", className = "", size = 24 }: { color?: string; className?: string; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" className={className} aria-hidden>
      <path d="M12 3 C 8 3, 5 6, 5 10 C 5 14, 8 17, 12 17 C 16 17, 19 14, 19 10 C 19 6, 16 3, 12 3" fill={color} opacity="0.2" />
      <path d="M12 6 C 9.5 6, 7.5 8, 7.5 10 C 7.5 12, 9.5 14, 12 14 C 14.5 14, 16.5 12, 16.5 10 C 16.5 8, 14.5 6, 12 6" fill={color} opacity="0.4" />
      <path d="M12 8 C 10.5 8, 9.5 9, 9.5 10 C 9.5 11, 10.5 12, 12 12 C 13.5 12, 14.5 11, 14.5 10 C 14.5 9, 13.5 8, 12 8" fill={color} opacity="0.7" />
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// ELEGANT INVITE PREVIEW — reusable component for concept thumbnails + customize
// ═══════════════════════════════════════════════════════════════════════════════

type InvitePreviewProps = {
  title: string;
  date?: string;
  venue?: string;
  palette: { bg: string; text: string; accent: string; dots: string[] };
  frameStyle?: "gold-double" | "thin-colored" | "botanical" | "minimal";
  motif?: "rose-corner" | "botanical" | "single-rose" | "none";
  fontClass?: string;
  layout?: "banner" | "split" | "centered";
  className?: string;
  compact?: boolean;
};

function ElegantInvitePreview({
  title,
  date = "September 14 · 11:00 AM",
  venue = "Garden Terrace",
  palette,
  frameStyle = "gold-double",
  motif = "rose-corner",
  fontClass = "font-serif",
  layout = "centered",
  className = "",
  compact = false,
}: InvitePreviewProps) {
  const frameClass = {
    "gold-double": "ring-1 ring-[#d4af37]/50",
    "thin-colored": "ring-1",
    "botanical": "ring-1 ring-[#a3b8a3]/50",
    "minimal": "ring-1 ring-border/50",
  }[frameStyle];

  return (
    <div
      className={`relative overflow-hidden rounded-md ${frameClass} ${className}`}
      style={{
        background: `linear-gradient(135deg, ${palette.bg} 0%, ${palette.accent}15 100%)`,
      }}
    >
      {/* Paper texture overlay */}
      <div
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{
          background: `radial-gradient(circle at 30% 20%, rgba(255,255,255,0.4), transparent 50%), radial-gradient(circle at 70% 80%, ${palette.accent}10, transparent 50%)`,
        }}
      />

      {/* Inner gold frame for gold-double style */}
      {frameStyle === "gold-double" && (
        <div className="pointer-events-none absolute inset-1.5 rounded-sm border border-[#d4af37]/30" />
      )}

      {/* Floral motifs */}
      {motif === "rose-corner" && (
        <>
          <RoseCorner color={palette.accent} leafColor="#a3b8a3" className="absolute right-1 top-1" size={compact ? 24 : 32} />
          <div className="absolute bottom-1 left-1 rotate-180">
            <RoseCorner color={palette.accent} leafColor="#a3b8a3" size={compact ? 24 : 32} />
          </div>
        </>
      )}
      {motif === "botanical" && (
        <>
          <BotanicalSprig color="#a3b8a3" className="absolute left-1 top-1" size={compact ? 16 : 22} />
          <div className="absolute right-1 bottom-1 rotate-180">
            <BotanicalSprig color="#a3b8a3" size={compact ? 16 : 22} />
          </div>
        </>
      )}
      {motif === "single-rose" && (
        <div className="absolute left-1/2 top-1 -translate-x-1/2">
          <SingleRose color={palette.accent} size={compact ? 16 : 22} />
        </div>
      )}

      {/* Content */}
      <div className={`relative z-10 ${compact ? "p-2" : "p-3"} text-center`}>
        {layout === "banner" && (
          <div className="mb-1 h-px" style={{ background: `linear-gradient(90deg, transparent, ${palette.accent}40, transparent)` }} />
        )}
        <p
          className={`${fontClass} ${compact ? "text-[9px]" : "text-[11px]"} font-bold leading-tight`}
          style={{ color: palette.text }}
        >
          {title}
        </p>
        {!compact && (
          <>
            <p className={`${fontClass} mt-0.5 text-[7px] italic`} style={{ color: palette.text, opacity: 0.6 }}>
              {date}
            </p>
            <p className="text-[6px] uppercase tracking-widest" style={{ color: palette.text, opacity: 0.5 }}>
              {venue}
            </p>
            <div className="mx-auto mt-1 h-px w-2/3" style={{ background: `linear-gradient(90deg, transparent, ${palette.accent}50, transparent)` }} />
            <p className="mt-0.5 text-[6px] uppercase tracking-wider" style={{ color: palette.text, opacity: 0.4 }}>
              RSVP by Sep 7
            </p>
          </>
        )}
        {compact && (
          <p className="mt-0.5 text-[6px] italic" style={{ color: palette.text, opacity: 0.5 }}>
            {date}
          </p>
        )}
        {/* Palette dots */}
        <div className="mt-1 flex justify-center gap-0.5">
          {palette.dots.map((c, i) => (
            <span key={i} className={`${compact ? "h-1 w-1" : "h-1.5 w-1.5"} rounded-full`} style={{ backgroundColor: c }} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEMO SCRIPT
// ═══════════════════════════════════════════════════════════════════════════════

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
    userTypes: "Sofia's garden party, rose & gold theme, turning 30, ~20 close friends, backyard brunch.",
  },
  {
    label: "Posy asks one quick question",
    duration: 2400,
    posySays: "Love it! Any must-haves — a toast moment, live music, a specific flower palette?",
  },
  {
    label: "You answer",
    duration: 2000,
    userTypes: "Definitely a champagne toast and soft pink roses everywhere.",
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
    duration: 5000,
    posySays: "Here are four invitation directions. Pick one and I'll make it yours.",
    reveal: "inviteConcepts",
  },
  {
    label: "Customize invite + envelope",
    duration: 6500,
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

// ═══════════════════════════════════════════════════════════════════════════════
// FAKE DATA
// ═══════════════════════════════════════════════════════════════════════════════

const TIMELINE_ITEMS = [
  { time: "11:00 AM", title: "Guests arrive", icon: Users },
  { time: "11:30 AM", title: "Garden toast & brunch", icon: Sparkles },
  { time: "1:00 PM", title: "Live acoustic set", icon: Check },
  { time: "2:00 PM", title: "Cake & photos", icon: Check },
  { time: "3:30 PM", title: "Farewell favors", icon: Check },
];

const GUESTS = [
  { name: "Elena Voss", status: "Yes", color: "bg-green-500" },
  { name: "James Park", status: "Yes", color: "bg-green-500" },
  { name: "Mira Kapoor", status: "Maybe", color: "bg-yellow-500" },
  { name: "Leo Marchetti", status: "Pending", color: "bg-gray-400" },
];

const CHECKLIST = [
  "Order rose bouquet centerpieces",
  "Book acoustic guitarist for brunch",
  "Send invitations (this week!)",
  "Reserve champagne for toast",
  "Prepare garden favors for 20",
];

// ═══════════════════════════════════════════════════════════════════════════════
// INVITE CONCEPTS — 4 distinct elegant designs
// ═══════════════════════════════════════════════════════════════════════════════

type ConceptDesign = {
  name: string;
  lane: string;
  title: string;
  palette: { bg: string; text: string; accent: string; dots: string[] };
  frameStyle: "gold-double" | "thin-colored" | "botanical" | "minimal";
  motif: "rose-corner" | "botanical" | "single-rose" | "none";
  fontClass: string;
};

const INVITE_CONCEPTS: ConceptDesign[] = [
  {
    name: "Garden Rose Soirée",
    lane: "Editorial Premium",
    title: "Sofia's Garden Party",
    palette: { bg: "#fef7ed", text: "#9d6b7b", accent: "#c084a3", dots: ["#fef7ed", "#c084a3", "#d4af37", "#9d6b7b"] },
    frameStyle: "gold-double",
    motif: "rose-corner",
    fontClass: "font-serif",
  },
  {
    name: "Sage Terrace Brunch",
    lane: "Minimal Modern",
    title: "Sofia's Garden Party",
    palette: { bg: "#f5f7f0", text: "#3a5a40", accent: "#a3b8a3", dots: ["#f5f7f0", "#a3b8a3", "#d4af37", "#3a5a40"] },
    frameStyle: "botanical",
    motif: "botanical",
    fontClass: "font-sans",
  },
  {
    name: "Vintage Rose Garden",
    lane: "Handcrafted Rustic",
    title: "Sofia's Garden Party",
    palette: { bg: "#fdf6f0", text: "#7f1d1d", accent: "#c9a227", dots: ["#fdf6f0", "#c9a227", "#d4a5a5", "#7f1d1d"] },
    frameStyle: "gold-double",
    motif: "rose-corner",
    fontClass: "font-serif",
  },
  {
    name: "Modern Floral Minimal",
    lane: "Storybook Whimsical",
    title: "Sofia's Garden Party",
    palette: { bg: "#fefcf9", text: "#9d6b7b", accent: "#c084a3", dots: ["#fefcf9", "#c084a3", "#e8d5b7", "#9d6b7b"] },
    frameStyle: "minimal",
    motif: "single-rose",
    fontClass: "font-serif",
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// CUSTOMIZE STAGES — cohesive muted palette, shifts within rose/sage family
// ═══════════════════════════════════════════════════════════════════════════════

const FONT_SAMPLES = [
  { name: "Editorial Serif", className: "font-serif" },
  { name: "Modern Sans", className: "font-sans" },
  { name: "Playful Rounded", className: "font-sans font-medium" },
];

const LAYOUT_OPTIONS = [
  { name: "Banner", glyph: "\u25AC" },
  { name: "Split", glyph: "\u25A5" },
  { name: "Centered", glyph: "\u25C9" },
];

type CustomStage = {
  prompt: string;
  fontIdx: number;
  layoutIdx: number;
  palette: { bg: string; text: string; accent: string; dots: string[] };
  envelopeColor: string;
  linerPattern: "solid" | "dots" | "stripes" | "chevron" | "floral" | "waves" | "lattice" | "confetti" | "stars" | "hearts" | "diamonds" | "scallops";
  stampStyle: "classic" | "seal" | "postmark" | "motif" | "wax-seal" | "heart" | "star" | "floral" | "bow" | "monogram";
  envelopeOpened: boolean;
};

const CUSTOMIZE_STAGES: CustomStage[] = [
  {
    prompt: "Try warmer rose tones",
    fontIdx: 0,
    layoutIdx: 0,
    palette: { bg: "#fef7ed", text: "#9d6b7b", accent: "#c084a3", dots: ["#fef7ed", "#c084a3", "#d4af37", "#9d6b7b"] },
    envelopeColor: "#c084a3",
    linerPattern: "dots",
    stampStyle: "classic",
    envelopeOpened: false,
  },
  {
    prompt: "Make it more romantic",
    fontIdx: 0,
    layoutIdx: 2,
    palette: { bg: "#fdf0f5", text: "#831843", accent: "#c084a3", dots: ["#fdf0f5", "#c084a3", "#d4af37", "#831843"] },
    envelopeColor: "#9d6b7b",
    linerPattern: "stripes",
    stampStyle: "floral",
    envelopeOpened: false,
  },
  {
    prompt: "Switch to a floral liner",
    fontIdx: 0,
    layoutIdx: 2,
    palette: { bg: "#fdf0f5", text: "#831843", accent: "#c084a3", dots: ["#fdf0f5", "#c084a3", "#d4af37", "#831843"] },
    envelopeColor: "#9d6b7b",
    linerPattern: "floral",
    stampStyle: "floral",
    envelopeOpened: true,
  },
  {
    prompt: "Add a gold stamp",
    fontIdx: 0,
    layoutIdx: 2,
    palette: { bg: "#fdf0f5", text: "#831843", accent: "#d4af37", dots: ["#fdf0f5", "#c084a3", "#d4af37", "#831843"] },
    envelopeColor: "#9d6b7b",
    linerPattern: "floral",
    stampStyle: "seal",
    envelopeOpened: true,
  },
  {
    prompt: "Perfect — your invite suite is ready!",
    fontIdx: 0,
    layoutIdx: 2,
    palette: { bg: "#fdf0f5", text: "#831843", accent: "#c084a3", dots: ["#fdf0f5", "#c084a3", "#d4af37", "#831843"] },
    envelopeColor: "#9d6b7b",
    linerPattern: "floral",
    stampStyle: "seal",
    envelopeOpened: true,
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// PROGRESS RAIL
// ═══════════════════════════════════════════════════════════════════════════════

const RAIL_STAGES = [
  { label: "Describe", icon: Wand2 },
  { label: "Build plan", icon: ClipboardList },
  { label: "Invite concepts", icon: Sparkles },
  { label: "Customize suite", icon: Palette },
];

const stepToRail = (stepIndex: number, isDone: boolean): number => {
  if (stepIndex < 0) return -1;
  if (isDone) return 4;
  if (stepIndex <= 2) return 0;
  if (stepIndex <= 6) return 1;
  if (stepIndex === 7) return 2;
  return 3;
};

// ═══════════════════════════════════════════════════════════════════════════════
// TYPEWRITER HOOK
// ═══════════════════════════════════════════════════════════════════════════════

function useTypewriter(text: string, duration: number, active: boolean, reducedMotion: boolean) {
  const [displayed, setDisplayed] = useState("");
  useEffect(() => {
    if (!active || !text) { setDisplayed(""); return; }
    if (reducedMotion) { setDisplayed(text); return; }
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

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════

export default function AIDemoShowcase({
  bare = false,
  autoPlay = false,
}: {
  bare?: boolean;
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

  const CUSTOMIZE_STEP = 8;
  useEffect(() => {
    if (stepIndex !== CUSTOMIZE_STEP) {
      if (stepIndex < CUSTOMIZE_STEP) setCustomizeStage(0);
      return;
    }
    const stageMs = prefersReducedMotion.current ? 400 : 1200;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let s = 1; s < CUSTOMIZE_STAGES.length; s++) {
      timers.push(setTimeout(() => setCustomizeStage(s), stageMs * s));
    }
    return () => timers.forEach(clearTimeout);
  }, [stepIndex]);

  useEffect(() => {
    if (!autoPlay || hasPlayed) return;
    const t = setTimeout(() => start(), 250);
    return () => clearTimeout(t);
  }, [autoPlay, hasPlayed, start]);

  useEffect(() => {
    if (autoPlay || hasPlayed) return;
    const el = containerRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !hasPlayed) start();
      },
      { threshold: 0.3 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasPlayed, start]);

  useEffect(() => {
    if (!playing || stepIndex < 0) return;
    if (stepIndex >= STEPS.length) { setPlaying(false); return; }
    const step = STEPS[stepIndex];
    const dur = prefersReducedMotion.current ? 200 : step.duration;
    const timer = setTimeout(() => setStepIndex((i) => i + 1), dur);
    return () => clearTimeout(timer);
  }, [playing, stepIndex]);

  const currentStep = stepIndex >= 0 && stepIndex < STEPS.length ? STEPS[stepIndex] : null;
  const isDone = stepIndex >= STEPS.length;
  const revealed: Set<string> = new Set();
  for (let i = 0; i <= stepIndex && i < STEPS.length; i++) {
    const r = STEPS[i].reveal;
    if (r) revealed.add(r);
  }

  const typedUser = useTypewriter(currentStep?.userTypes ?? "", currentStep?.duration ?? 1000, !!currentStep?.userTypes && playing, prefersReducedMotion.current);
  const typedPosy = useTypewriter(currentStep?.posySays ?? "", currentStep?.duration ?? 1000, !!currentStep?.posySays && playing, prefersReducedMotion.current);

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

        {/* Progress rail */}
        <div className="flex items-center gap-1 border-b border-border bg-muted/20 px-3 py-2 sm:px-4">
          {RAIL_STAGES.map((stage, i) => {
            const completed = railStage > i || isDone;
            const active = railStage === i;
            return (
              <div key={i} className="flex flex-1 items-center gap-1">
                {i > 0 && <span className={`h-px flex-1 ${completed ? "bg-primary/40" : "bg-border"}`} />}
                <div className={`flex items-center gap-1 rounded-full px-1.5 py-0.5 transition-all duration-300 ${active ? "bg-primary/10 ring-1 ring-primary/30" : completed ? "" : "opacity-40"}`} data-testid={`rail-stage-${i}`}>
                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[8px] ${completed && !active ? "bg-primary text-primary-foreground" : active ? "bg-primary text-primary-foreground" : "bg-muted-foreground/20 text-muted-foreground"}`}>
                    {completed && !active ? <Check className="h-2.5 w-2.5" /> : i + 1}
                  </span>
                  <span className={`text-[9px] font-medium sm:text-[10px] ${active ? "text-primary" : "text-muted-foreground"}`}>{stage.label}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Demo area — fixed height, content swaps per stage */}
        <div className="grid gap-0 md:grid-cols-2 min-h-[360px]">
          {/* LEFT: Conversation */}
          <div className="border-b border-border p-4 sm:p-5 md:border-b-0 md:border-r">
            <div className="mb-3 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold text-foreground">Your conversation with Posy</span>
            </div>
            <div className="min-h-[280px] space-y-2.5">
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
                    {stepIndex === 3 ? typedPosy : STEPS[3].posySays}
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
              {stepIndex >= 3 && stepIndex < 4 && (
                <div className="flex items-center gap-1.5 pl-1 text-xs text-muted-foreground">
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/50 [animation-delay:0ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/50 [animation-delay:150ms]" />
                  <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/50 [animation-delay:300ms]" />
                  <span className="ml-1">Building your plan…</span>
                </div>
              )}
              {isDone && (
                <div className="flex items-center gap-2 pl-1 text-sm font-medium text-green-600">
                  <Check className="h-4 w-4" /> Your plan is ready.
                </div>
              )}
            </div>
          </div>

          {/* RIGHT: Single-frame active canvas */}
          <div className="relative p-4 sm:p-5" data-testid="demo-canvas">
            {/* Stage 0: Ghosted mood board — not blank */}
            {stepIndex === -1 && (
              <div className="flex h-full min-h-[280px] items-center justify-center">
                <div className="opacity-30 transition-opacity">
                  <ElegantInvitePreview
                    title="Your invitation"
                    palette={{ bg: "#fef7ed", text: "#9d6b7b", accent: "#c084a3", dots: ["#fef7ed", "#c084a3", "#d4af37", "#9d6b7b"] }}
                    frameStyle="gold-double"
                    motif="rose-corner"
                    className="max-w-[200px]"
                  />
                </div>
              </div>
            )}

            {/* Stage 1: Typing — show faint ghost invite */}
            {stepIndex >= 0 && stepIndex <= 3 && !showPlanCards && (
              <div className="flex h-full min-h-[280px] items-center justify-center">
                <div className={`${stepIndex < 3 ? "opacity-20" : "opacity-0"} transition-opacity duration-700`}>
                  <ElegantInvitePreview
                    title="Sofia's Garden Party"
                    palette={{ bg: "#fef7ed", text: "#9d6b7b", accent: "#c084a3", dots: ["#fef7ed", "#c084a3", "#d4af37", "#9d6b7b"] }}
                    frameStyle="gold-double"
                    motif="rose-corner"
                    className="max-w-[200px]"
                  />
                </div>
                {stepIndex >= 3 && stepIndex < 4 && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/50 [animation-delay:0ms]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/50 [animation-delay:150ms]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-primary/50 [animation-delay:300ms]" />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Stage 2: Plan summary — compact 2x2 grid */}
            {showPlanCards && !showConcepts && !showCustomize && (
              <div className="grid h-full grid-cols-2 gap-2.5" data-testid="demo-canvas-plan">
                <DemoCard icon={Calendar} title="Timeline" delay={0} testId="demo-timeline">
                  <div className="space-y-1">
                    {TIMELINE_ITEMS.slice(0, 3).map((item, i) => (
                      <div key={i} className="flex items-center gap-1.5 text-[10px]">
                        <span className="w-12 shrink-0 font-medium text-muted-foreground">{item.time}</span>
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
                    <div className="flex h-10 w-8 shrink-0 flex-col items-center justify-center rounded border border-dashed border-rose-300/50 bg-rose-50 text-rose-500">
                      <Wand2 className="h-3 w-3" />
                    </div>
                    <div className="text-[10px]">
                      <p className="font-medium text-foreground">Garden Rose Soirée</p>
                      <p className="text-muted-foreground">Blush & gold</p>
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

            {/* Stage 3: Invite concepts — 4 elegant mini-invite previews */}
            {showConcepts && !showCustomize && (
              <div className="h-full" data-testid="demo-canvas-concepts">
                <div className="mb-2 flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-primary" />
                  <span className="text-xs font-semibold text-foreground">4 concepts generated</span>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  {INVITE_CONCEPTS.map((c, i) => (
                    <div key={i} className={`relative rounded-md transition-all ${i === 0 ? "ring-2 ring-primary" : "ring-1 ring-border"}`}>
                      <ElegantInvitePreview
                        title={c.title}
                        date="Sep 14 · 11am"
                        venue="Garden Terrace"
                        palette={c.palette}
                        frameStyle={c.frameStyle}
                        motif={c.motif}
                        fontClass={c.fontClass}
                        compact
                      />
                      {/* Selected checkmark */}
                      {i === 0 && (
                        <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground shadow">
                          <Check className="h-2.5 w-2.5" />
                        </span>
                      )}
                      {/* Lane label */}
                      <p className="mt-1 text-center text-[7px] text-muted-foreground">{c.name} · {c.lane}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Stage 4: Live customization — elegant invite + opened envelope */}
            {showCustomize && (() => {
              const stage = CUSTOMIZE_STAGES[customizeStage];
              return (
                <div className="h-full space-y-2" data-testid="demo-canvas-customize">
                  {/* Prompt bar */}
                  <div className="flex items-center gap-1.5 rounded-md bg-primary/5 px-2.5 py-1.5" data-testid={`demo-customize-prompt-${customizeStage}`}>
                    <Sparkles className="h-2.5 w-2.5 shrink-0 text-primary" />
                    <span className="text-[10px] font-medium text-foreground">{stage.prompt}</span>
                  </div>

                  {/* Two-column: elegant invite + opened envelope */}
                  <div className="grid grid-cols-2 gap-3">
                    {/* Elegant invite preview */}
                    <div className="flex items-center justify-center">
                      <ElegantInvitePreview
                        title={stage.layoutIdx === 2 ? "Sofia's Garden Party" : "SOFIA'S GARDEN PARTY"}
                        date="Sep 14 · 11am"
                        venue="Garden Terrace"
                        palette={stage.palette}
                        frameStyle="gold-double"
                        motif="rose-corner"
                        fontClass={FONT_SAMPLES[stage.fontIdx].className}
                        layout={stage.layoutIdx === 0 ? "banner" : stage.layoutIdx === 2 ? "centered" : "split"}
                        className="w-full max-w-[160px] transition-all duration-500"
                      />
                    </div>

                    {/* Envelope — bigger, opened to show liner */}
                    <div className="flex items-center justify-center rounded-md bg-muted/20 p-2 transition-all duration-500">
                      <EnvelopeMockup
                        envelopeColor={stage.envelopeColor}
                        linerPattern={stage.linerPattern}
                        linerColor={stage.envelopeColor}
                        linerBaseColor={stage.palette.bg}
                        stampStyle={stage.stampStyle}
                        stampColor={stage.envelopeColor}
                        finish="premium"
                        addressee="Sofia Taylor"
                        opened={stage.envelopeOpened}
                        className="max-w-[190px] transition-all duration-700"
                      />
                    </div>
                  </div>

                  {/* Font picker */}
                  <div>
                    <p className="mb-0.5 flex items-center gap-1 text-[9px] font-medium text-muted-foreground">
                      <TypeIcon className="h-2.5 w-2.5" /> Font
                    </p>
                    <div className="flex gap-1">
                      {FONT_SAMPLES.map((f, i) => (
                        <span key={i} className={`flex-1 truncate rounded px-1 py-0.5 text-center text-[8px] transition-all duration-300 ${f.className} ${i === stage.fontIdx ? "bg-primary/15 text-primary ring-1 ring-primary/30" : "bg-muted text-muted-foreground"}`}>
                          Aa
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Layout + Colors */}
                  <div className="flex gap-2">
                    <div className="flex-1">
                      <p className="mb-0.5 flex items-center gap-1 text-[9px] font-medium text-muted-foreground">
                        <Layout className="h-2.5 w-2.5" /> Layout
                      </p>
                      <div className="flex gap-0.5">
                        {LAYOUT_OPTIONS.map((l, i) => (
                          <span key={i} className={`flex h-4 w-4 items-center justify-center rounded text-[9px] transition-all duration-300 ${i === stage.layoutIdx ? "bg-primary/15 text-primary ring-1 ring-primary/30" : "bg-muted text-muted-foreground"}`}>
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
                        {stage.palette.dots.map((c, i) => (
                          <span key={i} className="h-4 w-4 rounded-full border border-border transition-all duration-500" style={{ backgroundColor: c }} />
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
              <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-3" data-testid="demo-done">
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
          <Button size="sm" variant="ghost" onClick={stepIndex === -1 || isDone ? reset : undefined} disabled={playing && !isDone} data-testid="button-demo-replay" className="text-xs">
            {stepIndex === -1 ? (<><Sparkles className="mr-1.5 h-3.5 w-3.5" /> Play demo</>) : isDone ? (<><Sparkles className="mr-1.5 h-3.5 w-3.5" /> Replay</>) : "Playing…"}
          </Button>
        </div>
      </div>

      <p className="mt-4 text-center text-sm text-muted-foreground">
        This is a simulated demo. <a href="/intake" className="font-medium text-primary underline underline-offset-2">Try it for real →</a>
      </p>
    </>
  );

  if (bare) return demoWindow;

  return (
    <section className="border-t border-border bg-card/40 px-6 py-16 sm:py-20" id="see-posy-build">
      <div className="mx-auto max-w-4xl">
        <div className="mx-auto mb-10 max-w-2xl text-center">
          <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-primary">See it happen</p>
          <h2 className="font-serif text-2xl font-semibold text-foreground sm:text-3xl" data-testid="text-demo-heading">
            Tell her once. Watch her build the whole plan.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground">
            No setup, no templates to pick. Just describe your event and Posy builds the timeline,
            guest list, invitation concepts, and checklist — then you customize the full invite suite
            live: card, envelope, liner, stamp, and RSVP page.
          </p>
        </div>
        {demoWindow}
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// DemoCard sub-component
// ═══════════════════════════════════════════════════════════════════════════════

function DemoCard({ icon: Icon, title, children, delay, testId }: { icon: typeof Calendar; title: string; children: React.ReactNode; delay: number; testId: string }) {
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

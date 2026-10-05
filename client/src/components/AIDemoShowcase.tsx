/** A guided example using approved, saved Posy artwork. Never calls generation or checkout. */
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, Check, CheckCheck, ClipboardList, LockKeyhole, Mail, Pause, Play, RotateCcw, Sparkles, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import "./AIDemoShowcase.css";

const ORIGINAL = "/demo/garden-original.webp";
const WARMER = "/demo/garden-warmer.webp";
const STEPS = [
  { label: "Describe", title: "Start with the feeling.", detail: "Tell Posy what you’re celebrating, who’s coming, and what you have in mind. Your details give the plan its direction.", note: "Your event. Your details. One place to begin." },
  { label: "Preview", title: "See your idea come to life.", detail: "Preview your first invitation artwork before paying. Keep the image you want to carry into your event.", note: "One initial artwork preview is included, subject to availability." },
  { label: "Unlock", title: "Keep it. Make it yours.", detail: "Choose Spark or Plus to unlock your event and continue to your planning draft. You see the price before you pay.", note: "The full plan and further artwork requests require an unlock." },
  { label: "Plan", title: "A starting point, already in place.", detail: "Review your timeline, checklist, and budget together. Adjust the draft to fit your plans, then add your guests.", note: "You stay in charge of the details and decisions." },
  { label: "Refine", title: "A little warmer? Just ask.", detail: "Describe a change to your saved artwork. Here, the host asked for warmer lantern light while keeping the garden scene.", note: "After unlock. Each image request uses your event’s allowance." },
  { label: "Share", title: "Bring everyone together.", detail: "Open your saved invitation, review the wording, and share when you’re ready. Manage your guests and replies in Invitation & Guests.", note: "Save your progress and return to your event when you need it." },
] as const;

function GardenImage({ edited = false }: { edited?: boolean }) {
  return <img src={edited ? WARMER : ORIGINAL} width={1024} height={1536}
    alt={edited ? "Posy garden dinner artwork with warmer lantern light, ivory flowers, and six place settings" : "Posy garden dinner artwork with ivory flowers, lanterns, and six place settings"}
    className="posy-demo-artwork" loading="lazy" decoding="async" />;
}

function Scene({ step, edited, onEdit }: { step: number; edited: boolean; onEdit: (value: boolean) => void }) {
  if (step === 0) return <div className="posy-demo-form">
    <div className="posy-demo-eyebrow"><Sparkles size={16} aria-hidden /> YOUR EVENT STARTS HERE</div>
    <h4>What are you imagining?</h4>
    <div className="posy-demo-brief">A relaxed garden dinner for six. Ivory flowers, linen, deep green and brass. Beautiful lantern light at dusk.</div>
    <div className="posy-demo-detail-grid">
      <div><span>Occasion</span><strong>Dinner party</strong></div>
      <div><span>Guests</span><strong>6 people</strong></div>
      <div><span>Setting</span><strong>Our garden</strong></div>
      <div><span>Feeling</span><strong>Warm & intimate</strong></div>
    </div>
    <p className="posy-demo-small">Illustrative event details</p>
  </div>;

  if (step === 1) return <div className="posy-demo-image-scene">
    <GardenImage />
    <div className="posy-demo-image-label"><Check size={16} aria-hidden /> Your first artwork preview</div>
  </div>;

  if (step === 2) return <div className="posy-demo-unlock">
    <div className="posy-demo-kept"><GardenImage /><div><CheckCheck size={22} aria-hidden /><strong>Your image is kept</strong><span>Ready for your event</span></div></div>
    <div className="posy-demo-unlock-copy"><LockKeyhole size={26} aria-hidden /><h4>Continue with your event</h4><p>Choose the plan that fits you.</p></div>
    <div className="posy-demo-options"><div><strong>Spark</strong><span>One event unlock</span></div><div><strong>Plus</strong><span>Membership</span></div></div>
    <p className="posy-demo-small">Example checkout step · No purchase happens in this demo.</p>
  </div>;

  if (step === 3) return <div className="posy-demo-plan">
    <div className="posy-demo-plan-heading"><span className="posy-demo-eyebrow">YOUR PLANNING DRAFT</span><h4>An evening in the garden</h4><p>6 guests · A relaxed dinner at home</p></div>
    <div className="posy-demo-plan-grid">
      <div className="posy-demo-card"><h5><CalendarDays size={17} aria-hidden /> Timeline</h5><p><strong>6:00</strong> Welcome & drinks</p><p><strong>6:30</strong> Dinner together</p><p><strong>8:00</strong> Dessert & conversation</p></div>
      <div className="posy-demo-card"><h5><ClipboardList size={17} aria-hidden /> Checklist</h5><p>□ Confirm the menu</p><p>□ Arrange the table</p><p>□ Check the weather</p></div>
      <div className="posy-demo-card"><h5><Users size={17} aria-hidden /> Guests</h5><p>Add your guest list.</p><p>Keep replies together.</p></div>
      <div className="posy-demo-card"><h5><Check size={17} aria-hidden /> Budget</h5><p>Review your estimates.</p><p>Make room for priorities.</p></div>
    </div>
    <p className="posy-demo-small">Illustrative draft · Review and adjust before sharing.</p>
  </div>;

  if (step === 4) return <div className="posy-demo-refine">
    <div className="posy-demo-image-scene"><GardenImage edited={edited} /><div className="posy-demo-image-label">{edited ? "Warmer lantern light" : "Original artwork"}</div></div>
    <div className="posy-demo-comparison" role="group" aria-label="Compare the saved artwork">
      <button type="button" aria-pressed={!edited} onClick={() => onEdit(false)}>Original</button>
      <button type="button" aria-pressed={edited} onClick={() => onEdit(true)}>Warmer lanterns</button>
    </div>
  </div>;

  return <div className="posy-demo-share">
    <div className="posy-demo-invitation"><GardenImage edited /><div><span>YOU’RE INVITED</span><h4>An evening in the garden</h4><p>Saturday · 6:00 PM · Our garden</p></div></div>
    <div className="posy-demo-share-note"><Mail size={19} aria-hidden /><span>Invitation & Guests<br /><strong>Your artwork, wording, and replies together.</strong></span></div>
    <p className="posy-demo-small">Example invitation · Share only when you’re ready.</p>
  </div>;
}

export default function AIDemoShowcase({ bare = false, autoPlay = false }: { bare?: boolean; autoPlay?: boolean } = {}) {
  const [step, setStep] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [edited, setEdited] = useState(true);
  const [finished, setFinished] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(true);

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPlaying(autoPlay && !motion.matches);
    const onMotion = () => { if (motion.matches) setPlaying(false); };
    motion.addEventListener("change", onMotion);
    return () => motion.removeEventListener("change", onMotion);
  }, [autoPlay]);

  useEffect(() => {
    const element = container.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting), { threshold: 0.1 });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const pauseWhenHidden = () => { if (document.hidden) setPlaying(false); };
    document.addEventListener("visibilitychange", pauseWhenHidden);
    return () => document.removeEventListener("visibilitychange", pauseWhenHidden);
  }, []);

  useEffect(() => {
    if (!playing || !inView) return;
    const timer = window.setTimeout(() => {
      if (step === STEPS.length - 1) { setPlaying(false); setFinished(true); }
      else setStep(current => current + 1);
    }, 8000);
    return () => window.clearTimeout(timer);
  }, [playing, step, inView]);

  const goTo = (next: number) => { setPlaying(false); setFinished(false); setStep(next); };
  const togglePlayback = () => {
    if (finished) { setStep(0); setFinished(false); setPlaying(true); }
    else setPlaying(value => !value);
  };
  const current = STEPS[step];
  const demo = <div ref={container} className="posy-demo" data-testid="ai-demo-container">
    <div className="posy-demo-top"><span><Sparkles size={17} aria-hidden /> posy</span><span>AN EVENT, FROM IDEA TO INVITATION</span></div>
    <nav className="posy-demo-chapters" aria-label="Demo chapters">{STEPS.map((item, index) => <button type="button" key={item.label}
      aria-current={index === step ? "step" : undefined} aria-label={`Step ${index + 1}: ${item.label}`} onClick={() => goTo(index)}>
      <span>{index < step ? <Check size={13} aria-hidden /> : index + 1}</span><span>{item.label}</span>
    </button>)}</nav>
    <div className="posy-demo-controls">
      <Button type="button" variant="ghost" onClick={togglePlayback} aria-label={playing ? "Pause walkthrough" : finished ? "Replay walkthrough" : "Play walkthrough"}>
        {playing ? <Pause size={16} aria-hidden /> : finished ? <RotateCcw size={16} aria-hidden /> : <Play size={16} aria-hidden />}
        <span>{playing ? "Pause" : finished ? "Replay" : "Play demo"}</span>
      </Button>
      <span data-testid="demo-step-label">{step + 1} of {STEPS.length} · {current.label}</span>
      <div className="posy-demo-arrows"><Button type="button" variant="ghost" size="icon" aria-label="Previous step" disabled={step === 0} onClick={() => goTo(step - 1)}><ArrowLeft size={18} /></Button>
        <Button type="button" variant="ghost" size="icon" aria-label="Next step" disabled={step === STEPS.length - 1} onClick={() => goTo(step + 1)}><ArrowRight size={18} /></Button></div>
    </div>
    <div className="posy-demo-body">
      <div className="posy-demo-story" aria-live={playing ? "off" : "polite"}>
        <span className="posy-demo-eyebrow">{String(step + 1).padStart(2, "0")} / {String(STEPS.length).padStart(2, "0")}</span>
        <h3 data-testid="demo-step-heading">{current.title}</h3>
        <p>{current.detail}</p>
        <div className="posy-demo-story-note"><span aria-hidden>✦</span><span>{current.note}</span></div>
      </div>
      <div className="posy-demo-scene" data-testid="demo-canvas"><div key={step} className="posy-demo-scene-content"><Scene step={step} edited={edited} onEdit={value => { setEdited(value); setPlaying(false); }} /></div></div>
    </div>
    <div className="posy-demo-caption"><p>Illustrative walkthrough with actual Posy-generated artwork. Steps are shortened; generation times and results vary.</p><a href="/intake">Start your event <ArrowRight size={15} aria-hidden /></a></div>
  </div>;

  if (bare) return demo;
  return <section className="border-t border-border bg-card/40 px-4 py-16 sm:px-6 sm:py-20" id="see-posy-build">
    <div className="mx-auto max-w-5xl"><div className="mx-auto mb-8 max-w-2xl text-center">
      <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-primary">A little less on your plate</p>
      <h2 className="font-serif text-3xl font-semibold text-foreground sm:text-4xl" data-testid="text-demo-heading">Your idea. A beautiful beginning.</h2>
      <p className="mt-4 text-base leading-relaxed text-muted-foreground">Follow a garden dinner from the first idea to artwork, a planning draft, and an invitation ready to share.</p>
    </div>{demo}</div>
  </section>;
}

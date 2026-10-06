/** A guided example using approved, saved Posy artwork. Never calls generation or checkout. */
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, CalendarDays, Check, CheckCheck, ClipboardList, LockKeyhole, Mail, Pause, Play, RotateCcw, Sparkles, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import "./AIDemoShowcase.css";

const ORIGINAL = "/demo/garden-original.webp";
const WARMER = "/demo/garden-warmer.webp";
const STEP_DURATION_MS = 5000;
const STEPS = [
  { label: "Tell us", title: "What are you planning?", detail: "Tell Posy the occasion, how many people are coming, and the look you love.", note: "Start with an idea. Posy helps with the details." },
  { label: "See image", title: "See your invitation image.", detail: "Posy creates an image from your ideas. See the first one before you pay.", note: "One free preview, when available." },
  { label: "Choose plan", title: "Like it? Keep planning.", detail: "Pay for one event with Spark, or subscribe to Plus. Your image comes with you.", note: "Payment gives you the full plan and image editing." },
  { label: "Your plan", title: "Know what to do next.", detail: "Posy puts together a schedule, to-do list, and budget. Review the suggestions and make them your own.", note: "Add guests and keep everything in one place." },
  { label: "Make changes", title: "“Make the lighting warmer.”", detail: "Want to change your invitation image? Tell Posy what you’d like. Compare the before and after here.", note: "Your purchase includes a limited number of image changes." },
  { label: "Invite guests", title: "Ready? Invite your guests.", detail: "Check your invitation’s wording, share it, and see who’s coming. Return anytime to keep planning.", note: "Find your invitation and replies in Invitation & Guests." },
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
    <div className="posy-demo-brief">A garden dinner for six, with white flowers and glowing lanterns.</div>
    <div className="posy-demo-detail-grid">
      <div><span>Occasion</span><strong>Dinner party</strong></div>
      <div><span>Guests</span><strong>6 people</strong></div>
      <div><span>Setting</span><strong>Our garden</strong></div>
      <div><span>Feeling</span><strong>Warm & intimate</strong></div>
    </div>
    <p className="posy-demo-small">Example event</p>
  </div>;

  if (step === 1) return <div className="posy-demo-image-scene">
    <GardenImage />
    <div className="posy-demo-image-label"><Check size={16} aria-hidden /> Your first invitation image</div>
  </div>;

  if (step === 2) return <div className="posy-demo-unlock">
    <div className="posy-demo-kept"><GardenImage /><div><CheckCheck size={22} aria-hidden /><strong>Keep this image</strong><span>Continue planning your event</span></div></div>
    <div className="posy-demo-unlock-copy"><LockKeyhole size={26} aria-hidden /><h4>Choose what works for you</h4></div>
    <div className="posy-demo-options"><div><strong>Spark</strong><span>One event · Pay once</span></div><div><strong>Plus</strong><span>Subscription</span></div></div>
    <p className="posy-demo-small">You’ll see prices before paying. This demo makes no purchase.</p>
  </div>;

  if (step === 3) return <div className="posy-demo-plan">
    <div className="posy-demo-plan-heading"><span className="posy-demo-eyebrow">YOUR EVENT PLAN</span><h4>An evening in the garden</h4><p>6 guests · Dinner at home</p></div>
    <div className="posy-demo-plan-grid">
      <div className="posy-demo-card"><h5><CalendarDays size={17} aria-hidden /> Schedule</h5><p><strong>6:00</strong> Drinks</p><p><strong>6:30</strong> Dinner</p><p><strong>8:00</strong> Dessert</p></div>
      <div className="posy-demo-card"><h5><ClipboardList size={17} aria-hidden /> To-do list</h5><p>□ Plan the menu</p><p>□ Set the table</p><p>□ Check the weather</p></div>
      <div className="posy-demo-card"><h5><Users size={17} aria-hidden /> Guests</h5><p>Add your guest list.</p><p>Keep replies together.</p></div>
      <div className="posy-demo-card"><h5><Check size={17} aria-hidden /> Budget</h5><p>See estimated costs.</p><p>Adjust your spending.</p></div>
    </div>
    <p className="posy-demo-small">Example plan · You can change the details.</p>
  </div>;

  if (step === 4) return <div className="posy-demo-refine">
    <div className="posy-demo-image-scene"><GardenImage edited={edited} /><div className="posy-demo-image-label">{edited ? "After: warmer lighting" : "Before: original image"}</div></div>
    <div className="posy-demo-comparison" role="group" aria-label="Compare before and after">
      <button type="button" aria-pressed={!edited} onClick={() => onEdit(false)}>Before</button>
      <button type="button" aria-pressed={edited} onClick={() => onEdit(true)}>After</button>
    </div>
  </div>;

  return <div className="posy-demo-share">
    <div className="posy-demo-invitation"><GardenImage edited /><div><span>YOU’RE INVITED</span><h4>An evening in the garden</h4><p>Saturday · 6:00 PM · Our garden</p></div></div>
    <div className="posy-demo-share-note"><Mail size={19} aria-hidden /><span>Invitation & Guests<br /><strong>Your invitation and guest replies, together.</strong></span></div>
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
    }, STEP_DURATION_MS);
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
      <span data-testid="demo-step-label">{step + 1} of {STEPS.length}</span>
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
    <div className="posy-demo-caption"><p>A 30-second example using images made with Posy. Creating your own takes longer; results vary.</p><a href="/intake">Start your event <ArrowRight size={15} aria-hidden /></a></div>
  </div>;

  if (bare) return demo;
  return <section className="border-t border-border bg-card/40 px-4 py-16 sm:px-6 sm:py-20" id="see-posy-build">
    <div className="mx-auto max-w-5xl"><div className="mx-auto mb-8 max-w-2xl text-center">
      <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-primary">A little less on your plate</p>
      <h2 className="font-serif text-3xl font-semibold text-foreground sm:text-4xl" data-testid="text-demo-heading">Your idea. A beautiful beginning.</h2>
      <p className="mt-4 text-base leading-relaxed text-muted-foreground">See how Posy helps plan a garden dinner—from the first idea to inviting guests—in 30 seconds.</p>
    </div>{demo}</div>
  </section>;
}

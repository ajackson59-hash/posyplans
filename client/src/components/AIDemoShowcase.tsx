/** Scripted product story with saved, approved images. No generation or checkout calls. */
import { useEffect, useRef, useState } from "react";
import { ArrowRight, ArrowUp, CalendarDays, Check, ClipboardList, Coins, Pause, Play, RotateCcw, Sparkles, Users } from "lucide-react";
import "./AIDemoShowcase.css";

const ORIGINAL = "/demo/garden-original.webp";
const WARMER = "/demo/garden-warmer.webp";
const PROMPT = "A garden dinner for six. White flowers, linen, and lanterns at dusk.";
const EDIT = "Make the lighting warmer.";
const CHAPTERS = [
  { label: "Your idea", title: "Tell Posy what you’re imagining.", start: 0, duration: 3500 },
  { label: "The reveal", title: "And watch it take shape.", start: 3500, duration: 4000 },
  { label: "Make it yours", title: "A few words. A whole new feeling.", start: 7500, duration: 6500 },
  { label: "Your plan", title: "The details come together, too.", start: 14000, duration: 4000 },
] as const;
const DURATION = 18000;

function Invitation({ edited }: { edited: boolean }) {
  return <div className="posy-story-invitation">
    <div className="posy-story-picture">
      <img src={ORIGINAL} width={1024} height={1536} alt={edited ? "" : "Garden dinner invitation image with white flowers and lanterns"} aria-hidden={edited} />
      <img src={WARMER} width={1024} height={1536} alt={edited ? "The same garden invitation with warmer lantern light" : ""} aria-hidden={!edited}
        className={`posy-story-warmer${edited ? " is-visible" : ""}`} />
    </div>
    <div className="posy-story-invitation-title"><span>YOU’RE INVITED</span><strong>An evening in the garden</strong></div>
  </div>;
}

function Plan() {
  return <div className="posy-story-plan">
    <div className="posy-story-plan-title"><Sparkles size={17} aria-hidden /><span>A little less on your plate.</span></div>
    <h4>Garden dinner</h4>
    <div className="posy-story-plan-grid">
      <div className="posy-story-card"><h5><CalendarDays size={16} aria-hidden /> Schedule</h5><p><b>6:00</b> Drinks</p><p><b>6:30</b> Dinner</p><p><b>8:00</b> Dessert</p></div>
      <div className="posy-story-card"><h5><ClipboardList size={16} aria-hidden /> To-do list</h5><p><Check size={12} aria-hidden /> Plan the menu</p><p><Check size={12} aria-hidden /> Set the table</p><p><Check size={12} aria-hidden /> Check the weather</p></div>
      <div className="posy-story-card"><h5><Users size={16} aria-hidden /> Your guests</h5><p>Add your people.</p><p>Keep replies together.</p></div>
      <div className="posy-story-card"><h5><Coins size={16} aria-hidden /> Your budget</h5><p>See estimated costs.</p><p>Adjust as you go.</p></div>
    </div>
    <a className="posy-story-cta" href="/intake">Let’s plan your event <ArrowRight size={16} aria-hidden /></a>
    <p className="posy-story-plan-note">Suggested details. Always yours to change.</p>
  </div>;
}

export default function AIDemoShowcase({ bare = false, autoPlay = false }: { bare?: boolean; autoPlay?: boolean } = {}) {
  const [elapsed, setElapsed] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [showPoster, setShowPoster] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [motionReady, setMotionReady] = useState(false);
  const [inView, setInView] = useState(false);
  const [pageVisible, setPageVisible] = useState(() => !document.hidden);
  const [comparison, setComparison] = useState<boolean | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const autoplayHandled = useRef(false);
  const finished = elapsed >= DURATION;
  const running = playing && !finished && inView && pageVisible;
  const step = elapsed < 3500 ? 0 : elapsed < 7500 ? 1 : elapsed < 14000 ? 2 : 3;
  const current = CHAPTERS[step];
  const sceneTime = elapsed - current.start;
  const edited = comparison ?? (!started || reducedMotion || sceneTime >= 2100);
  const text = step === 2 ? EDIT : PROMPT;
  const typed = !started || reducedMotion ? text : text.slice(0, Math.floor(sceneTime / 24));

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(motion.matches);
    setMotionReady(true);
    const onMotion = () => { setReducedMotion(motion.matches); if (motion.matches) setPlaying(false); };
    motion.addEventListener("change", onMotion);
    return () => motion.removeEventListener("change", onMotion);
  }, []);

  useEffect(() => {
    if (!container.current) return;
    // Older browsers keep manual playback available without starting offscreen.
    if (typeof IntersectionObserver === "undefined") { setInView(true); return; }
    const observer = new IntersectionObserver(([entry]) => setInView(entry.isIntersecting && entry.intersectionRatio >= 0.5), { threshold: 0.5 });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const pauseWhenHidden = () => setPageVisible(!document.hidden);
    document.addEventListener("visibilitychange", pauseWhenHidden);
    return () => document.removeEventListener("visibilitychange", pauseWhenHidden);
  }, []);

  useEffect(() => {
    if (!autoPlay || !motionReady || reducedMotion || !inView || !pageVisible || autoplayHandled.current || typeof IntersectionObserver === "undefined") return;
    autoplayHandled.current = true;
    setShowPoster(false);
    setStarted(true);
    setPlaying(true);
  }, [autoPlay, motionReady, reducedMotion, inView, pageVisible]);

  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => setElapsed(value => Math.min(value + 50, DURATION)), 50);
    return () => window.clearInterval(timer);
  }, [running]);

  const goTo = (index: number) => { autoplayHandled.current = true; setShowPoster(false); setPlaying(false); setStarted(false); setComparison(null); setElapsed(CHAPTERS[index].start); };
  const togglePlayback = () => {
    autoplayHandled.current = true;
    setShowPoster(false);
    if (finished) { setElapsed(0); setComparison(null); }
    setStarted(true);
    setPlaying(finished || !playing);
  };
  const compare = (value: boolean) => { setComparison(value); setPlaying(false); };
  const player = <div ref={container} className={`posy-story${running ? " is-playing" : ""}`} data-testid="ai-demo-container">
    <div className="posy-story-toolbar">
      <span className="posy-story-brand"><Sparkles size={16} aria-hidden /> posy</span>
      <span className="posy-story-runtime">18-second demo</span>
      <button type="button" className="posy-story-play" onClick={togglePlayback}
        aria-label={running ? "Pause walkthrough" : finished ? "Replay walkthrough" : "Play walkthrough"}>
        {running ? <Pause size={15} aria-hidden /> : finished ? <RotateCcw size={15} aria-hidden /> : <Play size={15} aria-hidden />}
        {running ? "Pause" : finished ? "Replay" : "Play"}
      </button>
    </div>
    <div className="posy-story-stage" data-testid="demo-canvas" aria-live={running ? "off" : "polite"}>
      <div className="posy-story-scene" key={showPoster ? "poster" : step}>
        {showPoster ? <div className="posy-story-result posy-story-poster">
          <div className="posy-story-dialogue">
            <h3 data-testid="demo-step-heading">Your idea, brought to life.</h3>
            <p className="posy-story-desktop-note">A beautiful invitation. A plan to go with it.</p>
          </div>
          <div className="posy-story-artwork"><Invitation edited />
            <button type="button" className="posy-story-watch" onClick={togglePlayback}><Play size={16} aria-hidden /> Watch Posy in action</button>
          </div>
        </div> : step === 0 ? <div className="posy-story-conversation">
          <div className="posy-story-avatar"><Sparkles size={23} aria-hidden /></div>
          <h3 data-testid="demo-step-heading">What are you imagining?</h3>
          <div className="posy-story-input"><span className="sr-only">{PROMPT}</span><p aria-hidden>{typed}<i className="posy-story-cursor" /></p><span className="posy-story-send" aria-hidden><ArrowUp size={20} /></span></div>
          <div className="posy-story-tags"><span>6 guests</span><span>In the garden</span><span>At dusk</span></div>
          <p className="posy-story-hint">Your idea is all you need to start.</p>
        </div> : step < 3 ? <div className={`posy-story-result${step === 2 ? " is-edit" : ""}`}>
          <div className="posy-story-dialogue">
            <span className="posy-story-speaker">{step === 1 ? <><Sparkles size={14} aria-hidden /> POSY</> : "YOU"}</span>
            <h3 data-testid="demo-step-heading">{step === 1 ? "A little garden magic." : <><span className="sr-only">{EDIT}</span><span aria-hidden>{typed}<i className="posy-story-cursor" /></span></>}</h3>
            <p className="posy-story-desktop-note">{step === 1 ? "An invitation image inspired by your idea." : "Same garden. A warmer glow."}</p>
          </div>
          <div className="posy-story-artwork">
            <Invitation edited={step === 2 && edited} />
            {step === 2 ? <div className="posy-story-compare" role="group" aria-label="Compare before and after">
              <button type="button" aria-pressed={!edited} onClick={() => compare(false)}>Before</button>
              <button type="button" aria-pressed={edited} onClick={() => compare(true)}>After <Sparkles size={11} aria-hidden /></button>
            </div> : <span className="posy-story-result-badge"><Check size={12} aria-hidden /> Your first look</span>}
          </div>
        </div> : <><h3 className="sr-only" data-testid="demo-step-heading">{current.title}</h3><Plan /></>}
      </div>
    </div>
    <nav className="posy-story-chapters" aria-label="Demo chapters">{CHAPTERS.map((chapter, index) => <button key={chapter.label} type="button"
      onClick={() => goTo(index)} aria-current={index === step ? "step" : undefined} aria-label={`Step ${index + 1}: ${chapter.label}`}>
      <span className="posy-story-track" aria-hidden><span style={{ width: `${Math.min(100, Math.max(0, (elapsed - chapter.start) / chapter.duration * 100))}%` }} /></span>
      <span>{chapter.label}</span>
    </button>)}</nav>
    <p className="posy-story-caption">Example, sped up. Free preview when available; paid plan for edits and planning. Image limits apply.</p>
  </div>;

  if (bare) return player;
  return <section className="posy-story-section" id="see-posy-build">
    <div className="posy-story-section-inner">
      <div className="posy-story-intro"><h2 data-testid="text-demo-heading">You imagine it. Posy gets it started.</h2><p>One idea. A beautiful invitation. A plan to go with it.</p></div>
      {player}
      <a className="posy-story-cta posy-story-section-cta" href="/intake">Plan my event <ArrowRight size={16} aria-hidden /></a>
    </div>
  </section>;
}

import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { SiInstagram, SiTiktok, SiFacebook, SiX } from "react-icons/si";
import { apiRequest, apiRequestJson } from "@/lib/queryClient";
import { Wordmark, Logo } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import ContinuePlanning from "@/components/ContinuePlanningCard";
import AIDemoShowcase from "@/components/AIDemoShowcase";
import DatePickerField from "@/components/DatePickerField";
import { EVENT_TYPES } from "@/lib/types";
import type { EventRecord } from "@/lib/types";
import { useToast } from "@/hooks/use-toast";
import {
  Users,
  Mail,
  ClipboardList,
  Sparkles,
  Wand2,
  Compass,
  ShieldCheck,
  Layers,
  Heart,
  MessageSquare,
  SlidersHorizontal,
} from "lucide-react";

const BLUEPRINT_EVENT_TYPE_MAP: Record<string, string> = {
  Wedding: "Wedding",
  "Destination Wedding": "Wedding",
  "Baby Shower": "Baby Shower",
  "Bridal Shower": "Bridal Shower",
  "Birthday Party": "Birthday Party",
  "Quinceañera / Coming-of-Age": "Birthday Party",
  "Engagement Party": "Anniversary",
  "Graduation Party": "Graduation",
  "Retirement Party": "Other Celebration",
  "Anniversary Party": "Anniversary",
  "Family Reunion": "Other Celebration",
  "Housewarming Party": "Housewarming",
  "Holiday Gathering": "Holiday Gathering",
  "Other Celebration": "Other Celebration",
};

function useBlueprintHandoff() {
  return useMemo(() => {
    if (typeof window === "undefined") return null;
    // Query params travel in the real address-bar search string (before the
    // hash), since wouter's hash router treats everything after "#/" as the
    // path and would 404 on a query string appended there.
    let search = window.location.search.replace(/^\?/, "");
    if (!search) {
      const hash = window.location.hash || "";
      const queryIndex = hash.indexOf("?");
      if (queryIndex >= 0) search = hash.slice(queryIndex + 1);
    }
    const params = new URLSearchParams(search);
    if (params.get("from") !== "blueprint") return null;
    const rawEventType = params.get("eventType") || "";
    return {
      eventName: params.get("eventName") || "",
      eventType: BLUEPRINT_EVENT_TYPE_MAP[rawEventType] || "Other Celebration",
      location: params.get("location") || "",
      hostNames: params.get("hostNames") || "",
      themeName: params.get("themeName") || "",
      paletteColors: params.get("palette")
        ? params.get("palette")!.split(",").filter(Boolean)
        : [],
      guestCount: params.get("guestCount") || "",
      budget: params.get("budget") || "",
    };
  }, []);
}

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export default function Home() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const handoff = useBlueprintHandoff();
  // Two entry points into the same product: a guided AI wizard ("describe
  // it, we'll build it") or the original manual form. A blueprint handoff
  // always skips straight to the manual form since those fields are already
  // filled in and reviewable.
  const [entryMode, setEntryMode] = useState<"choice" | "manual">(handoff ? "manual" : "choice");
  const [eventName, setEventName] = useState(handoff?.eventName || "");
  const [eventType, setEventType] = useState(handoff?.eventType || "Birthday Party");
  const [eventDate, setEventDate] = useState("");
  const [location, setLocationField] = useState(handoff?.location || "");
  const [hostNames, setHostNames] = useState(handoff?.hostNames || "");
  const [hostEmail, setHostEmail] = useState("");

  useEffect(() => {
    if (handoff) {
      toast({
        title: "Blueprint imported",
        description: "We've prefilled your event from the blueprint generator. Review the details below and create your event.",
      });
      scrollToId("get-started");
    }
  }, []);

  const createEvent = useMutation({
    mutationFn: async () => {
      const defaultSubject = `You're invited: ${eventName || "our celebration"}!`;
      const defaultMessage = `Hi there!\n\nWe'd love for you to join us${
        eventName ? ` for ${eventName}` : ""
      }${eventDate ? ` on ${eventDate}` : ""}${location ? ` at ${location}` : ""}.\n\nPlease RSVP using the link below so we can plan for you.\n\nCan't wait to celebrate with you!\n${hostNames ? `— ${hostNames}` : ""}`;
      const res = await apiRequest("POST", "/api/events", {
        eventName: eventName || "My Celebration",
        eventType,
        eventDate,
        location,
        hostNames,
        themeName: handoff?.themeName || "",
        paletteColors: JSON.stringify(handoff?.paletteColors || []),
        inviteSubject: defaultSubject,
        inviteMessage: defaultMessage,
        budgetTotal: handoff?.budget ? Number(handoff.budget) : 0,
      });
      const event = (await res.json()) as EventRecord;
      // Capture email immediately after creation if the host provided one,
      // so they can recover access later via /recover
      if (hostEmail.trim()) {
        try {
          await apiRequestJson("POST", `/api/events/${event.id}/email-capture`, {
            email: hostEmail,
            ownerToken: event.ownerToken,
          });
        } catch {
          // Non-blocking — the event is already created
        }
      }
      return event;
    },
    onSuccess: (event) => {
      toast({
        title: "Event created",
        description: hostEmail.trim()
          ? "Bookmark your dashboard link — or use your email to find it later at posyplans.com/recover"
          : "Bookmark your dashboard link — it's the only way back in.",
      });
      navigate(`/dashboard/${event.ownerToken}`);
    },
    onError: () => {
      toast({ title: "I couldn't create your event", description: "Please try again.", variant: "destructive" });
    },
  });

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <Link href="/" data-testid="link-logo-home">
            <Wordmark />
          </Link>
          <nav className="hidden items-center gap-8 md:flex" data-testid="nav-primary">
            <button
              type="button"
              onClick={() => scrollToId("how-posy-works")}
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              data-testid="link-nav-how-posy-helps"
            >
              How Posy helps
            </button>
            <button
              type="button"
              onClick={() => scrollToId("concierge")}
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              data-testid="link-nav-concierge"
            >
              Posy Concierge
            </button>
            <Link
              href="/pricing"
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              data-testid="link-nav-pricing"
            >
              Pricing
            </Link>
            <Link
              href="/recover"
              className="text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
              data-testid="link-nav-recover"
            >
              Find my event
            </Link>
          </nav>
          <Button
            data-testid="button-nav-start-planning"
            onClick={() => navigate("/intake")}
          >
            Start planning
          </Button>
        </div>
      </header>

      <main>
        <ContinuePlanning />
        {handoff && (
          <div className="mx-auto max-w-6xl px-6 pt-10">
            <div
              className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3"
              data-testid="banner-blueprint-imported"
            >
              <Wand2 className="h-4 w-4 flex-none text-primary" />
              <p className="text-sm text-foreground">
                Imported from your blueprint{handoff.themeName ? `: ${handoff.themeName}` : ""}.
                {handoff.guestCount ? ` Planned for ~${handoff.guestCount} guests.` : ""}
                {handoff.budget ? ` Budget carried over: $${Number(handoff.budget).toLocaleString()}.` : ""}
              </p>
              {handoff.paletteColors.length > 0 && (
                <div className="flex items-center gap-1" data-testid="swatches-blueprint-palette">
                  {handoff.paletteColors.map((c, i) => (
                    <span
                      key={i}
                      className="h-4 w-4 rounded-full border border-border"
                      style={{ backgroundColor: c }}
                      title={c}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* HERO */}
        <section className="mx-auto max-w-6xl px-6 py-14 sm:py-20">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
            <div>
              <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-primary" data-testid="text-eyebrow">
                Your Planning Concierge
              </p>
              <h1 className="font-serif text-3xl font-semibold leading-tight text-foreground sm:text-4xl lg:text-5xl" data-testid="text-hero-title">
                Life already asks enough of you.
                <br />
                You shouldn't have to{" "}
                <span className="italic text-primary">plan it all alone.</span>
              </h1>
              <p className="mt-5 text-base font-medium text-foreground" data-testid="text-hero-subtitle">
                Tell Posy about your event once.
              </p>
              <p className="mt-2 text-base leading-relaxed text-muted-foreground" data-testid="text-hero-supporting">
                Posy Concierge creates a thoughtful planning foundation — the timeline, the
                checklist, the little things easy to forget — and helps guide the rest.
              </p>

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <Button
                  size="lg"
                  data-testid="button-hero-start-planning"
                  onClick={() => navigate("/intake")}
                >
                  Start planning
                </Button>
                <Button
                  size="lg"
                  data-testid="button-hero-see-how-it-works"
                  onClick={() => scrollToId("see-posy-build")}
                >
                  See Posy build a plan
                </Button>
              </div>
              <p className="mt-3 text-sm text-muted-foreground" data-testid="text-hero-reassurance">
                ✓ Describe your event first · No pressure, no clutter
              </p>
            </div>

            <div className="relative">
              <img
                src="/brand/photography/posy_hero_tablescape.png"
                alt="A softly styled celebration tablescape"
                className="w-full rounded-2xl border border-card-border object-cover shadow-sm"
                data-testid="img-hero-tablescape"
              />
              <div className="absolute -bottom-5 -left-5 flex h-16 w-16 items-center justify-center rounded-full border border-card-border bg-card shadow-sm sm:h-20 sm:w-20">
                <Logo className="h-9 w-9 sm:h-11 sm:w-11" />
              </div>
            </div>
          </div>
        </section>

        {/* AI DEMO — scripted auto-playing showcase */}
        <AIDemoShowcase />

        {/* GET STARTED — functional entry point (AI wizard vs. manual form) */}
        <section id="get-started" className="mx-auto max-w-6xl px-6 pb-14 sm:pb-20">
          <div className="grid gap-12 lg:grid-cols-2 lg:items-start">
            <div className="space-y-4">
              <p className="mb-1 text-sm font-semibold uppercase tracking-wide text-primary">
                Real, working product — no waitlist
              </p>
              <Feature icon={Users} title="A guest list you never have to double-check" body="Add names once. Party size, contact info, and RSVP status stay organized automatically — no spreadsheet required." />
              <Feature icon={Mail} title="One invitation that does the reminding for you" body="Write it once, edit any time, and share a page that already looks put-together — no separate design tool needed." />
              <Feature icon={ClipboardList} title="Always know exactly where you stand" body="Confirmed, declined, maybe, and headcount update the moment a guest responds — so you're never left guessing." />
            </div>

            <div>
              {entryMode === "choice" && (
                <Card className="border-card-border shadow-sm" data-testid="card-entry-choice">
                  <CardContent className="p-6 sm:p-8">
                    <div className="mb-6 flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-accent" />
                      <h2 className="font-serif text-lg font-semibold text-foreground">How do you want to start?</h2>
                    </div>
                    <div className="space-y-3">
                      <button
                        type="button"
                        data-testid="button-entry-ai"
                        onClick={() => navigate("/intake")}
                        className="flex w-full items-start gap-3 rounded-lg border border-primary/40 bg-primary/5 p-4 text-left transition-colors hover:bg-primary/10"
                      >
                        <Wand2 className="mt-0.5 h-5 w-5 flex-none text-primary" />
                        <span>
                          <span className="block font-medium text-foreground">Describe it, I'll build the plan</span>
                          <span className="block text-sm text-muted-foreground">
                            Answer a few quick questions and we'll set up your event for you.
                          </span>
                        </span>
                      </button>
                      <button
                        type="button"
                        data-testid="button-entry-manual"
                        onClick={() => setEntryMode("manual")}
                        className="flex w-full items-start gap-3 rounded-lg border border-border p-4 text-left transition-colors hover:bg-muted/50"
                      >
                        <ClipboardList className="mt-0.5 h-5 w-5 flex-none text-muted-foreground" />
                        <span>
                          <span className="block font-medium text-foreground">Build it myself</span>
                          <span className="block text-sm text-muted-foreground">
                            Fill in the details on your own terms, right from the start.
                          </span>
                        </span>
                      </button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {entryMode === "manual" && (
                <Card className="border-card-border shadow-sm" data-testid="card-create-event">
                  <CardContent className="p-6 sm:p-8">
                    <div className="mb-6 flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-accent" />
                      <h2 className="font-serif text-lg font-semibold text-foreground">Start your event</h2>
                    </div>

                    <form
                      className="space-y-4"
                      onSubmit={(e) => {
                        e.preventDefault();
                        createEvent.mutate();
                      }}
                    >
                      <div>
                        <Label htmlFor="eventName">Event name</Label>
                        <Input
                          id="eventName"
                          data-testid="input-event-name"
                          placeholder="e.g. Maren's Golf-Themed 1st Birthday"
                          value={eventName}
                          onChange={(e) => setEventName(e.target.value)}
                        />
                      </div>

                      <div>
                        <Label htmlFor="eventType">Event type</Label>
                        <Select value={eventType} onValueChange={setEventType}>
                          <SelectTrigger id="eventType" data-testid="select-event-type">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {EVENT_TYPES.map((t) => (
                              <SelectItem key={t} value={t}>
                                {t}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <Label htmlFor="eventDate">Date</Label>
                          <DatePickerField
                            id="eventDate"
                            testId="input-event-date"
                            value={eventDate}
                            onChange={setEventDate}
                          />
                        </div>
                        <div>
                          <Label htmlFor="location">Location</Label>
                          <Input
                            id="location"
                            data-testid="input-location"
                            placeholder="e.g. Troy, NY"
                            value={location}
                            onChange={(e) => setLocationField(e.target.value)}
                          />
                        </div>
                      </div>

                      <div>
                        <Label htmlFor="hostNames">Honoree / host name(s)</Label>
                        <Input
                          id="hostNames"
                          data-testid="input-host-names"
                          placeholder="e.g. The Reyes Family"
                          value={hostNames}
                          onChange={(e) => setHostNames(e.target.value)}
                        />
                      </div>

                      <div>
                        <Label htmlFor="hostEmail">Your email (optional)</Label>
                        <Input
                          id="hostEmail"
                          type="email"
                          data-testid="input-host-email"
                          placeholder="you@example.com"
                          value={hostEmail}
                          onChange={(e) => setHostEmail(e.target.value)}
                        />
                        <p className="mt-1 text-xs text-muted-foreground">
                          We'll use this to help you find your event if you lose the link.
                        </p>
                      </div>

                      <Button
                        type="submit"
                        className="w-full"
                        data-testid="button-create-event"
                        disabled={createEvent.isPending}
                      >
                        {createEvent.isPending ? "Creating…" : "Create my event"}
                      </Button>
                      <p className="text-center text-xs text-muted-foreground">
                        No account, no password to remember — just a private link you can always come back to.
                      </p>
                    </form>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </section>

        {/* SECTION 1 — Four Pillars */}
        <section className="border-t border-border bg-card/40 px-6 py-16 sm:py-20">
          <div className="mx-auto max-w-6xl">
            <div className="mx-auto max-w-2xl text-center">
              <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-primary">
                What Posy gives you
              </p>
              <h2 className="font-serif text-2xl font-semibold text-foreground sm:text-3xl" data-testid="text-pillars-heading">
                Not another to-do list. A quieter mind.
              </h2>
              <p className="mt-4 text-base leading-relaxed text-muted-foreground">
                Posy is built around four feelings — the ones that make the difference between
                hosting and truly being there.
              </p>
            </div>

            <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              <Pillar icon={Compass} title="Anticipation" body="Posy thinks a few steps ahead, so what's next is already waiting for you — not a surprise." />
              <Pillar icon={ShieldCheck} title="Confidence" body="A clear foundation you can trust, so every decision feels considered instead of rushed." />
              <Pillar icon={Layers} title="Cohesion" body="Guests, timeline, details, and tone — all quietly holding together in one calm place." />
              <Pillar icon={Heart} title="Relief" body="The exhale of knowing it's handled. One less thing to carry, so you can enjoy the moment." />
            </div>
          </div>
        </section>

        {/* SECTION 2 — Relief split */}
        <section className="px-6 py-16 sm:py-20">
          <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-2 lg:items-center">
            <img
              src="/brand/photography/posy_relief_host.png"
              alt="A host relaxed and present at their own celebration"
              className="w-full rounded-2xl border border-card-border object-cover shadow-sm lg:order-2"
              data-testid="img-relief-host"
            />
            <div className="lg:order-1">
              <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-primary">
                The whole point
              </p>
              <h2 className="font-serif text-2xl font-semibold text-foreground sm:text-3xl" data-testid="text-relief-heading">
                Be at your own celebration.
              </h2>
              <div className="mt-5 space-y-4 text-base leading-relaxed text-muted-foreground">
                <p>
                  Most planning tools hand you more work — more fields, more checklists, more
                  decisions. Posy does the opposite.
                </p>
                <p>
                  She takes what you tell her and quietly shapes a plan around you, surfacing only
                  what needs a human touch. The rest simply gets handled.
                </p>
                <p>
                  So on the day itself, you're not managing a spreadsheet. You're pouring the
                  wine, greeting the people you love, and letting the evening happen.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* SECTION 3 — How Posy helps */}
        <section id="how-posy-works" className="border-t border-border bg-card/40 px-6 py-16 sm:py-20">
          <div className="mx-auto max-w-6xl">
            <div className="mx-auto max-w-2xl text-center">
              <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-primary">
                How Posy helps
              </p>
              <h2 className="font-serif text-2xl font-semibold text-foreground sm:text-3xl" data-testid="text-how-it-helps-heading">
                Tell her once. She carries the rest.
              </h2>
              <p className="mt-4 text-base leading-relaxed text-muted-foreground">
                No blank pages. No setup labyrinth. A short conversation is all Posy needs to
                begin.
              </p>
            </div>

            <div className="mt-12 grid gap-8 sm:grid-cols-3">
              <Step icon={MessageSquare} number="01" title="Tell Posy about your event" body="The occasion, roughly when, who's coming, the feeling you're after. A few sentences — that's it." />
              <Step icon={Wand2} number="02" title="Posy builds the foundation" body="A thoughtful timeline, a tailored checklist, and the easy-to-forget details — ready for you to review, not to write." />
              <Step icon={SlidersHorizontal} number="03" title="You guide from here" body="Adjust anything with a word. Posy keeps everything in step and gently reminds you when something's worth a look." />
            </div>
          </div>
        </section>

        {/* SECTION 4 — Meet Posy Concierge */}
        <section id="concierge" className="px-6 py-16 sm:py-20">
          <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-2 lg:items-center">
            <div>
              <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-primary">
                Meet Posy Concierge
              </p>
              <h2 className="font-serif text-2xl font-semibold text-foreground sm:text-3xl" data-testid="text-concierge-heading">
                A planner that talks like a person.
              </h2>
              <div className="mt-5 space-y-4 text-base leading-relaxed text-muted-foreground">
                <p>
                  Posy Concierge doesn't bark commands or hide behind jargon. She notices,
                  suggests, and reassures — the way a thoughtful friend who happens to be very
                  organized would.
                </p>
                <p>Every reply is written to make planning feel lighter, never heavier.</p>
              </div>
            </div>

            <Card className="border-card-border shadow-sm" data-testid="card-concierge-demo">
              <CardContent className="p-6 sm:p-8">
                <div className="mb-5 flex items-center gap-2">
                  <div className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-primary/10">
                    <Logo className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">Posy Concierge</p>
                    <p className="text-xs text-muted-foreground">Here with you</p>
                  </div>
                </div>

                <div className="space-y-3">
                  <ChatBubble align="right">
                    We're hosting a 40th birthday dinner for my husband — about 20 people, late
                    September, somewhere warm and relaxed.
                  </ChatBubble>
                  <ChatBubble align="left">
                    <span className="font-medium text-foreground">Here's what I came up with. </span>
                    A relaxed evening dinner works beautifully for that group size. I've drafted a
                    timeline working back from late September, a guest checklist, and a shortlist
                    of warm, low-key venues to consider.
                  </ChatBubble>
                  <ChatBubble align="left">
                    <span className="font-medium text-foreground">I noticed something. </span>
                    Late September books up fast for weekend evenings. Want me to hold two backup
                    dates so you're not boxed in?
                  </ChatBubble>
                  <ChatBubble align="right">Yes please.</ChatBubble>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>


        {/* SECTION 6 — Closing CTA band */}
        <section className="bg-primary px-6 py-16 text-primary-foreground sm:py-20">
          <div className="mx-auto flex max-w-3xl flex-col items-center text-center">
            <div className="mb-6 flex h-14 w-14 items-center justify-center rounded-full bg-primary-foreground/15">
              <Logo className="h-7 w-7" />
            </div>
            <h2 className="font-serif text-2xl font-semibold sm:text-3xl" data-testid="text-closing-heading">
              Planning feels lighter when someone is thinking ahead.
            </h2>
            <p className="mt-4 text-base leading-relaxed text-primary-foreground/85">
              Tell Posy about your next celebration. See how much of it is already handled.
            </p>
            <Button
              size="lg"
              variant="secondary"
              className="mt-8"
              data-testid="button-closing-start-planning"
              onClick={() => navigate("/intake")}
            >
              Start planning
            </Button>
          </div>
        </section>
      </main>

      <footer className="border-t border-border px-6 py-10">
        <div className="mx-auto max-w-6xl">
          <div
            className="flex flex-col items-center gap-3 border-b border-border pb-6 text-center sm:flex-row sm:justify-center sm:gap-6 sm:text-left"
            data-testid="row-footer-planning-guides"
          >
            <span className="text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
              Planning guides
            </span>
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
              <Link
                href="/baby-shower-planning"
                className="text-sm text-muted-foreground hover:text-foreground"
                data-testid="link-footer-guide-baby-shower"
              >
                Baby Shower
              </Link>
              <Link
                href="/birthday-party-planning"
                className="text-sm text-muted-foreground hover:text-foreground"
                data-testid="link-footer-guide-birthday"
              >
                Birthday Party
              </Link>
              <Link
                href="/graduation-party-planning"
                className="text-sm text-muted-foreground hover:text-foreground"
                data-testid="link-footer-guide-graduation"
              >
                Graduation Party
              </Link>
              <Link
                href="/family-reunion-planning"
                className="text-sm text-muted-foreground hover:text-foreground"
                data-testid="link-footer-guide-family-reunion"
              >
                Family Reunion
              </Link>
              <Link
                href="/holiday-party-planning"
                className="text-sm text-muted-foreground hover:text-foreground"
                data-testid="link-footer-guide-holiday"
              >
                Holiday Party
              </Link>
            </div>
          </div>
        </div>
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-5 pt-6 sm:flex-row">
          <p className="text-sm text-muted-foreground" data-testid="text-footer-tagline">
            Your planning concierge. Celebrations, handled with a little more calm.
          </p>
          <div className="flex items-center gap-4" data-testid="row-footer-social">
            <a
              href="https://instagram.com/posyplans"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Posy on Instagram"
              className="text-muted-foreground transition-colors hover:text-primary"
              data-testid="link-social-instagram"
            >
              <SiInstagram className="h-4 w-4" />
            </a>
            <a
              href="https://tiktok.com/@posyplans"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Posy on TikTok"
              className="text-muted-foreground transition-colors hover:text-primary"
              data-testid="link-social-tiktok"
            >
              <SiTiktok className="h-4 w-4" />
            </a>
            <a
              href="https://facebook.com/posyplans"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Posy on Facebook"
              className="text-muted-foreground transition-colors hover:text-primary"
              data-testid="link-social-facebook"
            >
              <SiFacebook className="h-4 w-4" />
            </a>
            <a
              href="https://x.com/posyplans"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Posy on X"
              className="text-muted-foreground transition-colors hover:text-primary"
              data-testid="link-social-x"
            >
              <SiX className="h-4 w-4" />
            </a>
          </div>
          <div className="flex items-center gap-6">
            <Link href="/privacy" className="text-sm text-muted-foreground hover:text-foreground" data-testid="link-footer-privacy">
              Privacy
            </Link>
            <Link href="/terms" className="text-sm text-muted-foreground hover:text-foreground" data-testid="link-footer-terms">
              Terms
            </Link>
            <Link href="/refund-policy" className="text-sm text-muted-foreground hover:text-foreground" data-testid="link-footer-refund">
              Refund Policy
            </Link>
            <Link href="/sms-terms" className="text-sm text-muted-foreground hover:text-foreground" data-testid="link-footer-sms-terms">
              SMS Terms
            </Link>
            <Link href="/pricing" className="text-sm text-muted-foreground hover:text-foreground" data-testid="link-footer-pricing">
              Pricing
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function Feature({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Users;
  title: string;
  body: string;
}) {
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex h-9 w-9 flex-none items-center justify-center rounded-full bg-primary/10 text-primary">
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <p className="font-medium text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

function Pillar({
  icon: Icon,
  title,
  body,
}: {
  icon: typeof Compass;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-xl border border-card-border bg-card p-6" data-testid={`card-pillar-${title.toLowerCase()}`}>
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
        <Icon className="h-5 w-5" />
      </div>
      <p className="font-serif text-lg font-semibold text-foreground">{title}</p>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

function Step({
  icon: Icon,
  number,
  title,
  body,
}: {
  icon: typeof MessageSquare;
  number: string;
  title: string;
  body: string;
}) {
  return (
    <div className="text-center sm:text-left" data-testid={`card-step-${number}`}>
      <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary sm:mx-0">
        <Icon className="h-5 w-5" />
      </div>
      <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-primary">Step {number}</p>
      <p className="mt-1 font-serif text-lg font-semibold text-foreground">{title}</p>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

function ChatBubble({
  align,
  children,
}: {
  align: "left" | "right";
  children: React.ReactNode;
}) {
  return (
    <div className={`flex ${align === "right" ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          align === "right"
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground"
        }`}
      >
        {children}
      </div>
    </div>
  );
}


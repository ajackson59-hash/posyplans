import { useEffect, useState } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { EventRecord, RsvpStatus } from "@/lib/types";
import { applyInviteTokens } from "@shared/inviteTokens";
import { DEFAULT_INVITE_FONT_ID, resolveInviteAccentColor, getInviteHeadingStyle, getInviteBodyStyle } from "@/lib/inviteStyles";
import { parseInviteDesignConcept, conceptHeadingStyle, conceptBodyStyle, conceptBorderStyle } from "@shared/inviteDesign";
import { deriveThemeDna, linerPatternStyle, stampGlyph, isLinerPattern, isStampStyle } from "@shared/themeDna";
import { Wordmark } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, HelpCircle, MessageSquareText, Search, UserRound, XCircle } from "lucide-react";
import { useDebouncedCallback } from "@/hooks/use-debounce";
import CountStepper from "@/components/CountStepper";
import { Checkbox } from "@/components/ui/checkbox";
import { Link } from "wouter";

type PublicEvent = Omit<EventRecord, "ownerToken">;
interface GuestMatch {
  id: number;
  name: string;
  group: string;
  rsvpStatus: RsvpStatus;
}

function parsePalette(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.filter((c) => typeof c === "string") : [];
  } catch {
    return [];
  }
}

// Headcount limits per restriction. "adults" cap includes the guest
// themself; "children" cap is additional. `hideChildren` removes the
// children stepper entirely for restrictions that don't allow kids.
function headcountLimits(restriction: string) {
  switch (restriction) {
    case "no_additional_guests":
      return { maxAdults: 1, maxChildren: 0, hideChildren: true, locked: true };
    case "plus_one":
      return { maxAdults: 2, maxChildren: 2, hideChildren: false, locked: false };
    case "no_children":
      return { maxAdults: 20, maxChildren: 0, hideChildren: true, locked: false };
    default:
      return { maxAdults: 20, maxChildren: 20, hideChildren: false, locked: false };
  }
}

export default function Rsvp() {
  const { shareSlug } = useParams<{ shareSlug: string }>();
  const { toast } = useToast();

  const { data: event, isLoading } = useQuery<PublicEvent>({
    queryKey: [`/api/events/public/${shareSlug}`],
  });

  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<GuestMatch[]>([]);
  const [searching, setSearching] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [selected, setSelected] = useState<GuestMatch | null>(null);
  const [status, setStatus] = useState<Exclude<RsvpStatus, "pending"> | null>(null);
  const [adults, setAdults] = useState(1);
  const [children, setChildren] = useState(0);
  const [note, setNote] = useState("");
  const [submitted, setSubmitted] = useState(false);
  // Once a guest has opened the envelope we keep it open for the rest of the
  // visit — component state only, so nothing is persisted and the reveal never
  // replays while they're filling in the form. `dismissed` follows shortly after
  // `opened` so the envelope collapses out of the layout entirely once the
  // flap-lift has played, leaving the page exactly as it looks without one.
  const [envelopeOpened, setEnvelopeOpened] = useState(false);
  const [envelopeDismissed, setEnvelopeDismissed] = useState(false);
  const [envelopeRemoved, setEnvelopeRemoved] = useState(false);

  // SMS consent is its own, standalone choice — separate from the RSVP
  // itself and never pre-checked (see /sms-terms). A guest can RSVP without
  // ever touching this section.
  const [smsOptIn, setSmsOptIn] = useState(false);
  const [smsPhone, setSmsPhone] = useState("");

  const restriction = event?.rsvpRestriction || "none";
  const limits = headcountLimits(restriction);

  // Whenever the restriction caps change (e.g. a fresh guest selection),
  // make sure the current counts still respect them.
  useEffect(() => {
    if (limits.hideChildren && children !== 0) setChildren(0);
    if (adults > limits.maxAdults) setAdults(limits.maxAdults);
  }, [limits.hideChildren, limits.maxAdults]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reveal sequence: the flap lifts (700ms), then the whole envelope collapses
  // out of the flow (500ms) while the invite card fades in, then it unmounts so
  // no empty box is left behind.
  useEffect(() => {
    if (!envelopeOpened) return;
    const collapse = setTimeout(() => setEnvelopeDismissed(true), 700);
    const remove = setTimeout(() => setEnvelopeRemoved(true), 1200);
    return () => {
      clearTimeout(collapse);
      clearTimeout(remove);
    };
  }, [envelopeOpened]);

  const search = useDebouncedCallback(async (q: string) => {
    if (!q.trim()) {
      setMatches([]);
      setSearching(false);
      setHighlightedIndex(-1);
      return;
    }
    setSearching(true);
    const res = await apiRequest("GET", `/api/events/public/${shareSlug}/search-guests?q=${encodeURIComponent(q)}`);
    const results = await res.json();
    setMatches(results);
    setHighlightedIndex(results.length > 0 ? 0 : -1);
    setSearching(false);
  }, 250);

  const pickGuest = (m: GuestMatch) => {
    setSelected(m);
    setStatus(m.rsvpStatus === "pending" ? null : (m.rsvpStatus as any));
  };

  const totalAttending = adults + children;

  const submitRsvp = useMutation({
    mutationFn: async () => {
      if (!selected || !status) return;
      const res = await apiRequest("POST", `/api/events/public/${shareSlug}/guests/${selected.id}/rsvp`, {
        status,
        attendingAdults: adults,
        attendingChildren: children,
        attendingCount: totalAttending,
        note,
      });
      const rsvpResult = await res.json();

      // The SMS checkbox is a separate consent action from the RSVP itself.
      // Only fire it if the guest actively checked the box and gave a number.
      if (smsOptIn && smsPhone.trim()) {
        await apiRequest("POST", `/api/events/public/${shareSlug}/guests/${selected.id}/sms-opt-in`, {
          optIn: true,
          phone: smsPhone.trim(),
        });
      }
      return rsvpResult;
    },
    onSuccess: () => {
      setSubmitted(true);
      toast({ title: "RSVP received", description: "Thanks for letting us know!" });
    },
    onError: () => {
      toast({ title: "Couldn't submit RSVP", description: "Please try again.", variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="mx-auto max-w-lg px-6 py-16">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="mt-6 h-32 w-full" />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="mx-auto max-w-lg px-6 py-24 text-center">
        <h1 className="font-serif text-2xl font-semibold">We couldn't find this event</h1>
        <p className="mt-2 text-muted-foreground">Double check the link you were given.</p>
      </div>
    );
  }

  // Full-custom invite: the host uploaded a finished design to be shown AS-IS.
  // Gated on an explicit "custom" check, so every event created before this
  // feature (inviteRenderMode "" or absent) renders exactly as it does today.
  // When active we deliberately drop the concept so no Posy border, font
  // overlay, or backdrop treatment is applied anywhere on this page.
  const customMode = event.inviteRenderMode === "custom" && !!event.customInviteImageUrl;
  const concept = customMode ? null : parseInviteDesignConcept(event.inviteDesignConceptJson);

  // Envelope reveal: only for a concept-styled invite. Suite fields fall back to
  // the concept's derived Theme DNA, so events saved before the suite existed
  // still get a matching envelope.
  const dna = concept ? deriveThemeDna(concept) : null;
  const envelopeColor = /^#[0-9a-fA-F]{6}$/.test(event.envelopeColor || "") ? (event.envelopeColor as string) : dna?.primaryColor;
  const linerPattern = isLinerPattern(event.envelopeLinerPattern) ? event.envelopeLinerPattern : dna?.linerPattern;
  const stamp = isStampStyle(event.stampStyle) ? event.stampStyle : dna?.stampStyle;
  const showEnvelope = !!dna && !!envelopeColor && !!linerPattern && !!stamp;
  const inviteRevealed = !showEnvelope || envelopeDismissed;
  const guestFirstName = selected?.name.split(" ")[0];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto max-w-lg px-6 py-5">
          <Wordmark />
        </div>
      </header>

      <main className="mx-auto max-w-lg px-6 py-12">
        <p className="text-sm font-medium uppercase tracking-wide text-primary">{event.eventType}</p>
        <h1 className="font-serif text-3xl font-semibold text-foreground" data-testid="text-rsvp-event-name">
          {event.eventName}
        </h1>
        <p className="mt-1 text-muted-foreground">
          {[event.eventDate, event.location].filter(Boolean).join(" · ")}
        </p>
        {event.rsvpDeadline && !submitted && (
          <p className="mt-1 text-sm font-medium text-primary" data-testid="text-rsvp-deadline">
            Please respond by {event.rsvpDeadline}
          </p>
        )}

        {showEnvelope && dna && !envelopeRemoved && (
          <div
            className={`transition-all duration-500 ${
              envelopeDismissed ? "pointer-events-none h-0 overflow-hidden opacity-0" : "mt-6 opacity-100"
            }`}
            data-testid="section-envelope"
          >
            <button
              type="button"
              onClick={() => setEnvelopeOpened(true)}
              disabled={envelopeOpened}
              aria-label="Open your invitation"
              className="block w-full cursor-pointer disabled:cursor-default"
              data-testid="button-open-envelope"
            >
              {/* No overflow clipping here: the flap rotates up past the top edge,
                  and perspective must sit on its direct parent for the 3D lift. */}
              <div
                className="relative mx-auto aspect-[7/5] w-full max-w-sm rounded-md shadow-sm"
                style={{ backgroundColor: envelopeColor, perspective: "900px", transformStyle: "preserve-3d" }}
              >
                {/* Liner + front pocket get their own clipped layer so the rounded
                    corners stay masked without clipping the animating flap. */}
                <div className="absolute inset-0 overflow-hidden rounded-md">
                  {/* Patterned liner — the inside of the envelope, revealed as the flap lifts. */}
                  <div className="absolute inset-0" style={linerPatternStyle(linerPattern!, dna.accentColor, dna.backgroundColor)} />
                  {/* Front pocket, over the liner. */}
                  <div className="absolute inset-x-0 bottom-0 top-[45%]" style={{ backgroundColor: envelopeColor }} />
                </div>

                <span
                  className="absolute right-3 top-[48%] z-20 flex h-10 w-9 items-center justify-center rounded-[2px] border-2 border-dashed text-lg"
                  style={{ borderColor: dna.backgroundColor, color: dna.backgroundColor }}
                  data-testid="glyph-envelope-stamp"
                >
                  {stampGlyph(stamp!).glyph}
                </span>

                <span
                  className="absolute inset-x-0 bottom-5 z-20 px-6 text-center text-sm font-medium"
                  style={{ color: dna.backgroundColor }}
                  data-testid="text-envelope-addressee"
                >
                  {guestFirstName ? `For ${guestFirstName}` : "You're invited"}
                </span>

                {/* Flap. Hiding the back face avoids a hard flip past 90deg, and the
                    matching opacity fade keeps that hand-off from reading as a pop. */}
                <div
                  className="absolute inset-x-0 top-0 z-30 h-[60%] transition-all duration-700 ease-in-out"
                  style={{
                    backgroundColor: envelopeColor,
                    filter: "brightness(0.92)",
                    clipPath: "polygon(0 0, 100% 0, 50% 100%)",
                    transformOrigin: "top",
                    transformStyle: "preserve-3d",
                    backfaceVisibility: "hidden",
                    transform: envelopeOpened ? "rotateX(-165deg)" : "rotateX(0deg)",
                    opacity: envelopeOpened ? 0 : 1,
                  }}
                />

                {/* Seal holding the flap shut — fades away on opening. */}
                <span
                  className="absolute left-1/2 top-[52%] z-40 flex h-9 w-9 -translate-x-1/2 items-center justify-center rounded-full text-sm transition-opacity duration-500"
                  style={{
                    backgroundColor: dna.accentColor,
                    color: dna.backgroundColor,
                    opacity: envelopeOpened ? 0 : 1,
                  }}
                >
                  ✦
                </span>
              </div>

              {!envelopeOpened && (
                <span className="mt-2 block text-center text-sm font-medium text-primary" data-testid="text-envelope-hint">
                  Tap to open your invitation
                </span>
              )}
            </button>
          </div>
        )}

        <div
          className={`transition-all duration-500 ${inviteRevealed ? "translate-y-0 opacity-100" : "pointer-events-none h-0 translate-y-4 overflow-hidden opacity-0"}`}
        >
        {customMode ? (
          // The host's finished design, shown exactly as uploaded: contained on
          // a clean neutral surface with no border, no overlaid text, and no
          // concept styling. The event details above and the RSVP form below
          // carry all the information, in the page's normal typography.
          <div className="mt-6 overflow-hidden rounded-md bg-muted" data-testid="card-custom-invite">
            <img
              src={event.customInviteImageUrl}
              alt={`Invitation to ${event.eventName}`}
              className="max-h-[36rem] w-full object-contain"
              data-testid="img-custom-invite"
            />
          </div>
        ) : (
        <Card className="mt-6 overflow-hidden border-card-border" style={concept ? conceptBorderStyle(concept) : undefined}>
          {concept ? (
            <>
              {event.inviteIllustrationUrl && concept.layoutStyle === "banner" && (
                <img
                  src={event.inviteIllustrationUrl}
                  alt=""
                  data-testid="img-rsvp-artwork"
                  className="h-48 w-full object-cover sm:h-56"
                />
              )}
              {event.inviteIllustrationUrl && concept.layoutStyle === "full-bleed" && (
                <div className="relative min-h-[200px]" style={{ backgroundImage: `url(${event.inviteIllustrationUrl})`, backgroundSize: "cover", backgroundPosition: "center" }}>
                  <img src={event.inviteIllustrationUrl} alt="" data-testid="img-rsvp-artwork" className="absolute inset-0 h-full w-full object-cover" />
                </div>
              )}
              {event.inviteIllustrationUrl && concept.layoutStyle === "split" && (
                <div className="flex min-h-[160px]">
                  <div className="w-2/5" style={{ backgroundImage: `url(${event.inviteIllustrationUrl})`, backgroundSize: "cover", backgroundPosition: "center" }} />
                  <div className="flex-1 p-5">
                    <p className="text-sm font-medium" style={conceptHeadingStyle(concept)}>
                      {applyInviteTokens(event.inviteSubject, {
                        guestName: selected?.name.split(" ")[0],
                        eventName: event.eventName,
                        eventDate: event.eventDate,
                        location: event.location,
                        hostNames: event.hostNames,
                      })}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm" style={conceptBodyStyle(concept)}>
                      {applyInviteTokens(event.inviteMessage, {
                        guestName: selected?.name.split(" ")[0],
                        eventName: event.eventName,
                        eventDate: event.eventDate,
                        location: event.location,
                        hostNames: event.hostNames,
                      })}
                    </p>
                  </div>
                </div>
              )}
              {event.inviteIllustrationUrl && concept.layoutStyle === "centered" && (
                <div className="flex flex-col items-center p-6">
                  <img src={event.inviteIllustrationUrl} alt="" data-testid="img-rsvp-artwork" className="mb-4 h-24 w-24 rounded-full object-cover" />
                </div>
              )}
              {concept.layoutStyle !== "split" && (
              <CardContent
                className="p-5"
                style={
                  event.inviteIllustrationUrl && concept.layoutStyle === "backdrop"
                    ? { backgroundImage: `url(${event.inviteIllustrationUrl})`, backgroundSize: "cover", backgroundPosition: "center" }
                    : event.inviteIllustrationUrl && concept.layoutStyle === "full-bleed"
                    ? { position: "relative", zIndex: 1, marginTop: "-80px" }
                    : undefined
                }
              >
                <div
                  className={
                    event.inviteIllustrationUrl && (concept.layoutStyle === "backdrop" || concept.layoutStyle === "full-bleed") ? "rounded-md bg-white/90 p-3" : undefined
                  }
                >
                  {concept.layoutStyle === "centered" ? (
                    <div className="text-center">
                      <p className="text-sm font-medium" style={conceptHeadingStyle(concept)}>
                        {applyInviteTokens(event.inviteSubject, {
                          guestName: selected?.name.split(" ")[0],
                          eventName: event.eventName,
                          eventDate: event.eventDate,
                          location: event.location,
                          hostNames: event.hostNames,
                        })}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-sm" style={conceptBodyStyle(concept)}>
                        {applyInviteTokens(event.inviteMessage, {
                          guestName: selected?.name.split(" ")[0],
                          eventName: event.eventName,
                          eventDate: event.eventDate,
                          location: event.location,
                          hostNames: event.hostNames,
                        })}
                      </p>
                    </div>
                  ) : (
                    <>
                      <p className="text-sm font-medium" style={conceptHeadingStyle(concept)}>
                        {applyInviteTokens(event.inviteSubject, {
                          guestName: selected?.name.split(" ")[0],
                          eventName: event.eventName,
                          eventDate: event.eventDate,
                          location: event.location,
                          hostNames: event.hostNames,
                        })}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-sm" style={conceptBodyStyle(concept)}>
                        {applyInviteTokens(event.inviteMessage, {
                          guestName: selected?.name.split(" ")[0],
                          eventName: event.eventName,
                          eventDate: event.eventDate,
                          location: event.location,
                          hostNames: event.hostNames,
                        })}
                      </p>
                    </>
                  )}
                </div>
              </CardContent>
              )}
            </>
          ) : (
            <>
              {event.inviteArtworkUrl && (
                <img
                  src={event.inviteArtworkUrl}
                  alt=""
                  data-testid="img-rsvp-artwork"
                  className="h-48 w-full object-cover sm:h-56"
                />
              )}
              <CardContent className="p-5">
                <p
                  className="text-sm font-medium text-foreground"
                  style={getInviteHeadingStyle(
                    event.inviteFontFamily || DEFAULT_INVITE_FONT_ID,
                    resolveInviteAccentColor(event.inviteAccentColor, parsePalette(event.paletteColors)),
                  )}
                >
                  {applyInviteTokens(event.inviteSubject, {
                    guestName: selected?.name.split(" ")[0],
                    eventName: event.eventName,
                    eventDate: event.eventDate,
                    location: event.location,
                    hostNames: event.hostNames,
                  })}
                </p>
                <p
                  className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground"
                  style={getInviteBodyStyle(event.inviteFontFamily || DEFAULT_INVITE_FONT_ID)}
                >
                  {applyInviteTokens(event.inviteMessage, {
                    guestName: selected?.name.split(" ")[0],
                    eventName: event.eventName,
                    eventDate: event.eventDate,
                    location: event.location,
                    hostNames: event.hostNames,
                  })}
                </p>
              </CardContent>
            </>
          )}
        </Card>
        )}
        </div>

        {submitted ? (
          <Card
            className="mt-6 overflow-hidden border-card-border bg-secondary/10"
            style={concept ? conceptBorderStyle(concept) : undefined}
            data-testid="card-thank-you"
          >
            {concept && event.inviteIllustrationUrl && concept.layoutStyle === "banner" && (
              <img src={event.inviteIllustrationUrl} alt="" data-testid="img-thank-you-artwork" className="h-32 w-full object-cover" />
            )}
            <CardContent
              className="p-6 text-center"
              style={
                concept && event.inviteIllustrationUrl && concept.layoutStyle === "backdrop"
                  ? { backgroundImage: `url(${event.inviteIllustrationUrl})`, backgroundSize: "cover", backgroundPosition: "center" }
                  : undefined
              }
            >
              <div
                className={
                  concept && event.inviteIllustrationUrl && concept.layoutStyle === "backdrop" ? "rounded-md bg-white/85 p-3" : undefined
                }
              >
                <CheckCircle2 className="mx-auto h-8 w-8 text-secondary" />
                <p
                  className="mt-3 font-serif text-lg font-semibold text-foreground"
                  style={concept ? conceptHeadingStyle(concept) : undefined}
                >
                  You're all set
                </p>
                <p className="mt-1 text-sm text-muted-foreground" style={concept ? conceptBodyStyle(concept) : undefined}>
                  The host has your answer
                  {status === "yes" || status === "maybe" ? ` for ${totalAttending} guest${totalAttending === 1 ? "" : "s"}` : ""} — nothing else to do on your end.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : !selected ? (
          <div className="mt-8">
            <label className="text-sm font-medium text-foreground">Find your name to RSVP</label>
            <div className="relative mt-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                data-testid="input-guest-search"
                className="h-11 pl-9 text-base"
                placeholder="Start typing your name…"
                value={query}
                autoFocus
                onChange={(e) => {
                  setQuery(e.target.value);
                  search(e.target.value);
                }}
                onKeyDown={(e) => {
                  if (matches.length === 0) return;
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    setHighlightedIndex((i) => (i + 1) % matches.length);
                  } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    setHighlightedIndex((i) => (i - 1 + matches.length) % matches.length);
                  } else if (e.key === "Enter") {
                    e.preventDefault();
                    const target = matches[highlightedIndex] ?? matches[0];
                    if (target) pickGuest(target);
                  }
                }}
              />
            </div>
            {searching && (
              <div className="mt-2 space-y-1.5">
                <Skeleton className="h-12 w-full rounded-md" />
                <Skeleton className="h-12 w-full rounded-md" />
              </div>
            )}
            {!searching && matches.length > 0 && (
              <div className="mt-2 divide-y divide-border rounded-md border border-border overflow-hidden">
                {matches.map((m, i) => (
                  <button
                    key={m.id}
                    className={`flex w-full items-center gap-3 px-4 py-3.5 text-left hover-elevate active-elevate-2 ${
                      i === highlightedIndex ? "bg-primary/5" : ""
                    }`}
                    data-testid={`button-select-guest-${m.id}`}
                    onMouseEnter={() => setHighlightedIndex(i)}
                    onClick={() => pickGuest(m)}
                  >
                    <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                      {m.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base font-medium text-foreground">{m.name}</span>
                      {m.group && <span className="block text-xs text-muted-foreground">{m.group}</span>}
                    </span>
                    {m.rsvpStatus !== "pending" && (
                      <span className="flex-none rounded-full bg-secondary/20 px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                        Already responded
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
            {!searching && query.trim() && matches.length === 0 && (
              <p className="mt-2 text-sm text-muted-foreground" data-testid="text-no-guest-match">
                No match found — double check the spelling, or ask your host to add you.
              </p>
            )}
          </div>
        ) : (
          <div className="mt-8 space-y-5">
            <div className="flex items-center gap-3 rounded-md border border-primary/30 bg-primary/5 p-3.5">
              <span className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-primary/15 text-base font-semibold text-primary">
                {selected.name.charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">RSVP-ing as</p>
                <p className="truncate font-serif text-lg font-semibold text-foreground" data-testid="text-selected-guest">
                  {selected.name}
                </p>
              </div>
              <button
                className="flex-none text-xs font-medium text-primary underline"
                onClick={() => {
                  setSelected(null);
                  setStatus(null);
                  setQuery("");
                  setMatches([]);
                }}
                data-testid="button-not-you"
              >
                Not you?
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <StatusButton icon={CheckCircle2} label="Joyfully accept" active={status === "yes"} onClick={() => setStatus("yes")} testId="button-rsvp-yes" />
              <StatusButton icon={HelpCircle} label="Maybe" active={status === "maybe"} onClick={() => setStatus("maybe")} testId="button-rsvp-maybe" />
              <StatusButton icon={XCircle} label="Regretfully decline" active={status === "no"} onClick={() => setStatus("no")} testId="button-rsvp-no" />
            </div>

            {(status === "yes" || status === "maybe") && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Who's coming?</label>
                {limits.locked ? (
                  <p className="rounded-md border border-border bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground" data-testid="text-headcount-locked">
                    <UserRound className="mr-1.5 inline h-3.5 w-3.5" />
                    This invitation is for you only — no additional guests.
                  </p>
                ) : (
                  <div className="space-y-2">
                    <CountStepper
                      label="Adults"
                      value={adults}
                      min={1}
                      max={limits.maxAdults}
                      onChange={setAdults}
                      testId="adults"
                    />
                    {!limits.hideChildren && (
                      <CountStepper
                        label="Children"
                        value={children}
                        min={0}
                        max={Math.max(0, limits.maxChildren)}
                        onChange={setChildren}
                        testId="children"
                      />
                    )}
                    {restriction === "plus_one" && (
                      <p className="text-xs text-muted-foreground">This invitation allows one additional guest (2 total).</p>
                    )}
                  </div>
                )}
              </div>
            )}

            <div>
              <label className="text-sm font-medium text-foreground">Note for your host (optional)</label>
              <Textarea
                data-testid="textarea-rsvp-note"
                className="mt-1.5"
                placeholder="Dietary restrictions, well wishes, etc."
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>

            <div className="rounded-md border border-border bg-muted/20 p-3.5">
              <div className="flex items-start gap-2.5">
                <Checkbox
                  id="sms-opt-in"
                  data-testid="checkbox-sms-opt-in"
                  checked={smsOptIn}
                  onCheckedChange={(checked) => setSmsOptIn(checked === true)}
                  className="mt-0.5"
                />
                <label htmlFor="sms-opt-in" className="text-sm font-medium leading-snug text-foreground">
                  <MessageSquareText className="mr-1 inline h-3.5 w-3.5 text-primary" />
                  Text me RSVP reminders and updates about this event
                </label>
              </div>
              {smsOptIn && (
                <div className="mt-2.5 pl-6">
                  <Input
                    data-testid="input-sms-phone"
                    className="h-10"
                    type="tel"
                    placeholder="Your phone number"
                    value={smsPhone}
                    onChange={(e) => setSmsPhone(e.target.value)}
                  />
                </div>
              )}
              <p className="mt-2 pl-6 text-xs text-muted-foreground">
                Optional and separate from your RSVP. Msg &amp; data rates may apply. Reply STOP to opt
                out anytime.{" "}
                <Link href="/sms-terms" className="underline">
                  SMS Terms
                </Link>
              </p>
            </div>

            <Button
              className="h-11 w-full text-base"
              disabled={!status || submitRsvp.isPending || (smsOptIn && !smsPhone.trim())}
              onClick={() => submitRsvp.mutate()}
              data-testid="button-submit-rsvp"
            >
              {submitRsvp.isPending ? "Submitting…" : "Submit RSVP"}
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}

function StatusButton({
  icon: Icon,
  label,
  active,
  onClick,
  testId,
}: {
  icon: typeof CheckCircle2;
  label: string;
  active: boolean;
  onClick: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={`flex flex-col items-center gap-1.5 rounded-md border p-3 text-center text-xs font-medium transition-colors ${
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border text-muted-foreground hover-elevate"
      }`}
    >
      <Icon className="h-5 w-5" />
      {label}
    </button>
  );
}

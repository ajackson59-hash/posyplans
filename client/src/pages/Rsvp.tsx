import { useEffect, useState } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { EventRecord, RsvpStatus } from "@/lib/types";
import { applyInviteTokens } from "@shared/inviteTokens";
import { DEFAULT_INVITE_FONT_ID, resolveInviteAccentColor, getInviteHeadingStyle, getInviteBodyStyle } from "@/lib/inviteStyles";
import { parseInviteDesignConcept, conceptHeadingStyle, conceptBodyStyle, conceptBorderStyle } from "@shared/inviteDesign";
import { deriveThemeDna, isLinerPattern, isStampStyle, envelopeFinish, flapAnimationMs, ENVELOPE_LINGER_MS, ENVELOPE_TURN_MS } from "@shared/themeDna";
import { getPaletteVariant, getPostageStamp } from "@shared/themeCatalog";
import { resolveThemeView } from "@/lib/themeInvite";
import { ThemeInvitation } from "@/components/ThemeInvitation";
import EnvelopeMockup from "@/components/EnvelopeMockup";
import { Wordmark } from "@/components/Logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, HelpCircle, Mail, MessageSquareText, Search, UserRound, XCircle } from "lucide-react";
import CountStepper from "@/components/CountStepper";
import { Checkbox } from "@/components/ui/checkbox";
import { Link } from "wouter";

type PublicEvent = Omit<EventRecord, "ownerToken">;
interface GuestMatch {
  name: string;
  group: string;
  partySize: number;
  rsvpStatus: RsvpStatus;
  attendingCount: number | null;
  attendingAdults: number | null;
  attendingChildren: number | null;
  note: string;
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
  const { shareSlug, guestToken } = useParams<{ shareSlug: string; guestToken?: string }>();
  const { toast } = useToast();

  const { data: event, isLoading } = useQuery<PublicEvent>({
    queryKey: [`/api/events/public/${shareSlug}`],
  });

  const {
    data: personalizedGuest,
    isLoading: isGuestLoading,
    isError: isGuestError,
  } = useQuery<GuestMatch>({
    queryKey: [`/api/events/public/${shareSlug}/guest/${guestToken}`],
    enabled: Boolean(guestToken),
  });

  const [identityName, setIdentityName] = useState("");
  const [identityContact, setIdentityContact] = useState("");
  const [activeGuestToken, setActiveGuestToken] = useState(guestToken || "");
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
  const recipient = selected ?? personalizedGuest ?? null;
  const allowedPartySize = Math.max(1, recipient?.partySize ?? 1);

  // Whenever the restriction caps change (e.g. a fresh guest selection),
  // make sure the current counts still respect them.
  useEffect(() => {
    if (limits.hideChildren && children !== 0) setChildren(0);
    if (adults > limits.maxAdults) setAdults(limits.maxAdults);
    if (adults + children > allowedPartySize) {
      setChildren(Math.max(0, allowedPartySize - Math.min(adults, allowedPartySize)));
      if (adults > allowedPartySize) setAdults(allowedPartySize);
    }
  }, [limits.hideChildren, limits.maxAdults, allowedPartySize]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reveal sequence: the addressed front turns over, the lined flap lifts, then
  // the whole envelope collapses out of the flow while the invite fades in.
  useEffect(() => {
    if (!envelopeOpened) return;
    // Hold the envelope on screen for the full flap rotation plus a brief linger,
    // otherwise the collapse starts while the flap is still moving and the guest
    // never sees it open at all. Durations are shared with EnvelopeMockup.
    // Read the lane off the raw query data rather than the derived `concept`,
    // which is only in scope after this component's loading guards.
    const lane = parseInviteDesignConcept(event?.inviteDesignConceptJson ?? "")?.styleLaneId;
    const collapseAt = ENVELOPE_TURN_MS + flapAnimationMs(envelopeFinish(lane)) + ENVELOPE_LINGER_MS;
    const collapse = setTimeout(() => setEnvelopeDismissed(true), collapseAt);
    const remove = setTimeout(() => setEnvelopeRemoved(true), collapseAt + 500);
    return () => {
      clearTimeout(collapse);
      clearTimeout(remove);
    };
  }, [envelopeOpened, event?.inviteDesignConceptJson]);

  const pickGuest = (m: GuestMatch, token: string) => {
    setSelected(m);
    setActiveGuestToken(token);
    setStatus(m.rsvpStatus === "pending" ? null : (m.rsvpStatus as any));
    setAdults(Math.max(1, m.attendingAdults ?? 1));
    setChildren(Math.max(0, m.attendingChildren ?? 0));
    setNote(m.note || "");
  };

  useEffect(() => {
    if (!guestToken || !personalizedGuest || selected) return;
    pickGuest(personalizedGuest, guestToken);
  }, [guestToken, personalizedGuest, selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const identifyGuest = useMutation<{ guest: GuestMatch; guestToken: string }>({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/events/public/${shareSlug}/identify`, {
        name: identityName,
        contact: identityContact,
      });
      return res.json();
    },
    onSuccess: ({ guest, guestToken: verifiedToken }) => pickGuest(guest, verifiedToken),
  });

  const totalAttending = adults + children;

  const submitRsvp = useMutation({
    mutationFn: async () => {
      if (!recipient || !activeGuestToken || !status) return;
      const res = await apiRequest("POST", `/api/events/public/${shareSlug}/guest/${activeGuestToken}/rsvp`, {
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
        await apiRequest("POST", `/api/events/public/${shareSlug}/guest/${activeGuestToken}/sms-opt-in`, {
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

  if (isLoading || (Boolean(guestToken) && isGuestLoading)) {
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

  if (guestToken && isGuestError) {
    return (
      <div className="mx-auto max-w-lg px-6 py-24 text-center">
        <h1 className="font-serif text-2xl font-semibold">This personal invitation link isn't valid</h1>
        <p className="mt-2 text-muted-foreground">Ask your host to send you a fresh link.</p>
      </div>
    );
  }

  // Draft gate: when the host hasn't published yet, show a friendly
  // "not ready" message instead of the RSVP form.
  if (event.inviteStatus === "draft") {
    return (
      <div className="min-h-screen bg-background">
        <header className="border-b border-border">
          <div className="mx-auto flex max-w-5xl justify-center px-4 py-5 sm:px-6" data-testid="rsvp-header-inner">
            <Link href="/" data-testid="link-logo-home">
              <Wordmark />
            </Link>
          </div>
        </header>
        <div className="mx-auto max-w-lg px-6 py-24 text-center">
          <div className="mb-6 flex justify-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <Mail className="h-7 w-7 text-primary" />
            </div>
          </div>
          <h1 className="font-serif text-2xl font-semibold" data-testid="text-draft-title">
            This invitation isn't quite ready yet
          </h1>
          <p className="mt-3 text-muted-foreground" data-testid="text-draft-body">
            The host is still putting the finishing touches on this event.
            Check back soon!
          </p>
          {event.rsvpPhone && (
            <p className="mt-4 text-sm text-muted-foreground">
              Questions? Contact the host at{" "}
              <a href={`tel:${event.rsvpPhone}`} className="font-medium text-primary underline">
                {event.rsvpPhone}
              </a>
            </p>
          )}
        </div>
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
  // A curated launch theme renders through the same composed-portrait component
  // the host designed with, so what they approved is exactly what arrives.
  const themeView = customMode ? null : resolveThemeView(event);

  // Envelope reveal: only for a concept-styled invite. Suite fields fall back to
  // the concept's derived Theme DNA, so events saved before the suite existed
  // still get a matching envelope.
  const dna = concept ? deriveThemeDna(concept) : null;
  const envelopeColor = /^#[0-9a-fA-F]{6}$/.test(event.envelopeColor || "") ? (event.envelopeColor as string) : dna?.backgroundColor;
  const linerPattern = isLinerPattern(event.envelopeLinerPattern) ? event.envelopeLinerPattern : dna?.linerPattern;
  const stamp = isStampStyle(event.stampStyle) ? event.stampStyle : dna?.stampStyle;
  // Suite colours are optional overrides; fall back to the concept's derived DNA
  // so events saved before those columns existed still render a matched suite.
  const linerColor = /^#[0-9a-fA-F]{6}$/.test(event.linerColor || "") ? (event.linerColor as string) : (dna?.accentColor ?? "#cbd5e1");
  const stampColor = /^#[0-9a-fA-F]{6}$/.test(event.stampColor || "") ? (event.stampColor as string) : (dna?.accentColor ?? "#cbd5e1");
  const showEnvelope = !!dna && !!envelopeColor && !!linerPattern && !!stamp;
  const inviteRevealed = !showEnvelope || envelopeDismissed;
  const guestFirstName = recipient?.name.split(" ")[0];

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl justify-center px-4 py-5 sm:px-6" data-testid="rsvp-header-inner">
          <Link href="/" data-testid="link-logo-home">
            <Wordmark />
          </Link>
        </div>
      </header>

      <main
        className="relative isolate mx-auto min-h-[calc(100vh-6rem)] max-w-5xl px-4 py-8 sm:px-6 sm:py-12 lg:px-10"
        data-testid="rsvp-main"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 -z-10 hidden w-32 bg-gradient-to-r from-primary/10 via-primary/[0.035] to-transparent md:block"
          data-testid="rsvp-side-shade-left"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 -z-10 hidden w-32 bg-gradient-to-l from-primary/10 via-primary/[0.035] to-transparent md:block"
          data-testid="rsvp-side-shade-right"
        />
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-medium uppercase tracking-wide text-primary">{event.eventType}</p>
          <h1 className="font-serif text-3xl font-semibold text-foreground sm:text-4xl" data-testid="text-rsvp-event-name">
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
          {event.rsvpPhone && !submitted && (
            <p className="mt-2 text-sm text-muted-foreground">
              Prefer to call or text? Reach the host at{" "}
              <a href={`tel:${event.rsvpPhone}`} className="font-medium text-primary underline" data-testid="link-rsvp-phone">
                {event.rsvpPhone}
              </a>
            </p>
          )}
        </div>

        <div className="mx-auto mt-8 max-w-2xl space-y-8" data-testid="rsvp-presentation-stack">
          <section
            className="min-w-0"
            data-testid="rsvp-invitation-mount"
          >

        {showEnvelope && dna && !envelopeRemoved && (
          <div
            className={`transition-all duration-500 ${
              envelopeDismissed ? "pointer-events-none h-0 overflow-hidden opacity-0" : "opacity-100"
            }`}
            data-testid="section-envelope"
          >
            <EnvelopeMockup
              envelopeColor={envelopeColor!}
              linerPattern={linerPattern!}
              linerColor={linerColor}
              linerBaseColor={
                themeView
                  ? getPaletteVariant(themeView.theme, themeView.selection.paletteVariantId).surface
                  : dna.backgroundColor
              }
              stampStyle={stamp!}
              stampColor={stampColor}
              postage={
                themeView
                  ? getPostageStamp(themeView.theme, themeView.selection.postageStampId)
                  : undefined
              }
              finish={envelopeFinish(concept?.styleLaneId)}
              addressee={guestFirstName ? `For ${guestFirstName}` : "You're invited"}
              opened={envelopeOpened}
              onOpen={() => setEnvelopeOpened(true)}
              displaySize="hero"
            />

            {!envelopeOpened && (
              <span className="mt-3 block text-center text-sm font-medium text-primary" data-testid="text-envelope-hint">
                Tap to open your invitation
              </span>
            )}
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
          <div className="overflow-hidden rounded-md bg-muted" data-testid="card-custom-invite">
            <img
              src={event.customInviteImageUrl}
              alt={`Invitation to ${event.eventName}`}
              className="max-h-[36rem] w-full object-contain"
              data-testid="img-custom-invite"
            />
          </div>
        ) : themeView ? (
          <div
            className="overflow-hidden rounded-sm shadow-[0_2px_6px_rgba(23,23,23,0.09),0_24px_48px_-20px_rgba(23,23,23,0.38)] ring-1 ring-black/5"
            data-testid="card-theme-invite"
          >
            <ThemeInvitation
              theme={themeView.theme}
              headline={themeView.headline}
              copy={themeView.selection.copy}
              message={themeView.message}
              paletteVariantId={themeView.selection.paletteVariantId}
              placementId={themeView.selection.placementId}
              overlay={themeView.selection.overlay}
              fontPairingId={themeView.fontPairingId}
              artworkOpacity={themeView.artworkOpacity}
            />
          </div>
        ) : (
        <Card className="overflow-hidden border-card-border" style={concept ? conceptBorderStyle(concept) : undefined}>
          {concept ? (
            <>
              {event.inviteIllustrationUrl && concept.layoutStyle === "banner" && (
                <img
                  src={event.inviteIllustrationUrl}
                  alt=""
                  data-testid="img-rsvp-artwork"
                  className="aspect-[3/2] w-full object-cover"
                />
              )}
              {event.inviteIllustrationUrl && concept.layoutStyle === "full-bleed" && (
                <div className="relative min-h-[200px]" style={{ backgroundImage: `url(${event.inviteIllustrationUrl})`, backgroundSize: "cover", backgroundPosition: "center" }}>
                  <img src={event.inviteIllustrationUrl} alt="" data-testid="img-rsvp-artwork" className="absolute inset-0 h-full w-full object-cover" />
                </div>
              )}
              {event.inviteIllustrationUrl && concept.layoutStyle === "split" && (
                <div className="flex min-h-[160px] flex-col sm:flex-row">
                  <div className="h-32 w-full sm:h-auto sm:w-2/5" style={{ backgroundImage: `url(${event.inviteIllustrationUrl})`, backgroundSize: "cover", backgroundPosition: "center" }} />
                  <div className="flex-1 p-5">
                    <p className="text-sm font-medium" style={conceptHeadingStyle(concept)}>
                      {applyInviteTokens(event.inviteSubject, {
                        guestName: recipient?.name.split(" ")[0],
                        eventName: event.eventName,
                        eventDate: event.eventDate,
                        location: event.location,
                        hostNames: event.hostNames,
                      })}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm" style={conceptBodyStyle(concept)}>
                      {applyInviteTokens(event.inviteMessage, {
                        guestName: recipient?.name.split(" ")[0],
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
                    ? { position: "relative", zIndex: 1, marginTop: "-60px" }
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
                          guestName: recipient?.name.split(" ")[0],
                          eventName: event.eventName,
                          eventDate: event.eventDate,
                          location: event.location,
                          hostNames: event.hostNames,
                        })}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-sm" style={conceptBodyStyle(concept)}>
                        {applyInviteTokens(event.inviteMessage, {
                          guestName: recipient?.name.split(" ")[0],
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
                          guestName: recipient?.name.split(" ")[0],
                          eventName: event.eventName,
                          eventDate: event.eventDate,
                          location: event.location,
                          hostNames: event.hostNames,
                        })}
                      </p>
                      <p className="mt-1 whitespace-pre-wrap text-sm" style={conceptBodyStyle(concept)}>
                        {applyInviteTokens(event.inviteMessage, {
                          guestName: recipient?.name.split(" ")[0],
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
                    guestName: recipient?.name.split(" ")[0],
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
                    guestName: recipient?.name.split(" ")[0],
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

          </section>

          {inviteRevealed && (
            <section
              className="min-w-0 sm:rounded-2xl sm:border sm:border-border/80 sm:bg-card sm:p-6 sm:shadow-[0_18px_52px_-38px_rgba(36,29,24,0.55)]"
              data-testid="section-rsvp-controls"
            >

        {submitted ? (
          <Card
            className="overflow-hidden border-card-border bg-secondary/10"
            style={concept ? conceptBorderStyle(concept) : undefined}
            data-testid="card-thank-you"
          >
            {concept && event.inviteIllustrationUrl && concept.layoutStyle === "banner" && (
              <img src={event.inviteIllustrationUrl} alt="" data-testid="img-thank-you-artwork" className="h-32 w-full object-cover" />
            )}
            {concept && event.inviteIllustrationUrl && concept.layoutStyle === "centered" && (
              <div className="flex justify-center pt-6">
                <img src={event.inviteIllustrationUrl} alt="" data-testid="img-thank-you-artwork" className="h-20 w-20 rounded-full object-cover" />
              </div>
            )}
            {concept && event.inviteIllustrationUrl && concept.layoutStyle === "split" && (
              <img src={event.inviteIllustrationUrl} alt="" data-testid="img-thank-you-artwork" className="h-24 w-full object-cover" />
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
        ) : !recipient ? (
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              identifyGuest.mutate();
            }}
            data-testid="form-identify-guest"
          >
            <div>
              <h2 className="font-serif text-lg font-semibold text-foreground">Find your invitation</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Enter the exact full name and email or phone number your host has on file.
              </p>
            </div>
            <div>
              <label htmlFor="guest-name" className="text-sm font-medium text-foreground">Full name</label>
              <div className="relative mt-1.5">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="guest-name"
                  data-testid="input-guest-name-verify"
                  className="h-11 pl-9 text-base"
                  autoComplete="name"
                  value={identityName}
                  onChange={(e) => setIdentityName(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label htmlFor="guest-contact" className="text-sm font-medium text-foreground">Email or phone</label>
              <div className="relative mt-1.5">
                <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="guest-contact"
                  data-testid="input-guest-contact-verify"
                  className="h-11 pl-9 text-base"
                  autoComplete="email"
                  value={identityContact}
                  onChange={(e) => setIdentityContact(e.target.value)}
                />
              </div>
            </div>
            {identifyGuest.isError && (
              <p className="text-sm text-destructive" data-testid="text-guest-verification-error">
                We couldn't verify that invitation. Check both entries or ask your host for your private link.
              </p>
            )}
            <Button
              type="submit"
              className="h-11 w-full text-base"
              disabled={!identityName.trim() || !identityContact.trim() || identifyGuest.isPending}
              data-testid="button-verify-guest"
            >
              {identifyGuest.isPending ? "Checking…" : "Continue to RSVP"}
            </Button>
          </form>
        ) : (
          <div className="space-y-5">
            <div className="flex items-center gap-3 rounded-md border border-primary/30 bg-primary/5 p-3.5">
              <span className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-primary/15 text-base font-semibold text-primary">
                {recipient.name.charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">RSVP-ing as</p>
                <p className="truncate font-serif text-lg font-semibold text-foreground" data-testid="text-selected-guest">
                  {recipient.name}
                </p>
              </div>
              {!guestToken && (
                <button
                  className="flex-none text-xs font-medium text-primary underline"
                  onClick={() => {
                    setSelected(null);
                    setActiveGuestToken("");
                    setStatus(null);
                    setIdentityName("");
                    setIdentityContact("");
                    identifyGuest.reset();
                  }}
                  data-testid="button-not-you"
                >
                  Not you?
                </button>
              )}
            </div>

            <div className="grid grid-cols-3 gap-2">
              <StatusButton icon={CheckCircle2} label="Joyfully accept" active={status === "yes"} onClick={() => setStatus("yes")} testId="button-rsvp-yes" />
              <StatusButton icon={HelpCircle} label="Maybe" active={status === "maybe"} onClick={() => setStatus("maybe")} testId="button-rsvp-maybe" />
              <StatusButton icon={XCircle} label="Regretfully decline" active={status === "no"} onClick={() => setStatus("no")} testId="button-rsvp-no" />
            </div>

            {(status === "yes" || status === "maybe") && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-foreground">Who's coming?</label>
                {limits.locked || allowedPartySize === 1 ? (
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
                      max={Math.min(limits.maxAdults, Math.max(1, allowedPartySize - children))}
                      onChange={setAdults}
                      testId="adults"
                    />
                    {!limits.hideChildren && (
                      <CountStepper
                        label="Children"
                        value={children}
                        min={0}
                        max={Math.min(limits.maxChildren, Math.max(0, allowedPartySize - adults))}
                        onChange={setChildren}
                        testId="children"
                      />
                    )}
                    {restriction === "plus_one" && (
                      <p className="text-xs text-muted-foreground">This invitation allows one additional guest (2 total).</p>
                    )}
                    {restriction !== "plus_one" && allowedPartySize > 1 && (
                      <p className="text-xs text-muted-foreground">
                        This invitation is for up to {allowedPartySize} guests total.
                      </p>
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
            </section>
          )}
        </div>
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

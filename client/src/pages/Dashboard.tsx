import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { apiRequest, apiRequestJson } from "@/lib/queryClient";
import { insertGuestSchema } from "@shared/schema";
import type { EventRecord, GuestRecord, RsvpStatus, RsvpRestriction } from "@/lib/types";
import { EVENT_TYPES, RSVP_RESTRICTION_OPTIONS } from "@/lib/types";
import { buildEventDetailsUpdate } from "@/lib/eventDetails";
import { touchRecentEvent } from "@/lib/eventRecovery";
import { applyInviteTokens, INVITE_TOKENS, INVITE_TONES, type InviteTone } from "@shared/inviteTokens";
import { suggestRsvpDeadline } from "@shared/rsvpDeadline";
import { Wordmark } from "@/components/Logo";
import AskPosy from "@/components/AskPosy";
import ThemeTab from "@/components/ThemeTab";
import BudgetTab from "@/components/BudgetTab";
import MenuTab from "@/components/MenuTab";
import ShoppingListTab from "@/components/ShoppingListTab";
import TimelineTab from "@/components/TimelineTab";
import DatePickerField from "@/components/DatePickerField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { readImageFileAsDataUrl } from "@/lib/imageUpload";
import { ARTWORK_TEMPLATES } from "@/lib/artworkTemplates";
import {
  INVITE_FONT_OPTIONS,
  INVITE_ACCENT_COLORS,
  DEFAULT_INVITE_FONT_ID,
  resolveInviteAccentColor,
  getInviteHeadingStyle,
  getInviteBodyStyle,
} from "@/lib/inviteStyles";
import InviteDesignPicker from "@/components/InviteDesignPicker";
import PlanningAlerts from "@/components/PlanningAlerts";
import AiDraftedBadge from "@/components/AiDraftedBadge";
import ReadinessScoreCard from "@/components/ReadinessScoreCard";
import NextActions from "@/components/NextActions";
import ReadinessMoment from "@/components/ReadinessMoment";
import { getInvitationJourneyState, hasSelectedInvitationDesign } from "@/lib/invitationState";
import { parseInviteDesignConcept, conceptHeadingStyle, conceptBodyStyle, conceptBorderStyle } from "@shared/inviteDesign";
import {
  Copy,
  Mail,
  Trash2,
  UserPlus,
  Users,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Clock,
  ExternalLink,
  Send,
  Wallet,
  ChefHat,
  ClipboardList,
  MapPin,
  AlertTriangle,
  Phone,
  Palette,
  Pencil,
  Sparkles,
  Plus,
  BellRing,
  Eye,
  ImagePlus,
  X,
  Check,
  Lock,
  MessageSquareText,
} from "lucide-react";

const guestFormSchema = insertGuestSchema.extend({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Enter a valid email").or(z.literal("")),
  partySize: z.coerce.number().int().min(1).max(30),
});
type GuestFormValues = z.infer<typeof guestFormSchema>;

function useEventData(ownerToken: string) {
  return useQuery<{ event: EventRecord; guests: GuestRecord[] }>({
    queryKey: [`/api/events/owner/${ownerToken}`],
    staleTime: 0,
    refetchInterval: 10000,
    refetchOnWindowFocus: true,
  });
}

const STATUS_META: Record<RsvpStatus, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  yes: { label: "Confirmed", color: "bg-secondary text-secondary-foreground", icon: CheckCircle2 },
  no: { label: "Declined", color: "bg-muted text-muted-foreground", icon: XCircle },
  maybe: { label: "Maybe", color: "bg-accent text-accent-foreground", icon: HelpCircle },
  pending: { label: "Awaiting reply", color: "bg-muted text-muted-foreground", icon: Clock },
};

export default function Dashboard() {
  const { ownerToken } = useParams<{ ownerToken: string }>();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data, isLoading } = useEventData(ownerToken);
  const retainedReviewRequest = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const attemptId = params.get("retainedReviewAttempt");
    const expectedAssetHash = params.get("retainedReviewHash");
    return attemptId && expectedAssetHash ? { attemptId, expectedAssetHash } : null;
  }, []);
  const [retainedReviewReady, setRetainedReviewReady] = useState(false);

  const reviewRetainedArtwork = useMutation({
    mutationFn: async () => {
      if (!retainedReviewRequest) throw new Error("No retained artwork was selected.");
      return apiRequestJson<{ previewId: string; assetHash: string; imageProviderCalls: number }>(
        "POST",
        `/api/events/owner/${ownerToken}/ai-first/review/attempts/${retainedReviewRequest.attemptId}/recheck`,
        {
          confirmRetainedReview: true,
          expectedAssetHash: retainedReviewRequest.expectedAssetHash,
        },
      );
    },
    onSuccess: () => {
      setRetainedReviewReady(true);
      toast({
        title: "Private design preview ready",
        description: "The retained artwork passed review. Your live invitation was not changed.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "The retained design did not pass review",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (ownerToken) touchRecentEvent(ownerToken);
  }, [ownerToken]);

  // Guest-count + Event DNA driven default for the "Write it for me" tone
  // picker (backlog #26) — purely rule-based, no AI cost. See
  // shared/inviteFormatRecommendation.ts.
  const inviteFormatQuery = useQuery<{ recommendation: import("@shared/inviteFormatRecommendation").InviteFormatRecommendation | null }>({
    queryKey: [`/api/events/owner/${ownerToken}/invite-format-recommendation`],
    enabled: Boolean(ownerToken),
  });
  const recommendedTone = inviteFormatQuery.data?.recommendation?.recommendedTone ?? null;

  const [activeTab, setActiveTab] = useState("theme");

  // Some buttons live above the tab section (Readiness, Next Actions, Theme tab
  // "Go to Shopping List" links) and only switch the active tab without moving
  // the viewport — on a long dashboard page that reads as "nothing happened."
  // This wrapper switches the tab AND scrolls the tab section into view.
  const navigateToTab = (tab: string, sectionId = "event-tabs-section") => {
    setActiveTab(tab);
    // The requested section may not exist until Radix mounts the newly active
    // tab. Wait for that render before scrolling so the click never appears to
    // do nothing on this long page.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const target = document.getElementById(sectionId) ?? document.getElementById("event-tabs-section");
        target?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });
  };

  const [editingInvite, setEditingInvite] = useState(false);
  const [subjectDraft, setSubjectDraft] = useState("");
  const [messageDraft, setMessageDraft] = useState("");
  const [artworkDraft, setArtworkDraft] = useState("");
  const [artworkUploading, setArtworkUploading] = useState(false);
  const [fontDraft, setFontDraft] = useState(DEFAULT_INVITE_FONT_ID);
  const [accentColorDraft, setAccentColorDraft] = useState("");
  const messageDraftRef = useRef<HTMLTextAreaElement>(null);

  const [editingDetails, setEditingDetails] = useState(false);
  const [eventNameDraft, setEventNameDraft] = useState("");
  const [eventTypeDraft, setEventTypeDraft] = useState("Birthday Party");
  const [eventDateDraft, setEventDateDraft] = useState("");
  const [locationDraft, setLocationDraft] = useState("");
  const [hostNamesDraft, setHostNamesDraft] = useState("");
  const [estimatedGuestCountDraft, setEstimatedGuestCountDraft] = useState("");
  const [vibeDescriptionDraft, setVibeDescriptionDraft] = useState("");

  const [editingVenue, setEditingVenue] = useState(false);
  const [venueNameDraft, setVenueNameDraft] = useState("");
  const [venueAddressDraft, setVenueAddressDraft] = useState("");
  const [venueCapacityDraft, setVenueCapacityDraft] = useState("");
  const [venueContactNameDraft, setVenueContactNameDraft] = useState("");
  const [venueContactPhoneDraft, setVenueContactPhoneDraft] = useState("");

  // Real path, not a hash fragment — this app uses browser-path routing (see
  // App.tsx's <Route path="/rsvp/:shareSlug">), so a hash-style link left the
  // dashboard's own path (and its private ownerToken) as the actual
  // destination, silently landing guests on the host's dashboard instead of
  // the public RSVP page.
  const rsvpUrl = data ? `${window.location.origin}/rsvp/${data.event.shareSlug}` : "";

  function parsePalette(raw: string): string[] {
    try {
      const parsed = JSON.parse(raw || "[]");
      return Array.isArray(parsed) ? parsed.filter((c) => typeof c === "string") : [];
    } catch {
      return [];
    }
  }

  const form = useForm<GuestFormValues>({
    resolver: zodResolver(guestFormSchema),
    defaultValues: { name: "", email: "", phone: "", group: "", partySize: 1 },
  });

  const addGuest = useMutation({
    mutationFn: async (values: GuestFormValues) => {
      const res = await apiRequest("POST", `/api/events/owner/${ownerToken}/guests`, values);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/events/owner/${ownerToken}`] });
      form.reset({ name: "", email: "", phone: "", group: "", partySize: 1 });
      toast({ title: "Guest added" });
    },
  });

  const deleteGuest = useMutation({
    mutationFn: async (guestId: number) => {
      await apiRequest("DELETE", `/api/events/owner/${ownerToken}/guests/${guestId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/events/owner/${ownerToken}`] });
      toast({ title: "Guest removed" });
    },
  });

  const markInvited = useMutation({
    mutationFn: async (guestId: number) => {
      await apiRequest("POST", `/api/events/owner/${ownerToken}/guests/${guestId}/mark-invited`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/events/owner/${ownerToken}`] });
    },
  });

  const sendEmail = useMutation({
    mutationFn: async (guestId: number) =>
      apiRequestJson("POST", `/api/events/owner/${ownerToken}/guests/${guestId}/send-email`, {
        origin: window.location.origin,
      }),
    onSuccess: (_data, guestId) => {
      queryClient.invalidateQueries({ queryKey: [`/api/events/owner/${ownerToken}`] });
      const guest = data?.guests.find((g) => g.id === guestId);
      toast({ title: "Invite sent", description: guest ? `Emailed ${guest.name}.` : undefined });
    },
    onError: (error: Error & { authUrl?: string }) => {
      toast({
        title: "Couldn't send email",
        description: error.authUrl
          ? "Reconnect your email service, then try again."
          : error?.message || "I couldn't get this invite sent.",
        variant: "destructive",
      });
      queryClient.invalidateQueries({ queryKey: [`/api/events/owner/${ownerToken}`] });
    },
  });

  const sendBulkEmail = useMutation({
    mutationFn: async () =>
      apiRequestJson<{ attempted: number; results: { guestId: number; name: string; ok: boolean; error?: string }[] }>(
        "POST",
        `/api/events/owner/${ownerToken}/guests/send-bulk-email`,
        { origin: window.location.origin },
      ),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: [`/api/events/owner/${ownerToken}`] });
      const sent = result.results.filter((r) => r.ok).length;
      const failed = result.results.length - sent;
      if (result.attempted === 0) {
        toast({ title: "Nothing to send", description: "Every guest with an email has already been sent an invite." });
      } else {
        toast({
          title: `Sent ${sent} invite${sent === 1 ? "" : "s"}`,
          description: failed > 0 ? `${failed} couldn't be sent — check the email setup.` : "All invites were sent.",
          variant: failed > 0 ? "destructive" : "default",
        });
      }
    },
    onError: () => {
      toast({ title: "Couldn't send invites", description: "Check the email setup and try again.", variant: "destructive" });
    },
  });

  const saveInvite = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", `/api/events/owner/${ownerToken}`, {
        inviteSubject: subjectDraft,
        inviteMessage: messageDraft,
        inviteArtworkUrl: artworkDraft,
        inviteFontFamily: fontDraft,
        inviteAccentColor: accentColorDraft,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/events/owner/${ownerToken}`] });
      setEditingInvite(false);
      toast({ title: "Invitation updated" });
    },
  });

  const generateInviteTone = useMutation({
    mutationFn: async (tone: InviteTone) =>
      apiRequestJson<{ subject: string; message: string }>(
        "POST",
        `/api/events/owner/${ownerToken}/invite/generate-tone`,
        { tone },
      ),
    onSuccess: (result) => {
      setSubjectDraft(result.subject);
      setMessageDraft(result.message);
      toast({ title: "Invite text generated", description: "Review it, tweak anything, then save." });
    },
    onError: () => {
      toast({ title: "Couldn't generate invite text", description: "Please try again in a moment.", variant: "destructive" });
    },
  });

  function insertToken(token: string) {
    const el = messageDraftRef.current;
    if (!el) {
      setMessageDraft((prev) => `${prev}${token}`);
      return;
    }
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;
    const next = `${el.value.slice(0, start)}${token}${el.value.slice(end)}`;
    setMessageDraft(next);
    requestAnimationFrame(() => {
      el.focus();
      const cursor = start + token.length;
      el.setSelectionRange(cursor, cursor);
    });
  }

  const sendSms = useMutation({
    mutationFn: async (guestId: number) =>
      apiRequestJson("POST", `/api/events/owner/${ownerToken}/guests/${guestId}/send-sms`, {
        origin: window.location.origin,
      }),
    onSuccess: (_data, guestId) => {
      queryClient.invalidateQueries({ queryKey: [`/api/events/owner/${ownerToken}`] });
      const guest = data?.guests.find((g) => g.id === guestId);
      toast({ title: "Text sent", description: guest ? `Texted ${guest.name} an RSVP reminder.` : undefined });
    },
    onError: (error: Error) => {
      toast({
        title: "Couldn't send text",
        description: error?.message || "This guest's text reminder couldn't be sent.",
        variant: "destructive",
      });
      queryClient.invalidateQueries({ queryKey: [`/api/events/owner/${ownerToken}`] });
    },
  });

  const sendReminderSms = useMutation({
    mutationFn: async () =>
      apiRequestJson<{ attempted: number; results: { guestId: number; name: string; ok: boolean; error?: string }[] }>(
        "POST",
        `/api/events/owner/${ownerToken}/guests/send-reminder-sms`,
        { origin: window.location.origin },
      ),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: [`/api/events/owner/${ownerToken}`] });
      const sent = result.results.filter((r) => r.ok).length;
      const failed = result.results.length - sent;
      if (result.attempted === 0) {
        toast({ title: "No reminders needed", description: "Everyone who opted in to texts has already responded." });
      } else {
        toast({
          title: `Texted ${sent} reminder${sent === 1 ? "" : "s"}`,
          description: failed > 0 ? `${failed} couldn't be sent.` : "Nudge sent to everyone still pending who opted in.",
          variant: failed > 0 ? "destructive" : "default",
        });
      }
    },
    onError: () => {
      toast({ title: "Couldn't send text reminders", description: "Please try again in a moment.", variant: "destructive" });
    },
  });

  const sendReminderEmail = useMutation({
    mutationFn: async () =>
      apiRequestJson<{ attempted: number; results: { guestId: number; name: string; ok: boolean; error?: string }[] }>(
        "POST",
        `/api/events/owner/${ownerToken}/guests/send-reminder-email`,
        { origin: window.location.origin },
      ),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: [`/api/events/owner/${ownerToken}`] });
      const sent = result.results.filter((r) => r.ok).length;
      const failed = result.results.length - sent;
      if (result.attempted === 0) {
        toast({ title: "No reminders needed", description: "Everyone with an email has already responded." });
      } else {
        toast({
          title: `Sent ${sent} reminder${sent === 1 ? "" : "s"}`,
          description: failed > 0 ? `${failed} couldn't be sent — check the email setup.` : "Nudge sent to everyone still pending.",
          variant: failed > 0 ? "destructive" : "default",
        });
      }
    },
    onError: () => {
      toast({ title: "Couldn't send reminders", description: "Check the email setup and try again.", variant: "destructive" });
    },
  });

  const toggleInviteStatus = useMutation({
    mutationFn: async (status: "draft" | "published") =>
      apiRequestJson("PATCH", `/api/events/owner/${ownerToken}/invite-status`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/events/owner/${ownerToken}`] });
    },
    onError: () => {
      toast({ title: "Couldn't update invite status", description: "Please try again.", variant: "destructive" });
    },
  });

  const updateRsvpPhone = useMutation({
    mutationFn: async (phone: string) =>
      apiRequestJson("PATCH", `/api/events/owner/${ownerToken}/rsvp-phone`, { phone }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/events/owner/${ownerToken}`] });
    },
    onError: () => {
      toast({ title: "Couldn't save phone number", description: "Please try again.", variant: "destructive" });
    },
  });

  const saveRsvpRestriction = useMutation({
    mutationFn: async (rsvpRestriction: RsvpRestriction) => {
      await apiRequest("PATCH", `/api/events/owner/${ownerToken}`, { rsvpRestriction });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/events/owner/${ownerToken}`] });
      toast({ title: "RSVP setting updated" });
    },
    onError: () => {
      toast({ title: "Couldn't update RSVP setting", variant: "destructive" });
    },
  });

  const [deadlineDraft, setDeadlineDraft] = useState("");
  const deadlineInitialized = useRef(false);
  useEffect(() => {
    if (!deadlineInitialized.current && data) {
      setDeadlineDraft(data.event.rsvpDeadline);
      deadlineInitialized.current = true;
    }
  }, [data]);
  const saveRsvpDeadline = useMutation({
    mutationFn: async (rsvpDeadline: string) => {
      await apiRequest("PATCH", `/api/events/owner/${ownerToken}`, { rsvpDeadline });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/events/owner/${ownerToken}`] });
      toast({ title: "RSVP deadline updated" });
    },
    onError: () => {
      toast({ title: "Couldn't update RSVP deadline", variant: "destructive" });
    },
  });
  // #25 from the Engineering Backlog: a rule-based suggested deadline, offered
  // only while the host has not set one yet. Never overrides a value the host
  // already chose.
  const suggestedRsvpDeadline = useMemo(
    () => (data ? suggestRsvpDeadline(data.event.eventDate) : null),
    [data?.event.eventDate]
  );

  const saveDetails = useMutation({
    mutationFn: async () => {
      const update = buildEventDetailsUpdate({
        eventName: eventNameDraft,
        eventType: eventTypeDraft,
        eventDate: eventDateDraft,
        location: locationDraft,
        hostNames: hostNamesDraft,
        estimatedGuestCount: estimatedGuestCountDraft,
        vibeDescription: vibeDescriptionDraft,
      });
      await apiRequest("PATCH", `/api/events/owner/${ownerToken}`, update);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/events/owner/${ownerToken}`] });
      setEditingDetails(false);
      toast({ title: "Event details saved" });
    },
    onError: (error: Error) => {
      toast({ title: "Couldn't save event details", description: error.message, variant: "destructive" });
    },
  });

  const saveVenue = useMutation({
    mutationFn: async () => {
      const capacity = venueCapacityDraft.trim() === "" ? null : Number(venueCapacityDraft);
      await apiRequest("PATCH", `/api/events/owner/${ownerToken}`, {
        venueName: venueNameDraft,
        venueAddress: venueAddressDraft,
        venueCapacity: capacity !== null && Number.isFinite(capacity) ? Math.max(0, Math.round(capacity)) : null,
        venueContactName: venueContactNameDraft,
        venueContactPhone: venueContactPhoneDraft,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/events/owner/${ownerToken}`] });
      setEditingVenue(false);
      toast({ title: "Venue details saved" });
    },
    onError: () => {
      toast({ title: "Couldn't save venue details", variant: "destructive" });
    },
  });

  const stats = useMemo(() => {
    const guests = data?.guests ?? [];
    const invitedHeadcount = guests.reduce((sum, g) => sum + g.partySize, 0);
    const confirmedHeadcount = guests
      .filter((g) => g.rsvpStatus === "yes")
      .reduce((sum, g) => sum + (g.attendingCount ?? g.partySize), 0);
    const pending = guests.filter((g) => g.rsvpStatus === "pending").length;
    const declined = guests.filter((g) => g.rsvpStatus === "no").length;
    const maybe = guests.filter((g) => g.rsvpStatus === "maybe").length;
    return { invitedHeadcount, confirmedHeadcount, pending, declined, maybe, guestCount: guests.length };
  }, [data]);

  // Sample recipient used to render the invite preview — a real guest's first
  // name if one exists, otherwise a friendly placeholder.
  const previewGuestName = data?.guests[0]?.name.split(" ")[0] || "Jamie";
  const previewCtx = useMemo(
    () => ({
      guestName: previewGuestName,
      eventName: data?.event.eventName,
      eventDate: data?.event.eventDate,
      location: data?.event.location,
      hostNames: data?.event.hostNames,
    }),
    [previewGuestName, data?.event.eventName, data?.event.eventDate, data?.event.location, data?.event.hostNames],
  );

  function copyLink() {
    navigator.clipboard.writeText(rsvpUrl);
    toast({ title: "General RSVP link copied", description: "Guests will verify their full name and email or phone." });
  }

  function personalRsvpUrl(guest: GuestRecord) {
    return `${rsvpUrl}/g/${guest.accessToken}`;
  }

  function copyGuestLink(guest: GuestRecord) {
    navigator.clipboard.writeText(personalRsvpUrl(guest));
    toast({ title: `${guest.name}'s private link copied`, description: "They can open it and RSVP without searching." });
  }

  function mailtoFor(guest: GuestRecord) {
    if (!data) return "#";
    const ctx = {
      guestName: guest.name.split(" ")[0] || guest.name,
      eventName: data.event.eventName,
      eventDate: data.event.eventDate,
      location: data.event.location,
      hostNames: data.event.hostNames,
    };
    const message = applyInviteTokens(data.event.inviteMessage, ctx);
    const subject = applyInviteTokens(data.event.inviteSubject, ctx);
    const body = `${message}\n\nRSVP here: ${personalRsvpUrl(guest)}`;
    return `mailto:${guest.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }

  function copyAllEmails() {
    const emails = (data?.guests ?? []).map((g) => g.email).filter(Boolean).join(", ");
    if (!emails) {
      toast({ title: "No guest emails yet", variant: "destructive" });
      return;
    }
    navigator.clipboard.writeText(emails);
    toast({ title: "Emails copied", description: "Paste into BCC on a group email." });
  }

  if (isLoading) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-14">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="mt-6 h-40 w-full" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="mx-auto max-w-xl px-6 py-24 text-center">
        <h1 className="font-serif text-2xl font-semibold">We couldn't find that event</h1>
        <p className="mt-2 text-muted-foreground">Double-check your dashboard link, or start a new event.</p>
        <Link href="/" className="mt-6 inline-block text-primary underline">
          Go home
        </Link>
      </div>
    );
  }

  const { event, guests } = data;
  const hasInvitationDesign = hasSelectedInvitationDesign(event);
  const invitationJourneyState = getInvitationJourneyState(event);
  const invitationCallout =
    invitationJourneyState === "live"
      ? {
          title: "Your invitation is live",
          detail: "Preview the guest experience, manage RSVP settings, or update the design and wording at any time.",
          action: "Manage invitation",
        }
      : invitationJourneyState === "draft"
        ? {
            title: "Your invitation is ready to finish",
            detail: "Review the design and wording, choose your RSVP settings, then publish it for guests.",
            action: "Finish invitation",
          }
        : {
            title: "Create your invitation",
            detail: "Posy already has your event style. Start with a custom idea, choose a ready-made design, or upload your own.",
            action: "Create invitation",
          };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
          <Link href="/" data-testid="link-logo-home">
            <Wordmark />
          </Link>
          <div className="flex items-center gap-4">
            <Link
              href={`/pricing?returnToken=${ownerToken}`}
              className="text-sm font-medium text-muted-foreground hover:text-foreground"
              data-testid="link-upgrade-plus"
            >
              Upgrade to Plus
            </Link>
            {invitationJourneyState === "live" && (
              <a
                href={`/rsvp/${event.shareSlug}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
                data-testid="link-preview-rsvp"
              >
                Preview invitation <ExternalLink className="h-3.5 w-3.5" />
              </a>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-10 space-y-8">
        {/* Event header */}
        <div>
          {editingDetails ? (
            <Card className="border-card-border">
              <CardContent className="space-y-3 p-5">
                <div>
                  <Label htmlFor="detailsEventName">Event name</Label>
                  <Input
                    id="detailsEventName"
                    data-testid="input-details-event-name"
                    value={eventNameDraft}
                    onChange={(e) => setEventNameDraft(e.target.value)}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="detailsEventType">Event type</Label>
                    <Select value={eventTypeDraft} onValueChange={setEventTypeDraft}>
                      <SelectTrigger id="detailsEventType" data-testid="select-details-event-type">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {EVENT_TYPES.map((type) => (
                          <SelectItem key={type} value={type}>
                            {type}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="detailsEventDate">Date</Label>
                    <DatePickerField
                      id="detailsEventDate"
                      testId="input-details-event-date"
                      value={eventDateDraft}
                      onChange={setEventDateDraft}
                    />
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="detailsLocation">Location</Label>
                    <Input
                      id="detailsLocation"
                      data-testid="input-details-location"
                      value={locationDraft}
                      onChange={(e) => setLocationDraft(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="detailsGuestCount">Estimated guest count</Label>
                    <Input
                      id="detailsGuestCount"
                      data-testid="input-details-guest-count"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      max={2000}
                      placeholder="e.g. 30"
                      value={estimatedGuestCountDraft}
                      onChange={(e) => setEstimatedGuestCountDraft(e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="detailsHostNames">Honoree / host name(s)</Label>
                  <Input
                    id="detailsHostNames"
                    data-testid="input-details-host-names"
                    value={hostNamesDraft}
                    onChange={(e) => setHostNamesDraft(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="detailsPlanningBrief">Planning brief</Label>
                  <Textarea
                    id="detailsPlanningBrief"
                    data-testid="input-details-planning-brief"
                    rows={4}
                    maxLength={500}
                    placeholder="Describe the mood, theme, colors, and must-haves"
                    value={vibeDescriptionDraft}
                    onChange={(e) => setVibeDescriptionDraft(e.target.value)}
                  />
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    These updates guide future suggestions. Saving will not regenerate or overwrite your existing plan.
                  </p>
                </div>
                <div className="flex gap-2 pt-1">
                  <Button
                    size="sm"
                    data-testid="button-save-details"
                    disabled={saveDetails.isPending}
                    onClick={() => saveDetails.mutate()}
                  >
                    {saveDetails.isPending ? "Saving…" : "Save"}
                  </Button>
                  <Button size="sm" variant="outline" data-testid="button-cancel-details" onClick={() => setEditingDetails(false)}>
                    Cancel
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-medium uppercase tracking-wide text-primary">{event.eventType}</p>
                <h1 className="font-serif text-3xl font-semibold text-foreground" data-testid="text-dashboard-event-name">
                  {event.eventName}
                </h1>
                <p className="mt-1 text-muted-foreground">
                  {[event.eventDate, event.location].filter(Boolean).join(" · ") || "Add a date and location any time"}
                  {event.hostNames ? ` · Hosted by ${event.hostNames}` : ""}
                  {event.estimatedGuestCount ? ` · About ${event.estimatedGuestCount} guests` : ""}
                </p>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="flex-none gap-1.5 text-muted-foreground"
                data-testid="button-edit-details"
                onClick={() => {
                  setEventNameDraft(event.eventName);
                  setEventTypeDraft(event.eventType || "Birthday Party");
                  setEventDateDraft(event.eventDate);
                  setLocationDraft(event.location);
                  setHostNamesDraft(event.hostNames);
                  setEstimatedGuestCountDraft(event.estimatedGuestCount?.toString() || "");
                  setVibeDescriptionDraft(event.vibeDescription || "");
                  setEditingDetails(true);
                }}
              >
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
            </div>
          )}
        </div>

        {retainedReviewRequest && (
          <Card className="border-primary/30 bg-primary/[0.04]" data-testid="card-retained-artwork-review">
            <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-full bg-primary/10 p-2 text-primary">
                  <Sparkles className="h-4 w-4" />
                </div>
                <div>
                  <p className="font-serif text-lg font-semibold text-foreground">
                    {retainedReviewReady ? "Private design preview ready" : "Review the saved artwork"}
                  </p>
                  <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">
                    {retainedReviewReady
                      ? "It passed Posy's quality review. Your live invitation is unchanged until you explicitly choose the design."
                      : "This reviews the exact artwork already created. It will not generate another image or change the live invitation."}
                  </p>
                </div>
              </div>
              {retainedReviewReady ? (
                <Button
                  className="shrink-0"
                  onClick={() => navigateToTab("guests", "invitation-design-section")}
                  data-testid="button-open-retained-preview"
                >
                  Compare design
                </Button>
              ) : (
                <Button
                  className="shrink-0"
                  disabled={reviewRetainedArtwork.isPending}
                  onClick={() => reviewRetainedArtwork.mutate()}
                  data-testid="button-review-retained-artwork"
                >
                  {reviewRetainedArtwork.isPending ? "Reviewing…" : "Review saved artwork"}
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        <Card className="border-primary/25 bg-primary/[0.03]" data-testid="card-invitation-next-step">
          <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-full bg-primary/10 p-2 text-primary">
                <Mail className="h-4 w-4" />
              </div>
              <div>
                <p className="font-serif text-lg font-semibold text-foreground">
                  {invitationCallout.title}
                </p>
                <p className="mt-0.5 max-w-2xl text-sm text-muted-foreground">
                  {invitationCallout.detail}
                </p>
              </div>
            </div>
            <Button
              className="shrink-0"
              onClick={() => navigateToTab("guests", "invitation-design-section")}
              data-testid="button-open-invitation-workspace"
            >
              {invitationCallout.action}
            </Button>
          </CardContent>
        </Card>

        {/* Readiness */}
        <ReadinessMoment ownerToken={ownerToken} eventDate={event.eventDate} onNavigate={navigateToTab} />
        <ReadinessScoreCard ownerToken={ownerToken} />
        <NextActions ownerToken={ownerToken} onNavigate={navigateToTab} />

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <StatCard label="Guests invited" value={stats.guestCount} />
          <StatCard label="Headcount invited" value={stats.invitedHeadcount} />
          <StatCard label="Confirmed" value={stats.confirmedHeadcount} accent="secondary" />
          <StatCard label="Maybe" value={stats.maybe} accent="accent" />
          <StatCard label="Pending" value={stats.pending} />
        </div>

        {/* Venue & logistics */}
        <Card className="border-card-border">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 font-serif text-lg">
              <MapPin className="h-4 w-4 text-primary" /> Venue &amp; logistics
            </CardTitle>
            {!editingVenue && (
              <Button
                variant="outline"
                size="sm"
                data-testid="button-edit-venue"
                onClick={() => {
                  setVenueNameDraft(event.venueName || "");
                  setVenueAddressDraft(event.venueAddress || "");
                  setVenueCapacityDraft(event.venueCapacity != null ? String(event.venueCapacity) : "");
                  setVenueContactNameDraft(event.venueContactName || "");
                  setVenueContactPhoneDraft(event.venueContactPhone || "");
                  setEditingVenue(true);
                }}
              >
                {event.venueName || event.venueAddress || event.venueCapacity ? "Edit venue" : "Add venue details"}
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {editingVenue ? (
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="venueName">Venue name</Label>
                    <Input
                      id="venueName"
                      data-testid="input-venue-name"
                      placeholder="e.g. Riverside Community Hall"
                      value={venueNameDraft}
                      onChange={(e) => setVenueNameDraft(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="venueCapacity">Capacity (max guests)</Label>
                    <Input
                      id="venueCapacity"
                      data-testid="input-venue-capacity"
                      type="number"
                      min={0}
                      placeholder="e.g. 40"
                      value={venueCapacityDraft}
                      onChange={(e) => setVenueCapacityDraft(e.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <Label htmlFor="venueAddress">Full address</Label>
                  <Input
                    id="venueAddress"
                    data-testid="input-venue-address"
                    placeholder="e.g. 210 River St, Troy, NY 12180"
                    value={venueAddressDraft}
                    onChange={(e) => setVenueAddressDraft(e.target.value)}
                  />
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="venueContactName">Venue contact (optional)</Label>
                    <Input
                      id="venueContactName"
                      data-testid="input-venue-contact-name"
                      placeholder="e.g. Maria, event coordinator"
                      value={venueContactNameDraft}
                      onChange={(e) => setVenueContactNameDraft(e.target.value)}
                    />
                  </div>
                  <div>
                    <Label htmlFor="venueContactPhone">Contact phone (optional)</Label>
                    <Input
                      id="venueContactPhone"
                      data-testid="input-venue-contact-phone"
                      placeholder="e.g. (518) 555-0134"
                      value={venueContactPhoneDraft}
                      onChange={(e) => setVenueContactPhoneDraft(e.target.value)}
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => saveVenue.mutate()} disabled={saveVenue.isPending} data-testid="button-save-venue">
                    {saveVenue.isPending ? "Saving…" : "Save"}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingVenue(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : event.venueName || event.venueAddress || event.venueCapacity ? (
              <div className="space-y-2">
                {event.venueName && (
                  <p className="text-sm font-medium text-foreground" data-testid="text-venue-name">
                    {event.venueName}
                  </p>
                )}
                {event.venueAddress && (
                  <p className="text-sm text-muted-foreground" data-testid="text-venue-address">
                    {event.venueAddress}
                  </p>
                )}
                {event.venueCapacity != null && (
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm text-muted-foreground" data-testid="text-venue-capacity">
                      Fits up to {event.venueCapacity} guest{event.venueCapacity === 1 ? "" : "s"}
                    </p>
                    {stats.invitedHeadcount > event.venueCapacity && (
                      <Badge variant="destructive" className="gap-1" data-testid="badge-venue-over-capacity">
                        <AlertTriangle className="h-3 w-3" />
                        {stats.invitedHeadcount} invited — over capacity
                      </Badge>
                    )}
                  </div>
                )}
                {(event.venueContactName || event.venueContactPhone) && (
                  <p className="flex items-center gap-1.5 text-sm text-muted-foreground" data-testid="text-venue-contact">
                    <Phone className="h-3.5 w-3.5" />
                    {[event.venueContactName, event.venueContactPhone].filter(Boolean).join(" · ")}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                Add the full address, guest capacity, and a day-of contact so nothing gets lost when you're deep in planning.
              </p>
            )}
          </CardContent>
        </Card>

        <PlanningAlerts ownerToken={ownerToken} />

        <Tabs id="event-tabs-section" value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <div className="-mx-4 overflow-x-auto px-4 pb-1 sm:mx-0 sm:overflow-visible sm:px-0">
            <TabsList className="inline-flex w-max min-w-full sm:w-auto">
              <TabsTrigger value="theme" data-testid="tab-theme">
                <Palette className="mr-1.5 h-3.5 w-3.5" /> Theme
              </TabsTrigger>
              <TabsTrigger value="guests" data-testid="tab-guests">
                <Users className="mr-1.5 h-3.5 w-3.5" /> Guests &amp; Invites
              </TabsTrigger>
              <TabsTrigger value="budget" data-testid="tab-budget">
                <Wallet className="mr-1.5 h-3.5 w-3.5" /> Budget
              </TabsTrigger>
              <TabsTrigger value="menu" data-testid="tab-menu">
                <ChefHat className="mr-1.5 h-3.5 w-3.5" /> Menu
              </TabsTrigger>
              <TabsTrigger value="shopping" data-testid="tab-shopping">
                <ClipboardList className="mr-1.5 h-3.5 w-3.5" /> Shopping List
              </TabsTrigger>
              <TabsTrigger value="timeline" data-testid="tab-timeline">
                <Clock className="mr-1.5 h-3.5 w-3.5" /> Timeline
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="theme">
            <ThemeTab ownerToken={ownerToken} event={event} onNavigateToTab={navigateToTab} />
          </TabsContent>

          <TabsContent value="guests" className="space-y-6">
        <AiDraftedBadge ownerToken={ownerToken} />

        {/* Invitation composer */}
        <Card id="invitation-design-section" className="scroll-mt-6 border-card-border">
          <CardHeader>
            <div>
              <CardTitle className="flex items-center gap-2 font-serif text-lg">
                <Mail className="h-4 w-4 text-primary" /> Create your invitation
              </CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">
                Choose the design first, then confirm the wording and RSVP details. Posy keeps it all together on one shareable page.
              </p>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <InviteDesignPicker
              ownerToken={ownerToken}
              event={event}
              onReviewEventStyle={() => navigateToTab("theme", "event-style-section")}
            />

            <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-primary">Next: confirm the wording</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Use Posy's draft, adjust the tone, or write it in your own words.
                </p>
              </div>
              {!editingInvite && (
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="button-edit-invite"
                  onClick={() => {
                    setSubjectDraft(event.inviteSubject);
                    setMessageDraft(event.inviteMessage);
                    setArtworkDraft(event.inviteArtworkUrl);
                    setFontDraft(event.inviteFontFamily || DEFAULT_INVITE_FONT_ID);
                    setAccentColorDraft(event.inviteAccentColor || "");
                    setEditingInvite(true);
                  }}
                >
                  Edit invitation wording
                </Button>
              )}
            </div>

            {editingInvite ? (
              <div className="space-y-4">
                <div>
                  <Label className="text-xs text-muted-foreground">Write it for me</Label>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {INVITE_TONES.map((tone) => (
                      <Button
                        key={tone.value}
                        type="button"
                        size="sm"
                        variant={recommendedTone === tone.value ? "default" : "outline"}
                        disabled={generateInviteTone.isPending}
                        onClick={() => generateInviteTone.mutate(tone.value)}
                        data-testid={`button-generate-tone-${tone.value}`}
                        title={
                          recommendedTone === tone.value && inviteFormatQuery.data?.recommendation
                            ? `${tone.description} ${inviteFormatQuery.data.recommendation.reason}`
                            : tone.description
                        }
                      >
                        <Sparkles className="mr-1.5 h-3.5 w-3.5" />
                        {generateInviteTone.isPending && generateInviteTone.variables === tone.value ? "Writing…" : tone.label}
                        {recommendedTone === tone.value && (
                          <span className="ml-1.5 rounded-full bg-primary-foreground/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide">
                            Recommended
                          </span>
                        )}
                      </Button>
                    ))}
                  </div>
                  {recommendedTone && inviteFormatQuery.data?.recommendation && (
                    <p className="mt-1.5 text-[11px] text-muted-foreground" data-testid="text-invite-format-recommendation">
                      {inviteFormatQuery.data.recommendation.reason}
                    </p>
                  )}
                </div>

                <div>
                  <Label>Custom artwork (optional)</Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Choose a ready-made template, upload your own photo or designed invite, or leave blank to use the plain themed card.
                  </p>

                  {artworkDraft ? (
                    <div className="relative mt-2 inline-block">
                      <img
                        src={artworkDraft}
                        alt="Invitation artwork preview"
                        data-testid="img-artwork-preview"
                        className="h-32 w-auto rounded-md border border-border object-cover"
                      />
                      <Button
                        type="button"
                        size="icon"
                        variant="secondary"
                        className="absolute -right-2 -top-2 h-6 w-6 rounded-full"
                        data-testid="button-remove-artwork"
                        onClick={() => setArtworkDraft("")}
                        title="Remove artwork"
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ) : (
                    <>
                      <p className="mt-3 text-xs font-medium text-foreground">Choose a template</p>
                      <div className="mt-1.5 grid grid-cols-4 gap-2 sm:grid-cols-6" data-testid="grid-artwork-templates">
                        {ARTWORK_TEMPLATES.map((template) => (
                          <button
                            key={template.id}
                            type="button"
                            onClick={() => setArtworkDraft(template.url)}
                            title={template.label}
                            data-testid={`button-template-${template.id}`}
                            className="group relative aspect-video overflow-hidden rounded-md border border-border transition-all hover-elevate"
                          >
                            <img
                              src={template.url}
                              alt={template.label}
                              data-testid={`img-template-thumb-${template.id}`}
                              className="h-full w-full object-cover"
                            />
                            <span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1 py-0.5 text-[10px] leading-tight text-white">
                              {template.label}
                            </span>
                          </button>
                        ))}
                      </div>

                      <p className="mt-3 text-xs font-medium text-foreground">Or upload your own</p>
                      <label
                        htmlFor="artworkUpload"
                        className="mt-1.5 flex h-32 w-full max-w-xs cursor-pointer flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-border bg-muted/40 text-sm text-muted-foreground hover-elevate"
                      >
                        <ImagePlus className="h-5 w-5" />
                        {artworkUploading ? "Uploading…" : "Click to upload an image"}
                      </label>
                    </>
                  )}
                  <div className="mt-1.5">
                    <input
                      id="artworkUpload"
                      type="file"
                      accept="image/*"
                      className="hidden"
                      data-testid="input-artwork-upload"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        e.target.value = "";
                        if (!file) return;
                        if (file.size > 15 * 1024 * 1024) {
                          toast({ title: "Image too large", description: "Please choose a file under 15MB.", variant: "destructive" });
                          return;
                        }
                        setArtworkUploading(true);
                        try {
                          const dataUrl = await readImageFileAsDataUrl(file);
                          setArtworkDraft(dataUrl);
                        } catch {
                          toast({ title: "Couldn't use that image", description: "Try a JPG or PNG file.", variant: "destructive" });
                        } finally {
                          setArtworkUploading(false);
                        }
                      }}
                    />
                  </div>
                </div>

                <div>
                  <Label>Font style</Label>
                  <p className="mt-1 text-xs text-muted-foreground">Choose a font pairing for your invite subject and message.</p>
                  <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="grid-invite-fonts">
                    {INVITE_FONT_OPTIONS.map((font) => (
                      <button
                        key={font.id}
                        type="button"
                        onClick={() => setFontDraft(font.id)}
                        title={font.description}
                        data-testid={`button-invite-font-${font.id}`}
                        className={`rounded-md border p-2.5 text-left transition-colors hover-elevate ${
                          fontDraft === font.id ? "border-primary bg-primary/5" : "border-border"
                        }`}
                      >
                        <p
                          className="truncate text-base leading-tight"
                          style={{ fontFamily: font.headingFontFamily, ...font.headingStyle }}
                        >
                          {font.label}
                        </p>
                        <p className="mt-0.5 truncate text-[11px] text-muted-foreground" style={{ fontFamily: font.bodyFontFamily }}>
                          {font.description}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <Label>Accent color</Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Used for the invite subject line. Leave unset to use your theme palette automatically.
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2" data-testid="row-invite-accent-colors">
                    <button
                      type="button"
                      onClick={() => setAccentColorDraft("")}
                      title="Auto (theme palette)"
                      data-testid="button-invite-accent-auto"
                      className={`flex h-8 items-center rounded-full border px-3 text-xs font-medium transition-colors ${
                        accentColorDraft === "" ? "border-primary text-primary" : "border-border text-muted-foreground"
                      }`}
                    >
                      Auto
                    </button>
                    {INVITE_ACCENT_COLORS.map((color) => (
                      <button
                        key={color.id}
                        type="button"
                        onClick={() => setAccentColorDraft(color.hex)}
                        title={color.label}
                        data-testid={`button-invite-accent-${color.id}`}
                        className={`h-8 w-8 rounded-full border-2 transition-transform ${
                          accentColorDraft === color.hex ? "scale-110 border-foreground" : "border-transparent"
                        }`}
                        style={{ backgroundColor: color.hex }}
                      />
                    ))}
                  </div>
                </div>

                <div>
                  <Label htmlFor="subjectDraft">Subject</Label>
                  <Input
                    id="subjectDraft"
                    data-testid="input-invite-subject"
                    value={subjectDraft}
                    onChange={(e) => setSubjectDraft(e.target.value)}
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="messageDraft">Message</Label>
                    <span className="text-xs text-muted-foreground">Click a token to insert it</span>
                  </div>
                  <Textarea
                    id="messageDraft"
                    ref={messageDraftRef}
                    data-testid="textarea-invite-message"
                    rows={6}
                    value={messageDraft}
                    onChange={(e) => setMessageDraft(e.target.value)}
                  />
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {INVITE_TOKENS.map((t) => (
                      <Button
                        key={t.token}
                        type="button"
                        size="sm"
                        variant="secondary"
                        className="h-7 px-2 text-xs"
                        onClick={() => insertToken(t.token)}
                        data-testid={`button-insert-token-${t.label.replace(/\s+/g, "-").toLowerCase()}`}
                      >
                        <Plus className="mr-1 h-3 w-3" /> {t.label}
                      </Button>
                    ))}
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    Tokens are swapped in automatically for each guest — e.g. {"{{guestName}}"} becomes
                    each person's first name when you send.
                  </p>
                </div>

                <div className="rounded-md border border-dashed border-border bg-muted/40 p-4">
                  <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    <Eye className="h-3.5 w-3.5" /> Live preview — as {previewGuestName} will see it
                  </p>
                  {artworkDraft && (
                    <img
                      src={artworkDraft}
                      alt=""
                      data-testid="img-invite-preview-artwork"
                      className="mt-2 h-40 w-full rounded-md border border-border object-cover"
                    />
                  )}
                  <p
                    className="mt-2 text-sm font-medium text-foreground"
                    data-testid="text-invite-preview-subject"
                    style={getInviteHeadingStyle(fontDraft, resolveInviteAccentColor(accentColorDraft, parsePalette(event.paletteColors)))}
                  >
                    {applyInviteTokens(subjectDraft, previewCtx) || "(no subject yet)"}
                  </p>
                  <p
                    className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground"
                    data-testid="text-invite-preview-message"
                    style={getInviteBodyStyle(fontDraft)}
                  >
                    {applyInviteTokens(messageDraft, previewCtx) || "(no message yet)"}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">Please RSVP here: {rsvpUrl}</p>
                </div>

                <div className="flex gap-2">
                  <Button size="sm" onClick={() => saveInvite.mutate()} data-testid="button-save-invite">
                    Save
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingInvite(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              (() => {
                const concept = parseInviteDesignConcept(event.inviteDesignConceptJson);
                if (concept) {
                  return (
                    <div className="rounded-md" style={conceptBorderStyle(concept)} data-testid="card-invite-concept-display">
                      {event.inviteIllustrationUrl && concept.layoutStyle === "banner" && (
                        <img
                          src={event.inviteIllustrationUrl}
                          alt=""
                          data-testid="img-invite-artwork"
                          className="mb-3 h-40 w-full rounded-md object-cover"
                        />
                      )}
                      {event.inviteIllustrationUrl && concept.layoutStyle === "full-bleed" && (
                        <div className="relative min-h-[160px] overflow-hidden rounded-md" style={{ backgroundImage: `url(${event.inviteIllustrationUrl})`, backgroundSize: "cover", backgroundPosition: "center" }}>
                          <img src={event.inviteIllustrationUrl} alt="" data-testid="img-invite-artwork" className="absolute inset-0 h-full w-full object-cover" />
                        </div>
                      )}
                      {event.inviteIllustrationUrl && concept.layoutStyle === "split" && (
                        <div className="flex min-h-[140px] rounded-md overflow-hidden">
                          <div className="w-2/5" style={{ backgroundImage: `url(${event.inviteIllustrationUrl})`, backgroundSize: "cover", backgroundPosition: "center" }} />
                          <div className="flex-1 p-3">
                            <p className="text-sm font-medium" style={conceptHeadingStyle(concept)}>
                              {applyInviteTokens(event.inviteSubject, previewCtx)}
                            </p>
                            <p className="mt-1 whitespace-pre-wrap text-sm" style={conceptBodyStyle(concept)}>
                              {applyInviteTokens(event.inviteMessage, previewCtx)}
                            </p>
                          </div>
                        </div>
                      )}
                      {event.inviteIllustrationUrl && concept.layoutStyle === "centered" && (
                        <div className="flex flex-col items-center p-4">
                          <img src={event.inviteIllustrationUrl} alt="" data-testid="img-invite-artwork" className="mb-3 h-20 w-20 rounded-full object-cover" />
                        </div>
                      )}
                      {concept.layoutStyle !== "split" && (
                      <div
                        className="relative rounded-md p-3"
                        style={
                          event.inviteIllustrationUrl && concept.layoutStyle === "backdrop"
                            ? {
                                backgroundImage: `url(${event.inviteIllustrationUrl})`,
                                backgroundSize: "cover",
                                backgroundPosition: "center",
                              }
                            : event.inviteIllustrationUrl && concept.layoutStyle === "full-bleed"
                            ? { position: "relative", zIndex: 1, marginTop: "-60px" }
                            : undefined
                        }
                      >
                        <div
                          className={
                            event.inviteIllustrationUrl && (concept.layoutStyle === "backdrop" || concept.layoutStyle === "full-bleed")
                              ? "rounded-md bg-white/90 p-2"
                              : undefined
                          }
                        >
                          {concept.layoutStyle === "centered" ? (
                            <div className="text-center">
                              <p className="text-sm font-medium" style={conceptHeadingStyle(concept)}>
                                {applyInviteTokens(event.inviteSubject, previewCtx)}
                              </p>
                              <p className="mt-1 whitespace-pre-wrap text-sm" style={conceptBodyStyle(concept)}>
                                {applyInviteTokens(event.inviteMessage, previewCtx)}
                              </p>
                            </div>
                          ) : (
                            <>
                              <p className="text-sm font-medium" style={conceptHeadingStyle(concept)}>
                                {applyInviteTokens(event.inviteSubject, previewCtx)}
                              </p>
                              <p className="mt-1 whitespace-pre-wrap text-sm" style={conceptBodyStyle(concept)}>
                                {applyInviteTokens(event.inviteMessage, previewCtx)}
                              </p>
                            </>
                          )}
                        </div>
                      </div>
                      )}
                    </div>
                  );
                }
                return (
                  <div>
                    {event.inviteArtworkUrl && (
                      <img
                        src={event.inviteArtworkUrl}
                        alt=""
                        data-testid="img-invite-artwork"
                        className="mb-3 h-40 w-full rounded-md border border-border object-cover"
                      />
                    )}
                    <p
                      className="text-sm font-medium text-foreground"
                      style={getInviteHeadingStyle(
                        event.inviteFontFamily || DEFAULT_INVITE_FONT_ID,
                        resolveInviteAccentColor(event.inviteAccentColor, parsePalette(event.paletteColors)),
                      )}
                    >
                      {applyInviteTokens(event.inviteSubject, previewCtx)}
                    </p>
                    <p
                      className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground"
                      style={getInviteBodyStyle(event.inviteFontFamily || DEFAULT_INVITE_FONT_ID)}
                    >
                      {applyInviteTokens(event.inviteMessage, previewCtx)}
                    </p>
                  </div>
                );
              })()
            )}

            <section className="space-y-4 border-t border-border pt-5" aria-labelledby="rsvp-settings-title">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-primary">Next: choose RSVP settings</p>
                <h3 id="rsvp-settings-title" className="mt-1 font-serif text-lg font-semibold text-foreground">
                  How should guests respond?
                </h3>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <Label htmlFor="rsvpRestriction">Who can guests bring?</Label>
                  <Select
                    value={event.rsvpRestriction}
                    onValueChange={(value) => saveRsvpRestriction.mutate(value as RsvpRestriction)}
                  >
                    <SelectTrigger id="rsvpRestriction" className="mt-1.5" data-testid="select-rsvp-restriction">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RSVP_RESTRICTION_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {RSVP_RESTRICTION_OPTIONS.find((o) => o.value === event.rsvpRestriction)?.description}
                  </p>
                </div>
                <div>
                  <Label htmlFor="rsvpDeadline">RSVP deadline (optional)</Label>
                  <DatePickerField
                    id="rsvpDeadline"
                    testId="input-rsvp-deadline"
                    value={deadlineDraft}
                    onChange={setDeadlineDraft}
                    onBlur={() => {
                      if (deadlineDraft !== event.rsvpDeadline) saveRsvpDeadline.mutate(deadlineDraft);
                    }}
                    onDateSelect={(next) => {
                      if (next !== event.rsvpDeadline) saveRsvpDeadline.mutate(next);
                    }}
                  />
                  {!event.rsvpDeadline && suggestedRsvpDeadline ? (
                    <div className="mt-1.5 space-y-1" data-testid="hint-suggested-rsvp-deadline">
                      <p className="text-xs text-muted-foreground">
                        Suggested: <span className="font-medium text-foreground">{suggestedRsvpDeadline}</span>
                      </p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-auto px-1.5 py-0.5 text-xs text-secondary hover:text-secondary"
                        data-testid="button-use-suggested-rsvp-deadline"
                        onClick={() => {
                          setDeadlineDraft(suggestedRsvpDeadline);
                          saveRsvpDeadline.mutate(suggestedRsvpDeadline);
                        }}
                      >
                        <Check className="mr-1 h-3 w-3" /> Use this date
                      </Button>
                    </div>
                  ) : (
                    <p className="mt-1.5 text-xs text-muted-foreground">Shown on the RSVP page.</p>
                  )}
                </div>
                <div>
                  <Label htmlFor="rsvpPhone">RSVP phone (optional)</Label>
                  <div className="relative mt-1.5">
                    <Phone className="absolute left-3 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      id="rsvpPhone"
                      className="pl-9 text-sm"
                      placeholder="For guest questions"
                      defaultValue={event.rsvpPhone || ""}
                      onBlur={(e) => updateRsvpPhone.mutate(e.target.value.trim())}
                      data-testid="input-rsvp-phone"
                    />
                  </div>
                  <p className="mt-1.5 text-xs text-muted-foreground">Optional contact shown to guests.</p>
                </div>
              </div>
            </section>

            <section className="space-y-3 border-t border-border pt-5" aria-labelledby="share-invitation-title">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-primary">Then: publish and share</p>
                <h3 id="share-invitation-title" className="mt-1 font-serif text-lg font-semibold text-foreground">
                  Your invitation link
                </h3>
              </div>
              {hasInvitationDesign ? (
                <>
                  <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/50 p-3">
                    <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground" data-testid="text-rsvp-link">
                      {rsvpUrl}
                    </span>
                    <Button size="sm" variant="secondary" onClick={copyLink} data-testid="button-copy-rsvp-link">
                      <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy link
                    </Button>
                    <Button asChild size="sm" variant="outline">
                      <a href={`/rsvp/${event.shareSlug}`} target="_blank" rel="noreferrer">
                        Preview <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                      </a>
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {event.inviteStatus === "draft" ? (
                      <>
                        <Badge variant="outline" className="gap-1 text-yellow-700">
                          <Lock className="h-3 w-3" /> Draft
                        </Badge>
                        <Button
                          size="sm"
                          onClick={() => toggleInviteStatus.mutate("published")}
                          disabled={toggleInviteStatus.isPending}
                          data-testid="button-publish-invites"
                        >
                          <Send className="mr-1.5 h-3.5 w-3.5" /> Publish &amp; make live
                        </Button>
                      </>
                    ) : (
                      <>
                        <Badge variant="outline" className="gap-1 text-green-700">
                          <Check className="h-3 w-3" /> Live
                        </Badge>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => toggleInviteStatus.mutate("draft")}
                          disabled={toggleInviteStatus.isPending}
                          data-testid="button-unpublish-invites"
                        >
                          <Lock className="mr-1.5 h-3.5 w-3.5" /> Switch to draft
                        </Button>
                      </>
                    )}
                  </div>
                </>
              ) : (
                <div className="rounded-md border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground" data-testid="text-invitation-share-locked">
                  Choose an invitation design above first. Your share link and publishing controls will appear here when it is ready.
                </div>
              )}
            </section>
          </CardContent>
        </Card>

        {/* Guest list */}
        <Card className="border-card-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-serif text-lg">
              <Users className="h-4 w-4" /> Guest list
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <Form {...form}>
              <form
                onSubmit={form.handleSubmit((values) => addGuest.mutate(values))}
                className="grid gap-3 sm:grid-cols-6"
              >
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem className="sm:col-span-2">
                      <FormLabel className="text-xs">Name</FormLabel>
                      <FormControl>
                        <Input data-testid="input-guest-name" placeholder="Guest name" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem className="sm:col-span-2">
                      <FormLabel className="text-xs">Email</FormLabel>
                      <FormControl>
                        <Input data-testid="input-guest-email" placeholder="optional" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="group"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Group</FormLabel>
                      <FormControl>
                        <Input data-testid="input-guest-group" placeholder="e.g. Family" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="partySize"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs">Party size</FormLabel>
                      <FormControl>
                        <Input
                          data-testid="input-guest-party-size"
                          type="number"
                          min={1}
                          {...field}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="sm:col-span-6">
                  <Button type="submit" size="sm" disabled={addGuest.isPending} data-testid="button-add-guest">
                    <UserPlus className="mr-1.5 h-3.5 w-3.5" />
                    {addGuest.isPending ? "Adding…" : "Add guest"}
                  </Button>
                </div>
              </form>
            </Form>

            {guests.length === 0 ? (
              <div className="rounded-md border border-dashed border-border py-10 text-center text-sm text-muted-foreground" data-testid="text-empty-guests">
                Your guest list starts here — add your first guest above, and Posy keeps their RSVP status in sync from then on.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Name</th>
                      <th className="px-3 py-2">Group</th>
                      <th className="px-3 py-2">Party</th>
                      <th className="px-3 py-2">Contact</th>
                      <th className="px-3 py-2">RSVP</th>
                      <th className="px-3 py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {guests.map((guest) => {
                      const meta = STATUS_META[guest.rsvpStatus];
                      return (
                        <tr key={guest.id} data-testid={`row-guest-${guest.id}`}>
                          <td className="px-3 py-2.5 font-medium text-foreground">
                            <div>{guest.name}</div>
                            {guest.note && (
                              <div
                                className="mt-1 max-w-[220px] whitespace-normal text-xs font-normal leading-relaxed text-muted-foreground"
                                data-testid={`text-guest-note-${guest.id}`}
                                title={guest.note}
                              >
                                “{guest.note}”
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-muted-foreground">{guest.group || "—"}</td>
                          <td className="px-3 py-2.5 text-muted-foreground">
                            {(guest.rsvpStatus === "yes" || guest.rsvpStatus === "maybe") && guest.attendingCount != null ? (
                              <>
                                {guest.attendingCount}/{guest.partySize}
                                {(guest.attendingAdults != null || guest.attendingChildren != null) && (
                                  <span className="ml-1 text-xs text-muted-foreground/70">
                                    ({guest.attendingAdults ?? 0} adult{(guest.attendingAdults ?? 0) === 1 ? "" : "s"}
                                    {(guest.attendingChildren ?? 0) > 0 ? `, ${guest.attendingChildren} child${guest.attendingChildren === 1 ? "" : "ren"}` : ""})
                                  </span>
                                )}
                              </>
                            ) : (
                              guest.partySize
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-muted-foreground">
                            <div className="max-w-[160px] truncate">{guest.email || guest.phone || "—"}</div>
                          </td>
                          <td className="px-3 py-2.5">
                            <Badge className={`${meta.color} gap-1 border-0 font-normal`} data-testid={`status-rsvp-${guest.id}`}>
                              <meta.icon className="h-3 w-3" /> {meta.label}
                            </Badge>
                            {guest.invitedAt && guest.rsvpStatus === "pending" && (
                              <div className="mt-1 text-[11px] text-muted-foreground">Invited</div>
                            )}
                            {guest.emailSentAt && (
                              <div className="mt-1 text-[11px] text-secondary" data-testid={`text-email-sent-${guest.id}`}>
                                Emailed {new Date(guest.emailSentAt).toLocaleDateString()}
                              </div>
                            )}
                            {guest.emailSendError && (
                              <div className="mt-1 text-[11px] text-destructive" data-testid={`text-email-error-${guest.id}`}>
                                Email failed
                              </div>
                            )}
                            {guest.smsOptIn && (
                              <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground" data-testid={`text-sms-opted-in-${guest.id}`}>
                                <MessageSquareText className="h-3 w-3" /> Opted in to texts
                              </div>
                            )}
                            {guest.smsSentAt && (
                              <div className="mt-1 text-[11px] text-secondary" data-testid={`text-sms-sent-${guest.id}`}>
                                Texted {new Date(guest.smsSentAt).toLocaleDateString()}
                              </div>
                            )}
                            {guest.smsSendError && (
                              <div className="mt-1 text-[11px] text-destructive" data-testid={`text-sms-error-${guest.id}`}>
                                Text failed
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right">
                            <div className="flex justify-end gap-1">
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8"
                                data-testid={`button-copy-personal-link-${guest.id}`}
                                title={`Copy ${guest.name}'s private RSVP link`}
                                onClick={() => copyGuestLink(guest)}
                              >
                                <Copy className="h-4 w-4" />
                              </Button>
                              {guest.email && (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8"
                                  data-testid={`button-send-email-now-${guest.id}`}
                                  title={guest.emailSentAt ? "Re-send invite via email" : "Send invite via email now"}
                                  disabled={sendEmail.isPending}
                                  onClick={() => sendEmail.mutate(guest.id)}
                                >
                                  <Send className="h-4 w-4" />
                                </Button>
                              )}
                              {guest.smsOptIn && guest.phone && (
                                <Button
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8"
                                  data-testid={`button-send-sms-now-${guest.id}`}
                                  title={guest.smsSentAt ? "Re-send RSVP reminder via text" : "Send RSVP reminder via text now"}
                                  disabled={sendSms.isPending}
                                  onClick={() => sendSms.mutate(guest.id)}
                                >
                                  <MessageSquareText className="h-4 w-4" />
                                </Button>
                              )}
                              {guest.email && (
                                <Button
                                  asChild
                                  size="icon"
                                  variant="ghost"
                                  className="h-8 w-8"
                                  data-testid={`button-send-invite-${guest.id}`}
                                  onClick={() => markInvited.mutate(guest.id)}
                                >
                                  <a href={mailtoFor(guest)} title="Open a pre-filled email in your mail app">
                                    <Mail className="h-4 w-4" />
                                  </a>
                                </Button>
                              )}
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-8 w-8 text-destructive"
                                    data-testid={`button-delete-guest-${guest.id}`}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </Button>
                                </AlertDialogTrigger>
                                <AlertDialogContent>
                                  <AlertDialogHeader>
                                    <AlertDialogTitle>Remove {guest.name}?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                      This removes them from your guest list and RSVP tracking. This can't be undone.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => deleteGuest.mutate(guest.id)}>
                                      Remove
                                    </AlertDialogAction>
                                  </AlertDialogFooter>
                                </AlertDialogContent>
                              </AlertDialog>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-card-border" data-testid="card-send-invitations">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 font-serif text-lg">
              <Send className="h-4 w-4 text-primary" /> Send invitations
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              Add guests first, then send the finished invitation or copy their addresses for your own email.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                onClick={() => sendBulkEmail.mutate()}
                disabled={!hasInvitationDesign || sendBulkEmail.isPending || guests.every((g) => !g.email || g.emailSentAt)}
                data-testid="button-send-bulk-email"
              >
                <Send className="mr-1.5 h-3.5 w-3.5" />
                {sendBulkEmail.isPending ? "Sending…" : "Send all invites via email"}
              </Button>
              <Button size="sm" variant="outline" onClick={copyAllEmails} disabled={guests.every((g) => !g.email)} data-testid="button-copy-all-emails">
                <Mail className="mr-1.5 h-3.5 w-3.5" /> Copy all guest emails (for BCC)
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => sendReminderEmail.mutate()}
                disabled={!hasInvitationDesign || sendReminderEmail.isPending || !guests.some((g) => g.email && g.rsvpStatus === "pending")}
                data-testid="button-send-reminder"
              >
                <BellRing className="mr-1.5 h-3.5 w-3.5" />
                {sendReminderEmail.isPending ? "Sending…" : "Send RSVP reminder to pending guests"}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => sendReminderSms.mutate()}
                disabled={!hasInvitationDesign || sendReminderSms.isPending || !guests.some((g) => g.smsOptIn && g.phone && g.rsvpStatus === "pending")}
                data-testid="button-send-reminder-sms"
                title="Only goes to guests who opted in to texts"
              >
                <MessageSquareText className="mr-1.5 h-3.5 w-3.5" />
                {sendReminderSms.isPending ? "Sending…" : "Text RSVP reminder to opted-in guests"}
              </Button>
            </div>
            {!hasInvitationDesign && (
              <p className="text-xs text-muted-foreground">Finish choosing an invitation design before sending.</p>
            )}
            <p className="text-xs text-muted-foreground">
              Posy sends each email invitation separately. Reminders only go to guests still awaiting a reply
              {event.rsvpDeadline ? ` and mention your ${event.rsvpDeadline} deadline` : ""}. Text reminders only reach guests who explicitly opted in.
            </p>
          </CardContent>
        </Card>
          </TabsContent>

          <TabsContent value="budget">
            <BudgetTab
              ownerToken={ownerToken}
              event={event}
              confirmedHeadcount={stats.confirmedHeadcount}
              invitedHeadcount={stats.invitedHeadcount}
            />
          </TabsContent>

          <TabsContent value="menu">
            <MenuTab ownerToken={ownerToken} onNavigateToTab={navigateToTab} />
          </TabsContent>

          <TabsContent value="shopping">
            <ShoppingListTab ownerToken={ownerToken} onNavigateToTab={navigateToTab} />
          </TabsContent>

          <TabsContent value="timeline">
            <TimelineTab ownerToken={ownerToken} eventType={event.eventType} onNavigateToTab={navigateToTab} />
          </TabsContent>
        </Tabs>
      </main>
      <AskPosy page="dashboard" />
    </div>
  );
}

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: "secondary" | "accent";
}) {
  return (
    <Card className="border-card-border">
      <CardContent className="p-4">
        <p
          className={`font-serif text-2xl font-semibold ${
            accent === "secondary" ? "text-secondary" : accent === "accent" ? "text-accent" : "text-foreground"
          }`}
          data-testid={`stat-value-${label.toLowerCase().replace(/\s+/g, "-")}`}
        >
          {value}
        </p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}

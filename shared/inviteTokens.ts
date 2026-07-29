// Personalization tokens hosts can drop into their invite subject/message.
// Shared between server (bulk/single email send) and client (live preview,
// mailto links, and the public RSVP page) so substitution behaves
// identically everywhere.

export interface InviteTokenContext {
  guestName?: string;
  eventName?: string;
  eventDate?: string;
  location?: string;
  hostNames?: string;
}

export const INVITE_TONES = [
  { value: "warm", label: "Warm & friendly", description: "Cozy, personal, like a message from a close friend." },
  { value: "playful", label: "Playful & fun", description: "Upbeat, a little cheeky, exclamation-point energy." },
  { value: "elegant", label: "Formal & elegant", description: "Polished wording, great for milestone or upscale events." },
  { value: "simple", label: "Short & simple", description: "Just the essentials — quick to read on a phone." },
] as const;
export type InviteTone = (typeof INVITE_TONES)[number]["value"];

export const INVITE_TOKENS: { token: string; label: string; sampleFallback: string }[] = [
  { token: "{{guestName}}", label: "Guest name", sampleFallback: "there" },
  { token: "{{eventName}}", label: "Event name", sampleFallback: "our event" },
  { token: "{{eventDate}}", label: "Event date", sampleFallback: "the big day" },
  { token: "{{location}}", label: "Location", sampleFallback: "the venue" },
  { token: "{{hostNames}}", label: "Host name(s)", sampleFallback: "your host" },
];

// Replaces every {{token}} in the given text with a value from ctx, falling
// back to a friendly generic phrase when that field is empty/unset — so
// previews and real sends never show a literal "{{eventDate}}" placeholder
// or an awkward blank.
export function applyInviteTokens(text: string, ctx: InviteTokenContext): string {
  if (!text) return text;
  let result = text;
  for (const { token, sampleFallback } of INVITE_TOKENS) {
    const key = token.replace(/[{}]/g, "") as keyof InviteTokenContext;
    const value = (ctx[key] || "").trim() || sampleFallback;
    result = result.split(token).join(value);
  }
  return result;
}

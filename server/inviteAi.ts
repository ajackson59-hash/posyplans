import Anthropic from "@anthropic-ai/sdk";
import { INVITE_TONES, type InviteTone } from "@shared/inviteTokens";

// Rewrites a host's invite subject/message in a chosen tone using the LLM
// API. Requires the server to have been started with
// api_credentials=["llm-api:website"] so the Anthropic client can pick up
// its credentials from the environment.
export { INVITE_TONES };
export type { InviteTone };

const RESPONSE_SHAPE_INSTRUCTIONS = `You write short party/event invitation text for a non-professional host. Given event details and a target tone, produce an invite subject and message as STRICT JSON only — no markdown fences, no commentary, just the JSON object.

Return exactly this shape:
{
  "subject": "short subject line, under 10 words",
  "message": "2-4 short paragraphs separated by \\n\\n"
}

Rules:
- Write in the requested tone, distinctly — a "playful" invite should read very differently from an "elegant" one.
- You MAY use these personalization tokens verbatim where natural, and MUST NOT invent other tokens: {{guestName}}, {{eventName}}, {{eventDate}}, {{location}}, {{hostNames}}. Use {{guestName}} at least once, ideally as the opening greeting.
- Do NOT mention RSVP links or deadlines — those are appended separately by the app.
- Do NOT invent details (venue specifics, activities) beyond what's given.
- Keep it concise — this is a text/email invite, not a card.
- Output raw JSON only.`;

export async function generateInviteToneAi(params: {
  tone: InviteTone;
  eventName: string;
  eventType: string;
  eventDate: string;
  location: string;
  hostNames: string;
  themeName: string;
}): Promise<{ subject: string; message: string }> {
  const toneInfo = INVITE_TONES.find((t) => t.value === params.tone);
  const client = new Anthropic();
  const userPrompt = [
    `Tone: ${toneInfo?.label || params.tone} — ${toneInfo?.description || ""}`,
    `Event name: "${params.eventName}"`,
    params.eventType && `Event type: ${params.eventType}`,
    params.eventDate && `Date: ${params.eventDate}`,
    params.location && `Location: ${params.location}`,
    params.hostNames && `Host(s): ${params.hostNames}`,
    params.themeName && `Theme: ${params.themeName}`,
  ]
    .filter(Boolean)
    .join("\n");

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 600,
    system: RESPONSE_SHAPE_INSTRUCTIONS,
    messages: [{ role: "user", content: userPrompt }],
  });

  const block = message.content.find((c) => c.type === "text");
  const raw = block && "text" in block ? block.text : "";
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("AI response did not contain JSON");

  const parsed = JSON.parse(jsonMatch[0]);
  if (typeof parsed.subject !== "string" || typeof parsed.message !== "string") {
    throw new Error("AI response JSON did not match expected shape");
  }
  return { subject: parsed.subject, message: parsed.message };
}

import Anthropic from "@anthropic-ai/sdk";
import type { ThemeSuggestion } from "./themeLibrary";
import { buildResourceUrl } from "./themeLibrary";

// Generates theme-idea suggestions for a party theme that isn't in the
// curated library, using the LLM API. Requires the server to have been
// started with api_credentials=["llm-api:website"] so the Anthropic client
// can pick up its credentials from the environment.

const RESPONSE_SHAPE_INSTRUCTIONS = `You are helping a non-professional host plan a themed party. Given a theme name and (optionally) an event type, produce concrete, budget-conscious party-planning ideas as STRICT JSON only — no markdown fences, no commentary, just the JSON object.

Return exactly this shape:
{
  "paletteColors": ["#RRGGBB", "#RRGGBB", "#RRGGBB", "#RRGGBB"],
  "menuIdeas": [{"course": "Appetizers|Main Course|Sides|Dessert|Cake|Drinks & Bar", "itemName": "short dish name", "notes": "optional short note"}],
  "shoppingIdeas": [{"category": "Décor|Entertainment|Guest Supplies|Bathroom Essentials|Setup Tools|Cleanup Supplies|Take-Home Items|Food & Beverages|Serving Supplies|Emergency Supplies", "itemName": "short item name"}],
  "timelineIdeas": [{"time": "e.g. Start time / +30 min / +1 hr", "title": "short moment name"}],
  "budgetTip": "one sentence, concrete money-saving tip specific to this theme"
}

Rules:
- 4 paletteColors (hex codes that visually fit the theme).
- 4-5 menuIdeas.
- 5-6 shoppingIdeas covering décor AND at least one practical/unglamorous item.
- 4 timelineIdeas, in chronological order.
- Keep every string short (under ~12 words) and specific to the theme — avoid generic filler.
- Output raw JSON only.`;

export interface ThemeAndIdentityInput {
  eventName: string;
  eventType: string;
  vibeDescription: string;
  guestCount: number;
}

export interface ThemeAndIdentityResult {
  themeName: string;
  paletteColors: string[];
  eventIdentity: string;
}

const THEME_AND_IDENTITY_INSTRUCTIONS = `You are helping a non-professional host plan a party. Given the event name, event type, guest count, and the host's own free-text description of the vibe they want, infer a short, concrete theme name for the party AND write a one-to-two sentence "event identity" line that captures the feel of the event in a warm, human voice — the kind of line a thoughtful friend would say back to confirm they understood the vision.

Respond with STRICT JSON only — no markdown fences, no commentary, just the JSON object, in exactly this shape:
{
  "themeName": "short theme name, 2-5 words",
  "paletteColors": ["#RRGGBB", "#RRGGBB", "#RRGGBB", "#RRGGBB"],
  "eventIdentity": "1-2 sentences, warm and specific, no generic filler"
}

Rules:
- themeName should be concrete and specific to what the host described, not a generic category like "Birthday Party".
- If the host's description is sparse, infer a sensible theme from the event type alone rather than leaving it generic.
- 4 paletteColors (hex codes that visually fit the theme).
- eventIdentity should read like it was written by a person, not a marketing tagline. Reference something concrete from the vibe description when possible.
- Output raw JSON only.`;

export async function generateThemeAndIdentityAi(
  input: ThemeAndIdentityInput,
): Promise<ThemeAndIdentityResult> {
  const client = new Anthropic();
  const userPrompt = [
    `Event name: "${input.eventName}"`,
    `Event type: "${input.eventType}"`,
    `Guest count: ${input.guestCount}`,
    `Host's description of the vibe: "${input.vibeDescription || "(not provided)"}"`,
  ].join("\n");

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 600,
    system: THEME_AND_IDENTITY_INSTRUCTIONS,
    messages: [{ role: "user", content: userPrompt }],
  });

  const block = message.content.find((c) => c.type === "text");
  const raw = block && "text" in block ? block.text : "";
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("AI response did not contain JSON");

  const parsed = JSON.parse(jsonMatch[0]);

  if (
    typeof parsed.themeName !== "string" ||
    !parsed.themeName.trim() ||
    !Array.isArray(parsed.paletteColors) ||
    typeof parsed.eventIdentity !== "string" ||
    !parsed.eventIdentity.trim()
  ) {
    throw new Error("AI response JSON did not match expected shape");
  }

  return {
    themeName: parsed.themeName.trim(),
    paletteColors: parsed.paletteColors,
    eventIdentity: parsed.eventIdentity.trim(),
  };
}

export async function generateThemeSuggestionAi(theme: string, eventType: string): Promise<ThemeSuggestion> {
  const client = new Anthropic();
  const userPrompt = `Theme: "${theme}"${eventType ? `\nEvent type: "${eventType}"` : ""}`;

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1500,
    system: RESPONSE_SHAPE_INSTRUCTIONS,
    messages: [{ role: "user", content: userPrompt }],
  });

  const block = message.content.find((c) => c.type === "text");
  const raw = block && "text" in block ? block.text : "";
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("AI response did not contain JSON");

  const parsed = JSON.parse(jsonMatch[0]);

  if (!Array.isArray(parsed.paletteColors) || !Array.isArray(parsed.menuIdeas) ||
      !Array.isArray(parsed.shoppingIdeas) || !Array.isArray(parsed.timelineIdeas) ||
      typeof parsed.budgetTip !== "string") {
    throw new Error("AI response JSON did not match expected shape");
  }

  return {
    theme,
    source: "ai",
    paletteColors: parsed.paletteColors,
    menuIdeas: parsed.menuIdeas,
    shoppingIdeas: parsed.shoppingIdeas,
    timelineIdeas: parsed.timelineIdeas,
    budgetTip: parsed.budgetTip,
    resourceUrl: buildResourceUrl(theme),
  };
}

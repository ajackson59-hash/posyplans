import Anthropic from "@anthropic-ai/sdk";
import { SHOPPING_CATEGORIES } from "@shared/schema";

// Generates a starter shopping list built from the menu the Master Planner
// just drafted (via menuAi.ts) — same Anthropic call pattern and strict-JSON
// contract as budgetAi.ts/menuAi.ts. This is the second and last genuinely
// new AI generator in the Master Planner (see Engineering Breakdown §1);
// everything else in this build phase is rule-based.

export interface ShoppingSuggestionItem {
  category: string;
  itemName: string;
  quantity: string;
  estimatedCost: number;
  notes: string;
}

export interface ShoppingSuggestion {
  items: ShoppingSuggestionItem[];
  tip: string;
}

const RESPONSE_SHAPE_INSTRUCTIONS = `You are a budget-conscious party-planning assistant helping a non-professional host figure out what to actually buy. You are given the menu that was already drafted for this event, plus the event type, optional theme, and guest headcount. Produce a supplementary shopping list — everything the menu doesn't already cover (décor, serving supplies, guest supplies, cleanup, etc.) — as STRICT JSON only, no markdown fences, no commentary.

Return exactly this shape:
{
  "items": [{"category": "${SHOPPING_CATEGORIES.join("|")}", "itemName": "short item name", "quantity": "free-text quantity like '2 packs' or '1 per guest'", "estimatedCost": number, "notes": "optional short note or empty string"}],
  "tip": "one sentence practical tip specific to this scenario (e.g. where to save money, what to buy in bulk, or a common thing hosts forget)"
}

Rules:
- 8-14 items, only for categories that realistically apply given the event type, theme, and headcount (e.g. skip "Entertainment" for a quiet dinner party, skip "Bathroom Essentials" for a small home gathering unless headcount is large).
- Do NOT repeat items that would already come from the menu (food/drink items themselves) — this list is for décor, serving/setup supplies, guest-facing extras, and cleanup, not the dishes already planned.
- category must be exactly one of the allowed values listed above.
- quantity should scale sensibly with guest headcount when relevant (e.g. "1 per guest" or "3 for a table of 20") rather than a vague guess.
- estimatedCost must be whole-dollar integers (no decimals, no currency symbols).
- Keep each item name short and concrete, specific to the theme (e.g. "Gold balloon arch kit" not "Decorations").
- Output raw JSON only.`;

export async function generateShoppingAi(params: {
  eventName: string;
  eventType: string;
  themeName: string;
  guestCount: number;
  menuItems: { course: string; itemName: string }[];
}): Promise<ShoppingSuggestion> {
  const client = new Anthropic();
  const menuSummary =
    params.menuItems.length > 0
      ? params.menuItems.map((m) => `${m.course}: ${m.itemName}`).join("; ")
      : "No menu items drafted yet — assume a typical spread for this event type.";

  const lines = [
    `Event name: "${params.eventName}"`,
    params.eventType ? `Event type: "${params.eventType}"` : null,
    params.themeName ? `Theme: "${params.themeName}"` : null,
    `Guest headcount: ${params.guestCount > 0 ? params.guestCount : "unknown, assume a modest gathering of about 20"}`,
    `Menu already planned: ${menuSummary}`,
  ].filter(Boolean);

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1500,
    system: RESPONSE_SHAPE_INSTRUCTIONS,
    messages: [{ role: "user", content: lines.join("\n") }],
  });

  const block = message.content.find((c) => c.type === "text");
  const raw = block && "text" in block ? block.text : "";
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("AI response did not contain JSON");

  const parsed = JSON.parse(jsonMatch[0]);
  if (!Array.isArray(parsed.items) || typeof parsed.tip !== "string") {
    throw new Error("AI response JSON did not match expected shape");
  }

  const validCategories = new Set<string>(SHOPPING_CATEGORIES);
  const items: ShoppingSuggestionItem[] = parsed.items
    .filter((i: any) => i && typeof i.itemName === "string" && i.itemName.trim())
    .map((i: any) => ({
      category: validCategories.has(i.category) ? i.category : "Setup Tools",
      itemName: String(i.itemName).trim().slice(0, 120),
      quantity: typeof i.quantity === "string" ? i.quantity.trim().slice(0, 60) : "",
      estimatedCost: Math.max(0, Math.round(Number(i.estimatedCost) || 0)),
      notes: typeof i.notes === "string" ? i.notes.trim().slice(0, 200) : "",
    }))
    .slice(0, 20);

  return { items, tip: parsed.tip };
}

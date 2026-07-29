import Anthropic from "@anthropic-ai/sdk";
import { BUDGET_CATEGORIES } from "@shared/schema";

// Generates a realistic starter budget breakdown for a host who doesn't know
// what a category "should" cost — directly answers the ask "how do you know
// that is the correct budget for food?" by scaling line-item estimates to
// guest headcount, event type, and theme, then letting the host review and
// pick which suggested items to actually add to their budget.

export interface BudgetSuggestionItem {
  category: string;
  name: string;
  estimatedCost: number;
}

export interface BudgetSuggestion {
  items: BudgetSuggestionItem[];
  suggestedTotal: number;
  tip: string;
}

const RESPONSE_SHAPE_INSTRUCTIONS = `You are a budget-conscious party-planning assistant helping a non-professional host who has no idea what things "should" cost. Given an event type, optional theme, guest headcount, and (optionally) a target total budget, produce a realistic starter budget breakdown as STRICT JSON only — no markdown fences, no commentary, just the JSON object.

Return exactly this shape:
{
  "items": [{"category": "${BUDGET_CATEGORIES.join("|")}", "name": "short line-item name", "estimatedCost": number}],
  "suggestedTotal": number,
  "tip": "one sentence practical money-saving or planning tip specific to this scenario"
}

Rules:
- 6-10 items, only for categories that realistically apply to this event type and headcount (e.g. skip "Attire" for a casual backyard party, skip "Venue" if it's clearly a home gathering).
- category must be exactly one of the allowed values listed above.
- Scale estimatedCost realistically to headcount — Food & Beverage and Rentals should visibly reflect per-guest cost, not a flat guess.
- If a target total budget is given, make the items sum close to it (within about 10%) and mention in the tip whether that target feels tight or comfortable for this headcount. If no target is given, propose what a typical host would realistically spend and let suggestedTotal reflect that.
- estimatedCost must be whole-dollar integers (no decimals, no currency symbols).
- suggestedTotal must equal the sum of all item estimatedCost values.
- Keep each item name short, concrete, and specific to the theme/event type (e.g. "Taco bar catering (25 guests)" not "Food").
- Output raw JSON only.`;

export async function generateBudgetSuggestionAi(params: {
  eventName: string;
  eventType: string;
  themeName: string;
  headcount: number;
  targetBudget?: number | null;
}): Promise<BudgetSuggestion> {
  const client = new Anthropic();
  const lines = [
    `Event name: "${params.eventName}"`,
    params.eventType ? `Event type: "${params.eventType}"` : null,
    params.themeName ? `Theme: "${params.themeName}"` : null,
    `Guest headcount: ${params.headcount > 0 ? params.headcount : "unknown, assume a modest gathering of about 20"}`,
    params.targetBudget ? `Target total budget: $${params.targetBudget}` : "Target total budget: not set — propose a sensible total",
  ].filter(Boolean);

  const message = await client.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1200,
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

  const validCategories = new Set<string>(BUDGET_CATEGORIES);
  const items: BudgetSuggestionItem[] = parsed.items
    .filter((i: any) => i && typeof i.name === "string" && i.name.trim())
    .map((i: any) => ({
      category: validCategories.has(i.category) ? i.category : "Other",
      name: String(i.name).trim().slice(0, 120),
      estimatedCost: Math.max(0, Math.round(Number(i.estimatedCost) || 0)),
    }))
    .slice(0, 12);

  const suggestedTotal =
    typeof parsed.suggestedTotal === "number" && parsed.suggestedTotal > 0
      ? Math.round(parsed.suggestedTotal)
      : items.reduce((sum, i) => sum + i.estimatedCost, 0);

  return { items, suggestedTotal, tip: parsed.tip };
}

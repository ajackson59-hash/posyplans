import Anthropic from "@anthropic-ai/sdk";
import { MENU_COURSES, MENU_SOURCES } from "@shared/schema";

// Generates a starter menu spread for a host who has no idea where to begin
// — mirrors budgetAi.ts's shape exactly (same Anthropic call pattern, same
// strict-JSON contract), scaled to guest headcount, event type, and theme.
// See Engineering Breakdown §1: this is one of only two genuinely new AI
// generators the Master Planner adds.

export interface MenuSuggestionItem {
  course: string;
  itemName: string;
  source: string;
  servesCount: number;
  costEstimate: number;
  dietaryTags: string;
  notes: string;
}

export interface MenuSuggestion {
  items: MenuSuggestionItem[];
  tip: string;
}

const RESPONSE_SHAPE_INSTRUCTIONS = `You are a budget-conscious party-planning assistant helping a non-professional host build a menu spread from scratch. Given an event type, optional theme, optional free-text "vibe" description, and guest headcount, produce a realistic course-by-course menu as STRICT JSON only — no markdown fences, no commentary, just the JSON object.

Return exactly this shape:
{
  "items": [{"course": "${MENU_COURSES.join("|")}", "itemName": "short dish name", "source": "${MENU_SOURCES.join("|")}", "servesCount": number, "costEstimate": number, "dietaryTags": "comma-separated tags or empty string", "notes": "optional short note or empty string"}],
  "tip": "one sentence practical tip specific to this scenario (e.g. about scaling, prep timing, or a budget-conscious swap)"
}

Rules:
- 6-10 items, spread across multiple courses that realistically apply to this event type (e.g. skip "Cake" if nothing suggests a birthday/celebration cake moment, skip "Drinks & Bar" for a strictly kid-focused daytime event unless the vibe description implies otherwise).
- course must be exactly one of the allowed values listed above.
- source must be exactly one of the allowed values listed above — pick the most realistic sourcing per item (e.g. a caterer for a large formal event, homemade for a casual backyard gathering, potluck if the vibe description mentions guests bringing things).
- servesCount should reflect the guest headcount given (round to a sensible serving count, not necessarily identical across items — a dessert might serve fewer than a main dish per unit).
- costEstimate must be whole-dollar integers (no decimals, no currency symbols), scaled to headcount and sourcing (a caterer line costs more than a homemade one).
- dietaryTags: only include when genuinely relevant (e.g. "vegetarian", "nut-free", "gluten-free option") — leave as "" when nothing stands out, don't invent tags for the sake of it.
- Keep each item name short, concrete, and specific to the theme/vibe (e.g. "Taco bar with toppings station" not "Food").
- Output raw JSON only.`;

export async function generateMenuAi(params: {
  eventName: string;
  eventType: string;
  themeName: string;
  vibeDescription?: string;
  guestCount: number;
}): Promise<MenuSuggestion> {
  const client = new Anthropic();
  const lines = [
    `Event name: "${params.eventName}"`,
    params.eventType ? `Event type: "${params.eventType}"` : null,
    params.themeName ? `Theme: "${params.themeName}"` : null,
    params.vibeDescription ? `Host's own description of the vibe: "${params.vibeDescription}"` : null,
    `Guest headcount: ${params.guestCount > 0 ? params.guestCount : "unknown, assume a modest gathering of about 20"}`,
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

  const validCourses = new Set<string>(MENU_COURSES);
  const validSources = new Set<string>(MENU_SOURCES);
  const items: MenuSuggestionItem[] = parsed.items
    .filter((i: any) => i && typeof i.itemName === "string" && i.itemName.trim())
    .map((i: any) => ({
      course: validCourses.has(i.course) ? i.course : "Other",
      itemName: String(i.itemName).trim().slice(0, 120),
      source: validSources.has(i.source) ? i.source : "Homemade",
      servesCount: Math.max(0, Math.round(Number(i.servesCount) || 0)),
      costEstimate: Math.max(0, Math.round(Number(i.costEstimate) || 0)),
      dietaryTags: typeof i.dietaryTags === "string" ? i.dietaryTags.trim().slice(0, 120) : "",
      notes: typeof i.notes === "string" ? i.notes.trim().slice(0, 200) : "",
    }))
    .slice(0, 15);

  return { items, tip: parsed.tip };
}

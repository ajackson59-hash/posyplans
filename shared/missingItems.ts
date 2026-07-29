// Missing-item detection: cross-references the shopping list against a
// curated "commonly forgotten" resource list, and against invited headcount
// for per-guest consumables (plates, cups, chairs, favors, etc.).
//
// Deliberately rule-based, not a separate AI call — no algorithm can know
// exactly what a specific event needs, so this only ever suggests, never
// asserts something is required. Two checks:
//
//   1. Within a shopping category the host has ALREADY started building out
//      (at least one item present), surface a few curated items from that
//      same category that aren't on the list yet. Categories the host
//      hasn't touched at all are left alone — an event that doesn't need,
//      say, "Bathroom Essentials" shouldn't be told it's missing toilet
//      paper.
//   2. For "need"-status items whose name suggests a per-guest consumable
//      (plates, cups, napkins, chairs, favors, etc.), flag when the listed
//      quantity looks lower than the invited headcount.
//
// Computed fresh on every read — never persisted — same pattern as
// shared/contradictions.ts. Kept framework-agnostic (plain objects, no
// React/Express types) so this file can be imported by both the Express
// server and the React client.

export type MissingItemSeverity = "notice" | "warning";

export interface MissingItemSuggestion {
  id: string;
  severity: MissingItemSeverity;
  title: string;
  detail: string;
  modules: string[];
}

/** Minimal shape needed from a shopping item — matches shared/schema.ts's ShoppingListItem. */
export interface ShoppingItemSignalInput {
  category: string;
  itemName: string;
  quantity: string;
  status: string; // "need" | "have" | "borrowing"
}

/** Minimal shape needed from a guest — matches shared/schema.ts's Guest. */
export interface GuestSignalInput {
  partySize: number;
}

export interface MissingItemsInput {
  shoppingItems: ShoppingItemSignalInput[];
  guests: GuestSignalInput[];
}

// Must stay in sync with client/src/lib/types.ts's SUGGESTED_SHOPPING_ITEMS.
// Kept as a duplicate here (rather than a cross-bundle import) since that
// file lives under client/ and isn't reachable from the server build.
const SUGGESTED_SHOPPING_ITEMS: Record<string, string[]> = {
  "Décor": ["Welcome sign", "Balloons", "Tablecloths", "Centerpieces", "String lights", "Banner / backdrop"],
  "Food & Beverages": ["Ice", "Bottled water", "Coffee & creamer", "Extra napkins", "Condiments"],
  "Serving Supplies": ["Cake knife & server", "Serving utensils", "Chafing dishes", "Food-storage containers (leftovers)", "Coolers"],
  "Guest Supplies": ["Guest book", "Party favors", "Name tags / place cards", "Phone charging station", "Umbrellas (in case of rain)"],
  "Bathroom Essentials": ["Extra toilet paper", "Hand soap", "Paper towels", "Air freshener", "Small trash can liner"],
  "Entertainment": ["Speaker / music playlist", "Games or activities", "Photo booth props", "Lawn games"],
  "Emergency Supplies": ["First-aid kit", "Pain relievers", "Stain remover", "Sunscreen", "Bug spray", "Extra phone chargers"],
  "Setup Tools": ["Scissors", "Tape (packing & double-sided)", "Extension cords", "Lighters / matches", "Zip ties", "Step ladder"],
  "Cleanup Supplies": ["Trash bags", "Paper towels", "Disinfecting wipes", "Broom / dustpan", "Recycling bags"],
  "Take-Home Items": ["Leftover food containers", "Gift table cart", "Extra favors box", "Décor storage bins"],
};

// Keyword match on item name — case-insensitive substring — to identify
// consumables that should scale with headcount.
const PER_GUEST_KEYWORDS = [
  "plate", "cup", "napkin", "chair", "seat", "utensil", "fork", "spoon",
  "favor", "goodie bag", "gift bag",
];

/** Cap how many categories can surface a "commonly forgotten" suggestion at once, to stay quiet. */
const MAX_CATEGORY_SUGGESTIONS = 3;
/** Cap how many missing items are listed per category suggestion. */
const MAX_MISSING_PER_CATEGORY = 3;

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

// Packaging words like "pack" or "dozen" mean the true per-unit count is
// some unknown multiple of the number written ("1 pack" of napkins could
// easily be 50 napkins) — safer to skip those entirely than risk a wrong
// shortfall warning.
const AMBIGUOUS_QUANTITY_WORDS = ["pack", "box", "dozen", "set", "bag", "roll", "case", "bundle", "carton", "tray"];

/**
 * Reads a free-text quantity field as a plain per-unit count (e.g. "50",
 * "50 count"). Returns null for anything with ambiguous packaging language
 * ("1 pack", "2 dozen") or no leading number at all, rather than guessing.
 */
function parseQuantity(raw: string): number | null {
  const text = raw.trim().toLowerCase();
  if (!text) return null;
  if (AMBIGUOUS_QUANTITY_WORDS.some((word) => text.includes(word))) return null;
  const match = text.match(/^(\d+)/);
  if (!match) return null;
  return parseInt(match[1], 10);
}

export function detectMissingItems(input: MissingItemsInput): MissingItemSuggestion[] {
  const { shoppingItems, guests } = input;
  const suggestions: MissingItemSuggestion[] = [];
  const invitedHeadcount = guests.reduce((sum, g) => sum + (g.partySize || 0), 0);

  // 1. Commonly-forgotten items within categories the host has already started.
  const byCategory = new Map<string, ShoppingItemSignalInput[]>();
  for (const item of shoppingItems) {
    const bucket = byCategory.get(item.category) ?? [];
    bucket.push(item);
    byCategory.set(item.category, bucket);
  }

  const categoryGaps: { category: string; missing: string[] }[] = [];
  for (const [category, items] of Array.from(byCategory.entries())) {
    const curated = SUGGESTED_SHOPPING_ITEMS[category];
    if (!curated) continue;
    const missing = curated.filter((suggested) => {
      const suggestedNorm = normalize(suggested);
      return !items.some((existing: ShoppingItemSignalInput) => {
        const existingNorm = normalize(existing.itemName);
        return existingNorm === suggestedNorm || existingNorm.includes(suggestedNorm) || suggestedNorm.includes(existingNorm);
      });
    });
    if (missing.length > 0) {
      categoryGaps.push({ category, missing: missing.slice(0, MAX_MISSING_PER_CATEGORY) });
    }
  }

  for (const { category, missing } of categoryGaps.slice(0, MAX_CATEGORY_SUGGESTIONS)) {
    suggestions.push({
      id: `missing-items-${category}`,
      severity: "notice",
      title: `A few commonly forgotten ${category} items`,
      detail: `Since you're already stocking up on ${category.toLowerCase()}, you might also want: ${missing.join(", ")}.`,
      modules: ["shopping"],
    });
  }

  // 2. Per-guest quantity shortfalls, only for items still marked "need".
  if (invitedHeadcount > 0) {
    for (const item of shoppingItems) {
      if (item.status !== "need") continue;
      const nameNorm = normalize(item.itemName);
      const isPerGuestItem = PER_GUEST_KEYWORDS.some((keyword) => nameNorm.includes(keyword));
      if (!isPerGuestItem) continue;
      const quantity = parseQuantity(item.quantity);
      if (quantity === null || quantity >= invitedHeadcount) continue;
      suggestions.push({
        id: `shortfall-${item.category}-${item.itemName}`,
        severity: "notice",
        title: `"${item.itemName}" may not be enough for your guest count`,
        detail: `You have ${quantity} listed, but ${invitedHeadcount} guests are invited — worth bumping up the quantity.`,
        modules: ["shopping", "guests"],
      });
    }
  }

  return suggestions;
}

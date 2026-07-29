// "Splurge vs. save" category guidance: a static, hardcoded mapping of which
// budget categories guests tend to notice most at an event, vs. which ones
// are easiest to scale back without anyone clocking the difference.
//
// Deliberately a plain lookup table, not a separate AI call or a function of
// this event's actual data — same "quiet, deterministic-first" pattern as
// shared/eventDna.ts's category-weight tables. It is general planning
// wisdom (food and the venue are remembered; rental chairs and party favors
// rarely are), not a personalized inference, so there is nothing to compute
// and nothing that can go stale. Zero AI cost.
//
// Deliberately separate from shared/budgetFeasibility.ts (which flags
// whether a category's *amount* looks off for this event's headcount) —
// this module never looks at dollars at all. It only answers "if you had to
// choose, where does the extra dollar matter more?" A host can use both
// together: budgetFeasibility.ts's reallocation suggestions (#7) already
// prefer pulling slack from categories flagged "under" typical; this
// guidance is the qualitative reasoning a host would apply to the same
// question by hand.
//
// Kept framework-agnostic (plain objects, no React/Express types) so this
// file can be imported by both the Express server and the React client.

export type NoticeLevel = "high" | "medium" | "low";

export interface CategoryPriority {
  category: string; // matches shared/schema.ts's BUDGET_CATEGORIES
  noticeLevel: NoticeLevel; // how much guests tend to notice this category
  guidance: string; // one-line, host-facing rationale
}

export const NOTICE_LEVEL_LABELS: Record<NoticeLevel, string> = {
  high: "Worth the splurge",
  medium: "Nice to have",
  low: "Easy place to save",
};

// "Other" is intentionally excluded — it is a catch-all with no single
// guest-facing character, matching how shared/budgetFeasibility.ts also
// leaves it unbenchmarked.
export const BUDGET_PRIORITIES: CategoryPriority[] = [
  {
    category: "Food & Beverage",
    noticeLevel: "high",
    guidance: "Guests remember the food. A common, well-justified place to spend a bit more.",
  },
  {
    category: "Venue",
    noticeLevel: "high",
    guidance: "Sets the tone the moment guests arrive — often worth the investment.",
  },
  {
    category: "Entertainment",
    noticeLevel: "high",
    guidance: "Directly shapes how much fun people have — a frequent, high-impact splurge category.",
  },
  {
    category: "Décor",
    noticeLevel: "medium",
    guidance: "Noticed in photos and first impressions, but easy to scale back without ruining the day.",
  },
  {
    category: "Photography",
    noticeLevel: "medium",
    guidance: "Matters more after the event than during it — worth budgeting, but rarely urgent to overspend.",
  },
  {
    category: "Rentals",
    noticeLevel: "low",
    guidance: "Functional — guests rarely notice tables, chairs, or linens unless something is missing.",
  },
  {
    category: "Favors & Gifts",
    noticeLevel: "low",
    guidance: "A nice touch, but rarely make-or-break — one of the easiest places to trim.",
  },
  {
    category: "Attire",
    noticeLevel: "low",
    guidance: "Personal to the host — not usually a line item guests are weighing the event against.",
  },
];

export function getCategoryPriority(category: string): CategoryPriority | null {
  return BUDGET_PRIORITIES.find((p) => p.category === category) ?? null;
}

/** Grouped view for a static reference card: high-notice categories first. */
export function groupByNoticeLevel(): Record<NoticeLevel, CategoryPriority[]> {
  return {
    high: BUDGET_PRIORITIES.filter((p) => p.noticeLevel === "high"),
    medium: BUDGET_PRIORITIES.filter((p) => p.noticeLevel === "medium"),
    low: BUDGET_PRIORITIES.filter((p) => p.noticeLevel === "low"),
  };
}

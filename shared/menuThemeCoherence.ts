// Menu-to-theme coherence check: flags when the host's theme doesn't show up
// anywhere in the menu they have built so far (e.g. a "Dinosaur" theme with a
// menu of plain party snacks that never nod to it).
//
// Deliberately rule-based, not a separate AI call (per Engineering Backlog
// #12): light keyword matching against the same curated theme metadata
// already used by the Theme tab's idea generator (server/themeLibrary.ts).
// The server resolves the theme match and keyword vocabulary (that lookup
// lives in server/themeLibrary.ts, which isn't shared with the client) and
// passes the result in here, so this file stays a plain, framework-agnostic
// function importable by both the Express server and the React client —
// same pattern as shared/contradictions.ts and shared/missingItems.ts.
//
// Scope limitation: this only has vocabulary for themes recognized by the
// curated Theme Library (~20 popular party themes — golf, dinosaur, safari,
// etc.). A free-text theme outside that library (e.g. an adult dinner-party
// theme like "Italian Summer Dinner") has no curated keyword list to check
// against, so the check silently stays quiet rather than guessing. Widening
// coverage to arbitrary themes is exactly the case the backlog item calls
// out for escalating to an LLM check — not implemented here, to keep this
// feature at zero added AI cost.

export type MenuThemeCoherenceSeverity = "notice";

export interface MenuThemeCoherenceFlag {
  id: string;
  severity: MenuThemeCoherenceSeverity;
  title: string;
  detail: string;
  modules: string[];
}

/** Minimal shape needed from a menu item — matches shared/schema.ts's MenuItem. */
export interface MenuItemSignalInput {
  itemName: string;
  notes?: string;
}

export interface MenuThemeCoherenceInput {
  /** Display label of the curated theme the host's theme text matched, or
   *  null if it did not match any curated library entry. */
  matchedThemeLabel: string | null;
  /** Lowercased keyword vocabulary for the matched theme (its recognition
   *  keywords, e.g. ["dinosaur", "dino", "jurassic", "t-rex", "trex"]).
   *  Ignored when matchedThemeLabel is null. */
  themeKeywords: string[];
  menuItems: MenuItemSignalInput[];
}

/** Below this many menu items, a "nothing matches yet" read is too noisy to
 *  be useful — a host who has only added one or two placeholder items is
 *  still drafting, not finished, so there's nothing worth flagging yet. */
const MIN_MENU_ITEMS_FOR_CHECK = 3;

export function detectMenuThemeCoherence(input: MenuThemeCoherenceInput): MenuThemeCoherenceFlag[] {
  const { matchedThemeLabel, themeKeywords, menuItems } = input;

  if (!matchedThemeLabel || themeKeywords.length === 0) return [];
  if (menuItems.length < MIN_MENU_ITEMS_FOR_CHECK) return [];

  const haystacks = menuItems.map((m) => `${m.itemName} ${m.notes ?? ""}`.toLowerCase());
  const hasThemeEcho = themeKeywords.some((kw) => haystacks.some((h) => h.includes(kw)));

  if (hasThemeEcho) return [];

  return [
    {
      id: "menu-theme-mismatch",
      severity: "notice",
      title: `Your menu doesn't reflect your ${matchedThemeLabel} theme yet`,
      detail: `None of your ${menuItems.length} menu items nod to the ${matchedThemeLabel} theme by name. A dish name or two that echoes the theme helps tie the party together — check the Theme tab for menu ideas.`,
      modules: ["menu", "theme"],
    },
  ];
}

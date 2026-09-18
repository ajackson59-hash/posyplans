/** Server-owned provenance/numeric scope; no model calls or general NLP claims. */
export interface ReviewSource { id: string; text: string; authority: "host" | "policy" | "derived" }
export interface ReviewCountRule {
  operator: "exactly" | "at-least" | "at-most"; value: number; target: string; quote: string;
}
export interface ReviewBinding { sourceId: string; quote: string }

/** Exact source quotes, with the complete paragraph retained as context.
 * Do not split commas/conjunctions (relationships), decimals or URL punctuation.
 */
export function sourceClauses(source: string): string[] {
  return (source.match(/[\s\S]*?(?:[.!?;](?=\s|$)|\n|$)/g) ?? []).map(s => s.trim()).filter(Boolean);
}
const numbers: Record<string, number> = { zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, twenty: 20 };
const numeral = "(?:\\d{1,3}|zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty)";

/** Only a whole, explicit unambiguous count clause becomes executable policy.
 * Embedded counts, relationships, negation, alternatives and per-person scopes
 * remain qualitative in their original words. Never guess a global count.
 */
export function explicitCountRule(quote: string): ReviewCountRule | null {
  const match = new RegExp(`^(?:(?:show|include|depict)\\s+)?(exactly|at least|at most)\\s+(${numeral})\\s+([^.!?;]+)[.!?;]?$`, "i").exec(quote.trim());
  if (!match) return null;
  const target = match[3].trim();
  if (!target || /\b(?:and|or|with|without|each|every|per|except|unless|not|no|must|should|are|is|have|has|holding|wearing|on|in|at|behind|beside)\b|[,/:]/i.test(target)) return null;
  const value = /^\d+$/.test(match[2]) ? Number(match[2]) : numbers[match[2].toLowerCase()];
  if (!Number.isSafeInteger(value) || value > 100) return null;
  return { operator: match[1].toLowerCase().replace(/ /g, "-") as ReviewCountRule["operator"], value, target, quote };
}
export function countMatches(rule: ReviewCountRule, observed: number): boolean {
  return rule.operator === "exactly" ? observed === rule.value
    : rule.operator === "at-least" ? observed >= rule.value : observed <= rule.value;
}

/** Secondary prose-integrity guard, NOT semantic truth verification.
 * Observations describe pixels. The server separately emits authoritative policy.
 */
export function hasPolicyClaim(observation: string): boolean {
  return /\b(?:the\s+)?(?:host|brief|request|prompt|customer)\s+(?:explicitly\s+)?(?:requires?|demands?|asks?\s+for|specif(?:y|ies)|wants?)\b|\bas\s+explicitly\s+requested\b|\b(?:must|needs?\s+to|should)\s+(?:all\s+|each\s+|every\s+)?(?:have|be|show|include|contain|appear)\b/i.test(observation);
}

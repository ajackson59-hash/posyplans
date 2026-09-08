/**
 * One deterministic interpretation of explicit host directives, shared by the
 * teaser, invitation and refinement briefs. Free-form host words remain the
 * authority; these are additional binary review facts, not a replacement or
 * a vocabulary of supported subjects. Never clip a clause or drop later ones.
 */
const DIRECTIVE = /\b(do\s+not(?:\s+ever)?(?:\s+(?:include|show|depict|feature|add|use|have))?|don't(?:\s+ever)?(?:\s+(?:include|show|depict|feature|add|use|have))?|must\s+not(?:\s+(?:include|show|depict|feature|add|use|have))?|should\s+not(?:\s+(?:include|show|depict|feature|add|use|have))?|never(?:\s+(?:include|show|depict|feature|add|use|have))?|without(?:\s+(?:including|showing|depicting|featuring|adding|using|having))?|avoid(?:ing)?(?:\s+(?:including|showing|depicting|featuring|adding|using))?|exclude|excluding|omit(?:ting)?|skip(?:ping)?|no|free\s+of|include|including|show|showing|depict|depicting|feature|features|featuring|add|adding|use|using|with|have|having)\b/gi;
const NEGATIVE = /^(?:do\s+not|don't|must\s+not|should\s+not|never|without|avoid(?:ing)?|exclude|excluding|omit(?:ting)?|skip(?:ping)?|no|free\s+of)\b/i;

function clean(value: string): string {
  return value.replace(/\s+/g, " ").replace(/^[,;:\-–—\s]+|[,;:\-–—\s]+$/g, "").trim();
}

function clauses(source: string): string[] {
  return source.split(/[.!?;\n]+|\s+but\s+|,?\s+(?=(?:without|no|do not|don't|never|avoid|exclude|excluding|omit|skip|free of)\b)|,\s*(?=(?:include|show|depict|feature|add)\b)/i)
    .map(clean).filter(Boolean);
}

export function targetIsNegated(source: string, index: number): boolean {
  const prefix = source.slice(0, index).split(/[.!?;\n]|\bbut\b/i).at(-1) ?? "";
  const closest = Array.from(prefix.matchAll(DIRECTIVE)).at(-1)?.[1] ?? "";
  return NEGATIVE.test(closest);
}

function addClause(found: string[], value: string): void {
  const clause = clean(value);
  if (!clause || found.some(item => item.toLowerCase().includes(clause.toLowerCase()))) return;
  // Preserve the broader complete host statement when two patterns overlap.
  for (let i = found.length - 1; i >= 0; i--) {
    if (clause.toLowerCase().includes(found[i].toLowerCase())) found.splice(i, 1);
  }
  found.push(clause);
}

export function explicitSceneRequirements(source: string): string[] {
  const found: string[] = [];
  const patterns = [
    /\b(?:include|including|features?|featuring|show|showing|depict|depicting)\s+(.+)/gi,
    /\b(?:set|stage|staged|held)\s+(?:the\s+(?:celebration|party|scene)\s+)?(?:inside|within|in|at)\s+(.+)/gi,
    /\b(?:inside|within)\s+(.+)/gi,
    /\bat\s+(.+)/gi,
  ];
  for (const clause of clauses(source)) {
    for (const pattern of patterns) {
      for (const match of Array.from(clause.matchAll(pattern))) {
        if (targetIsNegated(clause, match.index ?? 0)) continue;
        const detail = clean(match[1]);
        if (/^(?:\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)|noon|midnight)\b/i.test(detail)) continue;
        if (/^(?:make|keep|feel|should|please|try)\b/i.test(detail)) continue;
        addClause(found, detail);
      }
    }
  }
  return found.map(clause => `[VISIBLE HOST DETAIL] ${clause}`);
}

export function explicitSceneExclusions(source: string): string[] {
  const found: string[] = [];
  const patterns = [
    /\b(?:do\s+not(?:\s+ever)?|don't(?:\s+ever)?|must\s+not|should\s+not|never)\s+(?:(?:include|including|show|showing|depict|depicting|feature|featuring|add|adding|use|using|have|having)\s+)?(.+)/gi,
    /\b(?:avoid(?:ing)?|exclude|excluding|omit(?:ting)?|skip(?:ping)?)\s+(?:(?:include|including|show|showing|depict|depicting|feature|featuring|add|adding|use|using)\s+)?(.+)/gi,
    /\b(?:without|free\s+of|no)\s+(.+)/gi,
  ];
  for (const clause of clauses(source)) {
    for (const pattern of patterns) {
      for (const match of Array.from(clause.matchAll(pattern))) addClause(found, match[1]);
    }
  }
  return found.map(clause => `[HOST EXCLUSION] ${clause}`);
}

export function hostExplicitlyRequestsCandles(source: string): boolean {
  return clauses(source).some(clause => Array.from(clause.matchAll(/\bcandles?\b/gi))
    .some(match => !targetIsNegated(clause, match.index ?? 0)));
}

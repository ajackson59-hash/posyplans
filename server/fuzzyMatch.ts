// Lightweight typo-tolerant name matching for the public RSVP guest search.
// No external dependency — plain Levenshtein distance with a length-scaled
// threshold, layered on top of the existing substring match so guests who
// type their name correctly still get instant, exact-feeling results.

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const prev = new Array(b.length + 1);
  const curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1, // deletion
        curr[j - 1] + 1, // insertion
        prev[j - 1] + cost, // substitution
      );
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

// Allow more typos for longer words, none for very short ones (avoids
// "Al" matching half the guest list).
function toleranceFor(len: number): number {
  if (len <= 3) return 0;
  if (len <= 6) return 1;
  return 2;
}

/**
 * Returns true if `query` is a plausible typo of `name` (or one of its
 * words) — substring matches should be checked separately/first since this
 * only handles near-miss spelling, not partial containment.
 */
export function isFuzzyNameMatch(query: string, name: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  const nameWords = name.toLowerCase().split(/\s+/).filter(Boolean);
  const queryWords = q.split(/\s+/).filter(Boolean);

  return queryWords.some((qw) =>
    nameWords.some((nw) => {
      const tolerance = toleranceFor(Math.max(qw.length, nw.length));
      if (tolerance === 0) return qw === nw;
      // Skip pairs whose length difference alone exceeds tolerance —
      // cheap early exit before running full Levenshtein.
      if (Math.abs(qw.length - nw.length) > tolerance) return false;
      return levenshtein(qw, nw) <= tolerance;
    }),
  );
}

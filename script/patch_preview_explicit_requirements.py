from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected one match in {path}, found {count}: {old[:180]!r}")
    p.write_text(text.replace(old, new, 1))


quality = "server/prePaymentPreviewQuality.ts"
replace_once(
    quality,
    'import { buildEventBrief, type EventBrief } from "./aiFirst/brief";',
    'import { ageFromMilestone, buildEventBrief, type EventBrief } from "./aiFirst/brief";',
)

anchor = '''function enrichBriefForNamedReference(brief: EventBrief, named: NamedCreativeReference | null): EventBrief {'''
helper = r'''const CHILD_AGE_WORDS: Readonly<Record<number, string>> = {
  1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six",
  7: "seven", 8: "eight", 9: "nine",
};

/**
 * The general event brief deliberately keeps ambiguous vibe words soft. A
 * pre-purchase image has a stricter job: prove Posy heard the host. Clauses the
 * host explicitly framed as scene contents or setting are therefore binding
 * for this quality-locked preview and are audited against the final pixels.
 *
 * This stays deterministic/network-free and intentionally conservative. It
 * captures strong visual constructions ("include…", "featuring…", "set inside…",
 * and concrete "at …" setting clauses) rather than turning every adjective in
 * a vibe sentence into a must-have object.
 */
function explicitPreviewSceneRequirements(brief: EventBrief): string[] {
  const source = brief.vibe.trim();
  if (!source) return [];

  const clauses: string[] = [];
  const patterns = [
    /\b(?:include|including|features?|featuring|show|showing|depict|depicting)\s+([^.!?]{4,220})/gi,
    /\b(?:set|stage|staged|held)\s+(?:the\s+(?:celebration|party|scene)\s+)?(?:inside|within|in|at)\s+([^.!?]{4,220})/gi,
    /\b(?:inside|within)\s+([^.!?]{4,180})/gi,
    /\bat\s+([^.!?]{4,180})/gi,
  ];

  for (const pattern of patterns) {
    for (const match of Array.from(source.matchAll(pattern))) {
      const clause = (match[1] || "")
        .replace(/\s+/g, " ")
        .replace(/^[,;:\-–—\s]+|[,;:\-–—\s]+$/g, "")
        .trim();
      if (!clause) continue;
      // Do not turn clock times or meta/style instructions into visual objects.
      if (/^(?:\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)|noon|midnight)\b/i.test(clause)) continue;
      if (/^(?:make|keep|feel|should|please|try)\b/i.test(clause)) continue;
      // A broader match can contain a narrower one; keep the most specific
      // useful clause once rather than multiplying near-duplicate requirements.
      if (clauses.some((existing) => existing.toLowerCase().includes(clause.toLowerCase()))) continue;
      const contained = clauses.findIndex((existing) => clause.toLowerCase().includes(existing.toLowerCase()));
      if (contained >= 0) clauses.splice(contained, 1);
      clauses.push(clause.slice(0, 220));
      if (clauses.length >= 4) break;
    }
    if (clauses.length >= 4) break;
  }

  const required = clauses.map((clause) => `host-explicit scene detail: ${clause}`);
  const age = ageFromMilestone(brief.milestone);
  if (age !== null && age >= 1 && age <= 9 && CHILD_AGE_WORDS[age]) {
    required.push(
      `a clear non-text ${brief.milestone} birthday cue using ${CHILD_AGE_WORDS[age]} separate unnumbered birthday candles or an equally explicit physical count`,
    );
  }
  return unique(required);
}

'''
replace_once(quality, anchor, helper + anchor)

replace_once(
    quality,
    '''      required: unique([\n        ...brief.requirements.required,\n        ...(named?.requirements ?? []),\n      ]),''',
    '''      required: unique([\n        ...brief.requirements.required,\n        ...explicitPreviewSceneRequirements(brief),\n        ...(named?.requirements ?? []),\n      ]),''',
)

test = "tests/prePaymentPreviewQuality.test.ts"
replace_once(
    test,
    '''    expect(concept.minOverlay).toBe("none");''',
    '''    expect(concept.minOverlay).toBe("none");\n    const binding = brief.requirements.required.join(" ");\n    expect(binding).toContain("indoor soft play with bubbles and ice cream treats");\n    expect(binding).toContain("four separate unnumbered birthday candles");''',
)

# Add a richer regression proving an explicit list becomes binding rather than
# merely preferred. Insert before the curated named-reference detector tests.
needle = '''  it("detects exact entertainment references instead of collapsing them to a generic category via the curated fast path", async () => {'''
insert = r'''  it("makes an explicit host scene list binding for the final teaser pixels", async () => {
    const detailed = {
      ...event,
      eventName: "Brian's 4th Birthday",
      themeName: "Blippi + Meekah",
      vibeDescription:
        "A joyful fourth birthday at an upscale indoor soft-play center. Include bright foam climbing structures, a ball pit, floating bubbles, and colorful ice-cream treats. The result should feel polished and premium.",
    } as unknown as Event;

    const { brief } = await buildQualityLockedPreviewBrief(detailed);
    const required = brief.requirements.required.join(" \n ");
    expect(required).toContain("host-explicit scene detail: bright foam climbing structures, a ball pit, floating bubbles, and colorful ice-cream treats");
    expect(required).toContain("host-explicit scene detail: an upscale indoor soft-play center");
    expect(required).toContain("four separate unnumbered birthday candles");
    expect(brief.requirements.preferred.join(" ")).not.toContain("ball pit");
  });

'''
replace_once(test, needle, insert + needle)

print("binding preview scene requirements applied")

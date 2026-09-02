from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected one match in {path}, found {count}: {old[:220]!r}")
    p.write_text(text.replace(old, new, 1))

quality = "server/prePaymentPreviewQuality.ts"

replace_once(
    quality,
    '''  const age = ageFromMilestone(brief.milestone);
  if (age !== null && age >= 1 && age <= 9 && CHILD_AGE_WORDS[age]) {
    required.push(
      `[VISIBLE MILESTONE] exactly ${CHILD_AGE_WORDS[age]} separate unnumbered birthday candles or another unmistakable physical count of exactly ${CHILD_AGE_WORDS[age]}`,
    );
  }''',
    '''  const age = ageFromMilestone(brief.milestone);
  const hostExplicitlyRequestedCandles = /\\bcandles?\\b/i.test(source);
  if (hostExplicitlyRequestedCandles && age !== null && age >= 1 && age <= 9 && CHILD_AGE_WORDS[age]) {
    required.push(
      `[VISIBLE MILESTONE] exactly ${CHILD_AGE_WORDS[age]} separate unnumbered birthday candles or another unmistakable physical count of exactly ${CHILD_AGE_WORDS[age]}`,
    );
  }''',
)

replace_once(
    quality,
    '''function enrichBriefForNamedReference(brief: EventBrief, named: NamedCreativeReference | null): EventBrief {
  return {''',
    '''function enrichBriefForNamedReference(brief: EventBrief, named: NamedCreativeReference | null): EventBrief {
  const age = ageFromMilestone(brief.milestone);
  const hostExplicitlyRequestedCandles = /\\bcandles?\\b/i.test(brief.vibe);
  return {''',
)
replace_once(
    quality,
    '''        "a lead character's face or head cropped off by the canvas edge",
      ]),''',
    '''        "a lead character's face or head cropped off by the canvas edge",
        ...(age !== null && !hostExplicitlyRequestedCandles
          ? ["birthday candles, numeral-shaped props or other countable age markers when the host did not explicitly request a count"]
          : []),
      ]),''',
)
replace_once(
    quality,
    '''  const teaserAge = ageFromMilestone(brief.milestone);
  const milestoneDirection = teaserAge !== null && teaserAge >= 1 && teaserAge <= 9 && CHILD_AGE_WORDS[teaserAge]
    ? `MILESTONE: show exactly ${CHILD_AGE_WORDS[teaserAge]} separate unnumbered birthday candles or another unmistakable physical count of exactly ${CHILD_AGE_WORDS[teaserAge]}; no extra candle-like decorations and no written numerals.`
    : "MILESTONE: communicate any stated milestone through a natural physical event cue, never written names, dates or logos.";''',
    '''  const teaserAge = ageFromMilestone(brief.milestone);
  const hostExplicitlyRequestedCandles = /\\bcandles?\\b/i.test(brief.vibe);
  const milestoneDirection = teaserAge !== null && teaserAge >= 1 && teaserAge <= 9 && CHILD_AGE_WORDS[teaserAge]
    ? hostExplicitlyRequestedCandles
      ? `MILESTONE: show exactly ${CHILD_AGE_WORDS[teaserAge]} separate unnumbered birthday candles; no extra candle-like decorations and no written numerals.`
      : "MILESTONE: match the child's age through age-appropriate energy only. Do not show birthday candles, numeral-shaped props or other countable age markers; the surrounding Posy UI carries the exact age."
    : "MILESTONE: communicate any stated milestone through age-appropriate tone, never invented written names, dates or logos.";''',
)

quality_test = "tests/prePaymentPreviewQuality.test.ts"
replace_once(
    quality_test,
    '''    expect(binding).toContain("[VISIBLE MILESTONE] exactly four separate unnumbered birthday candles");
    expect(binding).toContain("[VISIBLE NAMED IDENTITY] Blippi is visibly identifiable");''',
    '''    expect(binding).not.toContain("[VISIBLE MILESTONE]");
    expect(binding).toContain("[VISIBLE NAMED IDENTITY] Blippi is visibly identifiable");''',
)
replace_once(
    quality_test,
    '''    expect(brief.requirements.excluded).toContain(
      "a central unidentified child posed as the implied celebrant in place of the requested named-theme subjects",
    );
    expect(brief.requirements.preferred.join(" ")).not.toMatch(/stationery/i);
    expect(concept.art.prompt).toContain("exactly four separate unnumbered birthday candles");''',
    '''    expect(brief.requirements.excluded).toContain(
      "a central unidentified child posed as the implied celebrant in place of the requested named-theme subjects",
    );
    expect(brief.requirements.excluded).toContain(
      "birthday candles, numeral-shaped props or other countable age markers when the host did not explicitly request a count",
    );
    expect(brief.requirements.preferred.join(" ")).not.toMatch(/stationery/i);
    expect(concept.art.prompt).toContain("Do not show birthday candles");''',
)
replace_once(
    quality_test,
    '''    expect(required).toContain("[VISIBLE MILESTONE] exactly four separate unnumbered birthday candles");
    expect(brief.requirements.preferred.join(" ")).not.toContain("ball pit");
  });''',
    '''    expect(required).not.toContain("[VISIBLE MILESTONE]");
    expect(brief.requirements.excluded.join(" ")).toContain("countable age markers");
    expect(brief.requirements.preferred.join(" ")).not.toContain("ball pit");
  });

  it("keeps an exact milestone count binary when the host explicitly asks for candles", async () => {
    const candleEvent = {
      ...event,
      eventName: "Brian's 4th Birthday",
      themeName: "Blippi + Meekah",
      vibeDescription:
        "Blippi and Meekah at indoor soft play with bubbles and ice cream. Include four birthday candles on the cake.",
    } as unknown as Event;

    const { brief, concept } = await buildQualityLockedPreviewBrief(candleEvent);
    expect(brief.requirements.required.join(" ")).toContain(
      "[VISIBLE MILESTONE] exactly four separate unnumbered birthday candles",
    );
    expect(brief.requirements.excluded.join(" ")).not.toContain("countable age markers when the host did not explicitly request a count");
    expect(concept.art.prompt).toContain("show exactly four separate unnumbered birthday candles");
  });''',
)

print("safe teaser milestone policy applied")

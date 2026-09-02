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
    '  const required = clauses.map((clause) => `host-explicit scene detail: ${clause}`);',
    '  const required = clauses.map((clause) => `[VISIBLE HOST DETAIL] ${clause}`);',
)
replace_once(
    quality,
    '''      `a clear non-text ${brief.milestone} birthday cue using ${CHILD_AGE_WORDS[age]} separate unnumbered birthday candles or an equally explicit physical count`,''',
    '''      `[VISIBLE MILESTONE] exactly ${CHILD_AGE_WORDS[age]} separate unnumbered birthday candles or another unmistakable physical count of exactly ${CHILD_AGE_WORDS[age]}`,''',
)
replace_once(
    quality,
    '''        ...(named?.requirements ?? []),''',
    '''        ...(named?.requirements.map((requirement) => `[VISIBLE NAMED IDENTITY] ${requirement}`) ?? []),''',
)
replace_once(
    quality,
    '''      preferred: brief.requirements.preferred,''',
    '''      // Standalone teaser pixels are not stationery. Carry event mood but
      // remove shared invitation-furniture preferences that otherwise pull the
      // image model back toward a template/card treatment after the teaser
      // prompt explicitly forbids one.
      preferred: brief.requirements.preferred.filter((item) => !/stationery/i.test(item)),''',
)
replace_once(
    quality,
    '''              "an invented portrait, gender or physical appearance for the celebrant when the host did not supply a personal visual reference",''',
    '''              "an invented portrait, gender or physical appearance for the celebrant when the host did not supply a personal visual reference",
              "a central unidentified child posed as the implied celebrant in place of the requested named-theme subjects",''',
)
replace_once(
    quality,
    '''  const prompt = [
    "Create one premium cinematic event-world illustration: full portrait canvas, one continuous believable environment.",''',
    '''  const teaserAge = ageFromMilestone(brief.milestone);
  const milestoneDirection = teaserAge !== null && teaserAge >= 1 && teaserAge <= 9 && CHILD_AGE_WORDS[teaserAge]
    ? `MILESTONE: show exactly ${CHILD_AGE_WORDS[teaserAge]} separate unnumbered birthday candles or another unmistakable physical count of exactly ${CHILD_AGE_WORDS[teaserAge]}; no extra candle-like decorations and no written numerals.`
    : "MILESTONE: communicate any stated milestone through a natural physical event cue, never written names, dates or logos.";
  const prompt = [
    "Create one premium cinematic event-world illustration: full portrait canvas, one continuous believable environment.",''',
)
replace_once(
    quality,
    '''    "MILESTONE: if age is known, use a natural cue such as correct candle count; never invent written names, dates or logos.",''',
    '''    milestoneDirection,''',
)

vision = "server/aiFirst/visionGate.ts"
replace_once(
    vision,
    '''Judge BRIEF REQUIREMENTS holistically through briefFidelity and ageAppropriate. For each VISIBLE MUST-HAVE, report whether that concrete subject is visibly present. List any EXCLUDED item you can actually see.''',
    '''Judge BRIEF REQUIREMENTS holistically through briefFidelity and ageAppropriate. VISIBLE MUST-HAVES are stricter binary facts: an exact count must match the stated number exactly, and a named lead/co-host identity is false when it is generic, colour-only, or only ambiguously recognizable. Never average a wrong count or weak named identity into an overall 4/5 score. For each VISIBLE MUST-HAVE, report whether that concrete subject is visibly present. List any EXCLUDED item you can actually see.''',
)
replace_once(
    vision,
    '''export interface VisionGateInput {
  bytes: Buffer;''',
    '''const VISIBLE_REQUIREMENT_PREFIX = /^\\[VISIBLE (?:HOST DETAIL|MILESTONE|NAMED IDENTITY)\\]\\s*/i;

/**
 * Teaser-specific briefs deliberately tag host-explicit scene facts, exact
 * milestones and named identities as binary pixel facts. They must not be
 * allowed to disappear inside an otherwise-good holistic fidelity score.
 */
export function visibleReviewRequirementsForBrief(brief: EventBrief): string[] {
  return Array.from(new Set(
    brief.requirements.required
      .filter((requirement) => VISIBLE_REQUIREMENT_PREFIX.test(requirement))
      .map((requirement) => requirement.replace(VISIBLE_REQUIREMENT_PREFIX, "").trim())
      .filter(Boolean),
  ));
}

export interface VisionGateInput {
  bytes: Buffer;''',
)
replace_once(
    vision,
    '''  const reviewRequirements = concreteSubjectReviewRequirementsForBrief(brief);''',
    '''  const reviewRequirements = Array.from(new Set([
    ...concreteSubjectReviewRequirementsForBrief(brief),
    ...visibleReviewRequirementsForBrief(brief),
  ]));''',
)

quality_test = "tests/prePaymentPreviewQuality.test.ts"
replace_once(
    quality_test,
    '''    expect(binding).toContain("four separate unnumbered birthday candles");''',
    '''    expect(binding).toContain("[VISIBLE MILESTONE] exactly four separate unnumbered birthday candles");
    expect(binding).toContain("[VISIBLE NAMED IDENTITY] Blippi is visibly identifiable");
    expect(binding).toContain("[VISIBLE NAMED IDENTITY] Meekah is visibly identifiable");''',
)
replace_once(
    quality_test,
    '''    expect(brief.requirements.excluded).toContain(
      "an invented portrait, gender or physical appearance for the celebrant when the host did not supply a personal visual reference",
    );''',
    '''    expect(brief.requirements.excluded).toContain(
      "an invented portrait, gender or physical appearance for the celebrant when the host did not supply a personal visual reference",
    );
    expect(brief.requirements.excluded).toContain(
      "a central unidentified child posed as the implied celebrant in place of the requested named-theme subjects",
    );
    expect(brief.requirements.preferred.join(" ")).not.toMatch(/stationery/i);
    expect(concept.art.prompt).toContain("exactly four separate unnumbered birthday candles");''',
)
replace_once(
    quality_test,
    '''    expect(required).toContain("host-explicit scene detail: bright foam climbing structures, a ball pit, floating bubbles, and colorful ice-cream treats");
    expect(required).toContain("host-explicit scene detail: an upscale indoor soft-play center");
    expect(required).toContain("four separate unnumbered birthday candles");''',
    '''    expect(required).toContain("[VISIBLE HOST DETAIL] bright foam climbing structures, a ball pit, floating bubbles, and colorful ice-cream treats");
    expect(required).toContain("[VISIBLE HOST DETAIL] an upscale indoor soft-play center");
    expect(required).toContain("[VISIBLE MILESTONE] exactly four separate unnumbered birthday candles");''',
)

quality_gate_test = "tests/aiFirstQualityGate.test.ts"
replace_once(
    quality_gate_test,
    '''import { MIN_DIMENSION_SCORE, runVisionGate, visionCostUsd } from "../server/aiFirst/visionGate";''',
    '''import { MIN_DIMENSION_SCORE, runVisionGate, visibleReviewRequirementsForBrief, visionCostUsd } from "../server/aiFirst/visionGate";''',
)
replace_once(
    quality_gate_test,
    '''  it("fails when an EXCLUDED item is visible even though every score is 5", async () => {''',
    '''  it("turns teaser milestone, named-identity and host-detail contracts into binary must-haves", async () => {
    const teaser = brief({
      requirements: {
        required: [
          "[VISIBLE MILESTONE] exactly four separate unnumbered birthday candles",
          "[VISIBLE NAMED IDENTITY] Meekah is unmistakably recognizable as the requested co-host",
          "[VISIBLE HOST DETAIL] floating bubbles and colorful ice-cream treats",
        ],
        preferred: [],
        excluded: [],
      },
    });
    const visible = visibleReviewRequirementsForBrief(teaser);
    expect(visible).toEqual([
      "exactly four separate unnumbered birthday candles",
      "Meekah is unmistakably recognizable as the requested co-host",
      "floating bubbles and colorful ice-cream treats",
    ]);
    const verdict = await runVision(
      {
        requiredPresent: visible.map((requirement, index) => ({ requirement, present: index !== 0 })),
      },
      teaser,
    );
    expect(verdict.passed).toBe(false);
    expect(verdict.failureCodes).toContain("brief-fidelity");
  });

  it("fails when an EXCLUDED item is visible even though every score is 5", async () => {''',
)
replace_once(
    quality_gate_test,
    '''    expect(systemText).toContain("exact final pixels");
    expect(systemText).toContain("no browser crop");''',
    '''    expect(systemText).toContain("exact final pixels");
    expect(systemText).toContain("no browser crop");
    expect(systemText).toContain("exact count must match the stated number exactly");
    expect(systemText).toContain("weak named identity");''',
)

print("binary teaser fidelity gate repair applied")

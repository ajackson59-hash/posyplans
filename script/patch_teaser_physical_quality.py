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
    '''  const milestoneDirection = teaserAge !== null && teaserAge >= 1 && teaserAge <= 9 && CHILD_AGE_WORDS[teaserAge]
    ? hostExplicitlyRequestedCandles
      ? `MILESTONE: show exactly ${CHILD_AGE_WORDS[teaserAge]} separate unnumbered birthday candles; no extra candle-like decorations and no written numerals.`
      : "MILESTONE: match the child's age through age-appropriate energy only. Do not show birthday candles, numeral-shaped props or other countable age markers; the surrounding Posy UI carries the exact age."
    : "MILESTONE: communicate any stated milestone through age-appropriate tone, never invented written names, dates or logos.";
  const prompt = [
    "Create one premium cinematic event-world image: full portrait canvas, one continuous believable environment.",
    `IDENTITY: ${identity}; venue, activities and party details in the same scene.`,
    "NATIVE STYLE: natural skin, hair, fabric and light in live action; polished native animation. No generic mascot art.",
    namedReference
      ? "STORY: named characters and event details are the hero in candid interaction; do not invent any child in the foreground or central hero plane without a supplied celebrant reference."
      : "STORY: asymmetric candid interaction and varied poses, not a front-facing catalog or character-promo pose.",
    "DEPTH/MATERIAL: crisp hero focus with natural depth falloff; motivated directional key/fill/rim light, contact/cast shadows, controlled saturation, color bounce and micro-detail; correct hands, joints, scale, gravity and perspective. No waxy skin, plastic food, repeated object clusters, stamped bubbles or composite seams.",
    milestoneDirection,
    "COMPOSITION: fully frame required faces, primary celebration object, hands and props; leave breathing room and control foreground clutter.",
    "NO DESIGN SURFACES: no blank card, panel, sign, frame, collage, sticker sheet, poster, merchandise mockup, screen, invitation card or text-reserved rectangle.",
  ].join(" ");''',
    '''  const milestoneDirection = teaserAge !== null && teaserAge >= 1 && teaserAge <= 9 && CHILD_AGE_WORDS[teaserAge]
    ? hostExplicitlyRequestedCandles
      ? `MILESTONE: show exactly ${CHILD_AGE_WORDS[teaserAge]} separate unnumbered birthday candles; no extras or written numerals.`
      : "MILESTONE: age-appropriate energy only; no candles, numeral props or countable age markers."
    : "MILESTONE: age-appropriate tone only; no invented names, dates or logos.";
  const prompt = [
    "Premium event-world image, full portrait canvas, one believable environment.",
    `IDENTITY: ${identity}; venue and party details share the scene.`,
    "NATIVE STYLE: natural live-action skin, hair, fabric and light or polished native animation; no generic mascot art.",
    namedReference
      ? "STORY: candid asymmetric interaction; named characters are heroes; do not invent any child in the foreground or central hero plane without a personal reference."
      : "STORY: candid asymmetric interaction, not a front-facing catalog or character-promo pose.",
    "DEPTH/MATERIAL: directional key + subtle rim light; natural depth, contact/cast shadows, controlled saturation and color bounce; correct hands, joints, scale, gravity and perspective. No waxy skin, plastic food, repeated object clusters, stamped bubbles or cutout halos.",
    "HANDS/PROPS: unless explicitly required, no food or small props in hands; use simple natural hands and stable surfaces at believable scale.",
    "COMPOSITION: fully frame faces, hands and required objects; avoid dense repeated foreground micro-objects.",
    milestoneDirection,
    "NO DESIGN SURFACES: no card, panel, sign, frame, collage, poster, mockup, screen or text box.",
  ].join(" ");''',
)

test = "tests/prePaymentPreviewQuality.test.ts"
replace_once(
    test,
    '''    expect(concept.art.prompt).toContain("repeated object clusters");
    expect(concept.art.prompt.length).toBeLessThanOrEqual(1200);''',
    '''    expect(concept.art.prompt).toContain("repeated object clusters");
    expect(concept.art.prompt).toContain("HANDS/PROPS");
    expect(concept.art.prompt).toContain("directional key + subtle rim light");
    expect(concept.art.prompt).toContain("no food or small props in hands");
    expect(concept.art.prompt.length).toBeLessThanOrEqual(1200);''',
)

print("physical-quality teaser prompt repair applied")

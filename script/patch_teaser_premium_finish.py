from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected one match in {path}, found {count}: {old[:160]!r}")
    p.write_text(text.replace(old, new, 1))


quality = "server/prePaymentPreviewQuality.ts"
replace_once(
    quality,
    '''  const prompt = [\n    "Create one premium cinematic event-world illustration that proves the host's specific celebration was understood at a glance.",\n    `HOST EVENT WORLD — authoritative: ${sourceBrief}`,\n    "FULL-CANVAS SCENE CONTRACT: use the full portrait canvas as one continuous, believable environment. Keep every required person, face, creature, signature object and defining interaction fully visible with comfortable breathing room at every edge. Do not draw a blank card, white rectangle, paper panel, placard, sign, frame or placeholder box anywhere in the artwork.",\n    namedReference\n      ? `IDENTITY HIERARCHY: ${namedReference.label} must be immediately recognizable and central; the requested venue, activities and party details must visibly belong to the same scene.`\n      : "STORY HIERARCHY: the requested setting, activities and defining event details must be materially visible in the same cohesive scene.",\n    "NO DESIGN SURFACES: no collage, split panel, sticker sheet, poster, merchandise mockup, stage backdrop, photo-booth frame, sign, screen, invitation card, blank rectangle or text-reserved area.",\n    "FINISH CONTRACT: polished high-end cinematic illustration with dimensional light, believable material texture, clean silhouettes, natural expressions and anatomically coherent hands and limbs. Avoid flat-vector mascot art, clipart, stock-template sheen, merchandising-ad composition, generic AI clutter and oversaturated plastic rendering.",\n    inspirationNotes ? `IDENTITY REFERENCE NOTES — authoritative: ${inspirationNotes.slice(0, 320)}` : "",\n  ].filter(Boolean).join(" ");''',
    '''  // Keep this art-direction layer inside AiFirstConcept's 1,200-character\n  // schema budget. The full host brief, hard REQUIRED/EXCLUDED constraints and\n  // identity-reference notes are appended separately to the final model prompt,\n  // so duplicating them here only caused the highest-value finish rules to be\n  // truncated before GPT Image saw them.\n  const identity = namedReference\n    ? `${namedReference.label.slice(0, 80)} immediately recognizable and central`\n    : "the requested event world immediately recognizable and central";\n  const prompt = [\n    "Create one premium cinematic event-world illustration: full portrait canvas, one continuous believable environment.",\n    `IDENTITY: ${identity}; venue, activities and party details belong in the same scene.`,\n    "NATIVE VISUAL LANGUAGE: live-action references need natural skin, hair, fabric and light; animated worlds keep polished native animation. No generic mascot art.",\n    "STORY MOMENT: asymmetric candid interaction and varied poses, not a front-facing catalog or character-promo pose.",\n    "DEPTH/MATERIAL: crisp hero focal plane, believable venue depth, coherent light/shadow/color bounce and micro-detail. No waxy skin, plastic food, uniform gloss, stamped bubbles or cutout halos.",\n    "MILESTONE PROOF: when age is known, use a natural physical cue such as correct candle count; never invent written names, dates or logos.",\n    "COMPOSITION: fully frame every required face, primary celebration object, hands and props; leave breathing room and control foreground clutter/saturation.",\n    "NO DESIGN SURFACES: no blank card, panel, sign, frame, collage, sticker sheet, poster, merchandise mockup, screen, invitation card or text-reserved rectangle.",\n  ].join(" ");''',
)

# Keep the existing schema-safe guard. The contract above is deliberately under
# 1,200 characters even with an 80-character named identity, so this can no
# longer amputate a late-stage quality instruction.

# Make the teaser-only critic reject the synthetic/commercial-promo cues observed
# in the exact retained medium canary. The normal invitation critic stays intact.
vision = "server/aiFirst/visionGate.ts"
replace_once(
    vision,
    '''- artifactFree: 5 = no melted, duplicated, malformed or anatomically broken forms.\n- premiumFinish: 5 = art-directed, dimensional and commercially polished enough to create purchase desire on its own. Score 1-2 for clipart, stock-template, merchandise-ad, flat-vector mascot or generic AI look; score 3 for competent but ordinary or synthetic-looking work.''',
    '''- artifactFree: 5 = no melted, duplicated, malformed or anatomically broken forms, cutout/composite halos, copy-stamped effects, inconsistent light physics or other visible generation artifacts.\n- premiumFinish: 5 = art-directed, dimensional and commercially polished enough to create purchase desire on its own. Look for purposeful depth hierarchy, native-medium fidelity, believable materials, controlled saturation and an emotionally specific moment. Score 1-2 for clipart, stock-template, merchandise-ad, flat-vector mascot or generic AI look; score 3 for competent but ordinary/synthetic work such as waxy skin, plastic food, uniform specular highlights, flat painted backgrounds, copy-stamped bubbles/effects or front-facing catalog poses.''',
)

# Lock the full priority contract into tests. The final clause proves the entire
# 1,200-character budget survives, rather than merely checking its beginning.
test = "tests/prePaymentPreviewQuality.test.ts"
replace_once(
    test,
    '''    expect(concept.art.prompt).toContain("NO DESIGN SURFACES");\n    expect(concept.art.prompt).not.toContain("invitation artwork");''',
    '''    expect(concept.art.prompt).toContain("NO DESIGN SURFACES");\n    expect(concept.art.prompt).toContain("STORY MOMENT");\n    expect(concept.art.prompt).toContain("DEPTH/MATERIAL");\n    expect(concept.art.prompt).toContain("MILESTONE PROOF");\n    expect(concept.art.prompt).toContain("NATIVE VISUAL LANGUAGE");\n    expect(concept.art.prompt.length).toBeLessThanOrEqual(1200);\n    expect(concept.art.prompt).not.toContain("invitation artwork");''',
)
replace_once(
    test,
    '''    expect(generateImage.mock.calls[0][0].prompt).toContain("FINISH CONTRACT");\n    expect(generateImage.mock.calls[0][0].prompt).toContain("NO DESIGN SURFACES");\n    expect(generateImage.mock.calls[0][0].prompt).toContain("use the full portrait canvas");''',
    '''    expect(generateImage.mock.calls[0][0].prompt).toContain("NO DESIGN SURFACES");\n    expect(generateImage.mock.calls[0][0].prompt).toContain("STORY MOMENT");\n    expect(generateImage.mock.calls[0][0].prompt).toContain("DEPTH/MATERIAL");\n    expect(generateImage.mock.calls[0][0].prompt).toContain("MILESTONE PROOF");\n    expect(generateImage.mock.calls[0][0].prompt).toContain("full portrait canvas");''',
)

print("premium teaser art-direction repair applied")

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
    '''    namedReference\n      ? `IDENTITY HIERARCHY: ${namedReference.label} must be immediately recognizable and central; the requested venue, activities and party details must visibly belong to the same scene.`\n      : "STORY HIERARCHY: the requested setting, activities and defining event details must be materially visible in the same cohesive scene.",\n    "NO DESIGN SURFACES: no collage, split panel, sticker sheet, poster, merchandise mockup, stage backdrop, photo-booth frame, sign, screen, invitation card, blank rectangle or text-reserved area.",\n    "FINISH CONTRACT: polished high-end cinematic illustration with dimensional light, believable material texture, clean silhouettes, natural expressions and anatomically coherent hands and limbs. Avoid flat-vector mascot art, clipart, stock-template sheen, merchandising-ad composition, generic AI clutter and oversaturated plastic rendering.",\n    inspirationNotes ? `IDENTITY REFERENCE NOTES — authoritative: ${inspirationNotes.slice(0, 320)}` : "",''',
    '''    namedReference\n      ? `IDENTITY HIERARCHY: ${namedReference.label} must be immediately recognizable and central; the requested venue, activities and party details must visibly belong to the same scene.`\n      : "STORY HIERARCHY: the requested setting, activities and defining event details must be materially visible in the same cohesive scene.",\n    namedReference\n      ? "NATIVE VISUAL LANGUAGE: follow the visual medium established by the identity references. Live-action human hosts should retain natural photographic skin, hair, fabric and lighting; animated worlds should retain their own polished animation language. Never convert either into generic mascot art or an unrelated visual style."\n      : "NATIVE VISUAL LANGUAGE: choose one coherent premium visual medium and render every subject, prop and environment consistently within it.",\n    "STORY MOMENT: stage an asymmetric, emotionally alive celebration moment rather than two subjects posing frontally like a catalog or licensed-character promo. Use natural interaction, varied body positions and an intentional eye path through the scene.",\n    "DEPTH AND MATERIAL CONTRACT: create a crisp focal plane on the hero subjects and defining party moment, with believable foreground-to-background depth and restrained selective focus. Surfaces must have physically coherent light, shadow, color bounce and material micro-detail; bubbles, frosting, fabric, hair, metallic pieces, balloons and play equipment must not look copy-stamped, waxy, plasticky or uniformly glossy.",\n    "MILESTONE PROOF: when the host brief includes an age or milestone, communicate it through elegant physical celebration details such as the correct number of candles or another natural in-world cue. Do not invent names, dates, logos or written event copy inside the artwork.",\n    "COMPOSITION FINISH: keep the primary celebration object or activity fully inside the frame, avoid edge-clipped hands and props, control foreground clutter, and use depth/lighting to separate the hero moment from the venue instead of flattening everything into equal saturation.",\n    "NO DESIGN SURFACES: no collage, split panel, sticker sheet, poster, merchandise mockup, stage backdrop, photo-booth frame, sign, screen, invitation card, blank rectangle or text-reserved area.",\n    "FINISH CONTRACT: polished high-end cinematic art direction with dimensional light, believable material texture, clean silhouettes, natural expressions and anatomically coherent hands and limbs. Avoid flat-vector mascot art, clipart, stock-template sheen, merchandising-ad composition, generic AI clutter, subject cutout halos and oversaturated plastic rendering.",\n    inspirationNotes ? `IDENTITY REFERENCE NOTES — authoritative: ${inspirationNotes.slice(0, 320)}` : "",''',
)

# The old 1,200-character cut-off could sever the art-direction contract in the
# middle of a sentence. The final image prompt already has its own bounded event
# brief/reference inputs, so preserve this prioritized teaser contract intact.
replace_once(
    quality,
    '''      prompt: prompt.slice(0, 1200),''',
    '''      prompt,''',
)

# Make the teaser-only critic reject the synthetic/commercial-promo cues observed
# in the exact retained medium canary. The normal invitation critic stays intact.
vision = "server/aiFirst/visionGate.ts"
replace_once(
    vision,
    '''- artifactFree: 5 = no melted, duplicated, malformed or anatomically broken forms.\n- premiumFinish: 5 = art-directed, dimensional and commercially polished enough to create purchase desire on its own. Score 1-2 for clipart, stock-template, merchandise-ad, flat-vector mascot or generic AI look; score 3 for competent but ordinary or synthetic-looking work.''',
    '''- artifactFree: 5 = no melted, duplicated, malformed or anatomically broken forms, cutout/composite halos, copy-stamped effects, inconsistent light physics or other visible generation artifacts.\n- premiumFinish: 5 = art-directed, dimensional and commercially polished enough to create purchase desire on its own. Look for purposeful depth hierarchy, native-medium fidelity, believable materials, controlled saturation and an emotionally specific moment. Score 1-2 for clipart, stock-template, merchandise-ad, flat-vector mascot or generic AI look; score 3 for competent but ordinary/synthetic work such as waxy skin, plastic food, uniform specular highlights, flat painted backgrounds, copy-stamped bubbles/effects or front-facing catalog poses.''',
)

# Lock the systemic art-direction concepts into tests so future edits cannot
# quietly collapse the teaser back into a generic character-promo composition.
test = "tests/prePaymentPreviewQuality.test.ts"
replace_once(
    test,
    '''    expect(concept.art.prompt).toContain("NO DESIGN SURFACES");\n    expect(concept.art.prompt).not.toContain("invitation artwork");''',
    '''    expect(concept.art.prompt).toContain("NO DESIGN SURFACES");\n    expect(concept.art.prompt).toContain("STORY MOMENT");\n    expect(concept.art.prompt).toContain("DEPTH AND MATERIAL CONTRACT");\n    expect(concept.art.prompt).toContain("MILESTONE PROOF");\n    expect(concept.art.prompt).toContain("NATIVE VISUAL LANGUAGE");\n    expect(concept.art.prompt).not.toContain("invitation artwork");''',
)
replace_once(
    test,
    '''    expect(generateImage.mock.calls[0][0].prompt).toContain("NO DESIGN SURFACES");\n    expect(generateImage.mock.calls[0][0].prompt).toContain("use the full portrait canvas");''',
    '''    expect(generateImage.mock.calls[0][0].prompt).toContain("NO DESIGN SURFACES");\n    expect(generateImage.mock.calls[0][0].prompt).toContain("STORY MOMENT");\n    expect(generateImage.mock.calls[0][0].prompt).toContain("DEPTH AND MATERIAL CONTRACT");\n    expect(generateImage.mock.calls[0][0].prompt).toContain("MILESTONE PROOF");\n    expect(generateImage.mock.calls[0][0].prompt).toContain("use the full portrait canvas");''',
)

print("premium teaser art-direction repair applied")

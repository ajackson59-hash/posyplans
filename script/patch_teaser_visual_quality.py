from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected exactly one match in {path}, found {count}: {old[:140]!r}")
    file.write_text(text.replace(old, new, 1))


quality = "server/prePaymentPreviewQuality.ts"

replace_once(
    quality,
    '''        "a visible blank card, white rectangle, paper panel, placard, sign, frame or placeholder box inside the artwork",\n        "a lead character's face or head cropped off by the canvas edge",''',
    '''        "a visible blank card, white rectangle, paper panel, placard, sign, frame or placeholder box inside the artwork",\n        "a collage, split panel, sticker sheet, merchandise mockup, pasted character cutout or television-promo layout",\n        "a freestanding poster, banner, easel, title card, invitation card, menu board, screen or other rectangular surface reserved for text",\n        "a lead character's face or head cropped off by the canvas edge",''',
)

replace_once(
    quality,
    '''  const prompt = [\n    "Premium editorial invitation artwork that proves the host's specific event was understood at a glance.",\n    `ORIGINAL HOST BRIEF — authoritative: ${sourceBrief}`,\n    "TEASER COMPOSITION CONTRACT: use the full portrait canvas for one cohesive, compelling scene. Keep every required person, face, creature, signature object and defining interaction fully visible with comfortable breathing room at every edge. Do not draw a blank card, white rectangle, paper panel, placard, sign, frame or placeholder box anywhere in the artwork.",\n    inspirationNotes ? `HOST-PROVIDED VISUAL REFERENCE NOTES — authoritative: ${inspirationNotes}` : "",\n    "Depict the actual people, characters, setting, activities and defining objects requested. The event scene—not an accessory, logo-like symbol, pattern, palette or abstract shorthand—must dominate the composition.",\n    "FINISH CONTRACT: create bespoke editorial stationery artwork with layered depth, tactile material detail, controlled lighting and refined art direction. It must not resemble generic clipart, stock illustration, a television promo still, a merchandising graphic or a flat commercial poster. Keep faces, hands, limbs and object interactions anatomically coherent.",\n  ].filter(Boolean).join(" ");''',
    '''  const prompt = [\n    "Create one premium cinematic event-world illustration that proves the host's specific celebration was understood at a glance.",\n    `HOST EVENT WORLD — authoritative: ${sourceBrief}`,\n    "FULL-CANVAS SCENE CONTRACT: use the full portrait canvas as one continuous, believable environment. Keep every required person, face, creature, signature object and defining interaction fully visible with comfortable breathing room at every edge. Do not draw a blank card, white rectangle, paper panel, placard, sign, frame or placeholder box anywhere in the artwork.",\n    namedReference\n      ? `IDENTITY HIERARCHY: ${namedReference.label} must be immediately recognizable and central; the requested venue, activities and party details must visibly belong to the same scene.`\n      : "STORY HIERARCHY: the requested setting, activities and defining event details must be materially visible in the same cohesive scene.",\n    "NO DESIGN SURFACES: no collage, split panel, sticker sheet, poster, merchandise mockup, stage backdrop, photo-booth frame, sign, screen, invitation card, blank rectangle or text-reserved area.",\n    "FINISH CONTRACT: polished high-end cinematic illustration with dimensional light, believable material texture, clean silhouettes, natural expressions and anatomically coherent hands and limbs. Avoid flat-vector mascot art, clipart, stock-template sheen, merchandising-ad composition, generic AI clutter and oversaturated plastic rendering.",\n    inspirationNotes ? `IDENTITY REFERENCE NOTES — authoritative: ${inspirationNotes.slice(0, 320)}` : "",\n  ].filter(Boolean).join(" ");''',
)

replace_once(
    quality,
    '''    borderStyle: "thin-frame",\n    fontPairingId: "editorial-serif",''',
    '''    // Teaser generation consumes only concept.art; keep schema-required invitation\n    // furniture deliberately inert so retained QA evidence cannot imply a floral\n    // frame, paper texture or typography treatment that was never requested.\n    borderStyle: "none",\n    fontPairingId: "modern-sans",''',
)
replace_once(
    quality,
    '''    texture: { style: "cotton", intensity: 0.45 },\n    dividerStyle: "diamond-rule",''',
    '''    texture: { style: "none", intensity: 0 },\n    dividerStyle: "none",''',
)
replace_once(
    quality,
    '''      medium: namedReference ? "premium character-led editorial illustration" : "premium narrative editorial illustration",''',
    '''      medium: namedReference ? "polished cinematic character illustration" : "polished cinematic event illustration",''',
)

replace_once(
    quality,
    '''  const referenceImageRule = dependencies.referenceImages?.length\n    ? "ATTACHED REFERENCE IMAGES ARE AUTHORITATIVE IDENTITY ANCHORS. Match the defining face, hair, outfit, creature markings, proportions, silhouette and visual-world details that make the requested subjects recognizable at a glance. Create a new event-specific scene; never copy wording, logos, watermarks or an invitation layout from the references."\n    : "";\n  const basePrompt = [\n    buildTeaserArtworkPrompt(concept),\n    buildArtworkConstraints(brief),\n    referenceImageRule,\n  ].filter(Boolean).join("\\n\\n");''',
    '''  const referenceIdentityNotes = dependencies.inspirationNotes?.trim()\n    ? `AUTHORITATIVE IDENTITY NOTES: ${dependencies.inspirationNotes.trim()}`\n    : "";\n  const referenceImageRule = dependencies.referenceImages?.length\n    ? "ATTACHED REFERENCE IMAGES ARE IDENTITY ANCHORS ONLY. Preserve the defining face, hair, outfit, creature markings, proportions, silhouette and world details that make the requested subjects recognizable. Integrate them naturally into a new event-specific environment. Do not copy the source background, pose, crop, wording, logo, watermark, card, poster or layout; do not paste cutout characters onto an unrelated scene."\n    : "";\n  const basePrompt = [\n    buildTeaserArtworkPrompt(concept),\n    buildArtworkConstraints(brief),\n    referenceIdentityNotes,\n    referenceImageRule,\n  ].filter(Boolean).join("\\n\\n");''',
)

# Strengthen the customer-visible quality definition so premiumFinish is not
# satisfied by merely clean/competent AI artwork.
vision = "server/aiFirst/visionGate.ts"
replace_once(
    vision,
    '''- premiumFinish: 5 = genuinely premium editorial illustration. Score 1-2 for clipart, stock-template or generic AI look.\n- briefFidelity: 5 = the artwork unmistakably delivers the host's named world, requested setting, activities and defining details.''',
    '''- premiumFinish: 5 = art-directed, dimensional and commercially polished enough to create purchase desire on its own. Score 1-2 for clipart, stock-template, merchandise-ad, flat-vector mascot or generic AI look; score 3 for competent but ordinary or synthetic-looking work.\n- briefFidelity: 5 = the artwork unmistakably delivers the host's named world, requested setting, activities and defining details.''',
)
replace_once(
    vision,
    '''- compositionQuality: 5 = clear, balanced, intentional full-bleed composition in the exact supplied pixels. Any cropped face or head, edge-clipped lead subject, awkward empty panel, or required hero subject pushed partly outside the canvas forces 3 or lower.''',
    '''- compositionQuality: 5 = one clear, balanced, intentional full-bleed scene in the exact supplied pixels. Any collage/split-panel treatment, pasted cutout look, poster/sign/card surface, cropped face or head, edge-clipped lead subject, awkward empty panel, or required hero subject pushed partly outside the canvas forces 3 or lower.''',
)

# Regression expectations: the generator prompt itself must now be free of the
# invitation/stationery language that caused the model to invent design panels.
test = "tests/prePaymentPreviewQuality.test.ts"
replace_once(
    test,
    '''    expect(concept.art.prompt).toContain("use the full portrait canvas");\n    expect(concept.art.prompt).toContain("Do not draw a blank card");''',
    '''    expect(concept.art.prompt).toContain("use the full portrait canvas");\n    expect(concept.art.prompt).toContain("Do not draw a blank card");\n    expect(concept.art.prompt).toContain("NO DESIGN SURFACES");\n    expect(concept.art.prompt).not.toContain("invitation artwork");\n    expect(concept.art.prompt).not.toContain("stationery artwork");\n    expect(concept.borderStyle).toBe("none");\n    expect(concept.texture).toEqual({ style: "none", intensity: 0 });\n    expect(concept.dividerStyle).toBe("none");''',
)
replace_once(
    test,
    '''    expect(generateImage.mock.calls[0][0].prompt).toContain("FINISH CONTRACT");\n    expect(generateImage.mock.calls[0][0].prompt).toContain("use the full portrait canvas");''',
    '''    expect(generateImage.mock.calls[0][0].prompt).toContain("FINISH CONTRACT");\n    expect(generateImage.mock.calls[0][0].prompt).toContain("NO DESIGN SURFACES");\n    expect(generateImage.mock.calls[0][0].prompt).toContain("use the full portrait canvas");\n    expect(generateImage.mock.calls[0][0].prompt).not.toContain("stationery artwork");\n    expect(generateImage.mock.calls[0][0].prompt).not.toContain("garden-editorial");\n    expect(generateImage.mock.calls[0][0].prompt).not.toContain("botanical-sprig");''',
)

print("teaser visual-quality repair applied")

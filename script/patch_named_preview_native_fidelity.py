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
    '    `${concept.art.medium} illustration.`,',
    '    `${concept.art.medium}.`,',
)

replace_once(
    quality,
    '      "Meekah is visibly identifiable as a distinct full co-host through her recognizable purple-and-orange visual identity—not a generic second adult",',
    '      "Meekah is visibly identifiable as a distinct full co-host through her natural curly hair and recognizable purple play-and-learn wardrobe with warm orange/yellow accents—not a generic second adult",',
)

replace_once(
    quality,
    '              "isolated accessories or palette-only shorthand standing in for the requested characters or world",\n            ]',
    '              "isolated accessories or palette-only shorthand standing in for the requested characters or world",\n              "an invented portrait, gender or physical appearance for the celebrant when the host did not supply a personal visual reference",\n            ]',
)

replace_once(
    quality,
    '      medium: namedReference ? "polished cinematic character illustration" : "polished cinematic event illustration",',
    '      medium: namedReference ? "premium native-medium cinematic event image" : "premium cinematic event illustration",',
)

replace_once(
    quality,
    '  const modelForCandidate = (candidate: number): ArtworkModel =>\n    referenceLed && candidate > 1 ? REFERENCE_ARTWORK_MODEL : DEFAULT_ARTWORK_MODEL;',
    '  const modelForCandidate = (candidate: number): ArtworkModel =>\n    referenceLed && candidate === 1 ? REFERENCE_ARTWORK_MODEL : DEFAULT_ARTWORK_MODEL;',
)

# The first named-reference attempt must use the high-fidelity edit path; a
# second private attempt, when budget/time allows, may trade fidelity for GPT
# Image 2's broader rendering strength.
test = "tests/prePaymentPreviewReferenceQuality.test.ts"
replace_once(
    test,
    '  it("tries GPT Image 2 first, then one high-fidelity reference correction when needed", async () => {',
    '  it("uses high-fidelity reference generation first, then GPT Image 2 only as a private correction", async () => {',
)
replace_once(
    test,
    '    expect(result.model).toBe("gpt-image-1.5");',
    '    expect(result.model).toBe("gpt-image-2");',
)
replace_once(
    test,
    '''    expect(generateImage.mock.calls[0][0]).toEqual(expect.objectContaining({
      model: "gpt-image-2",
      quality: "high",
      inputFidelity: undefined,
      aspectRatio: "9:16",
      referenceImages,
    }));
    expect(generateImage.mock.calls[1][0]).toEqual(expect.objectContaining({
      model: "gpt-image-1.5",
      quality: "high",
      inputFidelity: "high",
      aspectRatio: "9:16",
      referenceImages,
    }));''',
    '''    expect(generateImage.mock.calls[0][0]).toEqual(expect.objectContaining({
      model: "gpt-image-1.5",
      quality: "high",
      inputFidelity: "high",
      aspectRatio: "9:16",
      referenceImages,
    }));
    expect(generateImage.mock.calls[1][0]).toEqual(expect.objectContaining({
      model: "gpt-image-2",
      quality: "high",
      inputFidelity: undefined,
      aspectRatio: "9:16",
      referenceImages,
    }));''',
)

# Lock the no-invented-celebrant constraint and remove the accidental doubled
# "illustration illustration" wording from the provider prompt.
main_test = "tests/prePaymentPreviewQuality.test.ts"
replace_once(
    main_test,
    '''    expect(brief.requirements.excluded).toContain(
      "a lead character's face or head cropped off by the canvas edge",
    );''',
    '''    expect(brief.requirements.excluded).toContain(
      "a lead character's face or head cropped off by the canvas edge",
    );
    expect(brief.requirements.excluded).toContain(
      "an invented portrait, gender or physical appearance for the celebrant when the host did not supply a personal visual reference",
    );
    expect(`${concept.art.medium}.`).not.toContain("illustration illustration");''',
)

print("native-fidelity named preview repair applied")

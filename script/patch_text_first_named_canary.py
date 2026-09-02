from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected one match in {path}, found {count}: {old[:180]!r}")
    p.write_text(text.replace(old, new, 1))

# Revert the failed reference-model-first experiment. Keep the native-medium
# wording, explicit Meekah details, no-invented-celebrant rule and all prompt
# budget/art-direction improvements.
quality = "server/prePaymentPreviewQuality.ts"
replace_once(
    quality,
    '  const modelForCandidate = (candidate: number): ArtworkModel =>\n    referenceLed && candidate === 1 ? REFERENCE_ARTWORK_MODEL : DEFAULT_ARTWORK_MODEL;',
    '  const modelForCandidate = (candidate: number): ArtworkModel =>\n    referenceLed && candidate > 1 ? REFERENCE_ARTWORK_MODEL : DEFAULT_ARTWORK_MODEL;',
)

reference_test = "tests/prePaymentPreviewReferenceQuality.test.ts"
replace_once(
    reference_test,
    '  it("uses high-fidelity reference generation first, then GPT Image 2 only as a private correction", async () => {',
    '  it("tries GPT Image 2 first, then one high-fidelity reference correction when needed", async () => {',
)
replace_once(
    reference_test,
    '    expect(result.model).toBe("gpt-image-2");',
    '    expect(result.model).toBe("gpt-image-1.5");',
)
replace_once(
    reference_test,
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
)

# Canary-only isolation: automatic research still runs and its authoritative
# notes remain in the prompt, but the official pixels are not passed into the
# image-edit endpoint. This makes the build canary a true GPT Image 2
# text-generation test, not a character-compositing/edit test.
diag = "server/emailDiagnosticRoutes.ts"
replace_once(
    diag,
    '''          inspirationNotes: resolved.notes,
          referenceImages: resolved.images,
          quality: "medium",''',
    '''          inspirationNotes: resolved.notes,
          quality: "medium",''',
)

print("text-first named canary patch applied")

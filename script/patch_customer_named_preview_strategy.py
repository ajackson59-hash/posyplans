from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected one match in {path}, found {count}: {old[:220]!r}")
    p.write_text(text.replace(old, new, 1))

route = "server/prePaymentPreviewQualityRoutes.ts"
replace_once(
    route,
    '''      generate(event, {
        inspirationNotes: resolved.notes,
        referenceImages: resolved.images,
        quality: "high",
        maxCandidates: 2,
        namedReference,
        attemptRetention: { store: artworkAttemptStore, eventId: event.id, ownerToken: event.ownerToken },
        signal: abortController.signal,
      }),''',
    '''      generate(event, {
        // Automatic research supplies the identity facts, but raw official
        // pixels are deliberately NOT passed into the edit/compositing path.
        // Live QA showed that path was slower and repeatedly collapsed into
        // synthetic licensed-character promo art. Text-first GPT Image 2
        // preserves the researched identity while building one cohesive event
        // scene from scratch.
        inspirationNotes: resolved.notes,
        quality: "medium",
        maxCandidates: 2,
        parallelCandidates: true,
        namedReference,
        attemptRetention: { store: artworkAttemptStore, eventId: event.id, ownerToken: event.ownerToken },
        signal: abortController.signal,
      }),''',
)

test = "tests/prePaymentPreviewQualityRoutes.test.ts"
replace_once(
    test,
    '''    expect(generate.mock.calls[0][1]).toEqual(expect.objectContaining({
      inspirationNotes: "Official Blippi and Meekah identity references",
      quality: "high",
      maxCandidates: 2,
      namedReference: expect.objectContaining({ id: "blippi-meekah" }),
      signal: expect.any(AbortSignal),
    }));
    expect(generate.mock.calls[0][1].referenceImages).toHaveLength(1);''',
    '''    expect(generate.mock.calls[0][1]).toEqual(expect.objectContaining({
      inspirationNotes: "Official Blippi and Meekah identity references",
      quality: "medium",
      maxCandidates: 2,
      parallelCandidates: true,
      namedReference: expect.objectContaining({ id: "blippi-meekah" }),
      signal: expect.any(AbortSignal),
    }));
    expect(generate.mock.calls[0][1].referenceImages).toBeUndefined();''',
)

print("customer named-preview strategy aligned")

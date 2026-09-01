from pathlib import Path


def one(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected one match in {path}, found {count}: {old[:120]!r}")
    file.write_text(text.replace(old, new, 1))


quality = "server/prePaymentPreviewQuality.ts"
one(
    quality,
    '''import {
  aspectRatioForLayout,
  buildArtworkPrompt,
  type AiFirstConcept,
} from "@shared/aiFirstInvite";''',
    '''import {
  ARTWORK_EDGE_REQUIREMENT,
  ARTWORK_TEXT_REQUIREMENT,
  aspectRatioForLayout,
  type AiFirstConcept,
} from "@shared/aiFirstInvite";''',
)
one(
    quality,
    '''export function customerVisiblePreviewBytes(source: Buffer): Buffer {
  const decoded = decodePng(source);
  return encodePng(boxDownsampleRgb(decoded, PRE_PAYMENT_PREVIEW_LONG_EDGE));
}
''',
    '''export function customerVisiblePreviewBytes(source: Buffer): Buffer {
  const decoded = decodePng(source);
  return encodePng(boxDownsampleRgb(decoded, PRE_PAYMENT_PREVIEW_LONG_EDGE));
}

/** The first-look image is standalone artwork, not the later invitation card. */
function buildTeaserArtworkPrompt(concept: AiFirstConcept): string {
  return [
    `${concept.art.medium} illustration.`,
    `${concept.art.composition}.`,
    concept.art.prompt.trim().replace(/\\s+$/, ""),
    ARTWORK_EDGE_REQUIREMENT,
    ARTWORK_TEXT_REQUIREMENT,
  ].filter(Boolean).join(" ");
}
''',
)
one(quality, "    buildArtworkPrompt(concept),", "    buildTeaserArtworkPrompt(concept),")

test = "tests/prePaymentPreviewQuality.test.ts"
one(
    test,
    '''    expect(generateImage.mock.calls[0][0].prompt).toContain("visually quiet typography zone");''',
    '''    expect(generateImage.mock.calls[0][0].prompt).toContain("use the full portrait canvas");
    expect(generateImage.mock.calls[0][0].prompt).not.toContain("visually quiet typography zone");
    expect(generateImage.mock.calls[0][0].prompt).not.toContain("cropped away");''',
)

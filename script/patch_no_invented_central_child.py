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
    '''              "a central unidentified child posed as the implied celebrant in place of the requested named-theme subjects",''',
    '''              "any child in the foreground or central hero plane when the host did not supply a personal visual reference for the celebrant",''',
)
replace_once(
    quality,
    '''    "STORY: asymmetric candid interaction and varied poses, not a front-facing catalog or character-promo pose.",''',
    '''    namedReference
      ? "STORY: named characters and event details are the hero. Use asymmetric candid interaction and varied poses; do not invent any child in the foreground or central hero plane when no personal celebrant reference was supplied."
      : "STORY: asymmetric candid interaction and varied poses, not a front-facing catalog or character-promo pose.",''',
)

test = "tests/prePaymentPreviewQuality.test.ts"
replace_once(
    test,
    '''    expect(brief.requirements.excluded).toContain(
      "a central unidentified child posed as the implied celebrant in place of the requested named-theme subjects",
    );''',
    '''    expect(brief.requirements.excluded).toContain(
      "any child in the foreground or central hero plane when the host did not supply a personal visual reference for the celebrant",
    );
    expect(concept.art.prompt).toContain("do not invent any child in the foreground or central hero plane");''',
)

print("no-invented-central-child teaser repair applied")

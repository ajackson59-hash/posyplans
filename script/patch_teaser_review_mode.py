from pathlib import Path


def one(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected one match in {path}, found {count}: {old[:120]!r}")
    file.write_text(text.replace(old, new, 1))


# The deterministic invitation gate keeps all existing defaults, but a
# standalone teaser may opt out of checks that only exist for a later browser
# crop/type overlay.
tier1 = "server/aiFirst/tier1.ts"
one(
    tier1,
    '''  /** Artwork opacity actually applied by the layout. */
  artworkOpacity: number;
  /** Enables the OCR pass. Off in unit tests, on in production. */''',
    '''  /** Artwork opacity actually applied by the layout. */
  artworkOpacity: number;
  /**
   * False for a standalone artwork teaser shown at its native ratio with no
   * live type or browser crop. Invitation rendering keeps the default true.
   */
  layoutApplied?: boolean;
  /** Enables the OCR pass. Off in unit tests, on in production. */''',
)
one(tier1, '  if (!crop.safe) {', '  if (input.layoutApplied !== false && !crop.safe) {')
one(tier1, '  if (!quiet.quiet) {', '  if (input.layoutApplied !== false && !quiet.quiet) {')
one(tier1, '    if (ratio < floor) {', '    if (input.layoutApplied !== false && ratio < floor) {')
one(tier1, '  if (input.overlayCoverage > 0.4) {', '  if (input.layoutApplied !== false && input.overlayCoverage > 0.4) {')
one(tier1, '  if (input.artworkOpacity < 0.5) {', '  if (input.layoutApplied !== false && input.artworkOpacity < 0.5) {')

# The vision critic needs a separate, explicit contract for the exact teaser
# pixels. It must not imagine an invitation type box that is no longer present.
vision = "server/aiFirst/visionGate.ts"
one(
    vision,
    '''const CODE_FOR_DIMENSION: Record<keyof VisionScores, string> = {''',
    '''const TEASER_SYSTEM = `You are a strict art director reviewing the exact final pixels of a personalized pre-payment artwork teaser. The customer sees this artwork at its native aspect ratio with no browser crop, text box, badge, gradient, panel or other overlay.

Score each 1-5. 4 means "a professional stationery studio would confidently show this as a compelling first look". 3 means acceptable but visibly compromised and is a FAIL.

- textLogoWatermarkFree: 5 = no letters, words, numbers, logos, signatures or watermarks anywhere, including stylised or partial ones.
- artifactFree: 5 = no melted, duplicated, malformed or anatomically broken forms.
- premiumFinish: 5 = genuinely premium editorial illustration. Score 1-2 for clipart, stock-template or generic AI look.
- briefFidelity: 5 = the artwork unmistakably delivers the host's named world, requested setting, activities and defining details.
- compositionQuality: 5 = clear, balanced, intentional full-bleed composition in the exact supplied pixels. Any cropped face or head, edge-clipped lead subject, awkward empty panel, or required hero subject pushed partly outside the canvas forces 3 or lower.
- ageAppropriate: 5 = correctly pitched for the celebrant's age. When the host explicitly requests an all-ages action or fantasy identity, do not fail merely because faithful imagery includes stylized fantasy weapons, non-graphic supernatural creatures, performance costumes or dramatic poses.

Judge BRIEF REQUIREMENTS holistically through briefFidelity and ageAppropriate. For each VISIBLE MUST-HAVE, report whether that concrete subject is visibly present. List any EXCLUDED item you can actually see.

Reply with JSON only:
{"textLogoWatermarkFree":0,"artifactFree":0,"premiumFinish":0,"briefFidelity":0,"compositionQuality":0,"ageAppropriate":0,"requiredPresent":[{"requirement":"","present":true}],"excludedFound":[],"notes":""}`;

/** Which retry remedy each failed dimension maps onto. */
const CODE_FOR_DIMENSION: Record<keyof VisionScores, string> = {''',
)
one(
    vision,
    '''export interface VisionGateInput {
  bytes: Buffer;
  concept: AiFirstConcept;
  brief: EventBrief;
  client?: Anthropic;
}''',
    '''export interface VisionGateInput {
  bytes: Buffer;
  concept: AiFirstConcept;
  brief: EventBrief;
  client?: Anthropic;
  /** Invitation is the default; teaser reviews exact standalone pixels. */
  reviewMode?: "invitation" | "teaser";
}''',
)
one(
    vision,
    '''  const client = input.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const { brief, concept } = input;
  const reviewRequirements = concreteSubjectReviewRequirementsForBrief(brief);''',
    '''  const client = input.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const { brief, concept } = input;
  const reviewMode = input.reviewMode ?? "invitation";
  const reviewRequirements = concreteSubjectReviewRequirementsForBrief(brief);''',
)
one(
    vision,
    '''  const protectionInstruction =
    concept.minOverlay === "plate"
      ? `FINAL TYPE PROTECTION: a ${(protectionAlpha * 100).toFixed(0)}%-opaque solid paper panel in ${concept.semanticPalette.textSurface} covers the LIVE TYPOGRAPHY BOX in the rendered invitation. Treat raw pixels beneath the box as covered. Required subjects must remain clearly recognizable outside the panel, and the remaining visible composition must still feel balanced.`
      : `FINAL TYPE PROTECTION: ${concept.minOverlay} (${(protectionAlpha * 100).toFixed(0)}% local surface opacity). The LIVE TYPOGRAPHY BOX must contain no face, person, hero object or required subject.`;''',
    '''  const protectionInstruction = reviewMode === "teaser"
    ? "FINAL CUSTOMER SURFACE: judge the supplied image exactly as shown. The browser adds no crop, type, badge, gradient, panel or overlay."
    : concept.minOverlay === "plate"
      ? `FINAL TYPE PROTECTION: a ${(protectionAlpha * 100).toFixed(0)}%-opaque solid paper panel in ${concept.semanticPalette.textSurface} covers the LIVE TYPOGRAPHY BOX in the rendered invitation. Treat raw pixels beneath the box as covered. Required subjects must remain clearly recognizable outside the panel, and the remaining visible composition must still feel balanced.`
      : `FINAL TYPE PROTECTION: ${concept.minOverlay} (${(protectionAlpha * 100).toFixed(0)}% local surface opacity). The LIVE TYPOGRAPHY BOX must contain no face, person, hero object or required subject.`;''',
)
one(
    vision,
    '''    `LIVE TYPOGRAPHY BOX (percentage of final card): left ${typeBox.left.toFixed(0)}%, top ${typeBox.top.toFixed(0)}%, width ${typeBox.width.toFixed(0)}%, height ${typeBox.height.toFixed(0)}%.`,''',
    '''    reviewMode === "teaser"
      ? ""
      : `LIVE TYPOGRAPHY BOX (percentage of final card): left ${typeBox.left.toFixed(0)}%, top ${typeBox.top.toFixed(0)}%, width ${typeBox.width.toFixed(0)}%, height ${typeBox.height.toFixed(0)}%.`,''',
)
one(
    vision,
    '''      system: SYSTEM,''',
    '''      system: reviewMode === "teaser" ? TEASER_SYSTEM : SYSTEM,''',
)

# Pre-payment artwork is now explicitly a standalone, full-canvas teaser. The
# exact 560px asset is checked without invitation-only crop/type assumptions.
quality = "server/prePaymentPreviewQuality.ts"
one(
    quality,
    '''    "LAYOUT CONTRACT: reserve a naturally calm, low-detail typography zone at approximately left 21%, top 32%, width 58%, height 40%. Keep every required person, face, creature, signature object and defining interaction fully visible outside that zone. Do not draw a blank card, white rectangle, paper panel, placard, sign, frame or placeholder box—the quiet area must remain part of the continuous full-bleed scene.",''',
    '''    "TEASER COMPOSITION CONTRACT: use the full portrait canvas for one cohesive, compelling scene. Keep every required person, face, creature, signature object and defining interaction fully visible with comfortable breathing room at every edge. Do not draw a blank card, white rectangle, paper panel, placard, sign, frame or placeholder box anywhere in the artwork.",''',
)
one(
    quality,
    '''      composition: "portrait scene-led full-bleed composition arranged around a naturally quiet central typography zone; all required subjects, faces and defining objects remain fully visible, with no visible panel, blank rectangle or cropped head",''',
    '''      composition: "portrait scene-led full-bleed teaser using the full canvas; all required subjects, faces and defining objects remain fully visible, with no panel, blank rectangle, cropped head or edge-clipped hero subject",''',
)
one(quality, '    minOverlay: "veil",', '    minOverlay: "none",')
one(
    quality,
    '''        artworkOpacity: 1,
        ocr: true,''',
    '''        artworkOpacity: 1,
        layoutApplied: false,
        ocr: true,''',
)
one(
    quality,
    '''        vision = await runVision({ bytes: reviewedBytes, concept, brief });''',
    '''        vision = await runVision({ bytes: reviewedBytes, concept, brief, reviewMode: "teaser" });''',
)

# Regression tests for context-specific deterministic and vision contracts.
quality_test = "tests/prePaymentPreviewQuality.test.ts"
one(quality_test, '    expect(concept.minOverlay).toBe("veil");', '    expect(concept.minOverlay).toBe("none");')
one(
    quality_test,
    '''    expect(concept.art.prompt).toContain("Do not draw a blank card");''',
    '''    expect(concept.art.prompt).toContain("use the full portrait canvas");
    expect(concept.art.prompt).toContain("Do not draw a blank card");''',
)
one(
    quality_test,
    '''    expect(Buffer.compare(runVision.mock.calls[0][0].bytes, returnedBytes)).toBe(0);
  });''',
    '''    expect(Buffer.compare(runVision.mock.calls[0][0].bytes, returnedBytes)).toBe(0);
    expect(runTier1.mock.calls[0][0].layoutApplied).toBe(false);
    expect(runVision.mock.calls[0][0].reviewMode).toBe("teaser");
  });''',
)

gate_test = "tests/aiFirstQualityGate.test.ts"
one(
    gate_test,
    '''  it("hard-rejects artwork that is busy under the exact live-type placement", () => {
    const result = tier1(busyTypeRegionPng(), {
      concept: concept({ minOverlay: "veil", placementId: "centre", safeTypographyRegion: "center" }),
    });
    const finding = result.findings.find((candidate) => candidate.code === "quiet-region");
    expect(finding).toBeDefined();
    expect(finding?.critical).toBe(true);
    expect(result.passed).toBe(false);
  });
});''',
    '''  it("hard-rejects artwork that is busy under the exact live-type placement", () => {
    const result = tier1(busyTypeRegionPng(), {
      concept: concept({ minOverlay: "veil", placementId: "centre", safeTypographyRegion: "center" }),
    });
    const finding = result.findings.find((candidate) => candidate.code === "quiet-region");
    expect(finding).toBeDefined();
    expect(finding?.critical).toBe(true);
    expect(result.passed).toBe(false);
  });

  it("does not apply invitation-only crop, type and overlay checks to a standalone teaser", () => {
    const result = tier1(busyTypeRegionPng(), {
      concept: concept({
        minOverlay: "none",
        placementId: "centre",
        safeTypographyRegion: "center",
        semanticPalette: {
          textSurface: "#FFFFFF",
          headlineColor: "#F2F2F2",
          bodyColor: "#EFEFEF",
          accentColor: "#EEEEEE",
        },
      }),
      overlayCoverage: 0.9,
      artworkOpacity: 0.2,
      layoutApplied: false,
    });
    const found = result.findings.map((finding) => finding.code);
    expect(found).not.toContain("crop-unsafe");
    expect(found).not.toContain("quiet-region");
    expect(found).not.toContain("text-contrast");
    expect(found).not.toContain("overlay-coverage");
    expect(found).not.toContain("layout-opacity");
  });
});''',
)
one(
    gate_test,
    '''  it("reviews a paper-panel concept as the final protected card without hiding required subjects", async () => {''',
    '''  it("reviews a teaser as exact standalone pixels without inventing a live type box", async () => {
    let reviewText = "";
    let systemText = "";
    const capturingCritic = {
      messages: {
        create: async (request: any) => {
          systemText = request.system;
          reviewText = request.messages[0].content.find((part: any) => part.type === "text")?.text ?? "";
          return {
            content: [{ type: "text", text: JSON.stringify({ ...allFive, requiredPresent: [], excludedFound: [], notes: "" }) }],
            usage: { input_tokens: 1200, output_tokens: 180 },
          };
        },
      },
    } as unknown as Anthropic;

    const verdict = await runVisionGate({
      bytes: artworkPng(),
      concept: concept({ minOverlay: "none" }),
      brief: brief(),
      client: capturingCritic,
      reviewMode: "teaser",
    });

    expect(verdict.passed).toBe(true);
    expect(systemText).toContain("exact final pixels");
    expect(systemText).toContain("no browser crop");
    expect(reviewText).toContain("FINAL CUSTOMER SURFACE");
    expect(reviewText).not.toContain("LIVE TYPOGRAPHY BOX");
    expect(reviewText).not.toContain("FINAL TYPE PROTECTION");
  });

  it("reviews a paper-panel concept as the final protected card without hiding required subjects", async () => {''',
)

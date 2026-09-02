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
    '''  /** Two internal candidates maximum; neither is customer-visible before approval. */
  maxCandidates?: 1 | 2;''',
    '''  /** Two internal candidates maximum; neither is customer-visible before approval. */
  maxCandidates?: 1 | 2;
  /**
   * Text-first named previews may privately render both candidates at once,
   * then quality-review both and choose the stronger approved result. This
   * spends two bounded image calls but avoids making conversion depend on one
   * stochastic draw or doubling customer latency with a sequential retry.
   */
  parallelCandidates?: boolean;''',
)

anchor = '''  const reviews: PreviewQualityReview[] = [];
  let failureCodes: string[] = [];
  let concreteNotes = "";

  for (let candidate = 1; candidate <= maxCandidates; candidate += 1) {'''
insert = '''  const reviews: PreviewQualityReview[] = [];
  let failureCodes: string[] = [];
  let concreteNotes = "";

  if (dependencies.parallelCandidates && maxCandidates === 2 && !referenceLed) {
    type ParallelOutcome = {
      candidate: number;
      model: ArtworkModel;
      passed: boolean;
      dataUrl?: string;
      review?: PreviewQualityReview;
      error?: string;
    };

    const prompts = [
      basePrompt,
      `${basePrompt}\n\nPRIVATE ALTERNATE TAKE: independently rebuild the same event world from a genuinely different camera position and staging while preserving every binding requirement and exclusion. Prioritize anatomically clean hands, coherent shadows, believable prop scale, natural foreground-to-background depth, controlled saturation and non-repeating physical detail. Do not make a cosmetic variation of the first take.`,
    ];

    const evaluateParallelCandidate = async (candidate: number): Promise<ParallelOutcome> => {
      const model = DEFAULT_ARTWORK_MODEL;
      if (dependencies.signal?.aborted) {
        return {
          candidate,
          model,
          passed: false,
          error: dependencies.signal.reason instanceof Error
            ? dependencies.signal.reason.message
            : "Preview generation was cancelled.",
        };
      }

      let generated: Awaited<ReturnType<ArtworkGenerator>>;
      try {
        generated = await generateImage({
          prompt: prompts[candidate - 1],
          aspectRatio: aspectRatioForLayout(concept.layoutStyle),
          model,
          quality,
          referenceImages: undefined,
          signal: dependencies.signal,
        });
      } catch (error) {
        return {
          candidate,
          model,
          passed: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }

      let reviewedBytes: Buffer;
      try {
        reviewedBytes = customerVisiblePreviewBytes(generated.bytes);
      } catch (error) {
        return {
          candidate,
          model,
          passed: false,
          error: `Generated artwork could not be prepared for customer review: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      const dataUrl = `data:image/png;base64,${reviewedBytes.toString("base64")}`;

      let tier1: Tier1Result;
      let vision: VisionVerdict | undefined;
      try {
        tier1 = runTier1({
          bytes: reviewedBytes,
          concept,
          overlayCoverage: OVERLAY_COVERAGE[concept.minOverlay],
          artworkOpacity: 1,
          layoutApplied: false,
          ocr: true,
        });
        if (tier1.passed) {
          vision = await runVision({
            bytes: reviewedBytes,
            concept,
            brief,
            reviewMode: "teaser",
            signal: dependencies.signal,
          });
        }
      } catch (error) {
        return {
          candidate,
          model,
          passed: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }

      const passed = tier1.passed && vision?.passed === true;
      const candidateFailureCodes = tier1.passed
        ? (vision?.failureCodes ?? ["vision-unavailable"])
        : retryCodesFor(tier1.findings);
      const notes = [
        ...tier1.findings.filter((finding) => finding.critical).map((finding) => finding.message),
        vision?.notes ?? "",
        ...(vision?.requiredPresent ?? [])
          .filter((item) => !item.present)
          .map((item) => `Missing required visual: ${item.requirement}`),
        ...(vision?.excludedFound ?? []).map((item) => `Remove excluded visual: ${item}`),
      ].filter(Boolean).join(" ").slice(0, 1200);
      const review: PreviewQualityReview = {
        tier1,
        vision,
        failureCodes: passed ? [] : candidateFailureCodes,
        notes,
      };

      if (dependencies.attemptRetention) {
        const { store: attemptStore, eventId, ownerToken, runId } = dependencies.attemptRetention;
        const size: ArtworkSize = sizeForAspect(aspectRatioForLayout(concept.layoutStyle));
        try {
          await attemptStore.record({
            eventId,
            ownerToken,
            runId: runId ?? null,
            idempotencyKey: null,
            directionIndex: 0,
            attempt: candidate,
            status: passed ? "accepted" : "rejected",
            bytes: reviewedBytes,
            previewId: null,
            concept,
            failureCodes: passed ? [] : candidateFailureCodes,
            tier1Findings: tier1.findings,
            visionScores: vision?.scores ?? null,
            model,
            quality,
            size,
            costUsdMicros: estimateImageCostUsdMicros(model, quality, size),
          });
        } catch (error) {
          console.error("[prepayment-preview] failed to persist parallel attempt evidence (non-fatal):", error);
        }
      }

      return { candidate, model, passed, dataUrl, review };
    };

    const outcomes = await Promise.all([
      evaluateParallelCandidate(1),
      evaluateParallelCandidate(2),
    ]);
    reviews.push(...outcomes.flatMap((outcome) => outcome.review ? [outcome.review] : []));

    const approved = outcomes
      .filter((outcome): outcome is ParallelOutcome & { dataUrl: string; review: PreviewQualityReview } =>
        outcome.passed && Boolean(outcome.dataUrl) && Boolean(outcome.review?.vision),
      )
      .sort((a, b) => {
        const av = a.review.vision!.scores;
        const bv = b.review.vision!.scores;
        const weighted = (scores: VisionVerdict["scores"]) =>
          scores.premiumFinish * 4
          + scores.briefFidelity * 4
          + scores.artifactFree * 3
          + scores.compositionQuality * 3
          + scores.textLogoWatermarkFree
          + scores.ageAppropriate;
        return weighted(bv) - weighted(av);
      })[0];

    if (approved) {
      return {
        kind: "approved-image",
        dataUrl: approved.dataUrl,
        attempts: outcomes.filter((outcome) => outcome.dataUrl || outcome.review).length,
        model: approved.model,
        reviews,
      };
    }

    const reviewedCount = outcomes.filter((outcome) => outcome.review).length;
    if (reviewedCount === 0) {
      return {
        kind: "unavailable",
        attempts: 0,
        model: DEFAULT_ARTWORK_MODEL,
        reviews,
        error: outcomes.map((outcome) => outcome.error).filter(Boolean).join(" | ") || "Both private preview candidates were unavailable.",
      };
    }

    return {
      kind: "rejected",
      attempts: reviewedCount,
      model: DEFAULT_ARTWORK_MODEL,
      reviews,
    };
  }

  for (let candidate = 1; candidate <= maxCandidates; candidate += 1) {'''
replace_once(quality, anchor, insert)

test = "tests/prePaymentPreviewQuality.test.ts"
replace_once(
    test,
    'import { encodePng, readPngSize } from "../server/aiFirst/png";',
    'import { decodePng, encodePng, readPngSize } from "../server/aiFirst/png";',
)

marker = '''  it("keeps a rejected first candidate private and returns only the approved correction", async () => {'''
new_test = '''  it("renders two private text-first candidates in parallel and returns only the stronger approved result", async () => {
    let started = 0;
    let release!: () => void;
    const bothStarted = new Promise<void>((resolve) => { release = resolve; });
    const generateImage = vi.fn(async () => {
      const candidate = ++started;
      if (started === 2) release();
      await bothStarted;
      const bytes = generatedPng(candidate);
      return {
        bytes,
        dataUrl: `data:image/png;base64,${bytes.toString("base64")}`,
        durationMs: 100,
      };
    });
    const runVision = vi.fn(async (input: { bytes: Buffer }) => {
      const fill = decodePng(input.bytes).rgb[0];
      return vision(fill === 2, fill === 2 ? "strong alternate" : "first take rejected");
    });

    const result = await generateQualityLockedPreview(event, {
      generateImage,
      runTier1: () => tier1(true),
      runVision: runVision as never,
      maxCandidates: 2,
      parallelCandidates: true,
    });

    expect(result.kind).toBe("approved-image");
    expect(generateImage).toHaveBeenCalledTimes(2);
    expect(runVision).toHaveBeenCalledTimes(2);
    expect(result.attempts).toBe(2);
    expect(result.reviews).toHaveLength(2);
    expect(generateImage.mock.calls[1][0].prompt).toContain("PRIVATE ALTERNATE TAKE");
    if (result.kind !== "approved-image") throw new Error("expected approved image");
    expect(decodePng(Buffer.from(result.dataUrl.split(",")[1], "base64")).rgb[0]).toBe(2);
  });

  it("keeps a rejected first candidate private and returns only the approved correction", async () => {'''
replace_once(test, marker, new_test)

print("parallel best-of-two preview reliability applied")

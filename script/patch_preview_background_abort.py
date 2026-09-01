from pathlib import Path


def one(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected one match in {path}, found {count}: {old[:140]!r}")
    file.write_text(text.replace(old, new, 1))


# ---------------------------------------------------------------------------
# Exact customer-preview pipeline: carry a real abort signal through OpenAI
# generation and Anthropic review; make the pre-classification direction proof
# use the host's theme name instead of collapsing to a generic cue.
# ---------------------------------------------------------------------------
quality = "server/prePaymentPreviewQuality.ts"
one(
    quality,
    ''' * properties can be classified here only when a caller deliberately invokes
 * this asynchronous function. The launch customer route does not call it.
 */''',
    ''' * properties can be classified here only when a caller deliberately invokes
 * this asynchronous function. The customer POST schedules it once in the
 * background; pure GET/read paths never call it.
 */''',
)
one(
    quality,
    '''  const fallbackCue = event.eventType?.trim() || "Personal celebration";
  const cues = unique([...(named?.cues ?? []), ...detectedCues, fallbackCue]).slice(0, 4);''',
    '''  const themeCue = event.themeName?.trim() || "";
  const fallbackCue = event.eventType?.trim() || "Personal celebration";
  const cues = unique([...(named?.cues ?? []), themeCue, ...detectedCues, fallbackCue]).slice(0, 4);''',
)
one(
    quality,
    '''    headline: named?.label || cues[0],''',
    '''    headline: named?.label || themeCue || cues[0],''',
)
one(
    quality,
    '''  attemptRetention?: PreviewQualityAttemptRetention;
}''',
    '''  attemptRetention?: PreviewQualityAttemptRetention;
  /** Aborts active image generation and vision review at the route deadline. */
  signal?: AbortSignal;
}''',
)
one(
    quality,
    '''  for (let candidate = 1; candidate <= maxCandidates; candidate += 1) {
    const model = modelForCandidate(candidate);''',
    '''  for (let candidate = 1; candidate <= maxCandidates; candidate += 1) {
    if (dependencies.signal?.aborted) {
      return {
        kind: "unavailable",
        attempts: candidate - 1,
        model: lastModel,
        reviews,
        error: dependencies.signal.reason instanceof Error
          ? dependencies.signal.reason.message
          : "Preview generation was cancelled.",
      };
    }
    const model = modelForCandidate(candidate);''',
)
one(
    quality,
    '''        referenceImages: dependencies.referenceImages,
      });''',
    '''        referenceImages: dependencies.referenceImages,
        signal: dependencies.signal,
      });''',
)
one(
    quality,
    '''        vision = await runVision({ bytes: reviewedBytes, concept, brief, reviewMode: "teaser" });''',
    '''        vision = await runVision({
          bytes: reviewedBytes,
          concept,
          brief,
          reviewMode: "teaser",
          signal: dependencies.signal,
        });''',
)

vision = "server/aiFirst/visionGate.ts"
one(
    vision,
    '''  /** Invitation is the default; teaser reviews exact standalone pixels. */
  reviewMode?: "invitation" | "teaser";
}''',
    '''  /** Invitation is the default; teaser reviews exact standalone pixels. */
  reviewMode?: "invitation" | "teaser";
  signal?: AbortSignal;
}''',
)
one(
    vision,
    '''  const client = input.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const { brief, concept } = input;''',
    '''  if (input.signal?.aborted) {
    return {
      scores: empty,
      requiredPresent: [],
      excludedFound: [],
      notes: input.signal.reason instanceof Error
        ? input.signal.reason.message
        : "vision review was cancelled",
      passed: false,
      failureCodes: [],
      unavailable: true,
      durationMs: Date.now() - started,
      usage: { inputTokens: 0, outputTokens: 0 },
    };
  }

  const client = input.client ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const { brief, concept } = input;''',
)
one(
    vision,
    '''      ],
    });
    raw = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");''',
    '''      ],
    }, { signal: input.signal });
    raw = response.content.map((b) => (b.type === "text" ? b.text : "")).join("");''',
)

# ---------------------------------------------------------------------------
# Routes: every provider path is background work; arbitrary named-theme
# classification happens exactly once after the explicit action, never on GET;
# an AbortController stops OpenAI/vision work at the deadline; a quality-marked
# image is serveable even when its arbitrary name is not in the curated regexes.
# ---------------------------------------------------------------------------
routes = "server/prePaymentPreviewQualityRoutes.ts"
one(
    routes,
    '''interface AutomaticNamedJobDependencies {
  store: PrePaymentPreviewQualityStorage;''',
    '''interface AutomaticClassifiedJobDependencies {
  store: PrePaymentPreviewQualityStorage;
  event: Event;
  mode: PrePaymentPreviewMode;
  namedAutoEnabled: boolean;
  classifyNamedReference: NonNullable<PrePaymentPreviewQualityRouteDependencies["classifyNamedReference"]>;
  resolveNamedReference: typeof resolveNamedCreativeReference;
  generate: NonNullable<PrePaymentPreviewQualityRouteDependencies["generate"]>;
  artworkAttemptStore: AiFirstArtworkAttemptStore;
  now: () => number;
  jobTimeoutMs: number;
}

interface AutomaticNamedJobDependencies {
  store: PrePaymentPreviewQualityStorage;''',
)
one(
    routes,
    '''  const jobStartedAt = Date.now();
  const remainingMs = () => Math.max(1, jobTimeoutMs - (Date.now() - jobStartedAt));
  try {''',
    '''  const jobStartedAt = Date.now();
  const remainingMs = () => Math.max(1, jobTimeoutMs - (Date.now() - jobStartedAt));
  const abortController = new AbortController();
  const abortTimer = setTimeout(() => {
    abortController.abort(new PrePaymentPreviewDeadlineError("Artwork generation and private review"));
  }, Math.max(1, jobTimeoutMs));
  try {''',
)
one(
    routes,
    '''      namedReference,
      attemptRetention: { store: artworkAttemptStore, eventId: event.id, ownerToken: event.ownerToken },
    }), remainingMs(), "Artwork generation and private review");''',
    '''      namedReference,
      attemptRetention: { store: artworkAttemptStore, eventId: event.id, ownerToken: event.ownerToken },
      signal: abortController.signal,
    }), remainingMs(), "Artwork generation and private review");''',
)
one(
    routes,
    '''    console.error("[prepayment-preview] automatic named-theme background task failed closed:", error);
  }
}

async function readyResponse(''',
    '''    console.error("[prepayment-preview] automatic named-theme background task failed closed:", error);
  } finally {
    clearTimeout(abortTimer);
  }
}

async function runAutomaticClassifiedPreviewJob({
  store,
  event,
  mode,
  namedAutoEnabled,
  classifyNamedReference,
  resolveNamedReference,
  generate,
  artworkAttemptStore,
  now,
  jobTimeoutMs,
}: AutomaticClassifiedJobDependencies): Promise<void> {
  const startedAt = Date.now();
  const remainingMs = () => Math.max(1, jobTimeoutMs - (Date.now() - startedAt));
  let namedReference: NamedCreativeReference | null = null;
  try {
    namedReference = await withPreviewDeadline(
      classifyNamedReference(eventNamedReferenceBrief(event)),
      Math.min(GENERAL_CLASSIFIER_TIMEOUT_MS, remainingMs()),
      "Named-theme recognition",
    );
  } catch (error) {
    console.warn("[prepayment-preview] one-shot background named-theme recognition failed closed:", error);
  }

  if (namedReference) {
    if (namedAutoEnabled) {
      await runAutomaticNamedPreviewJob({
        store,
        event,
        namedReference,
        resolveNamedReference,
        generate,
        artworkAttemptStore,
        now,
        jobTimeoutMs: remainingMs(),
      });
      return;
    }
    await persistDirectionCard(store, event, now(), namedReference);
    return;
  }

  if (mode !== "quality-image") {
    await persistDirectionCard(store, event, now());
    return;
  }

  const abortController = new AbortController();
  const abortTimer = setTimeout(() => {
    abortController.abort(new PrePaymentPreviewDeadlineError("Artwork generation and private review"));
  }, remainingMs());
  try {
    const result = await withPreviewDeadline(generate(event, {
      quality: "medium",
      maxCandidates: 1,
      namedReference: null,
      attemptRetention: { store: artworkAttemptStore, eventId: event.id, ownerToken: event.ownerToken },
      signal: abortController.signal,
    }), remainingMs(), "Artwork generation and private review");

    if (result.kind === "approved-image"
      && await persistApprovedImage(store, event, result.dataUrl, now())) {
      return;
    }
    await persistDirectionCard(store, event, now());
    console.warn(`[prepayment-preview] ${JSON.stringify({
      eventId: event.id,
      kind: result.kind,
      model: result.model,
      privateCandidates: result.attempts,
      error: result.kind === "unavailable" ? result.error : undefined,
      rejectionSummary: summarizeRejectionForLog(result.reviews),
    })}`);
  } catch (error) {
    await persistDirectionCard(store, event, now());
    console.error("[prepayment-preview] classified background preview failed closed:", error);
  } finally {
    clearTimeout(abortTimer);
  }
}

async function readyResponse(''',
)

# Replace the POST decision section from classification through the old inline
# generic generation with one background-only flow.
start = '''    let namedReference = namedReferenceForEventSync(event);
    if (!namedReference && currentKind === "none" && event.prePaymentPreviewAttempts === 0) {
      try {
        namedReference = await withPreviewDeadline(
          classifyNamedReference(eventNamedReferenceBrief(event)),
          Math.min(GENERAL_CLASSIFIER_TIMEOUT_MS, jobTimeoutMs),
          "Named-theme recognition",
        );
      } catch (error) {
        console.warn("[prepayment-preview] one-shot named-theme recognition failed closed:", error);
        namedReference = null;
      }
    }

    if (namedReference) {'''
replacement = '''    // A previously completed safe asset is idempotent for every theme type.
    // Quality-approved arbitrary named themes do not need to be rediscovered by
    // the curated read-only detector in order to remain visible.
    if (currentKind === "approved-image" || currentKind === "reference-board") {
      return res.json(await readyResponse(event, mode, namedAutoEnabled, timestamp));
    }

    if (hasHostReference) {
      event = await persistReferenceBoard(store, event, referenceImages, timestamp);
      return res.json(await readyResponse(event, mode, namedAutoEnabled, timestamp));
    }

    const namedReference = namedReferenceForEventSync(event);

    if (namedReference) {'''
one(routes, start, replacement)

# Host reference and completed-asset branches are now common to all themes.
one(
    routes,
    '''      if (currentKind === "approved-image" && namedAutoEnabled && !hasHostReference) {
        return res.json(await readyResponse(event, mode, namedAutoEnabled, timestamp));
      }

      if (currentKind === "reference-board" && !hasHostReference) {
        return res.json(await readyResponse(event, mode, namedAutoEnabled, timestamp));
      }

      // This remains only as a backward-compatible optional override. The
      // normal screen no longer asks the customer to research or upload.
      if (hasHostReference) {
        event = await persistReferenceBoard(store, event, referenceImages, timestamp);
        return res.json(await readyResponse(event, mode, namedAutoEnabled, timestamp));
      }

''',
    '',
)

old_generic = '''    // Original and generic themes retain the existing explicit release gate.
    if (currentKind === "approved-image" && mode === "quality-image") {
      return res.json(await readyResponse(event, mode, namedAutoEnabled, timestamp));
    }
    if (currentKind === "direction-card" && mode !== "quality-image") {
      return res.json(await readyResponse(event, mode, namedAutoEnabled, timestamp));
    }

    if (mode !== "quality-image") {
      event = await persistDirectionCard(store, event, timestamp);
      return res.json(await readyResponse(event, mode, namedAutoEnabled, timestamp));
    }

    const allowance = canAttemptPrePaymentPreview(event);
    if (!allowance.ok) {
      event = await persistDirectionCard(store, event, timestamp);
      return res.json(await readyResponse(event, mode, namedAutoEnabled, timestamp));
    }

    event = await reservePreviewAttempt(store, event, timestamp);

    let result: Awaited<ReturnType<typeof generateQualityLockedPreview>>;
    try {
      result = await withPreviewDeadline(generate(event, {
        referenceImages,
        maxCandidates: 2,
        namedReference,
        attemptRetention: { store: artworkAttemptStore, eventId: event.id, ownerToken: event.ownerToken },
      }), jobTimeoutMs, "Artwork generation and private review");
    } catch (error) {
      event = await persistDirectionCard(store, event, now());
      console.error("[prepayment-preview] private quality pipeline failed closed:", error);
      return res.json(await readyResponse(event, mode, namedAutoEnabled, now()));
    }

    if (result.kind === "approved-image"
      && await persistApprovedImage(store, event, result.dataUrl, now())) {
      console.info(`[prepayment-preview] ${JSON.stringify({
        eventId: event.id,
        kind: result.kind,
        model: result.model,
        privateCandidates: result.attempts,
      })}`);
      const completed = await store.getEventByOwnerToken(req.params.ownerToken) ?? event;
      return res.json(await readyResponse(completed, mode, namedAutoEnabled, now()));
    }

    event = await persistDirectionCard(store, event, now());
    console.warn(`[prepayment-preview] ${JSON.stringify({
      eventId: event.id,
      kind: result.kind,
      model: result.model,
      privateCandidates: result.attempts,
      error: result.kind === "unavailable" ? result.error : undefined,
      // Full per-candidate tier1/vision evidence is durably retained in
      // artworkAttemptStore (see /ai-first/review/attempts); this compact
      // summary just keeps the last candidate's reason legible inline.
      rejectionSummary: summarizeRejectionForLog(result.reviews),
    })}`);
    return res.json(await readyResponse(event, mode, namedAutoEnabled, now()));'''
new_generic = '''    if (currentKind === "direction-card") {
      return res.json(await readyResponse(event, mode, namedAutoEnabled, timestamp));
    }

    // Unknown names and original themes are classified once after the explicit
    // action. The HTTP response is immediate; classification, optional visual
    // research, generation and review all happen in the scheduled job.
    if (!namedAutoEnabled && mode !== "quality-image") {
      event = await persistDirectionCard(store, event, timestamp);
      return res.json(await readyResponse(event, mode, namedAutoEnabled, timestamp));
    }

    const allowance = canAttemptPrePaymentPreview(event);
    if (!allowance.ok) {
      event = await persistDirectionCard(store, event, timestamp);
      return res.json(await readyResponse(event, mode, namedAutoEnabled, timestamp));
    }

    const reservedEvent = await reservePreviewAttempt(store, event, timestamp);
    schedule(() => runAutomaticClassifiedPreviewJob({
      store,
      event: reservedEvent,
      mode,
      namedAutoEnabled,
      classifyNamedReference,
      resolveNamedReference,
      generate,
      artworkAttemptStore,
      now,
      jobTimeoutMs,
    }));

    res.setHeader("Retry-After", String(Math.ceil(POLL_AFTER_MS / 1000)));
    return res.status(202).json(await readiness(reservedEvent, mode, namedAutoEnabled, timestamp));'''
one(routes, old_generic, new_generic)

# Quality-approved bytes have already passed the current gate and cutoff. The
# asset route must not hide arbitrary named themes just because GET is curated-
# only and therefore cannot synchronously rediscover their label.
one(
    routes,
    '''    const approvedPayload = qualityApprovedPayload(stored);
    const approvedLaneEnabled = namedReference ? namedAutoEnabled : mode === "quality-image";
    if (!approvedPayload || !imageIsCurrent(event) || !approvedLaneEnabled) {''',
    '''    const approvedPayload = qualityApprovedPayload(stored);
    if (!approvedPayload || !imageIsCurrent(event)) {''',
)

# ---------------------------------------------------------------------------
# Tests: arbitrary classification is deferred until the scheduled job; abort is
# forwarded; a general named approved image remains serveable from a pure GET.
# ---------------------------------------------------------------------------
test = "tests/prePaymentPreviewQualityRoutes.test.ts"
one(
    test,
    '''    expect(generate.mock.calls[0][1]).toEqual(expect.objectContaining({
      inspirationNotes: "Official Blippi and Meekah identity references",
      quality: "high",
      maxCandidates: 2,
      namedReference: expect.objectContaining({ id: "blippi-meekah" }),
    }));''',
    '''    expect(generate.mock.calls[0][1]).toEqual(expect.objectContaining({
      inspirationNotes: "Official Blippi and Meekah identity references",
      quality: "high",
      maxCandidates: 2,
      namedReference: expect.objectContaining({ id: "blippi-meekah" }),
      signal: expect.any(AbortSignal),
    }));''',
)
one(
    test,
    '''  it("classifies an original theme once on the explicit action, then continues safely when it is not named IP", async () => {
    stored = genericEvent();

    const response = await request(makeApp({ mode: "direction-card" }))
      .post(`/api/events/owner/${OWNER}/prepayment-preview`)
      .send({ email: "host@example.com" });

    expect(response.status).toBe(200);
    expect(response.body.kind).toBe("direction-card");
    expect(classifyNamedReference).toHaveBeenCalledTimes(1);
    expect(resolveNamedReference).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
    expect(stored.prePaymentPreviewAttempts).toBe(0);
  });''',
    '''  it("returns immediately, then classifies an original theme once in the scheduled job", async () => {
    stored = genericEvent();

    const response = await request(makeApp({ mode: "direction-card" }))
      .post(`/api/events/owner/${OWNER}/prepayment-preview`)
      .send({ email: "host@example.com" });

    expect(response.status).toBe(202);
    expect(response.body.kind).toBe("none");
    expect(response.body.directionCard.headline).toContain("Candlelit");
    expect(classifyNamedReference).not.toHaveBeenCalled();
    expect(schedule).toHaveBeenCalledTimes(1);

    await runScheduledTask();
    expect(classifyNamedReference).toHaveBeenCalledTimes(1);
    expect(resolveNamedReference).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(stored.prePaymentPreviewAttempts).toBe(1);
    expect(stored.prePaymentPreviewUrl).toMatch(/^data:image\/svg\+xml;base64,/);
  });''',
)
one(
    test,
    '''    expect(response.status).toBe(202);
    expect(response.body.directionCard.headline).toBe("Sesame Street");
    expect(classifyNamedReference).toHaveBeenCalledTimes(1);
    await runScheduledTask();
    expect(decodedStoredSvg()).toContain("Sesame Street");''',
    '''    expect(response.status).toBe(202);
    expect(response.body.directionCard.headline).toBe("Sesame Street");
    expect(classifyNamedReference).not.toHaveBeenCalled();

    const pollingBeforeWork = await request(makeApp())
      .get(`/api/events/owner/${OWNER}/prepayment-preview/readiness`);
    expect(pollingBeforeWork.status).toBe(200);
    expect(classifyNamedReference).not.toHaveBeenCalled();

    await runScheduledTask();
    expect(classifyNamedReference).toHaveBeenCalledTimes(1);
    expect(decodedStoredSvg()).toContain("Sesame Street");''',
)
one(
    test,
    '''    expect(classifyNamedReference).toHaveBeenCalledTimes(1);
  });

  it("keeps original themes behind the separate quality-image release gate",''',
    '''    expect(classifyNamedReference).toHaveBeenCalledTimes(1);
  });

  it("serves a quality-approved arbitrary named theme without reclassifying on GET", async () => {
    stored = {
      ...genericEvent(),
      eventName: "Ella's Sesame Street Party",
      themeName: "Sesame Street",
      prePaymentPreviewUrl: `${QUALITY_PREFIX}${APPROVED_BYTES.toString("base64")}`,
      prePaymentPreviewUsedAt: NOW,
      prePaymentPreviewAttempts: 1,
    } as unknown as Event;

    const response = await request(makeApp({ mode: "direction-card" }))
      .get(`/api/events/owner/${OWNER}/prepayment-preview/asset`);

    expect(response.status).toBe(200);
    expect(Buffer.compare(response.body, APPROVED_BYTES)).toBe(0);
    expect(classifyNamedReference).not.toHaveBeenCalled();
  });

  it("keeps original themes behind the separate quality-image release gate",''',
)

quality_test = "tests/prePaymentPreviewQuality.test.ts"
one(
    quality_test,
    '''    expect(runVision.mock.calls[0][0].reviewMode).toBe("teaser");
  });''',
    '''    expect(runVision.mock.calls[0][0].reviewMode).toBe("teaser");
  });

  it("forwards one AbortSignal to image generation and vision review", async () => {
    const sourceBytes = generatedPng(10);
    const controller = new AbortController();
    const generateImage = vi.fn(async () => ({
      bytes: sourceBytes,
      dataUrl: `data:image/png;base64,${sourceBytes.toString("base64")}`,
      durationMs: 10,
    }));
    const runVision = vi.fn(async () => vision(true));

    const result = await generateQualityLockedPreview(event, {
      generateImage,
      runTier1: () => tier1(true),
      runVision,
      maxCandidates: 1,
      signal: controller.signal,
    });

    expect(result.kind).toBe("approved-image");
    expect(generateImage.mock.calls[0][0].signal).toBe(controller.signal);
    expect(runVision.mock.calls[0][0].signal).toBe(controller.signal);
  });''',
)

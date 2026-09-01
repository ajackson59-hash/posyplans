from pathlib import Path


def one(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected one match in {path}, found {count}: {old[:120]!r}")
    file.write_text(text.replace(old, new, 1))


routes = "server/prePaymentPreviewQualityRoutes.ts"
one(
    routes,
    '''  buildDirectionCard,
  detectNamedCreativeReferenceSync,
  directionCardDataUrl,''',
    '''  buildDirectionCard,
  detectNamedCreativeReference,
  detectNamedCreativeReferenceSync,
  directionCardDataUrl,''',
)
one(
    routes,
    '''  autoNamedEnabled?: () => boolean;
  resolveNamedReference?: typeof resolveNamedCreativeReference;''',
    '''  autoNamedEnabled?: () => boolean;
  classifyNamedReference?: (text: string) => Promise<NamedCreativeReference | null>;
  resolveNamedReference?: typeof resolveNamedCreativeReference;''',
)
one(
    routes,
    '''  schedule?: PreviewBackgroundScheduler;
  now?: () => number;''',
    '''  schedule?: PreviewBackgroundScheduler;
  now?: () => number;
  jobTimeoutMs?: number;''',
)
one(
    routes,
    '''const QUALITY_APPROVED_PNG_PREFIX = "data:image/png;posy-quality-approved;base64,";
const STANDARD_PNG_PREFIX = "data:image/png;base64,";
const BACKGROUND_STALE_MS = 6 * 60 * 1000;
const POLL_AFTER_MS = 2500;''',
    '''const QUALITY_APPROVED_PNG_PREFIX = "data:image/png;posy-quality-approved;base64,";
const STANDARD_PNG_PREFIX = "data:image/png;base64,";
export const PREPAYMENT_PREVIEW_JOB_TIMEOUT_MS = 60_000;
const GENERAL_CLASSIFIER_TIMEOUT_MS = 7_500;
const REFERENCE_RESOLUTION_TIMEOUT_MS = 12_000;
const BACKGROUND_STALE_MS = PREPAYMENT_PREVIEW_JOB_TIMEOUT_MS + 15_000;
const POLL_AFTER_MS = 2500;

class PrePaymentPreviewDeadlineError extends Error {
  constructor(stage: string) {
    super(`${stage} exceeded Posy's preview deadline`);
    this.name = "PrePaymentPreviewDeadlineError";
  }
}

function withPreviewDeadline<T>(promise: Promise<T>, timeoutMs: number, stage: string): Promise<T> {
  const boundedMs = Math.max(1, Math.floor(timeoutMs));
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new PrePaymentPreviewDeadlineError(stage)), boundedMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}''',
)
one(
    routes,
    '''async function readiness(
  event: Event,
  mode: PrePaymentPreviewMode,
  autoNamedEnabled: boolean,
  timestamp: number,
): Promise<ReadinessResponse> {
  // Curated-only, synchronous, network-free — this runs on every readiness
  // poll (every 2.5s while generating), so it must never await a model call.
  const card = buildDirectionCard(event);''',
    '''async function readiness(
  event: Event,
  mode: PrePaymentPreviewMode,
  autoNamedEnabled: boolean,
  timestamp: number,
  resolvedNamed?: NamedCreativeReference | null,
): Promise<ReadinessResponse> {
  // Curated-only, synchronous and network-free on GET. The explicit POST may
  // pass its one already-resolved general classification into this response.
  const card = buildDirectionCard(event, resolvedNamed);''',
)
one(
    routes,
    '''  artworkAttemptStore: AiFirstArtworkAttemptStore;
  now: () => number;''',
    '''  artworkAttemptStore: AiFirstArtworkAttemptStore;
  now: () => number;
  jobTimeoutMs: number;''',
)
one(
    routes,
    '''  artworkAttemptStore,
  now,
}: AutomaticNamedJobDependencies): Promise<void> {
  try {
    let resolved: ResolvedNamedReference | null = null;
    try {
      resolved = await resolveNamedReference(event, namedReference);''',
    '''  artworkAttemptStore,
  now,
  jobTimeoutMs,
}: AutomaticNamedJobDependencies): Promise<void> {
  const jobStartedAt = Date.now();
  const remainingMs = () => Math.max(1, jobTimeoutMs - (Date.now() - jobStartedAt));
  try {
    let resolved: ResolvedNamedReference | null = null;
    try {
      resolved = await withPreviewDeadline(
        resolveNamedReference(event, namedReference),
        Math.min(REFERENCE_RESOLUTION_TIMEOUT_MS, remainingMs()),
        "Named-theme visual research",
      );''',
)
one(
    routes,
    '''    const result = await generate(event, {
      inspirationNotes: resolved.notes,
      referenceImages: resolved.images,
      quality: "high",
      maxCandidates: 2,
      namedReference,
      attemptRetention: { store: artworkAttemptStore, eventId: event.id, ownerToken: event.ownerToken },
    });''',
    '''    const result = await withPreviewDeadline(generate(event, {
      inspirationNotes: resolved.notes,
      referenceImages: resolved.images,
      quality: "high",
      maxCandidates: 2,
      namedReference,
      attemptRetention: { store: artworkAttemptStore, eventId: event.id, ownerToken: event.ownerToken },
    }), remainingMs(), "Artwork generation and private review");''',
)
one(
    routes,
    '''async function readyResponse(event: Event, mode: PrePaymentPreviewMode, autoNamed: boolean, timestamp: number) {
  return readiness(event, mode, autoNamed, timestamp);
}''',
    '''async function readyResponse(
  event: Event,
  mode: PrePaymentPreviewMode,
  autoNamed: boolean,
  timestamp: number,
  resolvedNamed?: NamedCreativeReference | null,
) {
  return readiness(event, mode, autoNamed, timestamp, resolvedNamed);
}''',
)
one(
    routes,
    '''  const autoNamedEnabled = dependencies.autoNamedEnabled
    ?? (() => namedReferenceAutoResolutionEnabled());
  const resolveNamedReference = dependencies.resolveNamedReference
    ?? resolveNamedCreativeReference;''',
    '''  const autoNamedEnabled = dependencies.autoNamedEnabled
    ?? (() => namedReferenceAutoResolutionEnabled());
  const classifyNamedReference = dependencies.classifyNamedReference
    ?? ((text: string) => detectNamedCreativeReference(text));
  const resolveNamedReference = dependencies.resolveNamedReference
    ?? resolveNamedCreativeReference;''',
)
one(
    routes,
    '''  const now = dependencies.now ?? Date.now;
  const artworkAttemptStore = dependencies.artworkAttemptStore ?? new DbArtworkAttemptStore();''',
    '''  const now = dependencies.now ?? Date.now;
  const jobTimeoutMs = dependencies.jobTimeoutMs ?? PREPAYMENT_PREVIEW_JOB_TIMEOUT_MS;
  const artworkAttemptStore = dependencies.artworkAttemptStore ?? new DbArtworkAttemptStore();''',
)
one(
    routes,
    '''    const hasHostReference = referenceImages.length > 0;
    // Launch-safe: only the curated, synchronous detector participates in a
    // customer request. The arbitrary LLM classifier remains available for a
    // future explicitly budgeted workflow, but is not reachable from this
    // route and therefore cannot add surprise latency or spend.
    const namedReference = namedReferenceForEventSync(event);

    if (backgroundIsStale(event, timestamp)) {
      event = await persistDirectionCard(store, event, timestamp);
      currentKind = "direction-card";
    }

    if (namedReference) {''',
    '''    const hasHostReference = referenceImages.length > 0;

    if (backgroundIsStale(event, timestamp)) {
      event = await persistDirectionCard(store, event, timestamp);
      currentKind = "direction-card";
    }

    // Treat repeated submits as the same in-flight request before attempting
    // any general classification. This keeps arbitrary named themes one-shot
    // even across duplicate browser requests.
    if (currentKind === "none" && event.prePaymentPreviewAttempts > 0) {
      res.setHeader("Retry-After", String(Math.ceil(POLL_AFTER_MS / 1000)));
      return res.status(202).json(await readiness(event, mode, namedAutoEnabled, timestamp));
    }
    if (currentKind === "direction-card" && event.prePaymentPreviewAttempts > 0) {
      return res.json(await readyResponse(event, mode, namedAutoEnabled, timestamp));
    }

    let namedReference = namedReferenceForEventSync(event);
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

    if (namedReference) {''',
)
one(
    routes,
    '''      if (currentKind === "none" && event.prePaymentPreviewAttempts > 0) {
        res.setHeader("Retry-After", String(Math.ceil(POLL_AFTER_MS / 1000)));
        return res.status(202).json(await readiness(event, mode, namedAutoEnabled, timestamp));
      }

      if (currentKind === "direction-card" && event.prePaymentPreviewAttempts > 0) {
        return res.json(await readyResponse(event, mode, namedAutoEnabled, timestamp));
      }

''',
    '',
)
one(
    routes,
    '''      if (!namedAutoEnabled) {
        if (currentKind !== "direction-card") {
          event = await persistDirectionCard(store, event, timestamp);
        }
        return res.json(await readyResponse(event, mode, namedAutoEnabled, timestamp));
      }''',
    '''      if (!namedAutoEnabled) {
        if (currentKind !== "direction-card") {
          event = await persistDirectionCard(store, event, timestamp, namedReference);
        }
        return res.json(await readyResponse(event, mode, namedAutoEnabled, timestamp, namedReference));
      }''',
)
one(
    routes,
    '''      if (!allowance.ok) {
        if (currentKind !== "direction-card") {
          event = await persistDirectionCard(store, event, timestamp);
        }
        return res.json(await readyResponse(event, mode, namedAutoEnabled, timestamp));
      }

      const reservedEvent = await reservePreviewAttempt(store, event, timestamp);''',
    '''      if (!allowance.ok) {
        if (currentKind !== "direction-card") {
          event = await persistDirectionCard(store, event, timestamp, namedReference);
        }
        return res.json(await readyResponse(event, mode, namedAutoEnabled, timestamp, namedReference));
      }

      const reservedEvent = await reservePreviewAttempt(store, event, timestamp);''',
)
one(
    routes,
    '''        artworkAttemptStore,
        now,
      }));

      res.setHeader("Retry-After", String(Math.ceil(POLL_AFTER_MS / 1000)));
      return res.status(202).json(await readiness(reservedEvent, mode, namedAutoEnabled, timestamp));''',
    '''        artworkAttemptStore,
        now,
        jobTimeoutMs,
      }));

      res.setHeader("Retry-After", String(Math.ceil(POLL_AFTER_MS / 1000)));
      return res.status(202).json(await readiness(reservedEvent, mode, namedAutoEnabled, timestamp, namedReference));''',
)
one(
    routes,
    '''      result = await generate(event, {
        referenceImages,
        maxCandidates: 2,
        namedReference,
        attemptRetention: { store: artworkAttemptStore, eventId: event.id, ownerToken: event.ownerToken },
      });''',
    '''      result = await withPreviewDeadline(generate(event, {
        referenceImages,
        maxCandidates: 2,
        namedReference,
        attemptRetention: { store: artworkAttemptStore, eventId: event.id, ownerToken: event.ownerToken },
      }), jobTimeoutMs, "Artwork generation and private review");''',
)

test = "tests/prePaymentPreviewQualityRoutes.test.ts"
one(
    test,
    '''const generate = vi.fn();
const resolveNamedReference = vi.fn();''',
    '''const generate = vi.fn();
const classifyNamedReference = vi.fn();
const resolveNamedReference = vi.fn();''',
)
one(
    test,
    '''  unlocked?: boolean;
} = {}) {''',
    '''  unlocked?: boolean;
  jobTimeoutMs?: number;
} = {}) {''',
)
one(
    test,
    '''    autoNamedEnabled: () => options.autoNamed ?? true,
    resolveNamedReference,''',
    '''    autoNamedEnabled: () => options.autoNamed ?? true,
    classifyNamedReference,
    resolveNamedReference,''',
)
one(
    test,
    '''    now: () => NOW,
  });''',
    '''    now: () => NOW,
    jobTimeoutMs: options.jobTimeoutMs,
  });''',
)
one(
    test,
    '''  generate.mockReset();
  resolveNamedReference.mockReset();''',
    '''  generate.mockReset();
  classifyNamedReference.mockReset();
  classifyNamedReference.mockResolvedValue(null);
  resolveNamedReference.mockReset();''',
)
one(
    test,
    '''  it("returns original themes immediately without invoking the arbitrary paid classifier", async () => {
    stored = genericEvent();

    const response = await request(makeApp({ mode: "direction-card" }))
      .post(`/api/events/owner/${OWNER}/prepayment-preview`)
      .send({ email: "host@example.com" });

    expect(response.status).toBe(200);
    expect(response.body.kind).toBe("direction-card");
    expect(resolveNamedReference).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
    expect(stored.prePaymentPreviewAttempts).toBe(0);
  });''',
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
  });

  it("recognizes an arbitrary named world once on POST and never reclassifies it from GET polling", async () => {
    stored = {
      ...stored,
      eventName: "Ella's Sesame Street Party",
      themeName: "Sesame Street",
      vibeDescription: "Sesame Street characters at a neighborhood block party with bubbles",
    } as unknown as Event;
    const sesame = {
      id: "named-theme-sesame-street",
      label: "Sesame Street",
      trigger: /sesame street/i,
      cues: ["Sesame Street", "Neighborhood friends", "Playful learning", "Block-party joy"],
      palette: ["#1b5e9b", "#f2c230", "#f7f1e5", "#d84f45"],
      requirements: ["The Sesame Street identity is unmistakable through its recognizable neighborhood character world."],
    };
    classifyNamedReference.mockResolvedValue(sesame);
    resolveNamedReference.mockResolvedValue(null);

    const response = await request(makeApp())
      .post(`/api/events/owner/${OWNER}/prepayment-preview`)
      .send({ email: "host@example.com" });

    expect(response.status).toBe(202);
    expect(response.body.directionCard.headline).toBe("Sesame Street");
    expect(classifyNamedReference).toHaveBeenCalledTimes(1);
    await runScheduledTask();
    expect(decodedStoredSvg()).toContain("Sesame Street");

    const ready = await request(makeApp())
      .get(`/api/events/owner/${OWNER}/prepayment-preview/readiness`);
    expect(ready.status).toBe(200);
    expect(classifyNamedReference).toHaveBeenCalledTimes(1);
  });''',
)
one(
    test,
    '''  it("keeps rejected named-theme candidates private and shows the reliable direction", async () => {''',
    '''  it("falls back within the bounded deadline instead of making the customer wait indefinitely", async () => {
    resolveNamedReference.mockResolvedValue(automaticResolution());
    generate.mockImplementation(() => new Promise(() => undefined));

    const response = await request(makeApp({ jobTimeoutMs: 5 }))
      .post(`/api/events/owner/${OWNER}/prepayment-preview`)
      .send({ email: "host@example.com" });

    expect(response.status).toBe(202);
    await runScheduledTask();
    expect(stored.prePaymentPreviewUrl).toMatch(/^data:image\/svg\+xml;base64,/);
  });

  it("keeps rejected named-theme candidates private and shows the reliable direction", async () => {''',
)

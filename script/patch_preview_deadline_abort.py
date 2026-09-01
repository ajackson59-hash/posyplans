from pathlib import Path


def one(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected one match in {path}, found {count}: {old[:160]!r}")
    file.write_text(text.replace(old, new, 1))


routes = "server/prePaymentPreviewQualityRoutes.ts"

one(
    routes,
    '''function withPreviewDeadline<T>(promise: Promise<T>, timeoutMs: number, stage: string): Promise<T> {
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
    '''function withPreviewDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
  stage: string,
  onTimeout?: (error: PrePaymentPreviewDeadlineError) => void,
): Promise<T> {
  const boundedMs = Math.max(1, Math.floor(timeoutMs));
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new PrePaymentPreviewDeadlineError(stage);
      onTimeout?.(error);
      reject(error);
    }, boundedMs);
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
    '''  const jobStartedAt = Date.now();
  const remainingMs = () => Math.max(1, jobTimeoutMs - (Date.now() - jobStartedAt));
  const abortController = new AbortController();
  const abortTimer = setTimeout(() => {
    abortController.abort(new PrePaymentPreviewDeadlineError("Artwork generation and private review"));
  }, Math.max(1, jobTimeoutMs));
  try {''',
    '''  const jobStartedAt = Date.now();
  const remainingMs = () => Math.max(1, jobTimeoutMs - (Date.now() - jobStartedAt));
  try {''',
)

one(
    routes,
    '''    const result = await withPreviewDeadline(generate(event, {
      inspirationNotes: resolved.notes,
      referenceImages: resolved.images,
      quality: "high",
      maxCandidates: 2,
      namedReference,
      attemptRetention: { store: artworkAttemptStore, eventId: event.id, ownerToken: event.ownerToken },
      signal: abortController.signal,
    }), remainingMs(), "Artwork generation and private review");''',
    '''    const abortController = new AbortController();
    const generationTimeoutMs = remainingMs();
    const result = await withPreviewDeadline(
      generate(event, {
        inspirationNotes: resolved.notes,
        referenceImages: resolved.images,
        quality: "high",
        maxCandidates: 2,
        namedReference,
        attemptRetention: { store: artworkAttemptStore, eventId: event.id, ownerToken: event.ownerToken },
        signal: abortController.signal,
      }),
      generationTimeoutMs,
      "Artwork generation and private review",
      (error) => abortController.abort(error),
    );''',
)

one(
    routes,
    '''    console.error("[prepayment-preview] automatic named-theme background task failed closed:", error);
  } finally {
    clearTimeout(abortTimer);
  }
}''',
    '''    console.error("[prepayment-preview] automatic named-theme background task failed closed:", error);
  }
}''',
)

one(
    routes,
    '''  const abortController = new AbortController();
  const abortTimer = setTimeout(() => {
    abortController.abort(new PrePaymentPreviewDeadlineError("Artwork generation and private review"));
  }, remainingMs());
  try {''',
    '''  const abortController = new AbortController();
  const generationTimeoutMs = remainingMs();
  try {''',
)

one(
    routes,
    '''    const result = await withPreviewDeadline(generate(event, {
      quality: "medium",
      maxCandidates: 1,
      namedReference: null,
      attemptRetention: { store: artworkAttemptStore, eventId: event.id, ownerToken: event.ownerToken },
      signal: abortController.signal,
    }), remainingMs(), "Artwork generation and private review");''',
    '''    const result = await withPreviewDeadline(
      generate(event, {
        quality: "medium",
        maxCandidates: 1,
        namedReference: null,
        attemptRetention: { store: artworkAttemptStore, eventId: event.id, ownerToken: event.ownerToken },
        signal: abortController.signal,
      }),
      generationTimeoutMs,
      "Artwork generation and private review",
      (error) => abortController.abort(error),
    );''',
)

one(
    routes,
    '''    console.error("[prepayment-preview] classified background preview failed closed:", error);
  } finally {
    clearTimeout(abortTimer);
  }
}''',
    '''    console.error("[prepayment-preview] classified background preview failed closed:", error);
  }
}''',
)


test = "tests/prePaymentPreviewQualityRoutes.test.ts"
one(
    test,
    '''  it("falls back within the bounded deadline instead of making the customer wait indefinitely", async () => {
    resolveNamedReference.mockResolvedValue(automaticResolution());
    generate.mockImplementation(() => new Promise(() => undefined));

    const response = await request(makeApp({ jobTimeoutMs: 5 }))
      .post(`/api/events/owner/${OWNER}/prepayment-preview`)
      .send({ email: "host@example.com" });

    expect(response.status).toBe(202);
    await runScheduledTask();
    expect(stored.prePaymentPreviewUrl).toMatch(/^data:image\\/svg\\+xml;base64,/);
  });''',
    '''  it("falls back at the bounded deadline and aborts the active provider work", async () => {
    resolveNamedReference.mockResolvedValue(automaticResolution());
    let providerSignal: AbortSignal | undefined;
    generate.mockImplementation((_event: Event, dependencies?: { signal?: AbortSignal }) => {
      providerSignal = dependencies?.signal;
      return new Promise(() => undefined);
    });

    const response = await request(makeApp({ jobTimeoutMs: 5 }))
      .post(`/api/events/owner/${OWNER}/prepayment-preview`)
      .send({ email: "host@example.com" });

    expect(response.status).toBe(202);
    await runScheduledTask();
    expect(providerSignal).toBeDefined();
    expect(providerSignal?.aborted).toBe(true);
    expect((providerSignal?.reason as Error | undefined)?.message).toContain("preview deadline");
    expect(stored.prePaymentPreviewUrl).toMatch(/^data:image\\/svg\\+xml;base64,/);
  });''',
)

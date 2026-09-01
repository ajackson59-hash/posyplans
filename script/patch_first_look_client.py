from pathlib import Path
import re


def one(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"expected one match in {path}, found {count}: {old[:100]!r}")
    file.write_text(text.replace(old, new, 1))


def sub(path: str, pattern: str, replacement: str) -> None:
    file = Path(path)
    updated, count = re.subn(pattern, replacement, file.read_text(), count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"expected one regex match in {path}, found {count}")
    file.write_text(updated)


page = "client/src/pages/DraftGenerating.tsx"
one(
    page,
    'type PrePaymentPreviewGenerationState = "idle" | "generating" | "ready" | "fallback";\n\ninterface PrePaymentPreviewReadiness {',
    '''type PrePaymentPreviewGenerationState = "idle" | "generating" | "ready" | "fallback";

interface PreviewDirectionCard {
  eventName: string;
  eyebrow: string;
  headline: string;
  supportingCopy: string;
  cues: string[];
}

interface PrePaymentPreviewReadiness {''',
)
one(
    page,
    '''  automaticReferenceResolutionEnabled?: boolean;
  automaticReferenceAttempted?: boolean;
}''',
    '''  automaticReferenceResolutionEnabled?: boolean;
  automaticReferenceAttempted?: boolean;
  directionCard?: PreviewDirectionCard;
}''',
)
one(
    page,
    '''  const readinessKind = previewReadiness.data?.kind ?? "none";
  const readinessState = previewReadiness.data?.generationState ?? "idle";
  const previewInProgress =''',
    '''  const readinessKind = previewReadiness.data?.kind ?? "none";
  const readinessState = previewReadiness.data?.generationState ?? "idle";
  const directionCard =
    startPrePaymentPreview.data?.directionCard
    ?? previewReadiness.data?.directionCard
    ?? null;
  const previewRequestAccepted =
    startPrePaymentPreview.isSuccess
    || backgroundPreviewStarted
    || readinessState === "generating"
    || readinessKind !== "none";
  const previewInProgress =''',
)
sub(
    page,
    r'  let paywallCtaLabel = "Show me my personalized first look";.*?\n\n  // Only auto-fire generation once we know this event is allowed to draft',
    '''  const continueCheckoutLabel =
    selectedPlan === "spark"
      ? "Continue to checkout — $9.99"
      : `Continue to Plus — ${plusInterval === "annual" ? "$99/yr" : "$11.99/mo"}`;
  let paywallCtaLabel = "Show me my personalized first look";
  if (checkoutPending) {
    paywallCtaLabel = "Starting checkout…";
  } else if (startPrePaymentPreview.isPending) {
    paywallCtaLabel = "Creating your personalized first look…";
  } else if (previewInProgress || previewAssetLoading || previewCouldNotBeShown) {
    paywallCtaLabel = continueCheckoutLabel;
  } else if (previewIsVisible) {
    paywallCtaLabel =
      selectedPlan === "spark"
        ? "Unlock this event — $9.99"
        : `Subscribe to Plus — ${plusInterval === "annual" ? "$99/yr" : "$11.99/mo"}`;
  }

  // Only auto-fire generation once we know this event is allowed to draft''',
)
one(
    page,
    '''                <span className="absolute right-3 top-3 rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground shadow-sm">
                  Posy first look
                </span>
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/35 to-transparent px-5 pb-4 pt-16 text-white">
                  <p className="font-serif text-lg font-semibold">A first look, made from your details</p>
                  <p className="mt-1 text-xs text-white/85">Unlock your complete plan and full invitation designs.</p>
                </div>
''',
    '',
)
one(
    page,
    '''            ) : previewInProgress ? (
              <div className="flex aspect-[9/16] items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
                <Loader2 className="h-5 w-5 shrink-0 animate-spin" />
                <div>
                  <p className="font-medium text-foreground">Creating your personalized first look…</p>
                  <p className="mt-1 text-xs leading-relaxed">
                    Posy is finding the right visual references and reviewing the artwork privately. You can leave this tab and return—this will keep working.
                  </p>
                </div>
              </div>
''',
    '''            ) : previewInProgress ? (
              <div className="min-h-[240px] px-6 py-6 text-left" data-testid="prepayment-preview-progress-proof">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-primary">
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
                  Creating your personalized first look…
                </div>
                {directionCard ? (
                  <div className="mt-5 space-y-4">
                    <div>
                      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                        {directionCard.eyebrow || "DIRECTION CAPTURED"}
                      </p>
                      <p className="mt-2 font-serif text-2xl font-semibold leading-tight text-foreground">
                        {directionCard.headline || directionCard.eventName}
                      </p>
                      {directionCard.eventName && directionCard.eventName !== directionCard.headline && (
                        <p className="mt-1 text-sm text-muted-foreground">{directionCard.eventName}</p>
                      )}
                    </div>
                    {directionCard.cues?.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {directionCard.cues.slice(0, 4).map((cue) => (
                          <span key={cue} className="rounded-full border border-primary/20 bg-primary/5 px-3 py-1.5 text-xs font-medium text-foreground">
                            {cue}
                          </span>
                        ))}
                      </div>
                    )}
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      Posy is finding the right visual references and reviewing the artwork privately. You may continue to checkout now—your first look will keep working in the background.
                    </p>
                  </div>
                ) : (
                  <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
                    Posy is reviewing your event details and artwork privately. You may continue to checkout now—your first look will keep working in the background.
                  </p>
                )}
              </div>
''',
)
one(
    page,
    '''                if (!previewIsVisible && !previewCouldNotBeShown) {
                  requestPersonalizedPreview();
                  return;
                }''',
    '''                if (!previewRequestAccepted && !previewIsVisible && !previewCouldNotBeShown) {
                  requestPersonalizedPreview();
                  return;
                }''',
)
one(
    page,
    '''                  onChange={(e) => setEmail(e.target.value)}
                  onBlur={() => {
                    // Generate early without turning a provisional field
                    // value into the event's permanent recovery identity.
                    requestPersonalizedPreview();
                  }}
''',
    '''                  onChange={(e) => setEmail(e.target.value)}
''',
)
one(
    page,
    '''                disabled={
                  previewInProgress ||
                  previewAssetLoading ||
                  checkoutPending
                }''',
    '''                disabled={startPrePaymentPreview.isPending || checkoutPending}''',
)

test = "tests/draftGeneratingPaywall.test.tsx"
one(
    test,
    '    expect(screen.getByTestId("button-unlock-spark").textContent).toContain("Revealing your personalized first look");',
    '    expect(screen.getByTestId("button-unlock-spark").textContent).toContain("Continue to checkout — $9.99");',
)
one(
    test,
    '''  it("allows checkout after a preview-provider failure instead of trapping the host", async () => {''',
    '''  it("shows the event direction immediately and lets checkout continue while artwork finishes", async () => {
    const checkout = deferred<{ url: string }>();
    const directionCard = {
      eventName: "Brian and Blippi's Extravaganza",
      eyebrow: "THEME RECOGNIZED",
      headline: "Blippi + Meekah",
      supportingCopy: "Posy captured the direction.",
      cues: ["Indoor soft play", "Bubbles", "Ice-cream treats"],
    };

    apiRequestJson.mockImplementation((method: string, url: string) => {
      if (method === "GET" && url.endsWith("/prepayment-preview/readiness")) {
        return Promise.resolve({ ready: false, generationState: "idle", pollAfterMs: null, kind: "none", namedReference: null, directionCard });
      }
      if (method === "GET" && url.endsWith("/master-planner/entitlement")) {
        return Promise.resolve({ eventId: 94, freeDraftState: "none", emailCaptured: false, planTier: "spark", sparkUnlocked: false, canGenerate: false });
      }
      if (method === "POST" && url.endsWith("/prepayment-preview")) {
        return Promise.resolve({ ready: false, generationState: "generating", pollAfterMs: 2500, kind: "none", namedReference: null, directionCard });
      }
      if (method === "POST" && url === "/api/checkout/create-session") return checkout.promise;
      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    renderPaywall();
    fireEvent.change(await screen.findByTestId("input-spark-email"), { target: { value: EMAIL } });
    fireEvent.click(screen.getByTestId("button-unlock-spark"));

    const proof = await screen.findByTestId("prepayment-preview-progress-proof");
    expect(proof.textContent).toContain("Blippi + Meekah");
    expect(proof.textContent).toContain("Indoor soft play");
    expect(screen.getByTestId("button-unlock-spark").textContent).toContain("Continue to checkout — $9.99");

    fireEvent.click(screen.getByTestId("button-unlock-spark"));
    await waitFor(() => expect(callsTo("/api/checkout/create-session")).toHaveLength(1));
  });

  it("allows checkout after a preview-provider failure instead of trapping the host", async () => {''',
)

source = Path(page).read_text()
ready = re.search(r'previewReady && !previewImageFailed[\s\S]*?: previewInProgress', source)
if not ready or "bg-gradient-to-t" in ready.group(0):
    raise SystemExit("browser overlay still alters reviewed artwork")
if "onBlur={() =>" in source:
    raise SystemExit("email blur still starts preview generation")

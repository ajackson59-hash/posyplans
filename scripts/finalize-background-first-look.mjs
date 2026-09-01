import { readFileSync, writeFileSync } from "node:fs";

function read(path) {
  return readFileSync(path, "utf8");
}

function write(path, value) {
  writeFileSync(path, value);
}

function replaceOnce(text, oldValue, newValue, label) {
  const index = text.indexOf(oldValue);
  if (index < 0) throw new Error(`Missing patch target: ${label}`);
  if (text.indexOf(oldValue, index + oldValue.length) >= 0) {
    throw new Error(`Patch target is not unique: ${label}`);
  }
  return `${text.slice(0, index)}${newValue}${text.slice(index + oldValue.length)}`;
}

function replaceCount(text, oldValue, newValue, expected, label) {
  const count = text.split(oldValue).length - 1;
  if (count !== expected) {
    throw new Error(`Expected ${expected} occurrences for ${label}; found ${count}`);
  }
  return text.split(oldValue).join(newValue);
}

const pagePath = "client/src/pages/DraftGenerating.tsx";
let page = read(pagePath);

page = replaceOnce(
  page,
  `interface EntitlementSummary {
  eventId: number;
  freeDraftState: string;
  emailCaptured: boolean;
  planTier: string;
  sparkUnlocked: boolean;
  canGenerate: boolean;
}
`,
  `interface EntitlementSummary {
  eventId: number;
  freeDraftState: string;
  emailCaptured: boolean;
  planTier: string;
  sparkUnlocked: boolean;
  canGenerate: boolean;
}

type PrePaymentPreviewKind = "direction-card" | "reference-board" | "approved-image" | "none";
type PrePaymentPreviewGenerationState = "idle" | "generating" | "ready" | "fallback";

interface PrePaymentPreviewReadiness {
  ready: boolean;
  generationState: PrePaymentPreviewGenerationState;
  pollAfterMs: number | null;
  kind: PrePaymentPreviewKind;
  namedReference: { id: string; label: string } | null;
  automaticReferenceResolutionEnabled?: boolean;
  automaticReferenceAttempted?: boolean;
}

type PrePaymentPreviewStart = PrePaymentPreviewReadiness;
`,
  "preview response types",
);

page = replaceOnce(
  page,
  `  const [persistedPreviewReady, setPersistedPreviewReady] = useState(false);

  const previewAssetUrl = ownerToken
    ? \`/api/events/owner/\${ownerToken}/prepayment-preview/asset\`
    : "";
`,
  `  const [persistedPreviewReady, setPersistedPreviewReady] = useState(false);
  const [backgroundPreviewStarted, setBackgroundPreviewStarted] = useState(false);
  const [previewAssetVersion, setPreviewAssetVersion] = useState(0);

  const previewAssetUrl = ownerToken
    ? \`/api/events/owner/\${ownerToken}/prepayment-preview/asset?v=\${previewAssetVersion}\`
    : "";
`,
  "preview recovery state",
);

const entitlementQuery = `  const entitlement = useQuery<EntitlementSummary>({
    queryKey: ["master-planner-entitlement", ownerToken],
    queryFn: () =>
      apiRequestJson<EntitlementSummary>("GET", \`/api/events/owner/\${ownerToken}/master-planner/entitlement\`),
    enabled: !!ownerToken,
  });
`;
page = replaceOnce(
  page,
  entitlementQuery,
  `${entitlementQuery}
  const previewReadiness = useQuery<PrePaymentPreviewReadiness>({
    queryKey: ["prepayment-preview-readiness", ownerToken],
    queryFn: () => apiRequestJson<PrePaymentPreviewReadiness>(
      "GET",
      \`/api/events/owner/\${ownerToken}/prepayment-preview/readiness\`,
    ),
    enabled: !!ownerToken,
    retry: false,
    refetchInterval: (query) => {
      const current = query.state.data as PrePaymentPreviewReadiness | undefined;
      return current?.generationState === "generating"
        ? current.pollAfterMs ?? 2500
        : false;
    },
  });
`,
  "preview readiness query",
);

page = replaceOnce(
  page,
  `  const startPrePaymentPreview = useMutation({
    mutationFn: (candidateEmail: string) =>
      apiRequestJson<{ ready: boolean }>("POST", \`/api/events/owner/\${ownerToken}/prepayment-preview\`, {
        email: candidateEmail,
      }),
    onSuccess: () => setPersistedPreviewReady(true),
  });
`,
  `  const startPrePaymentPreview = useMutation({
    mutationFn: (candidateEmail: string) =>
      apiRequestJson<PrePaymentPreviewStart>("POST", \`/api/events/owner/\${ownerToken}/prepayment-preview\`, {
        email: candidateEmail,
      }),
    onSuccess: (result) => {
      if (result.ready) {
        setBackgroundPreviewStarted(false);
        setPreviewImageLoaded(false);
        setPreviewImageFailed(false);
        setPersistedPreviewReady(true);
        setPreviewAssetVersion((current) => current + 1);
      } else {
        setBackgroundPreviewStarted(true);
        void previewReadiness.refetch();
      }
    },
    onError: () => {
      setBackgroundPreviewStarted(false);
      previewTriggeredRef.current = false;
    },
  });
`,
  "background preview mutation",
);

page = replaceOnce(
  page,
  `  const previewReady = startPrePaymentPreview.isSuccess || persistedPreviewReady;

  // Move the host to the visible spinner as soon as generation starts—not
`,
  `  const readinessKind = previewReadiness.data?.kind ?? "none";
  const readinessState = previewReadiness.data?.generationState ?? "idle";
  const previewInProgress =
    startPrePaymentPreview.isPending
    || backgroundPreviewStarted
    || readinessState === "generating";
  const previewReady =
    persistedPreviewReady
    || (readinessKind !== "none" && readinessState !== "generating");

  useEffect(() => {
    if (readinessState === "generating") {
      previewTriggeredRef.current = true;
      setBackgroundPreviewStarted(true);
      setPersistedPreviewReady(false);
      bringPreviewIntoView("smooth");
      return;
    }
    if (readinessKind === "none") return;

    previewTriggeredRef.current = true;
    setBackgroundPreviewStarted(false);
    setPreviewImageLoaded(false);
    setPreviewImageFailed(false);
    setPersistedPreviewReady(true);
    setPreviewAssetVersion((current) => current + 1);
    bringPreviewIntoView("smooth");
  }, [bringPreviewIntoView, readinessKind, readinessState]);

  // Move the host to the visible spinner as soon as generation starts—not
`,
  "readiness-driven preview state",
);

page = replaceOnce(
  page,
  `  useEffect(() => {
    if (!startPrePaymentPreview.isPending) return;
    bringPreviewIntoView("smooth");
  }, [bringPreviewIntoView, startPrePaymentPreview.isPending]);
`,
  `  useEffect(() => {
    if (!previewInProgress) return;
    bringPreviewIntoView("smooth");
  }, [bringPreviewIntoView, previewInProgress]);
`,
  "background spinner scroll",
);

page = replaceOnce(
  page,
  `      if (startPrePaymentPreview.isPending || previewReady || previewImageLoaded) {
        bringPreviewIntoView("auto");
      }
`,
  `      if (previewInProgress || previewReady || previewImageLoaded) {
        bringPreviewIntoView("auto");
      }
`,
  "visibility restoration condition",
);
page = replaceOnce(
  page,
  `  }, [bringPreviewIntoView, previewImageLoaded, previewReady, startPrePaymentPreview.isPending]);
`,
  `  }, [bringPreviewIntoView, previewImageLoaded, previewInProgress, previewReady]);
`,
  "visibility restoration dependencies",
);

page = replaceOnce(
  page,
  `  } else if (startPrePaymentPreview.isPending) {
    paywallCtaLabel = "Creating your personalized first look…";
`,
  `  } else if (previewInProgress) {
    paywallCtaLabel = "Creating your personalized first look…";
`,
  "background CTA label",
);

page = replaceOnce(
  page,
  `            ) : startPrePaymentPreview.isPending ? (
              <div className="flex aspect-square items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
                <Loader2 className="h-5 w-5 shrink-0 animate-spin" />
                <div>
                  <p className="font-medium text-foreground">Creating your personalized first look…</p>
                  <p className="mt-1 text-xs leading-relaxed">
                    This can take a minute or two. You can leave this tab and come back—your finished preview will be waiting.
                  </p>
                </div>
              </div>
`,
  `            ) : previewInProgress ? (
              <div className="flex aspect-square items-center justify-center gap-3 px-6 text-center text-sm text-muted-foreground">
                <Loader2 className="h-5 w-5 shrink-0 animate-spin" />
                <div>
                  <p className="font-medium text-foreground">Creating your personalized first look…</p>
                  <p className="mt-1 text-xs leading-relaxed">
                    Posy is finding the right visual references and reviewing the artwork privately. You can leave this tab and return—this will keep working.
                  </p>
                </div>
              </div>
`,
  "durable loading message",
);

page = replaceOnce(
  page,
  `                  startPrePaymentPreview.isPending ||
                  previewAssetLoading ||
`,
  `                  previewInProgress ||
                  previewAssetLoading ||
`,
  "background CTA disablement",
);

page = replaceOnce(
  page,
  `                Your preview took too long this time. You can still continue—your complete invitation is included once unlocked.
`,
  `                Posy couldn't complete the first look this time. You can still continue—your full invitation is included once unlocked.
`,
  "first-look fallback wording",
);

write(pagePath, page);

const guidePath = "client/src/components/PaywallPreviewGuide.tsx";
let guide = read(guidePath);
guide = replaceOnce(
  guide,
  `  kind: PreviewKind;
`,
  `  kind: PreviewKind;
  generationState?: "idle" | "generating" | "ready" | "fallback";
`,
  "guide generation-state type",
);
write(guidePath, guide);

const testPath = "tests/draftGeneratingPaywall.test.tsx";
let test = read(testPath);
const entitlementMarker = `      if (method === "GET" && url.endsWith("/master-planner/entitlement")) {
`;
const readinessHandler = `      if (method === "GET" && url.endsWith("/prepayment-preview/readiness")) {
        return Promise.resolve({
          ready: false,
          generationState: "idle",
          pollAfterMs: null,
          kind: "none",
          namedReference: null,
        });
      }
`;
test = replaceCount(
  test,
  entitlementMarker,
  `${readinessHandler}${entitlementMarker}`,
  3,
  "paywall readiness mocks",
);
test = test.replaceAll(
  "Your preview took too long this time",
  "Posy couldn't complete the first look this time",
);
write(testPath, test);

console.log("Background first-look client patch applied.");

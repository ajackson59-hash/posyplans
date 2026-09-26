// The personalized preview is the pre-payment value proof. A host's first
// submit must reveal it, not race directly to Stripe, while a provider failure
// must still leave checkout available.

import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiRequestJson = vi.fn();

vi.mock("@/lib/queryClient", () => ({
  apiRequestJson: (...args: unknown[]) => apiRequestJson(...args),
}));

vi.mock("@/lib/eventRecovery", () => ({ touchRecentEvent: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/components/AIDemoShowcase", () => ({
  default: () => <div data-testid="paywall-demo" />,
}));

const DraftGenerating = (await import("@/pages/DraftGenerating")).default;
const DirectCheckoutShortcut = (await import("@/components/DirectCheckoutShortcut")).default;

const OWNER = "preview-owner-token";
const EMAIL = "alex+fresh-preview@example.com";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderPaywall() {
  const { hook } = memoryLocation({ path: `/draft-generating/${OWNER}` });
  const client = new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: async ({ queryKey }) => {
          if (queryKey[0] === "/api/checkout/config") return { configured: true };
          throw new Error(`Unexpected query: ${String(queryKey[0])}`);
        },
      },
      mutations: { retry: false },
    },
  });

  return render(
    <QueryClientProvider client={client}>
      <Router hook={hook}>
        <DirectCheckoutShortcut />
        <Route path="/draft-generating/:ownerToken" component={DraftGenerating} />
      </Router>
    </QueryClientProvider>,
  );
}

function callsTo(path: string) {
  return apiRequestJson.mock.calls.filter(([, url]) => url === path);
}

beforeEach(() => {
  apiRequestJson.mockReset();
});

describe('human review customer gate', () => {
  it.each(['not-requested', 'queued', 'correction-queued', 'review', 'rejected', 'failed'])('keeps checkout closed in %s state', async (reviewState) => {
    apiRequestJson.mockImplementation((method: string, url: string) => {
      if (method === 'GET' && url.endsWith('/prepayment-preview/readiness')) return Promise.resolve({
        humanReview: true, reviewState, checkoutAllowed: false, ready: false, kind: 'none',
        generationState: ['queued','correction-queued','review'].includes(reviewState) ? 'generating' : 'idle', pollAfterMs: 60000,
        savedBrief: 'Complete watercolor garden brief',
      });
      if (method === 'GET' && url.endsWith('/master-planner/entitlement')) return Promise.resolve({ canGenerate: false });
      throw Error('Unexpected request '+method+' '+url);
    });
    renderPaywall();
    await screen.findByTestId('human-artwork-review-status');
    expect((screen.getByTestId('button-unlock-spark') as HTMLButtonElement).disabled).toBe(reviewState !== 'not-requested');
    expect(screen.queryByTestId('button-skip-preview-checkout')).toBeNull();
    expect(screen.queryByTestId('img-prepayment-preview')).toBeNull();
    expect(callsTo('/api/checkout/create-session')).toHaveLength(0);
    expect(callsTo(`/api/events/owner/${OWNER}/master-planner/generate`)).toHaveLength(0);
  });
  it('removes the optional shortcut when a legacy event becomes subject to human review', async () => {
    let humanReview = false;
    apiRequestJson.mockImplementation((method: string, url: string) => {
      if (method === 'GET' && url.endsWith('/prepayment-preview/readiness')) return Promise.resolve({
        humanReview, reviewState: 'approved', checkoutAllowed: true, ready: true,
        kind: 'approved-image', generationState: 'ready',
      });
      if (method === 'GET' && url.endsWith('/master-planner/entitlement')) return Promise.resolve({ canGenerate: false });
      throw Error('Unexpected request '+method+' '+url);
    });
    renderPaywall();
    await screen.findByTestId('button-skip-preview-checkout');
    humanReview = true;
    fireEvent(window, new Event('pageshow'));
    await waitFor(() => expect(screen.queryByTestId('button-skip-preview-checkout')).toBeNull());
    expect(callsTo('/api/checkout/create-session')).toHaveLength(0);
  });
  it('waits for known legacy readiness before offering a checkout that generates no preview', async () => {
    const readiness = deferred<{ humanReview: boolean; kind: string; generationState: string }>();
    const checkout = deferred<{ url: string }>();
    apiRequestJson.mockImplementation((method: string, url: string) => {
      if (method === 'GET' && url.endsWith('/prepayment-preview/readiness')) return readiness.promise;
      if (method === 'GET' && url.endsWith('/master-planner/entitlement')) return Promise.resolve({ canGenerate: false });
      if (method === 'POST' && url === '/api/checkout/create-session') return checkout.promise;
      throw Error('Unexpected request '+method+' '+url);
    });
    renderPaywall();
    await screen.findByTestId('button-unlock-spark');
    expect(screen.queryByTestId('button-skip-preview-checkout')).toBeNull();
    await act(async () => readiness.resolve({ humanReview: false, kind: 'none', generationState: 'idle' }));
    await screen.findByTestId('button-skip-preview-checkout');
    fireEvent.change(screen.getByTestId('input-spark-email'), { target: { value: EMAIL } });
    fireEvent.click(screen.getByTestId('button-skip-preview-checkout'));
    await waitFor(() => expect(callsTo('/api/checkout/create-session')).toHaveLength(1));
    expect(callsTo('/api/checkout/create-session')[0][2]).toEqual({ email: EMAIL, plan: 'spark', returnToken: OWNER });
    expect(callsTo(`/api/events/owner/${OWNER}/prepayment-preview`)).toHaveLength(0);
  });
  it('shows existing Plus access without starting planning while human review is pending', async () => {
    apiRequestJson.mockImplementation((method: string, url: string) => {
      if (method === 'GET' && url.endsWith('/prepayment-preview/readiness')) return Promise.resolve({
        humanReview:true,reviewState:'review',checkoutAllowed:false,ready:false,kind:'none',generationState:'generating',pollAfterMs:60000,
      });
      if (method === 'GET' && url.endsWith('/master-planner/entitlement')) return Promise.resolve({canGenerate:true,planTier:'plus'});
      throw Error('Unexpected request '+method+' '+url);
    });
    renderPaywall();await screen.findByText('Your existing access is saved. Planning can continue after artwork approval.');
    expect(callsTo(`/api/events/owner/${OWNER}/master-planner/generate`)).toHaveLength(0);
  });
});

describe("DraftGenerating pre-payment preview", () => {
  it("recovers an approved image on mobile pageshow without another generation or checkout", async () => {
    let ready = false;
    apiRequestJson.mockImplementation((method: string, url: string) => {
      if (method === "GET" && url.endsWith("/prepayment-preview/readiness")) return Promise.resolve({
        ready, kind: ready ? "approved-image" : "none", generationState: ready ? "ready" : "generating",
        pollAfterMs: 60000, namedReference: null,
      });
      if (method === "GET" && url.endsWith("/master-planner/entitlement")) return Promise.resolve({
        eventId: 94, freeDraftState: "none", emailCaptured: false, planTier: "spark", sparkUnlocked: false, canGenerate: false,
      });
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    renderPaywall();
    await screen.findByTestId("prepayment-preview-progress-proof");
    ready = true;
    fireEvent(window, new Event("pageshow"));
    await screen.findByTestId("img-prepayment-preview");
    expect(callsTo(`/api/events/owner/${OWNER}/prepayment-preview`)).toHaveLength(0);
    expect(callsTo("/api/checkout/create-session")).toHaveLength(0);
    expect(callsTo(`/api/events/owner/${OWNER}/prepayment-preview/readiness`).length).toBeGreaterThanOrEqual(2);
  });

  it("reveals the personalized preview before allowing a Spark checkout", async () => {
    const preview = deferred<{ ready: boolean }>();
    const checkout = deferred<{ url: string }>();

    apiRequestJson.mockImplementation((method: string, url: string) => {
      if (method === "GET" && url.endsWith("/prepayment-preview/readiness")) {
        return Promise.resolve({
          ready: false,
          generationState: "idle",
          pollAfterMs: null,
          kind: "none",
          namedReference: null,
        });
      }
      if (method === "GET" && url.endsWith("/master-planner/entitlement")) {
        return Promise.resolve({
          eventId: 91,
          freeDraftState: "none",
          emailCaptured: false,
          planTier: "spark",
          sparkUnlocked: false,
          canGenerate: false,
        });
      }
      if (method === "POST" && url.endsWith("/prepayment-preview")) return preview.promise;
      if (method === "POST" && url === "/api/checkout/create-session") return checkout.promise;
      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    renderPaywall();

    const email = await screen.findByTestId("input-spark-email");
    const cta = screen.getByTestId("button-unlock-spark");
    expect(cta.textContent).toContain("Show me my personalized first look");

    fireEvent.change(email, { target: { value: EMAIL } });
    fireEvent.click(cta);

    await waitFor(() => {
      expect(callsTo(`/api/events/owner/${OWNER}/prepayment-preview`)).toHaveLength(1);
    });
    expect(callsTo("/api/checkout/create-session")).toHaveLength(0);
    expect(screen.getByTestId("button-unlock-spark").textContent).toContain("Creating your personalized first look");

    await act(async () => preview.resolve({ ready: true }));

    const previewImage = await screen.findByTestId("img-prepayment-preview");
    // Regression test (B4): the preview must render at its own natural
    // aspect ratio, never a fixed box + object-cover crop. A fixed ratio
    // silently crops the moment the real generated image's ratio differs
    // from that hardcoded value (rounding, or a future layout change) —
    // this is the same bug PR #41 fixed once already.
    expect(previewImage.className).toContain("w-full");
    expect(previewImage.className).toContain("h-auto");
    expect(previewImage.className).not.toContain("object-cover");
    expect(previewImage.className).not.toContain("aspect-square");
    expect(previewImage.className).not.toMatch(/aspect-\[/);
    expect(screen.getByTestId("button-unlock-spark").textContent).toContain("Continue to checkout — $9.99");
    expect(callsTo("/api/checkout/create-session")).toHaveLength(0);

    fireEvent.load(previewImage);
    expect(screen.getByTestId("button-unlock-spark").textContent).toContain("Unlock this event — $9.99");
    expect(callsTo("/api/checkout/create-session")).toHaveLength(0);

    fireEvent.click(screen.getByTestId("button-unlock-spark"));
    await waitFor(() => expect(callsTo("/api/checkout/create-session")).toHaveLength(1));
  });

  it("shows the event direction immediately and lets checkout continue while artwork finishes", async () => {
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

  it.each(["provider-blocked", "quality-rejected", "preview-unavailable"])("shows a persisted %s failure without an artwork-ready claim or another generation", async failureReason => {
    const savedBrief = "Watercolor construction party. Yellow excavator, crane and sand play. No people.";
    apiRequestJson.mockImplementation((method: string, url: string) => {
      if (method === "GET" && url.endsWith("/prepayment-preview/readiness")) return Promise.resolve({
        ready: true, generationState: "fallback", kind: "direction-card", pollAfterMs: null,
        namedReference: null, failureReason, savedBrief,
      });
      if (method === "GET" && url.endsWith("/master-planner/entitlement")) return Promise.resolve({
        eventId: 53, freeDraftState: "none", emailCaptured: false, planTier: "spark", sparkUnlocked: false, canGenerate: false,
      });
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    renderPaywall();
    const failure = await screen.findByTestId("prepayment-preview-failure");
    expect(failure.textContent).toContain(savedBrief);
    expect(failure.textContent).toContain("Purchasing a plan does not guarantee");
    expect(screen.queryByTestId("img-prepayment-preview")).toBeNull();
    expect(screen.queryByTestId("button-view-personalized-preview")).toBeNull();
    expect(screen.getByTestId("button-unlock-spark").textContent).toContain("Continue to checkout");
    fireEvent(window, new Event("pageshow"));
    expect(callsTo(`/api/events/owner/${OWNER}/prepayment-preview`)).toHaveLength(0);
    expect(callsTo("/api/checkout/create-session")).toHaveLength(0);
  });

  it("allows checkout after a preview-provider failure instead of trapping the host", async () => {
    const checkout = deferred<{ url: string }>();

    apiRequestJson.mockImplementation((method: string, url: string) => {
      if (method === "GET" && url.endsWith("/prepayment-preview/readiness")) {
        return Promise.resolve({
          ready: false,
          generationState: "idle",
          pollAfterMs: null,
          kind: "none",
          namedReference: null,
        });
      }
      if (method === "GET" && url.endsWith("/master-planner/entitlement")) {
        return Promise.resolve({
          eventId: 92,
          freeDraftState: "none",
          emailCaptured: false,
          planTier: "spark",
          sparkUnlocked: false,
          canGenerate: false,
        });
      }
      if (method === "POST" && url.endsWith("/prepayment-preview")) {
        return Promise.reject(new Error("preview provider unavailable"));
      }
      if (method === "POST" && url === "/api/checkout/create-session") return checkout.promise;
      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    renderPaywall();

    fireEvent.change(await screen.findByTestId("input-spark-email"), { target: { value: EMAIL } });
    fireEvent.click(screen.getByTestId("button-unlock-spark"));

    await screen.findByText(/Posy couldn't complete the first look this time/);
    expect(screen.getByTestId("button-unlock-spark").textContent).toContain("Continue to checkout — $9.99");
    expect(callsTo("/api/checkout/create-session")).toHaveLength(0);

    fireEvent.click(screen.getByTestId("button-unlock-spark"));
    await waitFor(() => expect(callsTo("/api/checkout/create-session")).toHaveLength(1));
  });

  it("allows checkout if the generated preview asset itself cannot render", async () => {
    const checkout = deferred<{ url: string }>();

    apiRequestJson.mockImplementation((method: string, url: string) => {
      if (method === "GET" && url.endsWith("/prepayment-preview/readiness")) {
        return Promise.resolve({
          ready: false,
          generationState: "idle",
          pollAfterMs: null,
          kind: "none",
          namedReference: null,
        });
      }
      if (method === "GET" && url.endsWith("/master-planner/entitlement")) {
        return Promise.resolve({
          eventId: 93,
          freeDraftState: "none",
          emailCaptured: false,
          planTier: "spark",
          sparkUnlocked: false,
          canGenerate: false,
        });
      }
      if (method === "POST" && url.endsWith("/prepayment-preview")) {
        return Promise.resolve({ ready: true });
      }
      if (method === "POST" && url === "/api/checkout/create-session") return checkout.promise;
      throw new Error(`Unexpected request: ${method} ${url}`);
    });

    renderPaywall();

    fireEvent.change(await screen.findByTestId("input-spark-email"), { target: { value: EMAIL } });
    fireEvent.click(screen.getByTestId("button-unlock-spark"));

    fireEvent.error(await screen.findByTestId("img-prepayment-preview"));
    await screen.findByText(/Posy couldn't complete the first look this time/);
    expect(screen.getByTestId("button-unlock-spark").textContent).toContain("Continue to checkout — $9.99");
    expect(callsTo("/api/checkout/create-session")).toHaveLength(0);

    fireEvent.click(screen.getByTestId("button-unlock-spark"));
    await waitFor(() => expect(callsTo("/api/checkout/create-session")).toHaveLength(1));
  });
});

const customerBase = {
  version: 2, briefHash: 'b'.repeat(64), savedBrief: 'Keep the full watercolor garden request.',
  generationEnabled: true, requestsRemaining: 3, state: 'ready' as const,
  selectedId: null as string | null, selectedHash: null as string | null, appliedId: null, canContinue: false, supportReference: null,
  candidates: [{ id: '00000000-0000-4000-8000-000000000001', imageHash: 'a'.repeat(64),
    assetUrl: '/saved-customer-artwork.png', operation: 'create' as const, correction: null }],
};
function customerReadiness(artwork: Omit<typeof customerBase, 'state'> & { state: string }) {
  return { customerArtwork: artwork, kind: 'customer-artwork', ready: true,
    generationState: artwork.state === 'generating' ? 'generating' : 'ready', pollAfterMs: 60000, checkoutAllowed: artwork.canContinue };
}
describe('customer keeps and revises artwork in the normal paywall', () => {
  it.each(['failed', 'interrupted'])('explains an empty %s result without offering an unavailable retry or phantom saved images', async state => {
    const artwork = { ...customerBase, state, generationEnabled: false, requestsRemaining: 1, candidates: [], uploadAvailable: true, uploadsRemaining: 3 };
    apiRequestJson.mockImplementation((method: string, url: string) => {
      if (method === 'GET' && url.endsWith('/prepayment-preview/readiness')) return Promise.resolve(customerReadiness(artwork));
      if (method === 'GET' && url.endsWith('/master-planner/entitlement')) return Promise.resolve({ canGenerate: false });
      throw new Error('Unexpected request ' + method + ' ' + url);
    });
    renderPaywall();
    await screen.findByText(/We couldn’t create your artwork\. Your event details and request are saved/);
    expect(screen.getByText('Image generation is paused for this request. You can choose a ready-made design, upload your own artwork, or contact us for help.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Use this ready-made design' })).toBeTruthy();
    expect(screen.getByLabelText('Choose artwork')).toBeTruthy();
    expect(screen.queryByText(/Your saved images are still available/)).toBeNull();
    expect(screen.queryByText(/1 artwork request remaining/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Keep this image' })).toBeNull();
    expect((screen.getByTestId('button-unlock-spark') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh saved status' }));
    await waitFor(() => expect(callsTo(`/api/events/owner/${OWNER}/prepayment-preview/readiness`).length).toBeGreaterThan(1));
    expect(apiRequestJson.mock.calls.filter(([method]) => method === 'POST')).toHaveLength(0);
  });
  it.each(['accepted', 'response-lost'])('removes in-progress guidance when the %s revision finishes through saved-state refresh', async (outcome) => {
    let artwork: Omit<typeof customerBase, 'state'> & { state: string } = { ...structuredClone(customerBase),
      selectedId: customerBase.candidates[0].id, selectedHash: customerBase.candidates[0].imageHash, canContinue: true };
    apiRequestJson.mockImplementation((method: string, url: string) => {
      if (method === 'GET' && url.endsWith('/prepayment-preview/readiness')) return Promise.resolve(customerReadiness(artwork));
      if (method === 'GET' && url.endsWith('/master-planner/entitlement')) return Promise.resolve({ canGenerate: false });
      if (method === 'POST' && url.endsWith('/artwork/revise')) {
        artwork = { ...artwork, version: 3, state: 'generating', canContinue: false };
        return outcome === 'accepted' ? Promise.resolve(artwork) : Promise.reject(new Error('Connection interrupted'));
      }
      if (method === 'GET' && url.endsWith('/artwork')) return Promise.resolve(artwork);
      throw new Error('Unexpected request ' + method + ' ' + url);
    });
    renderPaywall(); fireEvent.load(await screen.findByTestId('customer-artwork-image'));
    fireEvent.change(screen.getByLabelText('What would you like to change?'), { target: { value: 'Keep the whole excavator inside the frame.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Make this change' }));
    await screen.findByText('Creating your artwork. You can return to this page; your request is saved.');
    artwork = { ...artwork, version: 4, state: 'ready', canContinue: true,
      candidates: [...artwork.candidates, { ...artwork.candidates[0], id: '00000000-0000-4000-8000-000000000002',
        imageHash: 'c'.repeat(64), assetUrl: '/revised-customer-artwork.png' }] };
    fireEvent(window, new Event('pageshow'));
    await screen.findByRole('button', { name: 'Revision 1' });
    expect(screen.queryByText(/change is (?:still )?underway/)).toBeNull();
    expect(screen.queryByText('Creating your artwork. You can return to this page; your request is saved.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Original · Kept' })).toBeTruthy();
    expect(callsTo(`/api/events/owner/${OWNER}/artwork/revise`)).toHaveLength(1);
    expect(callsTo(`/api/events/owner/${OWNER}/prepayment-preview`)).toHaveLength(0);
  });
  it('opens the kept original on return even when a later revision exists', async () => {
    apiRequestJson.mockImplementation((method: string, url: string) => {
      if (method === 'GET' && url.endsWith('/prepayment-preview/readiness')) return Promise.resolve(customerReadiness({ ...customerBase,
        selectedId: customerBase.candidates[0].id, selectedHash: customerBase.candidates[0].imageHash, canContinue: true,
        candidates: [...customerBase.candidates, { ...customerBase.candidates[0], id: '00000000-0000-4000-8000-000000000002', imageHash: 'c'.repeat(64), assetUrl: '/revised-customer-artwork.png' }],
      }));
      if (method === 'GET' && url.endsWith('/master-planner/entitlement')) return Promise.resolve({ canGenerate: false });
      throw new Error('Unexpected request ' + method + ' ' + url);
    });
    renderPaywall();
    expect((await screen.findByTestId('customer-artwork-image')).getAttribute('src')).toBe('/saved-customer-artwork.png');
    expect(screen.getByRole('button', { name: 'Original · Kept' }).getAttribute('aria-pressed')).toBe('true');
  });
  it('shows the saved image and requires a visible explicit choice before checkout; reloads do not create images', async () => {
    let artwork = structuredClone(customerBase);
    apiRequestJson.mockImplementation((method: string, url: string, body: any) => {
      if (method === 'GET' && url.endsWith('/prepayment-preview/readiness')) return Promise.resolve(customerReadiness(artwork));
      if (method === 'GET' && url.endsWith('/master-planner/entitlement')) return Promise.resolve({ canGenerate: false });
      if (method === 'POST' && url.endsWith('/artwork/select')) { artwork = { ...artwork, version: 3, selectedId: body.candidateId, selectedHash: body.imageHash, canContinue: true }; return Promise.resolve(artwork); }
      if (method === 'POST' && url === '/api/checkout/create-session') return new Promise(() => {});
      throw new Error('Unexpected request ' + method + ' ' + url);
    });
    renderPaywall();
    const img = await screen.findByTestId('customer-artwork-image');
    expect((screen.getByRole('button', { name: 'Keep this image' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('button-unlock-spark') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByTestId('button-skip-preview-checkout')).toBeNull();
    fireEvent.error(img);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh saved status' }));
    await waitFor(() => expect(screen.getByTestId('customer-artwork-image')).not.toBe(img));
    fireEvent.load(screen.getByTestId('customer-artwork-image'));
    fireEvent.click(screen.getByRole('button', { name: 'Keep this image' }));
    await screen.findByRole('button', { name: 'Image kept' });
    expect(apiRequestJson.mock.calls.find(([,url]) => url.endsWith('/artwork/select'))?.[2]).toEqual({ version: 2, briefHash: customerBase.briefHash,
      candidateId: customerBase.candidates[0].id, imageHash: customerBase.candidates[0].imageHash });
    fireEvent(window, new Event('pageshow'));
    await waitFor(() => expect(callsTo(`/api/events/owner/${OWNER}/prepayment-preview/readiness`).length).toBeGreaterThan(1));
    expect(callsTo(`/api/events/owner/${OWNER}/prepayment-preview`)).toHaveLength(0);
    fireEvent.change(screen.getByTestId('input-spark-email'), { target: { value: EMAIL } });
    fireEvent.submit(screen.getByTestId('button-unlock-spark').closest('form')!);
    await waitFor(() => expect(callsTo('/api/checkout/create-session')).toHaveLength(1));
  });
  it('recovers a lost revision response with GET and locks further changes while the saved request is running', async () => {
    const running = { ...customerBase, version: 3, state: 'generating' };
    apiRequestJson.mockImplementation((method: string, url: string) => {
      if (method === 'GET' && url.endsWith('/prepayment-preview/readiness')) return Promise.resolve(customerReadiness(customerBase));
      if (method === 'GET' && url.endsWith('/master-planner/entitlement')) return Promise.resolve({ canGenerate: false });
      if (method === 'POST' && url.endsWith('/artwork/revise')) return Promise.reject(new Error('Connection interrupted'));
      if (method === 'GET' && url.endsWith('/artwork')) return Promise.resolve(running);
      throw new Error('Unexpected request ' + method + ' ' + url);
    });
    renderPaywall(); fireEvent.load(await screen.findByTestId('customer-artwork-image'));
    fireEvent.change(screen.getByLabelText('What would you like to change?'), { target: { value: 'Preserve the garden; move only the left bird inward.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Make this change' }));
    await screen.findByText('Your saved request was found. No new request was sent.');
    const edits = callsTo(`/api/events/owner/${OWNER}/artwork/revise`);
    expect(edits).toHaveLength(1);
    expect(edits[0][2]).toMatchObject({ baseCandidateId: customerBase.candidates[0].id, imageHash: customerBase.candidates[0].imageHash,
      correction: 'Preserve the garden; move only the left bird inward.' });
    expect((screen.getByRole('button', { name: 'Make this change' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId('button-unlock-spark') as HTMLButtonElement).disabled).toBe(true);
    expect(callsTo(`/api/events/owner/${OWNER}/artwork`)).toHaveLength(1);
  });
  it('waits for a Plus host’s kept image before automatically starting the plan', async () => {
    apiRequestJson.mockImplementation((method: string, url: string, body: any) => {
      if (method === 'GET' && url.endsWith('/prepayment-preview/readiness')) return Promise.resolve(customerReadiness(customerBase));
      if (method === 'GET' && url.endsWith('/master-planner/entitlement')) return Promise.resolve({ canGenerate: true });
      if (method === 'GET' && url.endsWith('/master-planner/status')) return Promise.resolve({ draftStatus: 'none', completedStages: [] });
      if (method === 'POST' && url.endsWith('/artwork/select')) return Promise.resolve({ ...customerBase, version: 3, selectedId: body.candidateId, selectedHash: body.imageHash, canContinue: true });
      if (method === 'POST' && url.endsWith('/master-planner/generate')) return new Promise(() => {});
      throw new Error('Unexpected request ' + method + ' ' + url);
    });
    renderPaywall(); const img = await screen.findByTestId('customer-artwork-image');
    expect(callsTo(`/api/events/owner/${OWNER}/master-planner/generate`)).toHaveLength(0);
    fireEvent.load(img); fireEvent.click(screen.getByRole('button', { name: 'Keep this image' }));
    await waitFor(() => expect(callsTo(`/api/events/owner/${OWNER}/master-planner/generate`)).toHaveLength(1));
  });
  it('returns an already planned event without generating its plan again', async () => {
    apiRequestJson.mockImplementation((method: string, url: string) => {
      if (method === 'GET' && url.endsWith('/prepayment-preview/readiness')) return Promise.resolve(customerReadiness({ ...customerBase,
        selectedId: customerBase.candidates[0].id, selectedHash: customerBase.candidates[0].imageHash, canContinue: true, hasSavedPlan: true } as any));
      if (method === 'GET' && url.endsWith('/master-planner/entitlement')) return Promise.resolve({ canGenerate: true });
      throw new Error('Unexpected request ' + method + ' ' + url);
    });
    renderPaywall();
    await waitFor(() => expect(callsTo(`/api/events/owner/${OWNER}/prepayment-preview/readiness`)).toHaveLength(1));
    await waitFor(() => expect(screen.queryByTestId('customer-artwork-preview')).toBeNull());
    expect(callsTo(`/api/events/owner/${OWNER}/master-planner/generate`)).toHaveLength(0);
  });
});

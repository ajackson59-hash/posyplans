import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import PaywallPreviewGuide from "../client/src/components/PaywallPreviewGuide";

vi.mock("wouter", () => ({ useLocation: () => ["/draft-generating/test-owner", vi.fn()] }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("removes the duplicate email invitation when an in-flight preview fails without ever loading an image", async () => {
  const fetch = vi.fn(async () => ({ ok: true, json: async () => ({
    mode: "quality-image", kind: "none", generationState: "idle", imageGenerationEnabled: true,
    namedReference: null, referenceRecommended: false,
  }) }));
  vi.stubGlobal("fetch", fetch);
  HTMLElement.prototype.scrollIntoView = vi.fn();
  const page = (phase: "idle" | "generating" | "failed") => <>
    <div data-testid="prepayment-preview-card">
      {phase === "idle" && <div>Posy will create a personalized first look before checkout.</div>}
      {phase === "generating" && <div data-testid="prepayment-preview-progress-proof">Reviewing artwork</div>}
      {phase === "failed" && <div data-testid="prepayment-preview-failure">Artwork preview unavailable</div>}
    </div>
    <button data-testid="button-unlock-spark">Continue to checkout</button>
    <PaywallPreviewGuide />
  </>;
  const view = render(page("idle"));
  await screen.findByTestId("button-jump-to-preview-email");
  view.rerender(page("generating"));
  await waitFor(() => expect(screen.queryByTestId("button-jump-to-preview-email")).toBeNull());
  view.rerender(page("failed"));
  await waitFor(() => expect(screen.getByTestId("prepayment-preview-card").textContent).toBe("Artwork preview unavailable"));
  expect(screen.queryByTestId("button-jump-to-preview-email")).toBeNull();
  expect(screen.queryByTestId("text-preview-expectation")).toBeNull();
  expect(fetch).toHaveBeenCalledTimes(1);
});

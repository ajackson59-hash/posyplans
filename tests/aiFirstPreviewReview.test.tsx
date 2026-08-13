import { readFileSync } from "node:fs";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { conceptQuartet } from "./aiFirstFixtures";

const apiRequestJson = vi.fn();

vi.mock("@/lib/queryClient", () => ({
  API_BASE: "",
  apiRequestJson,
}));

const AiFirstPreviewReview = (await import("@/components/AiFirstPreviewReview")).default;

const readiness = {
  ready: true,
  environment: "preview" as const,
  killSwitch: true as const,
  canaryControlsReady: true,
  directionLimit: 1,
  automaticRetryDisabled: true,
  artworkModel: "gpt-image-2",
  providers: {
    ready: true,
    anthropic: {
      provider: "anthropic" as const,
      model: "claude-sonnet-4-6",
      configured: true,
      accessible: true,
    },
    openai: {
      provider: "openai" as const,
      model: "gpt-image-2",
      configured: true,
      accessible: true,
      httpStatus: 200,
    },
    imageProviderCalls: 0,
  },
  imageProviderCalls: 0,
  billedArtworkAttempts: 0,
};

function renderReview(readinessResult = readiness) {
  const queryFn = vi.fn(async () => readinessResult);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, queryFn } },
  });
  render(
    <QueryClientProvider client={client}>
      <AiFirstPreviewReview ownerToken="private-owner-token" />
    </QueryClientProvider>,
  );
  return { queryFn };
}

describe("Preview-only concept reviewer", () => {
  beforeEach(() => apiRequestJson.mockReset());

  it("contains no image-generation endpoint", () => {
    const source = readFileSync("client/src/components/AiFirstPreviewReview.tsx", "utf8");
    expect(source).not.toContain("/ai-first/generate");
    expect(source).not.toContain("images/generations");
  });

  it("does nothing automatically and locks the proof until every readiness gate passes", async () => {
    const { queryFn } = renderReview();
    expect(queryFn).not.toHaveBeenCalled();
    expect(apiRequestJson).not.toHaveBeenCalled();
    expect((screen.getByTestId("button-run-concept-proof") as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByTestId("button-check-preview-readiness"));
    await waitFor(() => expect(screen.getByTestId("preview-readiness-result")).toBeTruthy());

    expect(queryFn).toHaveBeenCalledTimes(1);
    expect(screen.getByText("All zero-image gates passed")).toBeTruthy();
    expect((screen.getByTestId("button-run-concept-proof") as HTMLButtonElement).disabled).toBe(false);
    expect(apiRequestJson).not.toHaveBeenCalled();
  });

  it("keeps the proof locked when any safety control is wrong", async () => {
    renderReview({ ...readiness, automaticRetryDisabled: false, canaryControlsReady: false });
    fireEvent.click(screen.getByTestId("button-check-preview-readiness"));
    await waitFor(() => expect(screen.getByText("Concept proof remains locked")).toBeTruthy());

    expect((screen.getByTestId("button-run-concept-proof") as HTMLButtonElement).disabled).toBe(true);
    expect(apiRequestJson).not.toHaveBeenCalled();
  });

  it("calls only the confirmed concept-proof route and renders all four text concepts", async () => {
    apiRequestJson.mockResolvedValue({
      model: "claude-sonnet-4-6",
      concepts: conceptQuartet(),
      conceptRejections: 0,
      environment: "preview",
      killSwitch: true,
      runClaimed: false,
      imageProviderCalls: 0,
      billedArtworkAttempts: 0,
    });
    renderReview();
    fireEvent.click(screen.getByTestId("button-check-preview-readiness"));
    await waitFor(() =>
      expect((screen.getByTestId("button-run-concept-proof") as HTMLButtonElement).disabled).toBe(false),
    );

    fireEvent.click(screen.getByTestId("button-run-concept-proof"));
    await waitFor(() => expect(screen.getByTestId("concept-proof-result")).toBeTruthy());

    expect(apiRequestJson).toHaveBeenCalledTimes(1);
    expect(apiRequestJson).toHaveBeenCalledWith(
      "POST",
      "/api/events/owner/private-owner-token/ai-first/review/concept-proof",
      { confirmConceptOnly: true },
    );
    expect(screen.getByText("Four text concepts passed with the safety boundary intact")).toBeTruthy();
    expect(screen.getAllByText(/Concept [1-4] ·/)).toHaveLength(4);
    expect(document.body.textContent).toContain("zero artwork calls");
    expect(document.body.textContent).toContain("no run claimed");

    fireEvent.click(screen.getByTestId("button-run-concept-proof"));
    expect(apiRequestJson).toHaveBeenCalledTimes(1);
  });
});

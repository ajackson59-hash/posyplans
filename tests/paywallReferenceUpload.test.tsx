import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiRequestJson = vi.fn();
const readImageFileAsDataUrl = vi.fn();
const toast = vi.fn();

vi.mock("@/lib/queryClient", () => ({
  apiRequestJson: (...args: unknown[]) => apiRequestJson(...args),
}));
vi.mock("@/lib/imageUpload", () => ({
  readImageFileAsDataUrl: (...args: unknown[]) => readImageFileAsDataUrl(...args),
}));
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast }),
}));

const PaywallReferenceUpload = (await import("@/components/PaywallReferenceUpload")).default;

const OWNER = "reference-owner-token";

function setupPaywallDom() {
  const email = document.createElement("input");
  email.dataset.testid = "input-spark-email";
  email.value = "host@example.com";
  document.body.appendChild(email);

  const card = document.createElement("div");
  card.dataset.testid = "prepayment-preview-card";
  const image = document.createElement("img");
  image.dataset.testid = "img-prepayment-preview";
  image.src = `/api/events/owner/${OWNER}/prepayment-preview/asset`;
  card.appendChild(image);
  document.body.appendChild(card);

  Object.defineProperty(email, "scrollIntoView", { value: vi.fn(), configurable: true });
  Object.defineProperty(card, "scrollIntoView", { value: vi.fn(), configurable: true });
  return { email, card, image };
}

function renderEnhancer() {
  const { hook } = memoryLocation({ path: `/draft-generating/${OWNER}` });
  return render(
    <Router hook={hook}>
      <PaywallReferenceUpload />
    </Router>,
  );
}

beforeEach(() => {
  document.body.innerHTML = "";
  apiRequestJson.mockReset();
  readImageFileAsDataUrl.mockReset();
  toast.mockReset();
});

describe("PaywallReferenceUpload", () => {
  it("builds a reference-backed first look even while generated previews are disabled", async () => {
    const { image } = setupPaywallDom();
    let readiness = {
      mode: "direction-card",
      kind: "direction-card",
      imageGenerationEnabled: false,
      namedReference: { id: "blippi-meekah", label: "Blippi + Meekah" },
      referenceRecommended: true,
      referenceCaptured: false,
    };

    apiRequestJson.mockImplementation((method: string, url: string) => {
      if (method === "GET" && url.endsWith("/prepayment-preview/readiness")) {
        return Promise.resolve(readiness);
      }
      if (method === "POST" && url.endsWith("/prepayment-preview")) {
        readiness = {
          ...readiness,
          kind: "reference-board",
          referenceRecommended: false,
          referenceCaptured: true,
        };
        return Promise.resolve({
          ready: true,
          kind: "reference-board",
          referenceRecommended: false,
          referenceCaptured: true,
        });
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    readImageFileAsDataUrl.mockResolvedValue("data:image/jpeg;base64,REFERENCE");

    renderEnhancer();

    const upload = await screen.findByTestId("input-prepayment-preview-reference");
    expect(screen.getByText(/Pin the exact Blippi \+ Meekah look/)).toBeTruthy();

    const file = new File(["reference"], "blippi-reference.jpg", { type: "image/jpeg" });
    fireEvent.change(upload, { target: { files: [file] } });

    await screen.findByText("blippi-reference.jpg");
    fireEvent.click(screen.getByTestId("button-create-reference-preview"));

    await waitFor(() => {
      const request = apiRequestJson.mock.calls.find(
        ([method, url]) => method === "POST" && String(url).endsWith("/prepayment-preview"),
      );
      expect(request?.[2]).toEqual({
        email: "host@example.com",
        inspirationImages: ["data:image/jpeg;base64,REFERENCE"],
      });
    });

    await screen.findByText(/exact visual reference is now pinned/i);
    expect(screen.getByText(/Blippi \+ Meekah reference pinned/)).toBeTruthy();
    expect(image.src).toContain(`/api/events/owner/${OWNER}/prepayment-preview/asset?v=`);
  });

  it("lets a host replace an already-pinned reference board", async () => {
    setupPaywallDom();
    apiRequestJson.mockResolvedValue({
      mode: "direction-card",
      kind: "reference-board",
      imageGenerationEnabled: false,
      namedReference: { id: "unicorn-academy", label: "Unicorn Academy" },
      referenceRecommended: false,
      referenceCaptured: true,
    });

    renderEnhancer();

    await screen.findByText(/Unicorn Academy reference pinned/);
    expect(screen.getByText(/Replace design inspo/)).toBeTruthy();
  });

  it("stays hidden for an original theme that does not need exact reference identity", async () => {
    setupPaywallDom();
    apiRequestJson.mockResolvedValue({
      mode: "direction-card",
      kind: "direction-card",
      imageGenerationEnabled: false,
      namedReference: null,
      referenceRecommended: false,
      referenceCaptured: false,
    });

    renderEnhancer();

    await waitFor(() => expect(apiRequestJson).toHaveBeenCalled());
    expect(screen.queryByTestId("prepayment-preview-reference-upload")).toBeNull();
  });
});

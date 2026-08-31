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
  it("sends a named-theme screenshot into the private reviewed-image path", async () => {
    const { image } = setupPaywallDom();
    apiRequestJson.mockImplementation((method: string, url: string) => {
      if (method === "GET" && url.endsWith("/prepayment-preview/readiness")) {
        return Promise.resolve({
          mode: "quality-image",
          kind: "direction-card",
          imageGenerationEnabled: true,
          namedReference: { id: "blippi-meekah", label: "Blippi + Meekah" },
          referenceRecommended: true,
        });
      }
      if (method === "POST" && url.endsWith("/prepayment-preview")) {
        return Promise.resolve({
          ready: true,
          kind: "approved-image",
          referenceRecommended: false,
        });
      }
      throw new Error(`Unexpected request: ${method} ${url}`);
    });
    readImageFileAsDataUrl.mockResolvedValue("data:image/jpeg;base64,REFERENCE");

    renderEnhancer();

    const upload = await screen.findByTestId("input-prepayment-preview-reference");
    const file = new File(["reference"], "blippi-reference.jpg", { type: "image/jpeg" });
    fireEvent.change(upload, { target: { files: [file] } });

    await screen.findByText("blippi-reference.jpg");
    fireEvent.click(screen.getByTestId("button-create-reference-preview"));

    await waitFor(() => {
      const request = apiRequestJson.mock.calls.find(
        ([method, url]) => method === "POST" && String(url).endsWith("/prepayment-preview"),
      );
      expect(request).toBeDefined();
      expect(request?.[2]).toEqual({
        email: "host@example.com",
        inspirationImages: ["data:image/jpeg;base64,REFERENCE"],
      });
    });

    await screen.findByText(/passed Posy’s private review/);
    expect(image.src).toContain(`/api/events/owner/${OWNER}/prepayment-preview/asset?v=`);
  });

  it("stays hidden while generated preview images are disabled", async () => {
    setupPaywallDom();
    apiRequestJson.mockResolvedValue({
      mode: "direction-card",
      kind: "direction-card",
      imageGenerationEnabled: false,
      namedReference: { id: "blippi-meekah", label: "Blippi + Meekah" },
      referenceRecommended: true,
    });

    renderEnhancer();

    await waitFor(() => expect(apiRequestJson).toHaveBeenCalled());
    expect(screen.queryByTestId("prepayment-preview-reference-upload")).toBeNull();
  });
});

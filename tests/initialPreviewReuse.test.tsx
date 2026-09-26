import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const apiRequestJson = vi.fn();
const invalidateQueries = vi.fn();
const toast = vi.fn();

vi.mock("@/lib/queryClient", () => ({
  apiRequestJson: (...args: unknown[]) => apiRequestJson(...args),
  queryClient: { invalidateQueries: (...args: unknown[]) => invalidateQueries(...args) },
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast }),
}));

const InitialPreviewReuse = (await import("@/components/InitialPreviewReuse")).default;

const OWNER = "owner-with-first-look";

function renderOnDashboard() {
  window.history.pushState({}, "", `/dashboard/${OWNER}`);
  const target = document.createElement("section");
  target.dataset.testid = "card-invitation-next-step";
  document.body.appendChild(target);
  return render(<InitialPreviewReuse />);
}

beforeEach(() => {
  cleanup();
  document.body.innerHTML = "";
  apiRequestJson.mockReset();
  invalidateQueries.mockReset();
  toast.mockReset();
});

describe("InitialPreviewReuse", () => {
  it.each(["direction-card", "reference-board", "none"])(
    "does not offer to reuse a %s as invitation artwork",
    async (kind) => {
      apiRequestJson.mockResolvedValue({ kind });
      renderOnDashboard();

      await waitFor(() => {
        expect(apiRequestJson).toHaveBeenCalledWith(
          "GET",
          `/api/events/owner/${OWNER}/prepayment-preview/readiness`,
        );
      });
      expect(screen.queryByTestId("button-use-initial-preview")).toBeNull();
    },
  );

  it("offers and reuses a quality-approved image without generating again", async () => {
    apiRequestJson.mockImplementation((method: string) => {
      if (method === "GET") return Promise.resolve({ kind: "approved-image" });
      if (method === "POST") return Promise.resolve({ reusedExistingArtwork: true });
      throw new Error(`Unexpected method: ${method}`);
    });

    renderOnDashboard();
    const button = await screen.findByTestId("button-use-initial-preview");
    fireEvent.click(button);

    await waitFor(() => {
      expect(apiRequestJson).toHaveBeenCalledWith(
        "POST",
        `/api/events/owner/${OWNER}/invite/use-prepayment-preview`,
        {},
      );
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: [`/api/events/owner/${OWNER}`],
    });
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({
      title: "Your first preview is back",
    }));
  });
});

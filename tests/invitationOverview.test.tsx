import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import InvitationOverview from "@/components/InvitationOverview";
import type { EventRecord } from "@/lib/types";

function event(overrides: Partial<EventRecord> = {}): EventRecord {
  return { inviteStatus: "draft", inviteArtworkUrl: "/saved-art.jpg", ...overrides } as EventRecord;
}

describe("invitation entry point", () => {
  it.each(["draft", "published"] as const)("makes a saved %s invitation directly viewable without publishing", (inviteStatus) => {
    const onOpenEditor = vi.fn();
    render(<InvitationOverview ownerToken="private-owner" event={event({ inviteStatus })} onOpenEditor={onOpenEditor} />);
    const preview = screen.getByRole("link", { name: "View invitation" });
    expect(preview.getAttribute("href")).toBe("/dashboard/private-owner/invitation-preview");
    expect(preview.getAttribute("target")).toBeNull();
    expect(onOpenEditor).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Invitation & Guests" }));
    expect(onOpenEditor).toHaveBeenCalledTimes(1);
  });

  it("offers creation instead of a misleading saved preview when there is no selected design", () => {
    const onOpenEditor = vi.fn();
    render(<InvitationOverview ownerToken="private-owner" event={event({ inviteArtworkUrl: "" })} onOpenEditor={onOpenEditor} />);
    expect(screen.queryByRole("link", { name: "View invitation" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Create invitation" }));
    expect(onOpenEditor).toHaveBeenCalledTimes(1);
  });
});

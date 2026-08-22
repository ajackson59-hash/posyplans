import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { getInvitationJourneyState, hasSelectedInvitationDesign } from "@/lib/invitationState";
import type { EventRecord } from "@/lib/types";

function event(overrides: Partial<EventRecord> = {}): EventRecord {
  return {
    inviteRenderMode: "",
    customInviteImageUrl: "",
    inviteDesignConceptJson: "{}",
    inviteArtworkUrl: "",
    inviteIllustrationUrl: "",
    ...overrides,
  } as EventRecord;
}

describe("invitation completion state", () => {
  it("does not call a default text-only event a finished invitation", () => {
    expect(hasSelectedInvitationDesign(event())).toBe(false);
  });

  it("recognizes custom, curated, AI, and legacy applied designs", () => {
    expect(hasSelectedInvitationDesign(event({ inviteRenderMode: "custom", customInviteImageUrl: "/mine.png" }))).toBe(true);
    expect(
      hasSelectedInvitationDesign(
        event({
          inviteDesignConceptJson: JSON.stringify({
            conceptName: "Blueprint Editorial",
            description: "Architectural",
            paletteColors: ["#111111", "#222222", "#333333", "#444444"],
            fontPairingId: "editorial-serif",
            borderStyle: "none",
            layoutStyle: "banner",
            illustrationPrompt: "blueprint linework",
          }),
        }),
      ),
    ).toBe(true);
    expect(hasSelectedInvitationDesign(event({ inviteIllustrationUrl: "/generated.png" }))).toBe(true);
    expect(hasSelectedInvitationDesign(event({ inviteArtworkUrl: "/legacy.png" }))).toBe(true);
  });

  it("distinguishes invitations that still need review from invitations already live", () => {
    const selected = {
      inviteArtworkUrl: "/applied.png",
    };

    expect(getInvitationJourneyState(event())).toBe("not_started");
    expect(getInvitationJourneyState(event({ ...selected, inviteStatus: "draft" }))).toBe("draft");
    expect(getInvitationJourneyState(event({ ...selected, inviteStatus: "published" }))).toBe("live");
  });

  it("keeps newly created invitations private until the host publishes", () => {
    const source = fs.readFileSync(path.resolve("server/storage.ts"), "utf8");
    const createEvent = source.slice(source.indexOf("async createEvent"), source.indexOf("async getEventByOwnerToken"));
    expect(createEvent).toContain('inviteStatus: "draft"');
    expect(createEvent.indexOf('inviteStatus: "draft"')).toBeGreaterThan(createEvent.indexOf("...data"));
  });
});

describe("dashboard invitation journey", () => {
  it("keeps the host-facing steps in a natural order", () => {
    const source = fs.readFileSync(path.resolve("client/src/pages/Dashboard.tsx"), "utf8");
    const markers = [
      'id="invitation-design-section"',
      "Next: confirm the wording",
      "Next: choose RSVP settings",
      "Then: publish and share",
      "{/* Guest list */}",
      'data-testid="card-send-invitations"',
    ];
    const positions = markers.map((marker) => source.indexOf(marker));

    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("offers a visible invitation entry point before the long planning sections", () => {
    const source = fs.readFileSync(path.resolve("client/src/pages/Dashboard.tsx"), "utf8");
    expect(source.indexOf('data-testid="card-invitation-next-step"')).toBeLessThan(
      source.indexOf("{/* Readiness */}"),
    );
  });

  it("keeps guest RSVP comments visible to the host", () => {
    const source = fs.readFileSync(path.resolve("client/src/pages/Dashboard.tsx"), "utf8");
    expect(source).toContain("{guest.note && (");
    expect(source).toContain("data-testid={`text-guest-note-${guest.id}`}");
  });
});

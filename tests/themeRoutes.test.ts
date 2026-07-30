// The curated theme path must be instant: applying one of the launch themes
// is a pure data write, and no image model may be reached. These tests stand
// the real Express routes up against an in-memory storage double and assert
// both the persisted shape and — critically — that the illustration generator
// was never called.

import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { createServer } from "node:http";

process.env.DATABASE_URL = "postgres://test/test";

const OWNER = "owner-token-test";

const baseEvent = {
  id: 1,
  ownerToken: OWNER,
  shareSlug: "slug",
  eventName: "Nina's Fortieth",
  eventType: "birthday",
  eventDate: "Saturday, June 14",
  location: "The Rosewood Terrace",
  hostNames: "Nina & Sam",
  rsvpDeadline: "June 1",
  themeName: "",
  paletteColors: "[]",
  inviteSubject: "",
  inviteMessage: "",
  inviteDesignConceptJson: "{}",
  inviteIllustrationUrl: "",
  customInviteImageUrl: "",
  inviteRenderMode: "",
  envelopeColor: "",
  envelopeLinerPattern: "",
  stampStyle: "",
  linerColor: "",
  stampColor: "",
};

let stored: Record<string, unknown>;

const generateInviteIllustrationWithQualityGate = vi.fn(async () => "data:image/png;base64,AAA");
const generateInviteIllustration = vi.fn(async () => "data:image/png;base64,AAA");

vi.mock("../server/storage", () => ({
  storage: {
    getEventByOwnerToken: async (token: string) => (token === OWNER ? { ...stored } : undefined),
    updateEventByOwnerToken: async (token: string, data: Record<string, unknown>) => {
      if (token !== OWNER) return undefined;
      stored = { ...stored, ...data };
      return { ...stored };
    },
  },
}));

vi.mock("../server/illustrationGen", () => ({
  generateInviteIllustrationWithQualityGate,
  generateInviteIllustration,
}));

const { registerRoutes } = await import("../server/routes");
const { LAUNCH_THEMES, readThemeSelection, paletteVariantColors, getPaletteVariant } = await import(
  "../shared/themeCatalog"
);
const { parseInviteDesignConcept, getFontPairing } = await import("../shared/inviteDesign");
const { contrastRatio } = await import("../shared/themeDna");

async function makeApp() {
  const app = express();
  app.use(express.json());
  await registerRoutes(createServer(app), app);
  return app;
}

const theme = LAUNCH_THEMES[0];

beforeEach(() => {
  stored = { ...baseEvent };
  generateInviteIllustrationWithQualityGate.mockClear();
  generateInviteIllustration.mockClear();
});

describe("POST /invite/apply-theme", () => {
  it("applies a curated theme without calling the image generator", async () => {
    const app = await makeApp();
    const res = await request(app)
      .post(`/api/events/owner/${OWNER}/invite/apply-theme`)
      .send({ themeId: theme.id });

    expect(res.status).toBe(200);
    expect(generateInviteIllustrationWithQualityGate).not.toHaveBeenCalled();
    expect(generateInviteIllustration).not.toHaveBeenCalled();
  });

  it("persists the theme selection so it survives a page refresh", async () => {
    const app = await makeApp();
    await request(app).post(`/api/events/owner/${OWNER}/invite/apply-theme`).send({ themeId: theme.id });

    // Re-read the event exactly as a reloading client would.
    const concept = parseInviteDesignConcept(stored.inviteDesignConceptJson as string);
    const selection = readThemeSelection(concept);

    expect(selection).not.toBeNull();
    expect(selection!.themeId).toBe(theme.id);
    expect(selection!.artworkUrl).toBe(theme.artwork.fullUrl);
    expect(selection!.paletteVariantId).toBe(theme.palettes[0].id);
    expect(concept!.fontPairingId).toBe(theme.fontPairingIds[0]);
  });

  it("points the legacy illustration field at the static asset, not a data URI", async () => {
    const app = await makeApp();
    await request(app).post(`/api/events/owner/${OWNER}/invite/apply-theme`).send({ themeId: theme.id });

    expect(stored.inviteIllustrationUrl).toBe(theme.artwork.fullUrl);
    expect(stored.inviteIllustrationUrl).not.toMatch(/^data:/);
  });

  it("seeds a coordinated envelope from the theme's own bundle", async () => {
    const app = await makeApp();
    await request(app).post(`/api/events/owner/${OWNER}/invite/apply-theme`).send({ themeId: theme.id });

    expect(stored.envelopeColor).toBe(theme.envelope.papers[0].color);
    expect(stored.envelopeLinerPattern).toBe(theme.envelope.liners[0].pattern);
    expect(stored.stampStyle).toBe(theme.envelope.seals[0].style);
  });

  it("seeds copy from the host's real event details", async () => {
    const app = await makeApp();
    await request(app).post(`/api/events/owner/${OWNER}/invite/apply-theme`).send({ themeId: theme.id });

    const selection = readThemeSelection(parseInviteDesignConcept(stored.inviteDesignConceptJson as string));
    expect(selection!.copy.dateLine).toBe(baseEvent.eventDate);
    expect(selection!.copy.locationLine).toBe(baseEvent.location);
    expect(selection!.copy.eyebrow).toContain(baseEvent.hostNames);
  });

  it("rejects an unknown theme id", async () => {
    const app = await makeApp();
    const res = await request(app)
      .post(`/api/events/owner/${OWNER}/invite/apply-theme`)
      .send({ themeId: "not-a-real-theme" });

    expect(res.status).toBe(400);
    expect(stored.inviteDesignConceptJson).toBe("{}");
  });
});

describe("PATCH /invite/theme", () => {
  async function applied() {
    const app = await makeApp();
    await request(app).post(`/api/events/owner/${OWNER}/invite/apply-theme`).send({ themeId: theme.id });
    return app;
  }

  it("updates the colourway and keeps paletteColors in sync", async () => {
    const app = await applied();
    const variant = theme.palettes[1];

    const res = await request(app)
      .patch(`/api/events/owner/${OWNER}/invite/theme`)
      .send({ paletteVariantId: variant.id });

    expect(res.status).toBe(200);
    const concept = parseInviteDesignConcept(stored.inviteDesignConceptJson as string)!;
    expect(readThemeSelection(concept)!.paletteVariantId).toBe(variant.id);
    expect(concept.paletteColors).toEqual(paletteVariantColors(variant));
    expect(JSON.parse(stored.paletteColors as string)).toEqual(paletteVariantColors(variant));
  });

  it("updates typeface, placement, overlay, and words together", async () => {
    const app = await applied();

    await request(app).patch(`/api/events/owner/${OWNER}/invite/theme`).send({
      fontPairingId: theme.fontPairingIds[1],
      placementId: theme.placements[1].id,
      overlay: theme.overlayOptions[theme.overlayOptions.length - 1],
      inviteSubject: "An Evening in the Garden",
      copy: { rsvpLine: "Reply by the first of June" },
    });

    const concept = parseInviteDesignConcept(stored.inviteDesignConceptJson as string)!;
    const selection = readThemeSelection(concept)!;
    expect(concept.fontPairingId).toBe(theme.fontPairingIds[1]);
    expect(selection.placementId).toBe(theme.placements[1].id);
    expect(selection.overlay).toBe(theme.overlayOptions[theme.overlayOptions.length - 1]);
    expect(selection.copy.rsvpLine).toBe("Reply by the first of June");
    expect(stored.inviteSubject).toBe("An Evening in the Garden");
  });

  it("leaves untouched copy fields alone", async () => {
    const app = await applied();
    const before = readThemeSelection(parseInviteDesignConcept(stored.inviteDesignConceptJson as string))!;

    await request(app).patch(`/api/events/owner/${OWNER}/invite/theme`).send({ copy: { eyebrow: "Join us" } });

    const after = readThemeSelection(parseInviteDesignConcept(stored.inviteDesignConceptJson as string))!;
    expect(after.copy.eyebrow).toBe("Join us");
    expect(after.copy.locationLine).toBe(before.copy.locationLine);
  });

  it("refuses options that do not belong to the applied theme", async () => {
    const app = await applied();
    const foreign = LAUNCH_THEMES[1];

    await request(app).patch(`/api/events/owner/${OWNER}/invite/theme`).send({
      paletteVariantId: foreign.palettes[0].id,
      fontPairingId: foreign.fontPairingIds[0],
    });

    const concept = parseInviteDesignConcept(stored.inviteDesignConceptJson as string)!;
    // Falls back to the theme's own default rather than accepting a foreign id.
    expect(theme.palettes.some((p) => p.id === readThemeSelection(concept)!.paletteVariantId)).toBe(true);
    expect(theme.fontPairingIds).toContain(concept.fontPairingId);
  });

  it("never calls the image generator while customising", async () => {
    const app = await applied();
    await request(app)
      .patch(`/api/events/owner/${OWNER}/invite/theme`)
      .send({ paletteVariantId: theme.palettes[2].id });

    expect(generateInviteIllustrationWithQualityGate).not.toHaveBeenCalled();
  });

  it("400s when no curated theme is applied", async () => {
    const app = await makeApp();
    const res = await request(app)
      .patch(`/api/events/owner/${OWNER}/invite/theme`)
      .send({ paletteVariantId: theme.palettes[1].id });

    expect(res.status).toBe(400);
  });
});

describe("catalog integrity", () => {
  it("ships eight themes with valid, renderable design data", () => {
    expect(LAUNCH_THEMES).toHaveLength(8);
    for (const t of LAUNCH_THEMES) {
      expect(t.artwork.fullUrl).toMatch(/^\/themes\/.+\.webp$/);
      expect(t.artwork.alt.length).toBeGreaterThan(20);
      expect(t.palettes.length).toBeGreaterThanOrEqual(3);
      expect(t.placements.length).toBeGreaterThanOrEqual(3);
      for (const p of t.palettes) {
        for (const hex of paletteVariantColors(p)) {
          expect(hex).toMatch(/^#[0-9a-f]{6}$/i);
        }
      }
      // Placement boxes must stay inside the card.
      for (const pl of t.placements) {
        expect(pl.box.top + pl.box.height).toBeLessThanOrEqual(100);
        expect(pl.box.left + pl.box.width).toBeLessThanOrEqual(100);
      }
      expect(getPaletteVariant(t, undefined)).toBe(t.palettes[0]);
    }
  });

  it("keeps every colourway legible against its own surface", () => {
    for (const t of LAUNCH_THEMES) {
      for (const p of t.palettes) {
        // Overlay treatments lay palette.surface behind the type, so the
        // artwork cannot rescue a colourway that fails on its own.
        expect(contrastRatio(p.ink, p.surface)).toBeGreaterThanOrEqual(4.5);
        expect(contrastRatio(p.body, p.surface)).toBeGreaterThanOrEqual(4.5);
        // The accent sets the small uppercase eyebrow and RSVP lines.
        expect(contrastRatio(p.accent, p.surface)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("gives each theme its own default typeface", () => {
    const defaults = LAUNCH_THEMES.map((t) => getFontPairing(t.fontPairingIds[0]).headingFontFamily);
    expect(new Set(defaults).size).toBe(LAUNCH_THEMES.length);
  });
});

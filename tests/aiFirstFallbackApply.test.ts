// The substituted direction has to be applicable.
//
// A direction whose artwork fails twice is replaced by an adapted studio
// direction. It is still one of the four cards a host can press "Use this
// design" on — so it must go through the same preview store and the same
// apply route as a generated one, with real bytes behind a real hash. The
// first cut returned `previewId: "studio-<theme>"` and an empty assetHash,
// which rendered fine and then 404'd on apply.

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import type Anthropic from "@anthropic-ai/sdk";
import { featureFlagEnvVar } from "@shared/featureFlags";
import { AI_FIRST_CONCEPT_KEY, readAiFirstSnapshot } from "@shared/aiFirstTheme";
import type { PipelineEvent } from "@shared/aiFirstStream";
import { runAiFirstPipeline } from "../server/aiFirst/pipeline";
import { registerAiFirstRoutes } from "../server/aiFirst/routes";
import { InMemoryPreviewStore } from "../server/aiFirst/previewStore";
import { InMemoryUsageStore } from "../server/aiFirst/usage";
import { InMemoryRunStore } from "../server/aiFirst/runStore";
import { InMemoryArtworkAttemptStore } from "../server/aiFirst/artworkAttemptStore";
import type { EventBrief } from "../server/aiFirst/brief";
import { concept, conceptQuartet, framedArtworkForAspect } from "./aiFirstFixtures";

const OWNER = "owner-token";
const EVENT_ID = 1;

const brief: EventBrief = {
  eventName: "Ada's 4th Birthday",
  eventType: "birthday",
  milestone: "4th",
  vibe: "modern editorial celebration",
  themeName: "modern editorial",
  colors: ["dusty rose"],
  formality: "playful",
  dateLine: "12 September 2026",
  season: "autumn",
  venueType: "home",
  guestCount: 18,
  dna: {},
  inspirationNotes: "",
  requirements: { required: ["age-appropriate modern editorial artwork"], preferred: [], excluded: [] },
};

/** One concept, so the run produces exactly one direction to reason about. */
const FAILING_CONCEPT = concept({
  conceptName: "High-Noon Nebula",
  baseThemeId: "celestial-heirloom",
  placementId: "centre",
  layoutStyle: "full-bleed",
});

function singleConceptClient(): Anthropic {
  return {
    messages: {
      stream: async () =>
        (async function* () {
          yield {
            type: "content_block_delta",
            delta: {
              type: "text_delta",
              text: `${conceptQuartet(FAILING_CONCEPT).map((item) => JSON.stringify(item)).join("\n")}\n`,
            },
          };
        })(),
    },
  } as unknown as Anthropic;
}

/**
 * Runs one direction whose every artwork attempt is defective, so both
 * attempts fail Tier 1 and the fallback fires. Returns the shared stores so
 * the apply route can be pointed at the same preview the run wrote.
 */
async function runToFallback() {
  const previewStore = new InMemoryPreviewStore();
  const usageStore = new InMemoryUsageStore();
  const events: PipelineEvent[] = [];
  let imageCalls = 0;

  const summary = await runAiFirstPipeline({
    eventId: EVENT_ID,
    email: "host@example.com",
    brief,
    previewStore,
    usageStore,
    allowance: 40,
    directionLimit: 1,
    sink: (event) => events.push(event),
    anthropic: singleConceptClient(),
    ocr: false,
    generateImage: async ({ aspectRatio }) => {
      imageCalls += 1;
      // A printed margin: Tier 1 rejects it without paying the critic.
      return {
        bytes: framedArtworkForAspect(aspectRatio),
        dataUrl: `data:image/png;base64,fake-${imageCalls}`,
        durationMs: 1,
      };
    },
  });

  const direction = events.find(
    (e): e is Extract<PipelineEvent, { type: "direction" }> => e.type === "direction",
  )!.direction;

  return { summary, direction, previewStore, usageStore, imageCallsAfterRun: imageCalls, imageCalls: () => imageCalls };
}

function appFor(previewStore: InMemoryPreviewStore, usageStore: InMemoryUsageStore) {
  const app = express();
  app.use(express.json());
  const updates: Record<string, unknown>[] = [];
  registerAiFirstRoutes(app, {
    storage: {
      getEventByOwnerToken: async (token: string) =>
        token === OWNER
          ? {
              id: EVENT_ID,
              capturedEmail: "host@example.com",
              eventName: "Ada's 4th Birthday",
              eventType: "birthday",
              eventDate: "12 September 2026",
              location: "The Glasshouse",
              hostNames: "Alex",
              rsvpDeadline: "1 September 2026",
              inviteSubject: "You're invited!",
            }
          : undefined,
      updateEventByOwnerToken: async (_token: string, data: Record<string, unknown>) => {
        updates.push(data);
        return { id: EVENT_ID, ...data };
      },
      getEmailEntitlement: async () => undefined,
      listMenuItems: async () => [],
      listBudgetItems: async () => [],
      listGuests: async () => [],
    },
    previewStore,
    usageStore,
    runStore: new InMemoryRunStore(),
    artworkAttemptStore: new InMemoryArtworkAttemptStore(),
    env: { [featureFlagEnvVar("aiFirstInvitations")]: "1" },
  });
  return { app, updates };
}

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

describe("a direction that fell back to an adapted studio direction", () => {
  it("is a real event-scoped preview, not a synthetic id", async () => {
    const { direction, summary, previewStore } = await runToFallback();

    expect(summary.adaptedDirections).toBe(1);
    expect(direction.source).toBe("adapted-studio-direction");
    expect(direction.previewId).not.toBe("");
    expect(direction.previewId).not.toMatch(/^studio-/);
    expect(direction.assetHash).not.toBe("");

    const stored = await previewStore.findByPreviewId(EVENT_ID, direction.previewId);
    expect(stored).toBeDefined();
    expect(stored!.source).toBe("adapted-studio-direction");
    expect(stored!.assetHash).toBe(direction.assetHash);
  });

  it("stores the exact bytes of the studio artwork it displays", async () => {
    const { direction, previewStore } = await runToFallback();
    const stored = (await previewStore.findByPreviewId(EVENT_ID, direction.previewId))!;

    // The card shows a curated asset that ships with the build; the hash in
    // the store has to be that file's own hash or apply cannot verify it.
    expect(stored.assetUrl).toBe(direction.illustrationUrl);
    const onDisk = await readFile(
      path.resolve(process.cwd(), "client", "public", direction.illustrationUrl.replace(/^\/+/, "")),
    );
    expect(stored.assetHash).toBe(sha256(onDisk));
  });

  it("applies through the ordinary route, with no image provider call", async () => {
    const { direction, previewStore, usageStore, imageCallsAfterRun, imageCalls } = await runToFallback();
    const { app, updates } = appFor(previewStore, usageStore);

    const res = await request(app)
      .post(`/api/events/owner/${OWNER}/ai-first/apply`)
      .send({ previewId: direction.previewId, assetHash: direction.assetHash });

    expect(res.status).toBe(200);
    expect(res.body.previewId).toBe(direction.previewId);
    expect(res.body.assetHash).toBe(direction.assetHash);
    // The apply route has no image generator at all; this pins that it stays
    // that way for the substituted path too.
    expect(imageCalls()).toBe(imageCallsAfterRun);
    expect(usageStore.all.filter((row) => row.reason === "apply").every((row) => row.billed === false)).toBe(true);
    expect(updates).toHaveLength(1);
  });

  it("restores the approved direction after browser state is lost", async () => {
    const { direction, previewStore, usageStore, imageCallsAfterRun, imageCalls } = await runToFallback();
    const { app } = appFor(previewStore, usageStore);

    const res = await request(app).get(`/api/events/owner/${OWNER}/ai-first/approved-designs`);

    expect(res.status).toBe(200);
    expect(res.body.appliedPreviewId).toBeNull();
    expect(res.body.directions).toHaveLength(1);
    expect(res.body.directions[0]).toMatchObject({
      previewId: direction.previewId,
      assetHash: direction.assetHash,
      concept: direction.concept,
      source: "adapted-studio-direction",
      illustrationUrl: `/api/events/owner/${OWNER}/ai-first/preview/${direction.previewId}/asset`,
      reusedPreview: true,
    });
    expect(res.body.directions[0].illustrationUrl).not.toMatch(/^data:/);
    expect(imageCalls()).toBe(imageCallsAfterRun);
  });

  it("persists the artwork, palette, envelope and composition it displayed", async () => {
    const { direction, previewStore, usageStore } = await runToFallback();
    const { app, updates } = appFor(previewStore, usageStore);

    await request(app)
      .post(`/api/events/owner/${OWNER}/ai-first/apply`)
      .send({ previewId: direction.previewId, assetHash: direction.assetHash });

    const saved = updates[0];
    expect(saved.inviteIllustrationUrl).toBe(direction.illustrationUrl);

    const applied = JSON.parse(String(saved.inviteDesignConceptJson));
    const snapshot = readAiFirstSnapshot(applied);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.source).toBe("adapted-studio-direction");
    expect(snapshot!.assetHash).toBe(direction.assetHash);
    expect(snapshot!.artworkUrl).toBe(direction.illustrationUrl);
    expect(applied[AI_FIRST_CONCEPT_KEY].concept).toEqual(direction.concept);

    // Applying generated artwork must never leak the underlying catalogue's
    // sample date, venue or RSVP copy onto the public invitation.
    expect(applied.theme.copy).toEqual({
      eyebrow: "Hosted by Alex",
      dateLine: "12 September 2026",
      timeLine: "",
      locationLine: "The Glasshouse",
      rsvpLine: "Kindly reply by 1 September 2026",
    });
    expect(saved.inviteSubject).toBe("Ada's 4th Birthday");

    // Composition: the substituted card inherits the curated theme's own
    // layout and placement, and that is what is written down.
    expect(snapshot!.concept.layoutStyle).toBe(direction.concept.layoutStyle);
    expect(snapshot!.concept.placementId).toBe(direction.concept.placementId);
    expect(snapshot!.concept.borderStyle).toBe(direction.concept.borderStyle);
    expect(snapshot!.concept.motif).toEqual(direction.concept.motif);
    expect(snapshot!.concept.minOverlay).toBe(direction.overlay);

    // Palette: the failed concept's own colours survive the substitution.
    expect(snapshot!.concept.semanticPalette).toEqual(direction.concept.semanticPalette);
    const palette = JSON.parse(String(saved.paletteColors));
    expect(Array.isArray(palette)).toBe(true);
    expect(palette.length).toBeGreaterThan(0);

    // Envelope: derived from the applied concept, so the RSVP surfaces match.
    expect(String(saved.envelopeColor)).toMatch(/^#[0-9a-fA-F]{6}$/);
    expect(saved.envelopeLinerPattern).toBeTruthy();
    expect(saved.stampStyle).toBeTruthy();
  });

  it("refuses the apply when the approved hash no longer matches", async () => {
    const { direction, previewStore, usageStore } = await runToFallback();
    const { app } = appFor(previewStore, usageStore);

    const res = await request(app)
      .post(`/api/events/owner/${OWNER}/ai-first/apply`)
      .send({ previewId: direction.previewId, assetHash: `${"0".repeat(64)}` });

    expect(res.status).toBe(409);
  });
});

import { createHash } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Event } from "@shared/schema";
import { buildQualityLockedPreviewBrief, customerVisiblePreviewBytes } from "../server/prePaymentPreviewQuality";
import { InMemoryArtworkAttemptStore } from "../server/aiFirst/artworkAttemptStore";
import { sceneAssetDigest, sceneBriefDigest, type SceneAsset, type SceneRecipe } from "../server/aiFirst/sceneComposition";
import { reviewSceneComposition } from "../server/aiFirst/scenePreviewReview";
import { encodePng, readPngSize } from "../server/aiFirst/png";

// Engineering fixtures only: the real vision parser sees scripted evidence.
// No human/art certificate, provider request or customer artwork is produced.
const allFive = { textLogoWatermarkFree: 5, artifactFree: 5, premiumFinish: 5,
  briefFidelity: 5, compositionQuality: 5, ageAppropriate: 5 };
const clearTier1 = () => ({ passed: true, findings: [], durationMs: 0 });

async function fixture() {
  const event = { id: 7, ownerToken: "private-owner-a", eventName: "Brian's fourth birthday",
    themeName: "Blippi + Meekah", eventType: "Birthday", eventDate: "September 19, 2026",
    vibeDescription: "Blippi and Meekah dancing. Include bubbles and a ball pit. No candles.",
    paletteColors: "[]", estimatedGuestCount: 15 } as Event;
  const { brief, namedReference } = await buildQualityLockedPreviewBrief(event);
  const png = encodePng({ width: 400, height: 600, rgb: new Uint8Array(400 * 600 * 3).fill(200) });
  const asset: SceneAsset = { id: "test-pixels", png, certificate: {
    digest: sceneAssetDigest(png), reviewer: "fixture-only-not-human", rightsRecord: "test-pixels-only",
    ownerScope: event.ownerToken, styleId: "engineering", namedThemeId: namedReference!.id,
    requirements: [...brief.requirements.required],
  } };
  const recipe: SceneRecipe = { id: "fixture", styleId: "engineering", briefDigest: sceneBriefDigest(brief),
    namedThemeId: namedReference!.id, width: 400, height: 600,
    layers: [{ assetId: asset.id, role: "background", box: { x: 0, y: 0, width: 1, height: 1 },
      requirements: [...brief.requirements.required] }],
  };
  return { event, recipe, assets: [asset], confirmOneVisionCall: true as const };
}

function critic(override: Record<string, unknown> = {}) {
  const create = vi.fn(async (request: any) => {
    const required = request.output_config.format.schema.properties.requiredPresent.items.properties.requirement.enum ?? [];
    return { stop_reason: "end_turn", usage: { input_tokens: 30, output_tokens: 20 }, content: [{ type: "text", text: JSON.stringify({
      ...allFive, requiredPresent: required.map((requirement: string) => ({ requirement, present: true, evidence: "Fixture observation" })),
      excludedFound: [], notes: "Scripted fixture, not real art approval",
      dimensionAssessments: Object.fromEntries(Object.keys(allFive).map((key) => [key, { status: "clear", criterion: "none", location: "Full canvas", observation: "Fixture observation" }])),
      teaserChecks: { milestone: { correct: true, evidence: "No candles" },
        identity: { accurate: true, evidence: "Fixture identities" },
        purchase: { wouldCreatePurchaseDesire: true, evidence: "Fixture purchase label" } },
      ...override,
    }) }] };
  });
  return { create, client: { messages: { create } } as unknown as Anthropic };
}

afterEach(() => vi.useRealTimers());

describe("private composed-scene final-pixel review", () => {
  it("uses the existing strict gate, retains source/evidence and never returns customer-ready pixels", async () => {
    const input = await fixture(), store = new InMemoryArtworkAttemptStore(), review = critic();
    const result = await reviewSceneComposition(input, {
      environment: "preview", attemptStore: store, client: review.client, runTier1: clearTier1,
    });
    expect(result).toMatchObject({ kind: "reviewed-scene", status: "accepted", customerActivation: "disabled" });
    expect(result).not.toHaveProperty("dataUrl");
    expect(result).not.toHaveProperty("bytes");
    expect(review.create).toHaveBeenCalledTimes(1);
    expect(review.create.mock.calls[0][1]).toMatchObject({ maxRetries: 0 });
    const row = store.all[0], source = Buffer.from(row.assetBytesBase64, "base64");
    const exactTeaser = customerVisiblePreviewBytes(source);
    const reviewed = Buffer.from(review.create.mock.calls[0][0].messages[0].content[0].source.data, "base64");
    expect(reviewed.equals(exactTeaser)).toBe(true);
    expect(readPngSize(source)).toEqual({ width: 400, height: 600 });
    expect(readPngSize(reviewed)).toEqual({ width: 373, height: 560 });
    expect(row.previewId).toBeNull();
    expect(row.model).toBe("posy-scene-compositor-v1");
    expect(row.quality).toBe("not-applicable");
    expect(row.costUsdMicros).toBe(0);
    expect(row.reviewEvidence?.reviewedAssetHash).toBe(createHash("sha256").update(exactTeaser).digest("hex"));
    expect(row.reviewEvidence?.verdict?.usage).toEqual({ inputTokens: 30, outputTokens: 20 });
    expect(row.reviewEvidence?.composition).toMatchObject({ imageProviderCalls: 0, customerActivation: "disabled" });
    expect(row.runId).toMatch(/^scene-/);
    expect(await store.listForOwner(input.event.id, "another-owner")).toEqual([]);
  });

  it.each([
    { premiumFinish: 4 }, { requiredPresent: [] }, { excludedFound: ["invented child"] },
    { dimensionAssessments: {} }, { teaserChecks: {} }, { artifactFree: 6 },
  ])("rejects a flawed verdict without generating a repair: %j", async (override) => {
    const input = await fixture(), store = new InMemoryArtworkAttemptStore(), review = critic(override);
    const result = await reviewSceneComposition(input, { environment: "preview", attemptStore: store, client: review.client, runTier1: clearTier1 });
    expect(result).toMatchObject({ kind: "reviewed-scene", status: "rejected" });
    expect(review.create).toHaveBeenCalledTimes(1);
    expect(store.all[0].assetBytesBase64.length).toBeGreaterThan(0);
  });

  it.each(["production", "development", ""])('does not call the critic outside Preview: "%s"', async (environment) => {
    const input = await fixture(), store = new InMemoryArtworkAttemptStore(), review = critic();
    expect(await reviewSceneComposition(input, { environment, attemptStore: store, client: review.client })).toEqual({ kind: "blocked", reason: "preview-only" });
    expect(review.create).not.toHaveBeenCalled(); expect(store.all).toHaveLength(0);
  });

  it.each(["brief", "owner", "bytes", "rights", "confirmation"])('blocks invalid input before spending: %s', async (failure) => {
    const input = await fixture(), store = new InMemoryArtworkAttemptStore(), review = critic();
    if (failure === "brief") input.event.vibeDescription += " Include a unicorn.";
    if (failure === "owner") input.event.ownerToken = "different-owner";
    if (failure === "bytes") input.assets[0].png = Buffer.from("replacement");
    if (failure === "rights") input.assets[0].certificate.rightsRecord = "";
    if (failure === "confirmation") (input as any).confirmOneVisionCall = false;
    expect(await reviewSceneComposition(input, { environment: "preview", attemptStore: store, client: review.client })).toMatchObject({ kind: "blocked" });
    expect(review.create).not.toHaveBeenCalled(); expect(store.all).toHaveLength(0);
  });

  it("runs the real deterministic gate before any paid critic call", async () => {
    const input = await fixture(), store = new InMemoryArtworkAttemptStore(), review = critic();
    const result = await reviewSceneComposition(input, { environment: "preview", attemptStore: store, client: review.client });
    expect(result).toMatchObject({ kind: "reviewed-scene", status: "rejected" });
    expect(review.create).not.toHaveBeenCalled();
    expect(store.all[0].tier1Findings.length).toBeGreaterThan(0);
  });

  it("does not issue the optional format repair when its single critic call is malformed", async () => {
    const input = await fixture(), store = new InMemoryArtworkAttemptStore(), review = critic();
    review.create.mockResolvedValue({ content: [{ type: "text", text: "invalid" }], usage: {} } as any);
    const result = await reviewSceneComposition(input, { environment: "preview", attemptStore: store, client: review.client, runTier1: clearTier1 });
    expect(result).toMatchObject({ kind: "reviewed-scene", status: "rejected" });
    expect(review.create).toHaveBeenCalledTimes(1);
  });

  it("retains a timed-out composite and ignores a late passing critic response", async () => {
    const input = await fixture(), store = new InMemoryArtworkAttemptStore(), review = critic();
    let finish!: (value: any) => void;
    review.create.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    vi.useFakeTimers();
    const pending = reviewSceneComposition(input, { environment: "preview", attemptStore: store, client: review.client, runTier1: clearTier1, reviewTimeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(101);
    const result = await pending;
    expect(result).toMatchObject({ kind: "reviewed-scene", status: "rejected", failureCodes: ["vision-unavailable"] });
    finish({ content: [{ type: "text", text: JSON.stringify(allFive) }], usage: {} });
    await vi.advanceTimersByTimeAsync(1);
    expect(store.all).toHaveLength(1); expect(store.all[0].status).toBe("rejected");
  });

  it("cancels an in-flight review and retains private evidence", async () => {
    const input = await fixture(), store = new InMemoryArtworkAttemptStore(), review = critic(), signal = new AbortController();
    review.create.mockImplementation(async () => { signal.abort(); return new Promise(() => {}); });
    const result = await reviewSceneComposition(input, { environment: "preview", attemptStore: store, client: review.client, runTier1: clearTier1, signal: signal.signal });
    expect(result).toEqual({ kind: "blocked", reason: "aborted" });
    expect(store.all[0].status).toBe("rejected");
  });

  it("does not report success if persistence fails", async () => {
    const input = await fixture(), store = new InMemoryArtworkAttemptStore(), review = critic();
    vi.spyOn(store, "record").mockRejectedValue(new Error("database unavailable"));
    expect(await reviewSceneComposition(input, { environment: "preview", attemptStore: store, client: review.client, runTier1: clearTier1 })).toEqual({ kind: "blocked", reason: "retention-failed" });
  });
});

// "Use this design" must apply the exact bytes the host approved and make no
// image provider call. These tests hold that line: identity is content-
// addressed, apply verifies the hash server-side, and the sweeper never takes
// an asset someone is using.

import { describe, expect, it } from "vitest";
import {
  InMemoryPreviewStore,
  PREVIEW_TTL_MS,
  applyPreview,
  assetHashOf,
  cleanupPreviews,
  conceptFingerprint,
  lookupReusablePreview,
  previewIdFor,
  savePreview,
} from "../server/aiFirst/previewStore";
import { concept } from "./aiFirstFixtures";

const bytes = Buffer.from("pretend-png-bytes");

async function seed(store: InMemoryPreviewStore, eventId = 1, now = 1_000) {
  return savePreview({ store, eventId, concept: concept(), bytes, assetUrl: "data:image/png;base64,AAA", source: "ai-generated", now });
}

describe("content addressing", () => {
  it("ignores restyling that cannot change a pixel", () => {
    const a = conceptFingerprint(concept());
    const b = conceptFingerprint(concept({ fontPairingId: "modern-sans", conceptName: "Renamed" }));
    expect(b).toBe(a);
  });

  it("changes when the artwork brief changes", () => {
    const a = conceptFingerprint(concept());
    const b = conceptFingerprint(concept({ art: { ...concept().art, prompt: concept().art.prompt + " Now with brass lanterns lining the path." } }));
    expect(b).not.toBe(a);
  });

  it("scopes a preview id to its event", () => {
    const fingerprint = conceptFingerprint(concept());
    const hash = assetHashOf(bytes);
    expect(previewIdFor(1, fingerprint, hash)).not.toBe(previewIdFor(2, fingerprint, hash));
  });
});

describe("save and reuse", () => {
  it("is idempotent — a second save returns the first row", async () => {
    const store = new InMemoryPreviewStore();
    const first = await seed(store);
    const second = await seed(store, 1, 2_000);
    expect(second.reused).toBe(true);
    expect(second.record.previewId).toBe(first.record.previewId);
    expect(store.size).toBe(1);
  });

  it("reuses across a restyle, which is what makes restyling free", async () => {
    const store = new InMemoryPreviewStore();
    const saved = await seed(store);
    const hit = await lookupReusablePreview(store, 1, concept({ fontPairingId: "modern-sans" }));
    expect(hit?.previewId).toBe(saved.record.previewId);
  });

  it("never serves one event's asset to another", async () => {
    const store = new InMemoryPreviewStore();
    await seed(store, 1);
    expect(await lookupReusablePreview(store, 2, concept())).toBeUndefined();
  });
});

describe("apply", () => {
  it("applies the exact approved bytes and promotes the row", async () => {
    const store = new InMemoryPreviewStore();
    const saved = await seed(store);
    const result = await applyPreview(store, 1, saved.record.previewId, saved.record.assetHash);
    expect(result.ok).toBe(true);
    expect(result.record?.promoted).toBe(true);
    expect(result.record?.assetUrl).toBe(saved.record.assetUrl);
  });

  it("refuses when the client's hash disagrees with the stored one", async () => {
    const store = new InMemoryPreviewStore();
    const saved = await seed(store);
    const result = await applyPreview(store, 1, saved.record.previewId, "not-the-hash");
    expect(result.ok).toBe(false);
    expect(result.failure).toBe("asset-hash-mismatch");
    expect((await store.findByPreviewId(1, saved.record.previewId))?.promoted).toBe(false);
  });

  it("refuses a preview id belonging to another event", async () => {
    const store = new InMemoryPreviewStore();
    const saved = await seed(store);
    expect((await applyPreview(store, 2, saved.record.previewId)).failure).toBe("not-found");
  });
});

describe("cleanup", () => {
  it("sweeps unused previews after seven days", async () => {
    const store = new InMemoryPreviewStore();
    const saved = await seed(store, 1, 0);
    const result = await cleanupPreviews(store, PREVIEW_TTL_MS + 1);
    expect(result.removed).toEqual([saved.record.previewId]);
    expect(store.size).toBe(0);
  });

  it("keeps a promoted asset indefinitely", async () => {
    const store = new InMemoryPreviewStore();
    const saved = await seed(store, 1, 0);
    await applyPreview(store, 1, saved.record.previewId, saved.record.assetHash, 0);
    const result = await cleanupPreviews(store, PREVIEW_TTL_MS * 100);
    expect(result.removed).toEqual([]);
    expect(result.keptPromoted).toBe(1);
    expect(store.size).toBe(1);
  });

  it("spares a preview the host looked at recently", async () => {
    const store = new InMemoryPreviewStore();
    await seed(store, 1, 0);
    await lookupReusablePreview(store, 1, concept(), PREVIEW_TTL_MS);
    expect((await cleanupPreviews(store, PREVIEW_TTL_MS + 1)).removed).toEqual([]);
  });
});

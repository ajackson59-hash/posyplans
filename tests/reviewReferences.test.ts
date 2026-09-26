import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { encodePng } from "../server/aiFirst/png";
import { prepareReviewReferences, type ReviewReference } from "../server/aiFirst/reviewReferences";
import { runVisionGate } from "../server/aiFirst/visionGate";
const bytes = encodePng({ width: 80, height: 60, rgb: new Uint8Array(80 * 60 * 3).fill(120) });
const ref: ReviewReference = { bytes, sha256: createHash("sha256").update(bytes).digest("hex"),
  sourceUrl: "https://example.com/official-reference", role: "identity", subject: "Requested character", region: "Right panel" };

describe("verified reviewer reference pixels", () => {
  it("keeps reference pixels, scoped labels and provenance separate", () => {
    const p = prepareReviewReferences([ref]);
    expect(p.content[1]).toMatchObject({ type: "image", source: { data: bytes.toString("base64") } });
    expect(p.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("identity-only") });
    expect(JSON.stringify(p.content)).not.toContain(ref.sourceUrl);
    expect(p.evidence[0]).not.toHaveProperty("bytes");
    expect(p.evidence[0]).toMatchObject({ sha256: ref.sha256, sourceUrl: ref.sourceUrl });
  });
  it.each([ { ...ref, sha256: "0".repeat(64) }, { ...ref, sourceUrl: "file:///secret" },
    { ...ref, subject: "" } ])("blocks invalid references before any paid request", async reference => {
    const create = vi.fn();
    const result = await runVisionGate({ bytes, referenceImages: [reference], client: { messages: { create } } as any,
      brief: {} as any, concept: {} as any });
    expect(result).toMatchObject({ unavailable: true, passed: false, requestCount: 0 });
    expect(create).not.toHaveBeenCalled();
  });
  it("bounds attachment count and rejects an unassessed craft example", () => {
    expect(() => prepareReviewReferences(Array(5).fill(ref))).toThrow();
    expect(() => prepareReviewReferences([{ ...ref, role: "craft", medium: "photography",
      assessment: { assessor: "AI", assessmentId: "synthetic", standard: "meets-standard", observation: "Looks good" } } as any])).toThrow();
  });
});

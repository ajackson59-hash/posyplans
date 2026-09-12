import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArtworkProviderError, generateArtwork } from "../server/aiFirst/artwork";

const fetchMock = vi.fn();
const prompt = "Private host brief with an owner token and private address";
const request = { prompt, aspectRatio: "9:16" as const, quality: "high" as const, outputFormat: "jpeg" as const };

beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "private-test-key");
  vi.stubGlobal("fetch", fetchMock.mockReset());
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("private structured image provider diagnostics", () => {
  it.each(["input", "output", "unknown"])("retains the %s moderation stage beyond a long reflected message, without retaining private content", async (stage) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: {
      message: `${prompt} ${"x".repeat(400)} private-test-key`, code: "moderation_blocked",
      type: "image_generation_user_error", moderation_details: {
        moderation_stage: stage, categories: ["violence", "sexual", prompt, "violence"],
      },
    } }), { status: 400, headers: { "x-request-id": "req_123456789abcdef0" } }));
    const error = await generateArtwork(request).catch((error) => error);
    expect(error).toBeInstanceOf(ArtworkProviderError);
    expect(error.diagnostics).toMatchObject({ status: 400, code: "moderation_blocked",
      type: "image_generation_user_error", requestId: "req_123456789abcdef0",
      moderationStage: stage, moderationCategories: ["violence", "sexual"],
      model: "gpt-image-2", quality: "high", size: "1024x1536", outputFormat: "jpeg",
      operation: "request", providerRequestCount: 1,
      promptSha256: createHash("sha256").update(prompt).digest("hex"),
    });
    const logged = JSON.stringify(vi.mocked(console.warn).mock.calls) + JSON.stringify(error) + error.message;
    expect(logged).not.toContain(prompt);
    expect(logged).not.toContain("private-test-key");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("recovers a legacy request ID from the message without guessing absent moderation details or retrying", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: {
      message: "Contact support with request ID req_6d811d71a9ff4430acdd7e727638e55b.",
      type: "image_generation_user_error", code: "moderation_block",
    } }), { status: 500 }));
    const error = await generateArtwork(request).catch((error) => error);
    expect(error.diagnostics).toMatchObject({ requestId: "req_6d811d71a9ff4430acdd7e727638e55b",
      code: "moderation_block", moderationStage: "unknown", moderationCategories: [], providerRequestCount: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps non-JSON failures useful and respects the single-request preview cap", async () => {
    fetchMock.mockResolvedValue(new Response(`<html>${prompt}</html>`, {
      status: 503, headers: { "x-request-id": "req_fedcba9876543210" },
    }));
    const error = await generateArtwork({ ...request, maxTransientRetries: 0 }).catch((error) => error);
    expect(error.diagnostics).toMatchObject({ status: 503, code: null, type: null,
      requestId: "req_fedcba9876543210", providerRequestCount: 1, moderationStage: "unknown" });
    expect(error.message).not.toContain(prompt);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("preserves separate request identities and counts for parallel candidates that both fail", async () => {
    for (const suffix of ["11111111", "22222222"]) fetchMock.mockResolvedValueOnce(new Response(
      JSON.stringify({ error: { code: "moderation_blocked", type: "image_generation_user_error" } }),
      { status: 400, headers: { "x-request-id": `req_${suffix}` } },
    ));
    const outcomes = await Promise.allSettled([
      generateArtwork({ ...request, prompt: `${prompt} candidate one`, maxTransientRetries: 0 }),
      generateArtwork({ ...request, prompt: `${prompt} candidate two`, maxTransientRetries: 0 }),
    ]);
    const diagnostics = outcomes.map((outcome) => outcome.status === "rejected" ? outcome.reason.diagnostics : null);
    expect(diagnostics.map((record) => record.requestId)).toEqual(["req_11111111", "req_22222222"]);
    expect(new Set(diagnostics.map((record) => record.promptSha256)).size).toBe(2);
    expect(diagnostics.map((record) => record.providerRequestCount)).toEqual([1, 1]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Event } from "@shared/schema";
import { InMemoryArtworkAttemptStore } from "../server/aiFirst/artworkAttemptStore";
import { MEDIUM_FEASIBILITY_CASES } from "../server/aiFirst/mediumFeasibilityCases";
import { CUSTOMER_PREVIEW_POLICY } from "../server/customerPreviewPolicy";
const providers = vi.hoisted(() => ({ image: vi.fn(), classify: vi.fn() }));
vi.mock("../server/aiFirst/artwork", async original => ({ ...await original<typeof import("../server/aiFirst/artwork")>(), generateArtwork: providers.image }));
vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { create: providers.classify }; } }));
import { customerArtworkEvaluation } from "../server/customerArtworkEvaluation";
const fixture = (index = 0) => ({ id: 42 + index, ownerToken: `fixture-${index}`, eventName: "Artwork evaluation",
  eventType: "Artwork evaluation", inviteStatus: "draft", themeName: "", paletteColors: "[]",
  vibeDescription: MEDIUM_FEASIBILITY_CASES[index].hostBrief } as Event);
beforeEach(() => { vi.stubEnv("VERCEL_ENV", "preview"); vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "a".repeat(40)); providers.image.mockReset(); providers.classify.mockReset(); });
afterEach(() => vi.unstubAllEnvs());
it("requires successful durable claims before any image dispatch and never replays a consumed case", async () => {
  const event = fixture(), store = new InMemoryArtworkAttemptStore();
  providers.image.mockRejectedValue(new Error("simulated provider unavailable"));
  const first = customerArtworkEvaluation(event, store)!;
  await first.generate(event, CUSTOMER_PREVIEW_POLICY);
  const rows = await store.listForOwner(event.id, event.ownerToken);
  expect(rows.find(r => r.reviewEvidence?.customerEvaluation?.stage === "image-claimed")?.reviewEvidence?.customerEvaluation?.imageRequest).toMatchObject({
    prompt: expect.stringContaining(event.vibeDescription), quality: "medium", maxTransientRetries: 0,
  });
  expect(providers.image).toHaveBeenCalledTimes(1);
  await expect(customerArtworkEvaluation(event, store)!.generate(event, CUSTOMER_PREVIEW_POLICY)).rejects.toThrow("claim-conflict");
  expect(providers.image).toHaveBeenCalledTimes(1);
  const broken = new InMemoryArtworkAttemptStore(); broken.recordOnce = vi.fn().mockRejectedValue(new Error("database unavailable"));
  await expect(customerArtworkEvaluation(event, broken)!.generate(event, CUSTOMER_PREVIEW_POLICY)).rejects.toThrow("database unavailable");
  expect(providers.image).toHaveBeenCalledTimes(1);
});
it("retains an incorrect classifier cast and stops before an image", async () => {
  const event = fixture(1), store = new InMemoryArtworkAttemptStore();
  providers.classify.mockResolvedValue({ content: [{ type: "text", text: JSON.stringify({ named: true, label: "Frozen", subjects: ["Elsa"] }) }], usage: { input_tokens: 20, output_tokens: 10 } });
  await expect(customerArtworkEvaluation(event, store)!.classify([event.eventName, event.eventType, event.vibeDescription].join(" "))).rejects.toThrow("classifier-cast-drift");
  expect(providers.classify).toHaveBeenCalledTimes(1); expect(providers.image).not.toHaveBeenCalled();
  const rows = await store.listForOwner(event.id, event.ownerToken);
  expect(rows.at(-1)?.reviewEvidence?.customerEvaluation?.stopReason).toBe("classifier-cast-drift");
});
it("does not activate for production or other events and fails closed on edited fixtures", () => {
  const store = new InMemoryArtworkAttemptStore();
  expect(customerArtworkEvaluation({ ...fixture(), id: 9000 }, store)).toBeNull();
  expect(() => customerArtworkEvaluation({ ...fixture(), vibeDescription: "changed brief" }, store)).toThrow("fixture-or-retention-drift");
  vi.stubEnv("VERCEL_ENV", "production"); expect(customerArtworkEvaluation(fixture(), store)).toBeNull();
});

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import type { Event } from "@shared/schema";
import { InMemoryArtworkAttemptStore } from "../server/aiFirst/artworkAttemptStore";
import { MEDIUM_FEASIBILITY_CASES } from "../server/aiFirst/mediumFeasibilityCases";
import { CUSTOMER_PREVIEW_POLICY } from "../server/customerPreviewPolicy";
const providers = vi.hoisted(() => ({ image: vi.fn(), classify: vi.fn() }));
vi.mock("../server/aiFirst/artwork", async original => ({ ...await original<typeof import("../server/aiFirst/artwork")>(), generateArtwork: providers.image }));
vi.mock("@anthropic-ai/sdk", () => ({ default: class { messages = { create: providers.classify }; } }));
vi.mock("../server/storage", () => ({ storage: {} }));
vi.mock("../server/masterPlannerEntitlement", () => ({ canGenerateDraft: vi.fn() }));
import { customerArtworkEvaluation, googleCustomerArtworkEvaluation, GOOGLE_CUSTOMER_EVALUATION_EVENT,
  GOOGLE_BILLING_EVALUATION_EVENT, GOOGLE_BILLING_EVALUATION_DATASET,
  GOOGLE_DIAGNOSTIC_EVALUATION_EVENT, GOOGLE_DIAGNOSTIC_EVALUATION_DATASET,
  GOOGLE_ORIGINAL_CONTROL_EVENT, GOOGLE_ORIGINAL_CONTROL_DATASET,
  GOOGLE_REPAIRED_FLOW_EVENT, GOOGLE_REPAIRED_FLOW_DATASET,
  GOOGLE_SCREENING_CASE_INDICES, GOOGLE_SCREENING_DATASET } from "../server/customerArtworkEvaluation";
import { registerPrePaymentPreviewQualityRoutes } from "../server/prePaymentPreviewQualityRoutes";
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
it("closes unrun customer fixtures before reservation, scheduling or paid providers", async () => {
  const event = { ...fixture(2), prePaymentPreviewAttempts: 0, prePaymentPreviewUrl: "", prePaymentPreviewUsedAt: null };
  const reserve = vi.fn(), schedule = vi.fn(), generate = vi.fn(), classify = vi.fn();
  const app = express(); app.use(express.json());
  registerPrePaymentPreviewQualityRoutes(app, { store: {
    getEventByOwnerToken: async () => event, updateEventById: vi.fn(),
    reservePrePaymentPreview: reserve, completePrePaymentPreview: vi.fn(),
  }, isUnlocked: async () => false, mode: () => "quality-image", autoNamedEnabled: () => true,
    generate, classifyNamedReference: classify, schedule, artworkAttemptStore: new InMemoryArtworkAttemptStore() });
  const response = await request(app).post(`/api/events/owner/${event.ownerToken}/prepayment-preview`).send({ email: "fixture@example.com" });
  expect(response.status).toBe(409);
  for (const boundary of [reserve, schedule, generate, classify, providers.image, providers.classify]) expect(boundary).not.toHaveBeenCalled();
});

it("does not spend or consume the Google fixture when its Preview key is missing", async () => {
  vi.stubEnv("GEMINI_API_KEY", "");
  const event = { ...fixture(1), id: GOOGLE_CUSTOMER_EVALUATION_EVENT, prePaymentPreviewAttempts: 0, prePaymentPreviewUrl: "", prePaymentPreviewUsedAt: null };
  const reserve = vi.fn(), schedule = vi.fn(), generate = vi.fn(), classify = vi.fn();
  const app = express(); app.use(express.json());
  const store = new InMemoryArtworkAttemptStore();
  registerPrePaymentPreviewQualityRoutes(app, { store: {
    getEventByOwnerToken: async () => event, updateEventById: vi.fn(),
    reservePrePaymentPreview: reserve, completePrePaymentPreview: vi.fn(),
  }, isUnlocked: async () => false, mode: () => "quality-image", autoNamedEnabled: () => true,
    generate, classifyNamedReference: classify, schedule, artworkAttemptStore: store });
  const response = await request(app).post(`/api/events/owner/${event.ownerToken}/prepayment-preview`).send({ email: "fixture@example.com" });
  expect(response.status).toBe(503); expect(response.body.code).toBe("google_api_key_missing");
  const readOnly = await request(app).get(`/api/events/owner/${event.ownerToken}/prepayment-preview/readiness`);
  expect(readOnly.status).toBe(200);
  expect(readOnly.body.providerEvaluation).toEqual({ provider: "google", model: "gemini-3.1-flash-image", configured: false, namedGenerationEnabled: true });
  for (const boundary of [reserve, schedule, generate, classify, providers.image, providers.classify]) expect(boundary).not.toHaveBeenCalled();
  expect(store.all).toHaveLength(0);
});

it("isolates Google claims from the closed GPT cohort and retains the selected provider", async () => {
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  const event = { ...fixture(1), id: GOOGLE_CUSTOMER_EVALUATION_EVENT }, store = new InMemoryArtworkAttemptStore();
  expect(customerArtworkEvaluation(event, store)).toBeNull();
  expect(googleCustomerArtworkEvaluation(fixture(1), store)).toBeNull();
  providers.image.mockRejectedValue(new Error("offline test provider stop"));
  await googleCustomerArtworkEvaluation(event, store)!.generate(event, CUSTOMER_PREVIEW_POLICY);
  expect(providers.image).toHaveBeenCalledWith(expect.objectContaining({ model: "gemini-3.1-flash-image", prompt: expect.stringContaining(event.vibeDescription) }));
  expect(store.all.every(row => row.model === "gemini-3.1-flash-image" && row.size === "768x1376")).toBe(true);
  await expect(googleCustomerArtworkEvaluation(event, store)!.generate(event, CUSTOMER_PREVIEW_POLICY)).rejects.toThrow("claim-conflict");
  expect(providers.image).toHaveBeenCalledTimes(1);
  vi.stubEnv("VERCEL_ENV", "production");
  expect(googleCustomerArtworkEvaluation(event, store)).toBeNull();
});

it.each([
  [GOOGLE_BILLING_EVALUATION_EVENT, GOOGLE_BILLING_EVALUATION_DATASET, 1],
  [GOOGLE_DIAGNOSTIC_EVALUATION_EVENT, GOOGLE_DIAGNOSTIC_EVALUATION_DATASET, 1],
  [GOOGLE_ORIGINAL_CONTROL_EVENT, GOOGLE_ORIGINAL_CONTROL_DATASET, 4],
  [GOOGLE_REPAIRED_FLOW_EVENT, GOOGLE_REPAIRED_FLOW_DATASET, 4],
  ...Object.entries(GOOGLE_SCREENING_CASE_INDICES).map(([eventId, index]) => [Number(eventId), GOOGLE_SCREENING_DATASET, index]),
])("isolates fresh Google case %s without reopening the consumed case", async (eventId, datasetId, index) => {
  vi.stubEnv("GEMINI_API_KEY", "test-key");
  const store = new InMemoryArtworkAttemptStore();
  const oldEvent = { ...fixture(1), id: GOOGLE_CUSTOMER_EVALUATION_EVENT };
  const newEvent = { ...fixture(index as number), id: eventId as number, ownerToken: "isolated-fixture" };
  providers.image.mockRejectedValue(new Error("offline provider stop"));
  await googleCustomerArtworkEvaluation(oldEvent, store)!.generate(oldEvent, CUSTOMER_PREVIEW_POLICY);
  const oldRows = structuredClone(await store.listForOwner(oldEvent.id, oldEvent.ownerToken));
  await googleCustomerArtworkEvaluation(newEvent, store)!.generate(newEvent, CUSTOMER_PREVIEW_POLICY);
  expect(providers.image).toHaveBeenCalledTimes(2);
  const newRows = await store.listForOwner(newEvent.id, newEvent.ownerToken);
  expect(newRows.length).toBeGreaterThan(0);
  expect(newRows.every(row => row.runId === datasetId)).toBe(true);
  expect(await store.listForOwner(oldEvent.id, oldEvent.ownerToken)).toEqual(oldRows);
  for (const event of [oldEvent, newEvent]) {
    await expect(googleCustomerArtworkEvaluation(event, store)!.generate(event, CUSTOMER_PREVIEW_POLICY)).rejects.toThrow("claim-conflict");
  }
  expect(providers.image).toHaveBeenCalledTimes(2);
  expect(googleCustomerArtworkEvaluation({ ...newEvent, id: 9000 }, store)).toBeNull();
  expect(() => googleCustomerArtworkEvaluation({ ...newEvent, vibeDescription: "edited brief" }, store)).toThrow("fixture-or-retention-drift");
  vi.stubEnv("VERCEL_ENV", "production");
  expect(googleCustomerArtworkEvaluation(newEvent, store)).toBeNull();
});

it("blocks screening outside its Preview branch before reservation or paid providers", async () => {
  vi.stubEnv("VERCEL_GIT_COMMIT_REF", "another-preview");
  const event = { ...fixture(), id: 55, prePaymentPreviewAttempts: 0, prePaymentPreviewUrl: "", prePaymentPreviewUsedAt: null };
  const reserve = vi.fn(), schedule = vi.fn(), generate = vi.fn(), classify = vi.fn();
  const app = express(); app.use(express.json());
  registerPrePaymentPreviewQualityRoutes(app, { store: {
    getEventByOwnerToken: async () => event, updateEventById: vi.fn(),
    reservePrePaymentPreview: reserve, completePrePaymentPreview: vi.fn(),
  }, isUnlocked: async () => false, mode: () => "quality-image", autoNamedEnabled: () => true,
    generate, classifyNamedReference: classify, schedule, artworkAttemptStore: new InMemoryArtworkAttemptStore() });
  const response = await request(app).post(`/api/events/owner/${event.ownerToken}/prepayment-preview`).send({ email: "fixture@example.com" });
  expect(response.status).toBe(409);
  expect(response.body.code).toBe("google_evaluation_closed");
  for (const boundary of [reserve, schedule, generate, classify, providers.image, providers.classify]) expect(boundary).not.toHaveBeenCalled();
});

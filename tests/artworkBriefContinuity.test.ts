import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import type { Event } from "@shared/schema";
import { buildArtworkPrompt, parseAiFirstConcept } from "@shared/aiFirstInvite";
import { buildEventBrief } from "../server/aiFirst/brief";
import { briefForHostDirection } from "../server/aiFirst/conceptPreflight";
import { bindConceptsToBrief } from "../server/aiFirst/conceptBindings";
import { buildArtworkConstraints, buildUserPrompt } from "../server/aiFirst/prompt";
import { preflightConceptQuartet } from "../server/aiFirst/conceptQuartet";
import { runVisionGate, visibleReviewRequirementsForBrief } from "../server/aiFirst/visionGate";
import { buildQualityLockedPreviewBrief } from "../server/prePaymentPreviewQuality";
import { concept } from "./aiFirstFixtures";
import { InMemoryPreviewStore, lookupReusablePreview, savePreview } from "../server/aiFirst/previewStore";
import { encodePng } from "../server/aiFirst/png";

const event = (vibeDescription: string) => ({
  eventName: "A celebration", eventType: "Party", themeName: "Moon garden",
  vibeDescription, paletteColors: "[]", estimatedGuestCount: 20,
}) as Event;
const brief = (words: string) => buildEventBrief({ event: event(words), dna: {}, guestCount: 20 });

describe("artwork brief continuity across customer generation paths", () => {
  it("makes every explicit scene directive a reviewed requirement in both teaser and invitation", async () => {
    const words = "Include silver leaves. Show a blue cake. Feature a fountain. Depict two birds. Include a moon arch. Show exactly six lanterns.";
    const invitation = brief(words);
    const teaser = (await buildQualityLockedPreviewBrief(event(words), "", null)).brief;
    for (const target of [invitation, teaser]) {
      const facts = visibleReviewRequirementsForBrief(target);
      expect(facts).toEqual(expect.arrayContaining([
        "silver leaves", "a blue cake", "a fountain", "two birds", "a moon arch", "exactly six lanterns",
      ]));
      expect(buildArtworkConstraints(target)).toContain(words);
    }
  });

  it("keeps the end of a long directive instead of clipping the checked requirement", async () => {
    const detail = `a garden with ${"silver foliage and blue flowers, ".repeat(9)}exactly two white doves above the arch`;
    const words = `Include ${detail}.`;
    for (const target of [brief(words), (await buildQualityLockedPreviewBrief(event(words), "", null)).brief]) {
      expect(visibleReviewRequirementsForBrief(target)).toContain(detail);
    }
  });

  it.each([
    "No candles; show a blue cake.",
    "Do not include candles but show a blue cake.",
    "Show a blue cake, without candles.",
  ])("separates a requested object from an exclusion: %s", words => {
    const target = brief(words);
    expect(visibleReviewRequirementsForBrief(target)).toContain("a blue cake");
    const exclusions = target.requirements.excluded.filter(item => item.startsWith("[HOST EXCLUSION]"));
    expect(exclusions).toContain("[HOST EXCLUSION] candles");
    expect(exclusions.join(" ")).not.toContain("blue cake");
    expect(visibleReviewRequirementsForBrief(target).join(" ")).not.toContain("candles");
  });

  it("keeps exclusions after the fourth clause binding", () => {
    const target = brief("No candles. No balloons. No bunting. No stickers. No portraits. No bows.");
    expect(target.requirements.excluded).toEqual(expect.arrayContaining([
      "[HOST EXCLUSION] candles", "[HOST EXCLUSION] portraits", "[HOST EXCLUSION] bows",
    ]));
  });

  it("preserves the full replacement direction instead of replacing it with a catalog label", () => {
    const original = { ...brief("Construction in gouache; include a dump truck."), themeName: "construction" };
    const direction = "KPop Demon Hunters. Medium: lacquer inlay. Include a silver moon arch. No extra characters.";
    const changed = briefForHostDirection(original, direction);
    expect(changed.visualIdentityOverride).toBe(direction);
    expect(buildArtworkConstraints(changed)).toContain("lacquer inlay");
    expect(visibleReviewRequirementsForBrief(changed)).toContain("a silver moon arch");
    expect(changed.requirements.excluded).toContain("[HOST EXCLUSION] extra characters");
    expect(buildArtworkConstraints(changed)).not.toContain("dump truck");
  });

  it.each(["medium", "composition", "prompt"] as const)("rejects an over-budget art.%s before it can silently lose its ending", field => {
    const candidate = concept();
    candidate.art[field] = `${"important direction ".repeat(100)}the final required subject`;
    const parsed = parseAiFirstConcept(candidate);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.errors.join(" ")).toContain(`art.${field}`);
  });

  it("keeps creative prompt content when adding an event fact", () => {
    const target = { ...brief("Moon garden"), milestone: "4th", eventType: "birthday" };
    const candidate = concept();
    candidate.art.prompt = `${"Silver leaves in moonlight. ".repeat(42)}EXACT FINAL DETAIL`;
    const bound = bindConceptsToBrief([candidate], target)[0];
    expect(bound.art.prompt).toContain(candidate.art.prompt);
  });

  it("does not instruct a requested photograph to become an illustration", () => {
    const candidate = concept();
    candidate.art.medium = "photographic";
    expect(buildArtworkPrompt(candidate)).not.toContain("photographic illustration");
  });

  it("reuses unchanged artwork but cannot reuse the old brief's approval after an exclusion changes", async () => {
    const store = new InMemoryPreviewStore();
    const candidate = concept();
    const original = buildArtworkConstraints(brief("Moon garden. Include silver leaves."));
    const changed = buildArtworkConstraints(brief("Moon garden. Include silver leaves. No birds."));
    const saved = await savePreview({ store, eventId: 1, concept: candidate, artworkContext: original,
      bytes: Buffer.from("retained fixture bytes"), assetUrl: "fixture", source: "ai-generated" });
    expect((await lookupReusablePreview(store, 1, candidate, undefined, original))?.previewId).toBe(saved.record.previewId);
    expect(await lookupReusablePreview(store, 1, candidate, undefined, changed)).toBeUndefined();
    expect((await lookupReusablePreview(store, 1, { ...candidate, fontPairingId: "modern-sans" }, undefined, original))?.previewId).toBe(saved.record.previewId);
  });

  it("does not treat a legacy concept-only record as approval of the current brief", async () => {
    const store = new InMemoryPreviewStore();
    const candidate = concept();
    await savePreview({ store, eventId: 1, concept: candidate, bytes: Buffer.from("legacy fixture"), assetUrl: "fixture", source: "ai-generated" });
    expect(await lookupReusablePreview(store, 1, candidate, undefined, buildArtworkConstraints(brief("Moon garden")))).toBeUndefined();
  });

  it("sends supplied identity context to the invitation generator as well as the critic", () => {
    const target = { ...brief("Moon garden"), inspirationNotes: "The requested character has a silver crescent brooch and braided hair." };
    expect(buildArtworkConstraints(target)).toContain(target.inspirationNotes);
  });

  it("does not delete a requested crane to enforce a preset construction lane", () => {
    const target = { ...brief("Construction in watercolor. Include a red crane and lumber in every direction."), themeName: "construction" };
    for (const focalStrategy of ["narrative-scene", "graphic-world", "tactile-still-life"] as const) {
      const candidate = concept({ focalStrategy, art: { medium: "watercolor", composition: "A red crane beside lumber",
        prompt: "A red crane lifting timber beside measured lumber in a construction celebration." } });
      expect(bindConceptsToBrief([candidate], target)[0].art.prompt).toBe(candidate.art.prompt);
    }
    expect(buildUserPrompt({ brief: target })).not.toContain("machine-free jobsite");
    const candidates = [0, 1, 2, 3].map(index => concept({
      conceptName: `Crane ${index}`, art: { medium: "watercolor", composition: `crane viewpoint ${index}`,
        prompt: "A red crane lifting timber beside measured lumber in a construction celebration." },
    }));
    expect(preflightConceptQuartet(candidates, target).errors.join(" ")).not.toMatch(/repeats crane|machine-led construction artwork/);
  });

  it.each(["teaser", "invitation"] as const)("fails %s review when a later host requirement is omitted despite perfect scores", async reviewMode => {
    const target = brief("Include silver leaves. Show a blue cake. Feature a fountain. Depict two birds. Include a moon arch. Show exactly six lanterns.");
    let calls = 0;
    const client = { messages: { create: async (body: any) => {
      calls++;
      const requirements: string[] = body.output_config.format.schema.properties.requiredPresent.items.properties.requirement.enum;
      expect(requirements).toContain("exactly six lanterns");
      const scores = { textLogoWatermarkFree: 5, artifactFree: 5, premiumFinish: 5,
        briefFidelity: 5, compositionQuality: 5, ageAppropriate: 5 };
      return { stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text: JSON.stringify({
        ...scores, requiredPresent: requirements.filter(item => item !== "exactly six lanterns").map(requirement => ({
          requirement, present: true, evidence: "Scripted fixture observation; not actual image quality evidence",
        })), excludedFound: [], notes: "Mock response intentionally omitted the final host requirement",
        dimensionAssessments: Object.fromEntries(Object.keys(scores).map(key => [key, {
          status: "clear", criterion: "none", location: "whole image", observation: "Scripted positive observation",
        }])), teaserChecks: { milestone: { correct: true, evidence: "Fixture" }, identity: { accurate: true, evidence: "Fixture" },
          purchase: { wouldCreatePurchaseDesire: true, evidence: "Fixture" } },
      }) }] };
    } } } as unknown as Anthropic;
    const bytes = encodePng({ width: 2, height: 3, rgb: new Uint8Array(18).fill(150) });
    const verdict = await runVisionGate({ brief: target, concept: concept(), bytes, client, reviewMode, maxFormatRepairs: 0 });
    expect(calls).toBe(1);
    expect(verdict.passed).toBe(false);
    expect(verdict.failureCodes).toContain("brief-fidelity");
    expect(verdict.requiredPresent.find(item => item.requirement === "exactly six lanterns")?.present).toBe(false);
  });
});

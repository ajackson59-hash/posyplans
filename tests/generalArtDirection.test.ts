import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import type { Event } from "@shared/schema";
import { buildEventBrief } from "../server/aiFirst/brief";
import { buildArtDirectionContract, conflictsWithRequestedMedium, resolveArtDirection } from "../server/aiFirst/artDirection";
import { buildArtworkConstraints, buildUserPrompt } from "../server/aiFirst/prompt";
import { preflightConceptQuartet } from "../server/aiFirst/conceptQuartet";
import { buildQualityLockedPreviewBrief, generateQualityLockedPreview, type NamedCreativeReference } from "../server/prePaymentPreviewQuality";
import { encodePng } from "../server/aiFirst/png";
import { runVisionGate } from "../server/aiFirst/visionGate";
import { runTier1Checks } from "../server/aiFirst/tier1";

const cases = [
  ["Original construction", "watercolor", false],
  ["Disney Frozen — Elsa and Anna", "cel-shaded", true],
  ["Disney Mickey and Minnie", "flat vector", true],
  ["Disney Moana", "3D", true],
  ["Unicorn Academy", "watercolour", true],
  ["KPop Demon Hunters", "anime", true],
  ["Adult garden dinner", "photographic", false],
  ["Black-tie wedding", "line art", false],
  ["Abstract geometric celebration", "vector art", false],
  ["Family portrait party", "oil painting", false],
  ["Original woodland animals", "stained glass", false],
  ["First birthday stars", "embroidery", false],
  ["Disney Alice in Wonderland", "cut-paper collage", true],
  ["Original celestial gala", "medium: lacquer inlay", false],
] as const;

function event(themeName: string, treatment: string) {
  return { id: 41, ownerToken: "fixture-owner", eventName: "A special celebration", eventType: "Party",
    themeName, vibeDescription: `${treatment}. Include a garden and a blue cake as the foreground hero. No candles or extra characters.`,
    paletteColors: '["blue","ivory"]', estimatedGuestCount: 20 } as Event;
}
const png = encodePng({ width: 400, height: 600, rgb: new Uint8Array(400 * 600 * 3).fill(170) });
const tier1 = () => ({ passed: true, findings: [], durationMs: 1 });
const scores = { textLogoWatermarkFree: 5, artifactFree: 5, premiumFinish: 5,
  briefFidelity: 5, compositionQuality: 5, ageAppropriate: 5 };
const passing = { passed: true, unavailable: false, scores, failureCodes: [], requiredPresent: [],
  excludedFound: [], notes: "Engineering fixture, not real art evidence", durationMs: 1, usage: { inputTokens: 1, outputTokens: 1 } };

/** Named resolver output is injected; this suite proves transport, not visual recognition. */
function named(label: string): NamedCreativeReference {
  return { id: "fixture-resolved-identity", label, trigger: /never/, palette: ["#000000", "#0000FF", "#FFFFFF", "#FFFFEE"],
    cues: [label], requirements: [`Every named subject in ${label} is independently recognizable in the requested version`] };
}

describe("general artwork direction contract", () => {
  it.each(cases)("preserves %s in %s across both candidates and review input", async (theme, treatment, isNamed) => {
    const input = event(theme, treatment);
    const generateImage = vi.fn(async () => ({ bytes: png, dataUrl: "", durationMs: 1 }));
    const review = vi.fn(async () => passing);
    const onApproved = vi.fn(async () => {});
    const result = await generateQualityLockedPreview(input, { generateImage, runTier1: tier1, runVision: review,
      maxCandidates: 2, parallelCandidates: true, namedReference: isNamed ? named(theme) : null, onApproved });
    expect(result.kind).toBe("approved-image"); expect(generateImage).toHaveBeenCalledTimes(2);
    expect(review).toHaveBeenCalledTimes(2); expect(onApproved).toHaveBeenCalledTimes(1);
    for (const [request] of generateImage.mock.calls as any[]) {
      expect(request.prompt).toContain(theme); expect(request.prompt).toContain(treatment.toLowerCase());
      expect(request.prompt).toContain("blue cake as the foreground hero");
      expect(request.prompt).toContain("No candles or extra characters");
      expect(request.prompt).not.toContain("DEFAULT ORIGINAL-ILLUSTRATION MEDIUM");
      expect(request.prompt).not.toContain("BINDING FOOD STAGING — Integrate edible props into one built-in rear");
      expect(request.maxTransientRetries).toBe(0);
    }
    expect(generateImage.mock.calls[1][0].prompt).toContain("SAME requested treatment");
    const reviewedBrief = review.mock.calls[0][0].brief;
    expect(reviewedBrief.vibe).toBe(input.vibeDescription);
    expect(reviewedBrief.colors).toEqual(["blue", "ivory"]);
    expect(buildArtworkConstraints(reviewedBrief)).toContain(treatment.toLowerCase());
  });

  it.each(["No 3D; use watercolor.", "Avoid photorealism, use watercolor.", "Not gouache but watercolor.",
    "Don't use 3D; use watercolor.", "Never render photography; use watercolor.",
    "Avoid gouache in favor of watercolor."])(
    "does not promote an excluded medium into a requested one: %s", vibe => {
      expect(resolveArtDirection({ themeName: "Disney", vibe }).media).toEqual(["watercolor"]);
    });

  it("does not turn a palette or compatible style into a conflicting material medium", () => {
    expect(resolveArtDirection({ themeName: "Flowers", vibe: "pastel pink palette; watercolor" }).media).toEqual(["watercolor"]);
    const brief = buildEventBrief({ event: event("Garden", "minimalist"), dna: {}, guestCount: 20 });
    expect(conflictsWithRequestedMedium(brief, "watercolor")).toBe(false);
  });

  it("sends intentional flat artwork through real pixel checks to mandatory vision review, then keeps a failed verdict private", async () => {
    const input = event("Abstract geometric celebration", "flat vector");
    const { brief, concept } = await buildQualityLockedPreviewBrief(input);
    const width = 400, height = 600;
    const rgb = new Uint8Array(width * height * 3).fill(240);
    for (let y = 140; y < 450; y++) for (let x = 100; x < 300; x++) {
      if (Math.hypot((x - 200) / 100, (y - 295) / 155) < 1) rgb.fill(30, (y * width + x) * 3, (y * width + x) * 3 + 3);
    }
    const flatPng = encodePng({ width, height, rgb });
    expect(flatPng.length).toBeLessThan(40 * 1024);
    const realTier1 = (request: Parameters<typeof runTier1Checks>[0]) => runTier1Checks({ ...request, ocr: false });
    const structural = realTier1({ bytes: flatPng, concept, brief, overlayCoverage: 0, artworkOpacity: 1, layoutApplied: false });
    expect(structural.passed).toBe(true);
    expect(structural.findings.map(f => f.code)).toEqual(expect.arrayContaining(["file-size", "flat-bands", "printed-margin"]));
    expect(structural.findings.every(f => !f.critical)).toBe(true);
    const review = vi.fn(async () => ({ ...passing, passed: false, failureCodes: ["brief-fidelity" as const] }));
    const onApproved = vi.fn();
    const result = await generateQualityLockedPreview(input, {
      generateImage: async () => ({ bytes: flatPng, dataUrl: "", durationMs: 1 }),
      runTier1: realTier1, runVision: review, onApproved, maxCandidates: 1,
    });
    expect(review).toHaveBeenCalledTimes(1); expect(onApproved).not.toHaveBeenCalled();
    expect(result.kind).toBe("rejected");
    expect(realTier1({ bytes: png, concept, brief, overlayCoverage: 0, artworkOpacity: 1, layoutApplied: false })
      .findings.some(f => f.code === "blank-degenerate" && f.critical)).toBe(true);
    expect(realTier1({ bytes: Buffer.from("corrupt"), concept, brief, overlayCoverage: 0, artworkOpacity: 1 })
      .findings.some(f => f.code === "file-integrity" && f.critical)).toBe(true);
    const tiny = encodePng({ width: 2, height: 3, rgb: Uint8Array.from([0, 0, 0, 255, 255, 255, 0, 0, 0, 255, 255, 255, 0, 0, 0, 255, 255, 255]) });
    expect(realTier1({ bytes: tiny, concept, brief, overlayCoverage: 0, artworkOpacity: 1, layoutApplied: false })
      .findings.some(f => f.code === "dimensions" && f.critical)).toBe(true);
  });

  it("preserves unfamiliar free-form art language and a current direction override", () => {
    const brief = buildEventBrief({ event: event("Old construction theme", "gouache"), dna: {}, guestCount: 20 });
    brief.visualIdentityOverride = "Original moon garden; medium: lacquer inlay; dense silver foliage";
    const contract = buildArtDirectionContract(brief);
    expect(contract).toContain(brief.visualIdentityOverride);
    expect(contract).not.toContain("Old construction theme"); expect(contract).not.toContain("gouache");
    expect(resolveArtDirection(brief).requestedTreatment).toBe("medium: lacquer inlay");
  });

  it("does not forbid named cartoons merely because the celebrant is an adult", () => {
    const brief = buildEventBrief({ event: { ...event("Disney Mickey Mouse", "flat vector"), eventName: "Alex's 40th birthday" }, dna: {}, guestCount: 20 });
    expect(brief.requirements.excluded).not.toContain("cartoon characters");
    expect(buildArtworkConstraints(brief)).toContain("Disney Mickey Mouse");
  });

  it("keeps paid concept variety within the selected medium and catches a known substitution before image spend", async () => {
    const { brief, concept } = await buildQualityLockedPreviewBrief(event("Adult garden dinner", "watercolor"));
    const prompt = buildUserPrompt({ brief });
    expect(prompt).toContain("HOST TREATMENT: watercolor");
    expect(prompt).not.toContain("art.medium must be gouache");
    expect(prompt).not.toContain("art.medium must be linocut");
    expect(conflictsWithRequestedMedium(brief, "gouache")).toBe(true);
    expect(conflictsWithRequestedMedium(brief, "editorial watercolour")).toBe(false);
    const quartet = [0, 1, 2, 3].map(i => ({ ...concept, conceptName: `Direction ${i}`, art: { ...concept.art, medium: "watercolor" } }));
    const checked = preflightConceptQuartet(quartet, brief);
    expect(checked.errors.some(e => /distinct illustration media/.test(e))).toBe(false);
    quartet[0].art.medium = "gouache";
    expect(preflightConceptQuartet(quartet, brief).errors.some(e => /substitutes another medium/.test(e))).toBe(true);
  });

  it("holds a style mismatch private even when every object and all numeric scores pass", async () => {
    const { brief, concept } = await buildQualityLockedPreviewBrief(event("Disney Mickey and Minnie", "flat vector"), "", named("Disney Mickey and Minnie"));
    const create = vi.fn(async (body: any) => {
      const requirements = body.output_config.format.schema.properties.requiredPresent.items.properties.requirement.enum;
      return { stop_reason: "end_turn", usage: { input_tokens: 5, output_tokens: 5 }, content: [{ type: "text", text: JSON.stringify({
        ...scores, requiredPresent: requirements.map((requirement: string) => ({ requirement,
          present: !requirement.includes("requested artwork treatment"), evidence: "Fixture: supplied image used a painted treatment" })),
        excludedFound: [], notes: "Fixture only",
        dimensionEvidence: Object.fromEntries(Object.keys(scores).map(k => [k, "Scripted observation"])),
        teaserChecks: { milestone: { correct: true, evidence: "No candles" }, identity: { accurate: true, evidence: "Named identities" },
          purchase: { wouldCreatePurchaseDesire: true, evidence: "Otherwise polished" } },
      }) }] };
    });
    const result = await runVisionGate({ bytes: png, concept, brief, reviewMode: "teaser", maxFormatRepairs: 0,
      client: { messages: { create } } as unknown as Anthropic });
    expect(result.passed).toBe(false); expect(result.failureCodes).toContain("brief-fidelity");
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].system).toContain("Do not penalize deliberate flat vector art for lacking depth");
    expect(result.requiredPresent.some(r => /requested artwork treatment/.test(r.requirement) && !r.present)).toBe(true);
  });
});

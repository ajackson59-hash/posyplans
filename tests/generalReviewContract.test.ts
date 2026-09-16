// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { buildEventBrief } from "../server/aiFirst/brief";
import { runVisionGate } from "../server/aiFirst/visionGate";
import { validateReviewEvidence } from "../server/aiFirst/reviewEvidence";
import { concept } from "./aiFirstFixtures";
import type { Event } from "@shared/schema";

const scores = { textLogoWatermarkFree: 5, artifactFree: 5, premiumFinish: 5,
  briefFidelity: 5, compositionQuality: 5, ageAppropriate: 5 };
const dimensions = () => Object.fromEntries(Object.keys(scores).map(key => [key, {
  status: "clear", criterion: "none", location: "Full canvas", observation: "Synthetic positive observation",
  ...(key === "premiumFinish" ? { basis: "observed-craft" } : key === "compositionQuality" ? { basis: "observed-layout" } : {}),
}]));
const themes = [
  ["Disney Frozen", "Elsa’s braided hair and ice-blue gown — faithful to the requested version", true],
  ["Netflix KPop Demon Hunters", "Rumi’s facial proportions, violet braid, and requested stage costume", true],
  ["Pokémon", "Pikachu’s recognizable nonhuman face, ears and tail silhouette", true],
  ["Sesame Street", "Elmo’s characteristic furry silhouette and facial proportions", true],
  ["Unfamiliar Star Academy", "Nova, as described by the host, with a crescent braid and copper boots", true],
  ["Original garden dinner", "Exactly six lanterns above a blue cake; no characters", false],
  ["Construction celebration", "An excavator holding three unnumbered balloons", false],
  ["Abstract geometric gala", "Silver circles overlapping cobalt arches, with deliberate negative space", false],
] as const;

function requestItems(body: any): { id: string; requirement: string }[] {
  const text = body.messages[0].content.find((x: any) => x.type === "text").text;
  const section = text.split("VISIBLE MUST-HAVES")[1].split("EXCLUDED:")[0];
  const json = section.slice(section.indexOf("\n") + 1).trim();
  // Legacy fallback permits reproducing the defect before changing production code.
  if (json.startsWith("[")) return JSON.parse(json);
  return section.split("\n").filter((x: string) => x.startsWith("- "))
    .map((x: string, i: number) => ({ id: `r${i + 1}`, requirement: x.slice(2) }));
}
function reply(items: { id: string; requirement: string }[]) {
  return { ...scores, requiredPresent: items.map(x => ({ requirementId: x.id, present: true,
    evidence: "Synthetic observation without copying the requirement's prose" })),
    excludedFound: [], notes: "Offline contract test, not a visual judgment", dimensionAssessments: dimensions(),
    mediumAssessment: { status: "not-requested", observedTreatment: "Deliberate graphic illustration",
      location: "Full canvas", observation: "Controlled contours and flat color shapes" },
    teaserChecks: { identity: { accurate: true, evidence: "Synthetic identity or original-world observation" },
      milestone: { correct: true, evidence: "Synthetic count observation" },
      purchase: { wouldCreatePurchaseDesire: true, evidence: "Synthetic polished composition" } } };
}
async function run(theme: string, detail: string, named: boolean, mode: "teaser" | "invitation",
  edit: (body: any, items: { id: string; requirement: string }[]) => void = () => {}) {
  const brief = buildEventBrief({ event: { eventName: "Contract fixture", eventType: "Party", themeName: theme,
    vibeDescription: detail, paletteColors: "[]" } as Event, dna: {}, guestCount: null });
  brief.requirements = { required: [`[VISIBLE ${named ? "NAMED IDENTITY" : "HOST DETAIL"}] ${detail}`], preferred: [], excluded: [] };
  let raw = "";
  const create = vi.fn(async (request: any) => {
    const items = requestItems(request), body = reply(items); edit(body, items);
    raw = JSON.stringify(body);
    return { stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text: raw }] };
  });
  const verdict = await runVisionGate({ bytes: Buffer.from("offline fixture"), brief, concept: concept(), reviewMode: mode,
    maxFormatRepairs: 0, client: { messages: { create } } as any });
  return { verdict, create, raw };
}

describe.each(["teaser", "invitation"] as const)("general %s review contract", mode => {
  it.each(themes)("binds %s requirements by ID without copied prose", async (theme, detail, named) => {
    const { verdict, create } = await run(theme, detail, named, mode, body => body.requiredPresent.reverse());
    expect(verdict.passed).toBe(true);
    expect(verdict.requiredPresent.find(x => x.requirement === detail)?.present).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
  });
  it.each(["missing", "duplicate", "unknown", "legacy-label", "no-evidence", "string-boolean"])(
    "distinguishes %s answers from an observed missing subject", async kind => {
      const { verdict } = await run("Original garden", "Six lanterns", false, mode, body => {
        if (kind === "missing") body.requiredPresent = [];
        if (kind === "duplicate") body.requiredPresent.push({ ...body.requiredPresent[0] });
        if (kind === "unknown") body.requiredPresent[0].requirementId = "unrequested";
        if (kind === "legacy-label") { delete body.requiredPresent[0].requirementId; body.requiredPresent[0].requirement = "Six lanterns"; }
        if (kind === "no-evidence") body.requiredPresent[0].evidence = " ";
        if (kind === "string-boolean") body.requiredPresent[0].present = "true";
      });
      expect(verdict.passed).toBe(false);
      expect(verdict.failureCodes).toContain("review-checklist-invalid");
      expect((verdict.requiredPresent[0] as any).reviewStatus).toBe("unresolved");
      expect(verdict.reviewIntegrity?.valid).toBe(false);
    });
  it("preserves the exact raw answer before normalization for private diagnosis", async () => {
    const { verdict, raw } = await run("Unknown reference", "Host supplied character", true, mode);
    expect((verdict as any).providerResponses).toEqual([{ text: raw, stopReason: "end_turn" }]);
  });
  it("rejects a reported character mismatch even when execution is excellent", async () => {
    const { verdict } = await run("Unknown franchise", "Nova with a crescent braid", true, mode, body => {
      body.requiredPresent[0].present = false;
      body.requiredPresent[0].evidence = "Central figure has a different face and no crescent braid";
      body.teaserChecks.identity.accurate = false;
      body.briefFidelity = 2;
      body.dimensionAssessments.briefFidelity = { status: "defect", criterion: "identity-mismatch",
        location: "Central figure", observation: "Requested identity features are absent" };
    });
    expect(verdict.reviewIntegrity?.valid).toBe(true);
    expect(verdict.passed).toBe(false); expect(verdict.failureCodes).toContain("brief-fidelity");
    expect(verdict.scores.premiumFinish).toBe(5); expect(verdict.scores.compositionQuality).toBe(5);
  });
  it("rejects a real medium substitution without inventing a craft defect", async () => {
    const { verdict } = await run("Garden in gouache", "Six lanterns", false, mode, (body, items) => {
      const medium = items.find(item => item.requirement.startsWith("The requested artwork treatment"))!;
      const answer = body.requiredPresent.find((row: any) => row.requirementId === medium.id);
      answer.present = false; answer.evidence = "Crisp digital cel shading throughout, without painted pigment";
      body.mediumAssessment = { status: "mismatched", observedTreatment: "Digital cel shading", location: "Full canvas",
        observation: "Hard digital tone boundaries replace the commissioned painted treatment" };
      body.briefFidelity = 2;
      body.dimensionAssessments.briefFidelity = { status: "defect", criterion: "medium-substitution",
        location: "Full canvas", observation: "Digital cel shading replaces requested gouache" };
    });
    expect(verdict.reviewIntegrity?.valid).toBe(true);
    expect(verdict.passed).toBe(false); expect(verdict.failureCodes).toContain("brief-fidelity");
    expect(verdict.scores.premiumFinish).toBe(5); expect(verdict.scores.compositionQuality).toBe(5);
  });
});

it.each(["premiumFinish", "compositionQuality"] as const)("rejects a brief-compliance deduction disguised as %s", dimension => {
  const rows = dimensions(); rows[dimension] = { ...rows[dimension], status: "defect", basis: "brief-compliance",
    criterion: dimension === "premiumFinish" ? "generic-execution" : "unbalanced-layout",
    observation: "Competent digital illustration instead of commissioned gouache" };
  rows.briefFidelity = { status: "defect", criterion: "medium-substitution", location: "Full canvas", observation: "Wrong requested treatment" };
  const result = validateReviewEvidence(rows, { ...scores, [dimension]: 2, briefFidelity: 2 },
    { missingRequired: true, identityAccurate: true, milestoneCorrect: true, excludedFound: false, purchaseDesire: false });
  expect(result.integrity.valid).toBe(false);
  expect(result.integrity.issues).toContain(`${dimension}:brief-compliance-is-not-execution`);
});

import { createHash } from "node:crypto";
import { expect, it, vi } from "vitest";
import { runVisionGate, VISION_SCHEMA_VERSION } from "../server/aiFirst/visionGate";
import type { ReviewReference } from "../server/aiFirst/reviewReferences";
import { encodePng } from "../server/aiFirst/png";
import { concept } from "./aiFirstFixtures";
import { buildEventBrief, type EventBrief } from "../server/aiFirst/brief";
import type { Event } from "@shared/schema";
import { visionRequestRequirements } from "./helpers/visionRequestRequirements";

const bytes = encodePng({ width: 80, height: 100, rgb: new Uint8Array(80 * 100 * 3).fill(120) });
const brief = (overrides: Partial<EventBrief>) => ({ ...buildEventBrief({ event: { eventName: "Schema fixture", eventType: "Party",
  themeName: "Garden", paletteColors: "[]", vibeDescription: "A garden celebration" } as Event, dna: {}, guestCount: null }), ...overrides });
const reference = (subject: string): ReviewReference => ({ bytes, sha256: createHash("sha256").update(bytes).digest("hex"),
  role: "identity", subject, region: "Face and hair", sourceUrl: "https://example.com/fixture" });

it.each(["invitation", "teaser"] as const)("reuses the %s grammar across prompt text, requirement counts and reference counts", async reviewMode => {
  async function capture(subjects: string[], detail: string, references: ReviewReference[]) {
    let request: any;
    const b = brief({ themeName: subjects.join(" and "), visualIdentityOverride: subjects.join(" and "),
      requirements: { required: [...subjects.map(subject => `[VISIBLE NAMED IDENTITY] ${subject} is visibly identifiable`),
        `[VISIBLE HOST DETAIL] ${detail}`], preferred: [], excluded: [] } });
    const client = { messages: { create: vi.fn(async body => { request = body;
      return { content: [{ type: "text", text: "{}" }], stop_reason: "end_turn", usage: { input_tokens: 0, output_tokens: 0 } };
    }) } };
    const verdict = await runVisionGate({ bytes, brief: b, concept: concept(), referenceImages: references,
      reviewMode, maxFormatRepairs: 0, client: client as any });
    expect(client.messages.create).toHaveBeenCalledTimes(1);
    expect(visionRequestRequirements(request)).toContain(detail);
    expect(verdict.requestSchema?.version).toBe(VISION_SCHEMA_VERSION);
    expect(JSON.stringify(request.output_config.format.schema)).not.toContain(detail);
    return { schema: request.output_config.format.schema, digest: verdict.requestSchema?.sha256, request };
  }
  const a = await capture(["Meekah"], "A ball pit is visible", [reference("Meekah")]);
  const b = await capture(["Rumi", "Zoey"], "A silver stage is visible", [reference("Rumi"), reference("Zoey")]);
  expect(a.schema).toEqual(b.schema); expect(a.digest).toEqual(b.digest);
  expect(a.request.messages).not.toEqual(b.request.messages);
  const c = await capture([], "Three roses are visible", []);
  const d = await capture(["Talia"], "A moon arch is visible", []);
  expect(c.schema).toEqual(d.schema); expect(c.digest).toEqual(d.digest);
  expect(c.schema.properties.identityComparisons).toBeUndefined();
});

it.each(["omitted", "duplicated", "unexpected"] as const)("keeps %s requirement reports private with the reusable schema", async kind => {
  const scores = { textLogoWatermarkFree: 5, artifactFree: 5, premiumFinish: 5, briefFidelity: 5, compositionQuality: 5, ageAppropriate: 5 };
  const create = vi.fn(async (request: any) => {
    const requirements = visionRequestRequirements(request).map(requirement => ({ requirement, present: true, evidence: "Offline fixture" }));
    const requiredPresent = kind === "omitted" ? requirements.slice(1) : [...requirements,
      kind === "duplicated" ? requirements[0] : { requirement: "An unrequested crown", present: true, evidence: "Offline fixture" }];
    return { stop_reason: "end_turn", usage: { input_tokens: 0, output_tokens: 0 }, content: [{ type: "text", text: JSON.stringify({ ...scores,
      requiredPresent, excludedFound: [], notes: "Offline fixture only",
      dimensionAssessments: Object.fromEntries(Object.keys(scores).map(key => [key,
        { status: "clear", criterion: "none", location: "Full canvas", observation: "Offline fixture" }])),
      teaserChecks: { milestone: { correct: true, evidence: "No count" }, identity: { accurate: true, evidence: "Offline fixture" },
        purchase: { wouldCreatePurchaseDesire: true, evidence: "Offline fixture" } },
    }) }] };
  });
  const result = await runVisionGate({ bytes, concept: concept(), brief: brief({
    requirements: { required: ["[VISIBLE HOST DETAIL] A silver moon arch is visible"], preferred: [], excluded: [] } }),
    reviewMode: "teaser", maxFormatRepairs: 0, client: { messages: { create } } as any });
  expect(result.passed).toBe(false); expect(result.failureCodes).toContain("brief-fidelity");
  expect(create).toHaveBeenCalledTimes(1);
});

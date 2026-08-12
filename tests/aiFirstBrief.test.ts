// The brief, the prompt, and what happens to a direction that cannot be
// rescued. The through-line: the host is never asked to re-enter something the
// product already knows, and a direction that fails is replaced rather than
// dropped or quietly shipped.

import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { Event } from "@shared/schema";
import {
  SINGLE_BRIEF_QUESTION,
  ageFromMilestone,
  briefIsSufficient,
  briefToPromptBlock,
  buildEventBrief,
  classifyRequirements,
  milestoneFrom,
  seasonFromDate,
  venueTypeFrom,
} from "../server/aiFirst/brief";
import {
  RETRY_REMEDIES,
  buildArtworkConstraints,
  buildRetryPrompt,
  buildSystemPrompt,
  buildUserPrompt,
} from "../server/aiFirst/prompt";
import { ConceptStreamParser } from "../server/aiFirst/conceptStream";
import { adaptStudioDirection } from "../server/aiFirst/fallback";
import {
  concreteSubjectRequirementsForBrief,
  curatedThemeMatchesBrief,
  preflightConceptForBrief,
} from "../server/aiFirst/conceptPreflight";
import { INVITATION_ASK_POSY_ACTIONS } from "@shared/aiFirstAskPosy";
import { constraintsFor, resolveAskPosyAction } from "../server/aiFirst/askPosy";
import { LAUNCH_THEMES } from "@shared/themeCatalog";
import { aiFirstConceptSchema, artDirectionSchema, parseAiFirstConcept } from "@shared/aiFirstInvite";
import { concept } from "./aiFirstFixtures";

const event = (over: Partial<Event> = {}): Event =>
  ({
    id: 1,
    eventName: "Ada's 4th Birthday",
    eventType: "birthday",
    vibeDescription: "modern space cowgirl, dusty rose and brass",
    themeName: "space cowgirl",
    paletteColors: JSON.stringify(["dusty rose", "brass"]),
    eventDate: "12 September 2026",
    location: "our back garden",
    venueName: "",
    ...over,
  }) as unknown as Event;

const brief = (over: Partial<Event> = {}) =>
  buildEventBrief({ event: event(over), dna: {}, guestCount: 18 });

describe("brief — derived from what the product already knows", () => {
  it("carries every structured field through without asking the host again", () => {
    const result = brief();
    expect(result.eventName).toBe("Ada's 4th Birthday");
    expect(result.eventType).toBe("birthday");
    expect(result.milestone).toBe("4th");
    expect(result.vibe).toContain("space cowgirl");
    expect(result.themeName).toBe("space cowgirl");
    expect(result.colors).toEqual(["dusty rose", "brass"]);
    expect(result.season).toBe("autumn");
    expect(result.venueType).not.toBe("");
    expect(result.guestCount).toBe(18);
  });

  it("reads a milestone written as digits or as a word", () => {
    expect(milestoneFrom("Ada's 4th Birthday", "birthday", "")).toBe("4th");
    expect(milestoneFrom("Fortieth Birthday Dinner", "birthday", "")).toBe("40th");
    expect(milestoneFrom("I'm 3 & Digging It", "Birthday Party", "construction-themed backyard BBQ")).toBe("3rd");
    expect(milestoneFrom("Summer Party", "party", "")).toBe("");
  });

  it("derives the real review event's age and construction contract without re-entry", () => {
    const result = brief({
      eventName: "I'm 3 & Digging It",
      eventType: "Birthday Party",
      themeName: "",
      vibeDescription:
        "A backyard BBQ construction themed for our favorite little builder. Theme heavily centered around construction and building.",
      paletteColors: "[]",
    });
    expect(result.milestone).toBe("3rd");
    expect(result.requirements.required).toContain("age-appropriate celebratory character for a 3rd birthday");
    expect(concreteSubjectRequirementsForBrief(result).join(" ")).toContain("construction machine");
  });

  it("turns a milestone back into an age for the age-appropriateness rules", () => {
    expect(ageFromMilestone("4th")).toBe(4);
    expect(ageFromMilestone("40th")).toBe(40);
    expect(ageFromMilestone("")).toBeNull();
  });

  it("derives the season from the date", () => {
    expect(seasonFromDate("12 September 2026")).toBe("autumn");
    expect(seasonFromDate("3 January 2027")).toBe("winter");
    expect(seasonFromDate("no date here")).toBe("");
  });

  it("derives a venue type rather than asking for one", () => {
    expect(venueTypeFrom({ location: "The Ivy, Soho", venueName: "The Ivy" })).not.toBe("");
    expect(typeof venueTypeFrom({ location: "", venueName: "" })).toBe("string");
  });
});

describe("brief — requirements the server owns, not the model", () => {
  it("makes the stated identity and colour family REQUIRED", () => {
    const requirements = classifyRequirements({
      themeName: "space cowgirl",
      vibe: "modern space cowgirl",
      colors: ["dusty rose", "brass"],
      milestone: "4th",
      formality: "playful",
    });
    expect(requirements.required.some((r) => r.includes("space cowgirl"))).toBe(true);
    expect(requirements.required.some((r) => r.includes("dusty rose"))).toBe(true);
  });

  it("excludes babyish work for an adult and over-mature work for a child", () => {
    const child = classifyRequirements({ themeName: "t", vibe: "v", colors: [], milestone: "4th", formality: "playful" });
    const adult = classifyRequirements({ themeName: "t", vibe: "v", colors: [], milestone: "40th", formality: "formal" });
    expect(child.excluded).not.toEqual(adult.excluded);
    expect(child.required.some((r) => r.includes("age-appropriate"))).toBe(true);
    expect(adult.required.some((r) => r.includes("grown-up"))).toBe(true);
  });

  it("keeps preferred items out of the pass/fail gate", () => {
    const requirements = classifyRequirements({
      themeName: "space cowgirl",
      vibe: "modern space cowgirl",
      colors: [],
      milestone: "4th",
      formality: "playful",
    });
    expect(requirements.preferred.length).toBeGreaterThan(0);
    for (const item of requirements.preferred) expect(requirements.required).not.toContain(item);
  });
});

describe("brief — the one question", () => {
  it("is exactly the wording the specification requires", () => {
    expect(SINGLE_BRIEF_QUESTION).toBe("What should this celebration feel like?");
  });

  it("is not asked when the event already carries a usable brief", () => {
    expect(briefIsSufficient(event())).toBe(true);
    expect(briefIsSufficient(event({ vibeDescription: "", themeName: "", eventType: "birthday" }))).toBe(false);
  });

  it("uses the host's answer as the vibe when there was nothing else", () => {
    const result = buildEventBrief({
      event: event({ vibeDescription: "", themeName: "" }),
      dna: {},
      guestCount: null,
      vibeAnswer: "warm, candlelit and grown-up",
    });
    expect(result.vibe).toBe("warm, candlelit and grown-up");
  });
});

describe("prompt — streamlined, and specific where it matters", () => {
  it("asks for one standalone JSON object per line so quartet comparison can start promptly", () => {
    const system = buildSystemPrompt();
    expect(system).toContain("NDJSON");
    expect(system).toContain("no array wrapper");
  });

  it("demands structural variety, not four recolours", () => {
    const system = buildSystemPrompt();
    expect(system).toContain("at least 3 different layouts");
    expect(system).toContain("4 different illustration media");
    expect(system).toContain("use every focalStrategy exactly once");
    expect(system).toContain("use every visualMood exactly once");
  });

  it("does not ask the model for traces, rationales or contrast maths", () => {
    const system = buildSystemPrompt();
    // The response schema is the binding part: no key invites prose the
    // product never reads, and contrast is measured server-side.
    const start = system.indexOf('{"conceptName"');
    const schema = system.slice(start, system.indexOf("\n", start));
    for (const banned of ["rationale", "reasoning", "trace", "contrastRatio", "audit", "notes"]) {
      expect(schema.toLowerCase(), banned).not.toContain(banned.toLowerCase());
    }
    expect(system).toContain("Do not report ratios");
    expect(system).toContain("no commentary");
  });

  it("states every length budget the validator will actually enforce", () => {
    // A cap the model is never told about is a cap it walks into. Live runs
    // discarded 6 of 12 concepts on art.composition alone before the budgets
    // were written down, so the prompt and the schema have to agree here.
    const system = buildSystemPrompt();
    const caps: [string, z.ZodTypeAny][] = [
      ["conceptName", aiFirstConceptSchema.shape.conceptName],
      ["description", aiFirstConceptSchema.shape.description],
      ["art.medium", artDirectionSchema.shape.medium],
      ["art.composition", artDirectionSchema.shape.composition],
      ["art.prompt", artDirectionSchema.shape.prompt],
    ];
    for (const [label, field] of caps) {
      const max = (field as z.ZodString).maxLength;
      expect(max, label).not.toBeNull();
      expect(system, label).toContain(`${label} ${max}`);
    }
  });

  it("stays far below the proof's 17k-character payload", () => {
    const total = buildSystemPrompt().length + buildUserPrompt({ brief: brief() }).length;
    expect(total).toBeLessThan(9_000);
  });

  it("carries pinned constraints and the host's steer verbatim", () => {
    const user = buildUserPrompt({
      brief: brief(),
      direction: "less literal, more atmospheric",
      keepConstraints: ["keep the full-bleed layout"],
      avoidConceptNames: ["Midnight Bloom"],
    });
    expect(user).toContain("less literal, more atmospheric");
    expect(user).toContain("keep the full-bleed layout");
    expect(user).toContain("Midnight Bloom");
  });

  it("copies required and excluded brief rules into the paid artwork request", () => {
    const constraints = buildArtworkConstraints(brief());
    expect(constraints).toContain("REQUIRED — the space cowgirl visual identity");
    expect(constraints).toContain("EXCLUDED —");
  });

  it("copies a concrete construction contract into both model stages", () => {
    const constructionBrief = brief({
      eventName: "I'm 3 & Digging It",
      eventType: "Birthday Party",
      themeName: "",
      vibeDescription: "A backyard BBQ construction themed for our favorite little builder.",
    });
    const conceptPrompt = buildUserPrompt({ brief: constructionBrief });
    const imagePrompt = buildArtworkConstraints(constructionBrief);
    for (const prompt of [conceptPrompt, imagePrompt]) {
      expect(prompt).toContain("at least two coherent builder cues");
      expect(prompt).toContain("Do not make a full construction machine mandatory");
      expect(prompt).toContain("do not satisfy or replace the construction identity");
    }
  });

  it("renders the brief compactly", () => {
    const block = briefToPromptBlock(brief());
    expect(block).toContain("Ada's 4th Birthday");
    expect(block.length).toBeLessThan(2_000);
  });

  it("names the measured defect on a retry instead of saying try again", () => {
    const retry = buildRetryPrompt("base prompt", ["printed-margin"]);
    expect(retry).toContain("base prompt");
    expect(retry).toContain(RETRY_REMEDIES["printed-margin"]);
    expect(retry.toLowerCase()).not.toContain("try again");
  });
});

describe("concept stream", () => {
  const line = (over = {}) => JSON.stringify({ ...concept(), ...over });

  it("emits a concept the moment its line closes, before the rest arrives", () => {
    const parser = new ConceptStreamParser();
    const text = `${line({ conceptName: "One" })}\n${line({ conceptName: "Two" })}\n`;
    const first = parser.push(text.slice(0, text.indexOf("\n") + 1));
    expect(first).toHaveLength(1);
    expect(first[0].concept.conceptName).toBe("One");
    expect(parser.push(text.slice(text.indexOf("\n") + 1))).toHaveLength(1);
  });

  it("survives a line arriving in arbitrary chunks", () => {
    const parser = new ConceptStreamParser();
    const text = line();
    let emitted = 0;
    for (let i = 0; i < text.length; i += 7) emitted += parser.push(text.slice(i, i + 7)).length;
    emitted += parser.flush().length;
    expect(emitted).toBe(1);
  });

  it("tolerates markdown fences and a stray array wrapper", () => {
    const parser = new ConceptStreamParser();
    const emitted = parser.push("```json\n[\n" + line() + ",\n" + line() + "\n]\n```");
    expect(emitted).toHaveLength(2);
  });

  it("rejects an invalid concept and records why, without stopping the stream", () => {
    const parser = new ConceptStreamParser();
    const emitted = parser.push(`{"conceptName":"broken"}\n${line({ conceptName: "Good" })}\n`);
    expect(emitted).toHaveLength(1);
    expect(emitted[0].concept.conceptName).toBe("Good");
    expect(parser.rejections).toHaveLength(1);
    expect(parser.rejections[0].errors.length).toBeGreaterThan(0);
  });

  it("indexes emitted concepts consecutively, skipping rejects", () => {
    const parser = new ConceptStreamParser();
    const emitted = parser.push(`${line()}\n{"nope":1}\n${line()}\n`);
    expect(emitted.map((e) => e.index)).toEqual([0, 1]);
  });
});

describe("concept schema", () => {
  it("refuses a placement that does not belong to the chosen theme", () => {
    const result = parseAiFirstConcept({ ...concept(), placementId: "not-a-placement" });
    expect(result.ok).toBe(false);
  });

  it("refuses an identifier invented outside the menus", () => {
    expect(parseAiFirstConcept({ ...concept(), layoutStyle: "diagonal" }).ok).toBe(false);
    expect(parseAiFirstConcept({ ...concept(), baseThemeId: "not-a-theme" }).ok).toBe(false);
  });

  it("accepts the fixture, which is the shape the model is asked for", () => {
    const result = parseAiFirstConcept(concept());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.normalized).toEqual([]);
  });
});

describe("concept schema — drift the model actually produces", () => {
  // Measured against claude-sonnet-4-6 on the three verification briefs:
  // over-long free text and worded dnaHints threw away 10 of 12 concepts.
  // Neither affects what gets composed, so neither should cost a direction.
  it("trims an over-long description at a word boundary and says so", () => {
    const long = `${"A candlelit table of burnished brass and deep ink. ".repeat(6)}End.`;
    const result = parseAiFirstConcept({ ...concept(), description: long });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.concept.description.length).toBeLessThanOrEqual(220);
    expect(result.concept.description).not.toMatch(/\s$/);
    expect(result.normalized.join(" ")).toContain("description trimmed");
  });

  it("drops a worded dnaHint rather than failing the direction", () => {
    const result = parseAiFirstConcept({
      ...concept(),
      dnaHints: { formalPlayful: "playful", elegantCasual: -0.4 },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.concept.dnaHints).toEqual({ elegantCasual: -0.4 });
    expect(result.normalized.join(" ")).toContain("dnaHints.formalPlayful dropped");
  });

  it("drops a numeric dnaHint that is out of range", () => {
    const result = parseAiFirstConcept({ ...concept(), dnaHints: { formalPlayful: 7 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.concept.dnaHints).toEqual({});
  });

  it("still hard-fails anything the renderer could not compose", () => {
    // The recovery must not become a general-purpose "make it fit".
    expect(parseAiFirstConcept({ ...concept(), fontPairingId: "invented" }).ok).toBe(false);
    expect(parseAiFirstConcept({ ...concept(), minOverlay: "sort-of" }).ok).toBe(false);
    expect(
      parseAiFirstConcept({
        ...concept(),
        semanticPalette: { ...concept().semanticPalette, headlineColor: "dark navy" },
      }).ok,
    ).toBe(false);
  });

  it("does not mutate the caller's object while repairing it", () => {
    const input = { ...concept(), dnaHints: { formalPlayful: "playful" } };
    parseAiFirstConcept(input);
    expect(input.dnaHints).toEqual({ formalPlayful: "playful" });
  });

  it("reports the repair through the stream parser, never silently", () => {
    const parser = new ConceptStreamParser();
    const lines = parser.push(`${JSON.stringify({ ...concept(), dnaHints: { formalPlayful: "playful" } })}\n`);
    expect(lines).toHaveLength(1);
    expect(lines[0].normalized.join(" ")).toContain("dnaHints.formalPlayful dropped");
  });
});

describe("zero-cost subject preflight", () => {
  const construction = brief({
    eventName: "Theo is Three",
    themeName: "construction",
    vibeDescription: "modern elevated construction theme",
  });

  it("permits blueprint language as one legitimate construction strategy without forcing a machine", () => {
    const result = preflightConceptForBrief(
      concept({
        conceptName: "Little Builder",
        description: "A modern jobsite scene for a favorite little builder.",
        art: {
          medium: "architectural gouache",
          composition: "asymmetric blueprint geometry",
          prompt: "Inky blueprint lines, amber blocks and restrained paper grain.",
        },
      }),
      construction,
    );
    expect(result.passed).toBe(true);
  });

  it("blocks Blueprint & Bloom when a hard hat is only an incidental cue", () => {
    const result = preflightConceptForBrief(
      concept({
        conceptName: "Blueprint & Bloom",
        description: "A refined botanical blueprint in amber and navy.",
        art: {
          medium: "editorial gouache",
          composition: "botanical cluster surrounding an open central field",
          prompt: "Painterly flowers, blueprint lines and a tiny hard hat tucked into one corner.",
        },
      }),
      construction,
    );
    expect(result.passed).toBe(false);
    expect(result.message).toContain("construction");
  });

  it("allows a concept whose actual art brief depicts the required subject", () => {
    const result = preflightConceptForBrief(
      concept({
        conceptName: "Little Builder",
        description: "A modern jobsite scene for a favorite little builder.",
        art: {
          medium: "cut-paper collage",
          composition: "one excavator crossing the lower third",
          prompt: "A clearly recognisable excavator and hard hat in refined cut paper, with warm amber and navy.",
        },
      }),
      construction,
    );
    expect(result.passed).toBe(true);
  });

  it("requires every half of a compound identity", () => {
    expect(curatedThemeMatchesBrief("celestial-heirloom", brief())).toBe(false);
  });
});

describe("fallback — semantic safety", () => {
  const briefFor = brief({ themeName: "space", vibeDescription: "modern celestial space" });

  it("substitutes a curated direction rather than showing rejected work", () => {
    const adapted = adaptStudioDirection({
      concept: concept(),
      brief: briefFor,
      usedThemeIds: [],
      reason: "premium-feel",
    });
    expect(adapted).not.toBeNull();
    expect(LAUNCH_THEMES.map((t) => t.id)).toContain(adapted!.theme.id);
    expect(adapted!.concept.baseThemeId).toBe(adapted!.theme.id);
  });

  it("never reuses a theme another direction in the run already took", () => {
    const used = LAUNCH_THEMES.slice(0, 3).map((t) => t.id);
    const adapted = adaptStudioDirection({ concept: concept(), brief: briefFor, usedThemeIds: used, reason: "x" });
    expect(adapted).not.toBeNull();
    expect(used).not.toContain(adapted!.theme.id);
  });

  it("describes the curated artwork honestly instead of relabelling it", () => {
    const original = concept({ conceptName: "Lariat & Starlight" });
    const adapted = adaptStudioDirection({ concept: original, brief: briefFor, usedThemeIds: [], reason: "x" });
    expect(adapted).not.toBeNull();
    expect(adapted!.concept.conceptName).toBe(adapted!.theme.name);
    expect(adapted!.concept.description).toBe(adapted!.theme.description);
    expect(adapted!.concept.conceptName).not.toBe("Lariat & Starlight");
  });

  it("takes the curated theme's own layout and placement, which are known good", () => {
    const adapted = adaptStudioDirection({ concept: concept(), brief: briefFor, usedThemeIds: [], reason: "x" });
    expect(adapted).not.toBeNull();
    expect(adapted!.concept.layoutStyle).toBe(adapted!.theme.layoutStyle);
    expect(adapted!.theme.placements.map((p) => p.id)).toContain(adapted!.concept.placementId);
  });

  it("records the reason instead of hiding the swap", () => {
    const adapted = adaptStudioDirection({ concept: concept(), brief: briefFor, usedThemeIds: [], reason: "premium-feel" });
    expect(adapted).not.toBeNull();
    expect(adapted!.reason).toBe("premium-feel");
  });

  it("returns no fallback when the collection has no matching subject artwork", () => {
    const constructionBrief = brief({
      eventName: "Theo is Three",
      themeName: "construction",
      vibeDescription: "modern elevated construction theme",
    });
    expect(
      adaptStudioDirection({ concept: concept(), brief: constructionBrief, usedThemeIds: [], reason: "brief-fidelity" }),
    ).toBeNull();
  });
});

describe("Ask Posy", () => {
  it("offers exactly the invitation actions the specification lists", () => {
    expect(INVITATION_ASK_POSY_ACTIONS.map((a) => a.label)).toEqual([
      "Refine this invitation",
      "Create different directions",
      "Keep the layout, change the artwork",
      "Keep the artwork, change the typography",
      "More elegant",
      "More playful",
      "More modern",
      "Reduce literal elements",
      "Strengthen the theme",
      "Help me choose",
    ]);
  });

  it("preserves the constraints an action pinned", () => {
    const keepLayout = INVITATION_ASK_POSY_ACTIONS.find((a) => a.label === "Keep the layout, change the artwork")!;
    const constraints = constraintsFor(concept(), keepLayout.pins);
    expect(constraints.join(" ")).toContain(concept().layoutStyle);
  });

  it("changes only what the host asked to change", () => {
    const keepArtwork = INVITATION_ASK_POSY_ACTIONS.find((a) => a.label === "Keep the artwork, change the typography")!;
    const constraints = constraintsFor(concept(), keepArtwork.pins).join(" ");
    expect(constraints).toContain(concept().art.medium);
    expect(constraints).not.toContain(concept().fontPairingId);
  });

  it("resolves an action into a steer the pipeline can run", () => {
    const resolved = resolveAskPosyAction("more-elegant", { concept: concept() });
    expect(resolved.direction.length).toBeGreaterThan(0);
  });

  it("treats help-me-choose as advice, not a new paid run", () => {
    const help = INVITATION_ASK_POSY_ACTIONS.find((a) => a.label === "Help me choose")!;
    expect(help.advisory).toBe(true);
  });
});

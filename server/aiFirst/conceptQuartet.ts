// Whole-quartet, zero-image preflight.
//
// Image quality cannot be repaired downstream when the creative set itself is
// repetitive or incomplete. This gate runs after all four text concepts have
// parsed and before the image generator can be reached. It audits the quartet
// as a designed set: complete event identity in every direction, four distinct
// focal strategies and moods, structural variety, and no repeated hero object.

import { buildArtworkPrompt, type AiFirstConcept, type FocalStrategy } from "@shared/aiFirstInvite";
import { validateLayoutBeforeGeneration } from "@shared/aiFirstLayout";
import type { EventBrief } from "./brief";
import { preflightConceptForBrief, subjectFamiliesForBrief } from "./conceptPreflight";
import { buildArtworkConstraints } from "./prompt";

export const REQUIRED_CONCEPT_QUARTET_SIZE = 4;

export interface ConceptReviewCard {
  index: number;
  conceptName: string;
  description: string;
  focalStrategy: FocalStrategy;
  visualMood: NonNullable<AiFirstConcept["visualMood"]>;
  medium: string;
  composition: string;
  layoutStyle: AiFirstConcept["layoutStyle"];
  fontPairingId: string;
  exactArtworkPrompt: string;
}

export interface ConceptQuartetPreflight {
  passed: boolean;
  errors: string[];
  concepts: AiFirstConcept[];
  reviewCards: ConceptReviewCard[];
  /**
   * Errors attributable to exactly one concept, keyed by that concept's index
   * in `concepts`. A whole-quartet error (uniqueness/count checks that need
   * all four concepts to evaluate) is never listed here — only in `errors`.
   * This lets a caller drop the specific bad concept(s) and still deliver the
   * rest of the set instead of discarding every concept over one violation.
   */
  perConceptErrors: Map<number, string[]>;
}

const OCCASION_ART_CUE =
  /\b(birthday|celebration|party|cake|candles?|bunting|garland|confetti|streamers?|balloons?|place settings?|party table|picnic table|festive)\b/i;
const BACKYARD_CUE = /\b(backyard|back garden|lawn|patio|outdoor|garden party|cookout|barbecue|bbq|grill|picnic)\b/i;

const CONSTRUCTION_STRATEGY_CUES: Record<FocalStrategy, RegExp> = {
  "narrative-scene":
    /\b(job ?site|building site|build zone|builder scene|construction scene|excavator|bulldozer|dump truck|backhoe|loader|crane|cement mixer)\b/i,
  "iconic-detail":
    /\b(excavator|bulldozer|dump truck|backhoe|loader|crane|cement mixer|steel tracks?|hydraulic|bucket|boom|machine detail)\b/i,
  "graphic-world":
    /\b(blueprint|site plan|survey grid|measurement grid|schematic|architectural plan|caution stripe|topographic|construction markings?)\b/i,
  "tactile-still-life":
    /\b(hard hat|tool belt|builder tools?|shovel|work gloves?|lumber|wood offcuts?|concrete blocks?|traffic cones?|safety vest|measuring tape)\b/i,
};

const CONSTRUCTION_CUE_GROUPS = [
  /\b(excavator|bulldozer|dump truck|backhoe|loader|crane|cement mixer)\b/i,
  /\b(bucket|boom|hydraulic|steel tracks?|machine detail)\b/i,
  /\b(hard hat|safety vest|traffic cones?|caution stripe|construction barrier)\b/i,
  /\b(tool belt|builder tools?|shovel|work gloves?|measuring tape)\b/i,
  /\b(lumber|wood offcuts?|concrete blocks?|scaffold|building materials?)\b/i,
  /\b(blueprint|site plan|survey grid|measurement grid|schematic|architectural plan|construction markings?)\b/i,
  /\b(job ?site|building site|build zone|builder scene|construction scene)\b/i,
] as const;

const MACHINE_PATTERNS: [string, RegExp][] = [
  ["excavator", /\b(excavator|digger)\b/i],
  ["bulldozer", /\b(bulldozer|dozer)\b/i],
  ["dump truck", /\bdump truck\b/i],
  ["backhoe", /\bbackhoe\b/i],
  ["loader", /\b(front|wheel)?\s*loader\b/i],
  ["crane", /\bcrane\b/i],
  ["cement mixer", /\b(cement|concrete) mixer\b/i],
];

function briefIdentity(brief: EventBrief): string {
  return [
    brief.eventName,
    brief.eventType,
    brief.milestone,
    brief.themeName,
    brief.vibe,
    ...brief.requirements.required,
  ].join(" ");
}

function mediumFamily(value: string): string {
  const text = value.toLowerCase();
  const families: [string, RegExp][] = [
    ["watercolor", /watercolou?r/],
    ["gouache", /gouache/],
    ["cut-paper", /cut[- ]?paper|papercut/],
    ["linocut", /linocut|woodcut/],
    ["collage", /collage/],
    ["colored-pencil", /colou?red pencil|pencil/],
    ["ink", /\bink\b|line art/],
    ["vector", /vector|flat graphic/],
    ["pastel", /pastel/],
    ["oil", /oil paint/],
    ["digital", /digital/],
  ];
  return families.find(([, pattern]) => pattern.test(text))?.[0] ?? text.replace(/[^a-z0-9]+/g, " ").trim();
}

function uniqueCount(values: string[]): number {
  return new Set(values.map((value) => value.trim().toLowerCase())).size;
}

function milestonePattern(milestone: string): RegExp | null {
  const match = /^(\d{1,3})/.exec(milestone);
  if (!match) return null;
  const number = Number(match[1]);
  const words: Record<number, string> = {
    1: "first|one",
    2: "second|two",
    3: "third|three",
    4: "fourth|four",
    5: "fifth|five",
    6: "sixth|six",
    7: "seventh|seven",
    8: "eighth|eight",
    9: "ninth|nine",
    10: "tenth|ten",
  };
  const aliases = [milestone.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), `${number}[- ]?year[- ]?old`];
  if (words[number]) aliases.push(words[number]);
  return new RegExp(`\\b(?:${aliases.join("|")})(?:[- ]birthday)?\\b`, "i");
}

function dominantMachine(concept: AiFirstConcept): string | null {
  const focalText = `${concept.art.medium} ${concept.art.composition} ${concept.art.prompt}`;
  return MACHINE_PATTERNS.find(([, pattern]) => pattern.test(focalText))?.[0] ?? null;
}

function exactArtworkPrompt(concept: AiFirstConcept, brief: EventBrief): string {
  return `${buildArtworkPrompt(concept)}\n\n${buildArtworkConstraints(brief)}`;
}

function addUniquenessError(errors: string[], label: string, values: string[], minimum = values.length): void {
  if (uniqueCount(values) < minimum) errors.push(`quartet must use ${minimum} distinct ${label}`);
}

export function preflightConceptQuartet(
  candidates: readonly AiFirstConcept[],
  brief: EventBrief,
): ConceptQuartetPreflight {
  const concepts = candidates.slice(0, REQUIRED_CONCEPT_QUARTET_SIZE);
  const errors: string[] = [];
  const perConceptErrors = new Map<number, string[]>();
  const addPerConceptError = (index: number, message: string): void => {
    errors.push(message);
    const existing = perConceptErrors.get(index) ?? [];
    existing.push(message);
    perConceptErrors.set(index, existing);
  };
  const identity = briefIdentity(brief);
  const birthday = /\bbirthday\b/i.test(identity);
  const explicitBackyardCelebration = BACKYARD_CUE.test(identity);
  const milestone = milestonePattern(brief.milestone);
  const construction = subjectFamiliesForBrief(brief).some((family) => family.id === "construction");

  if (candidates.length !== REQUIRED_CONCEPT_QUARTET_SIZE) {
    errors.push(
      `concept provider returned ${candidates.length}; exactly ${REQUIRED_CONCEPT_QUARTET_SIZE} are required before artwork spend`,
    );
  }

  concepts.forEach((concept, index) => {
    const label = `concept ${index + 1} (${concept.conceptName})`;
    const artBrief = `${concept.art.medium} ${concept.art.composition} ${concept.art.prompt}`;
    const subject = preflightConceptForBrief(concept, brief);
    const layout = validateLayoutBeforeGeneration(concept);

    if (!concept.focalStrategy) addPerConceptError(index, `${label} is missing focalStrategy`);
    if (!concept.visualMood) addPerConceptError(index, `${label} is missing visualMood`);
    if (!subject.passed) addPerConceptError(index, `${label}: ${subject.message}`);
    for (const issue of layout.issues.filter((finding) => finding.repair === "regenerate")) {
      addPerConceptError(index, `${label}: ${issue.message}`);
    }

    if (birthday) {
      if (!OCCASION_ART_CUE.test(artBrief)) addPerConceptError(index, `${label} artwork omits the birthday/celebration identity`);
      if (milestone && !milestone.test(concept.description)) {
        addPerConceptError(index, `${label} host-facing description omits the ${brief.milestone} milestone`);
      }
      if (milestone && !milestone.test(artBrief)) {
        addPerConceptError(index, `${label} artwork direction omits the ${brief.milestone} milestone`);
      }
    }

    if (explicitBackyardCelebration && !BACKYARD_CUE.test(artBrief)) {
      addPerConceptError(index, `${label} artwork omits the backyard BBQ/outdoor celebration setting`);
    }

    if (construction && concept.focalStrategy) {
      if (!CONSTRUCTION_STRATEGY_CUES[concept.focalStrategy].test(artBrief)) {
        addPerConceptError(index, `${label} does not deliver its ${concept.focalStrategy} construction strategy`);
      }
      const cueGroups = CONSTRUCTION_CUE_GROUPS.filter((pattern) => pattern.test(artBrief)).length;
      if (cueGroups < 2) addPerConceptError(index, `${label} needs at least two coherent construction/jobsite cue groups`);
    }
  });

  if (concepts.length === REQUIRED_CONCEPT_QUARTET_SIZE) {
    addUniquenessError(errors, "focal strategies", concepts.map((concept) => concept.focalStrategy ?? ""));
    addUniquenessError(errors, "visual moods", concepts.map((concept) => concept.visualMood ?? ""));
    // Medium is a creative-variety signal, not a rendering safety boundary.
    // Requiring all four to be different was brittle enough to reject an
    // otherwise strong set before any artwork spend. Three distinct media
    // still prevents a repetitive quartet while tolerating one intentional
    // repeat when the subject/theme benefits from it.
    addUniquenessError(errors, "illustration media", concepts.map((concept) => mediumFamily(concept.art.medium)), 3);
    addUniquenessError(errors, "style lanes", concepts.map((concept) => concept.styleLaneId));
    addUniquenessError(errors, "font pairings", concepts.map((concept) => concept.fontPairingId));
    addUniquenessError(errors, "focal compositions", concepts.map((concept) => concept.art.composition));
    addUniquenessError(errors, "concept names", concepts.map((concept) => concept.conceptName));
    addUniquenessError(errors, "layouts", concepts.map((concept) => concept.layoutStyle), 3);

    if (construction) {
      const machineLed = concepts.map(dominantMachine).filter((machine): machine is string => Boolean(machine));
      if (machineLed.length > 2) errors.push("quartet repeats machine-led construction artwork in more than two directions");
      for (const machine of Array.from(new Set(machineLed))) {
        if (machineLed.filter((candidate) => candidate === machine).length > 1) {
          errors.push(`quartet repeats ${machine} as a dominant subject`);
        }
      }
    }
  }

  const reviewCards = concepts
    .filter(
      (concept): concept is AiFirstConcept & {
        focalStrategy: FocalStrategy;
        visualMood: NonNullable<AiFirstConcept["visualMood"]>;
      } => Boolean(concept.focalStrategy && concept.visualMood),
    )
    .map((concept, index) => ({
      index,
      conceptName: concept.conceptName,
      description: concept.description,
      focalStrategy: concept.focalStrategy,
      visualMood: concept.visualMood,
      medium: concept.art.medium,
      composition: concept.art.composition,
      layoutStyle: concept.layoutStyle,
      fontPairingId: concept.fontPairingId,
      exactArtworkPrompt: exactArtworkPrompt(concept, brief),
    }));

  return { passed: errors.length === 0, errors, concepts, reviewCards, perConceptErrors };
}

export function allErrorsAreSingleConcept(preflight: ConceptQuartetPreflight): boolean {
  const perConceptTotal = Array.from(preflight.perConceptErrors.values()).reduce((sum, list) => sum + list.length, 0);
  return perConceptTotal === preflight.errors.length;
}

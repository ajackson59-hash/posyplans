// Zero-cost semantic preflight for generated invitation concepts.
//
// A polished image that does not depict the host's theme is still a failed
// image — and it is an especially expensive failure when the omission could
// have been detected in the concept's own art brief before calling the image
// provider. Concrete themes are therefore checked here before any billed
// artwork request is allowed to start.

import type { AiFirstConcept } from "@shared/aiFirstInvite";
import { classifyRequirements, type EventBrief } from "./brief";

export interface SubjectFamily {
  id: string;
  label: string;
  trigger: RegExp;
  artworkCue: RegExp;
  /** Host-facing direction copy must identify the subject, not merely a material. */
  identityCue?: RegExp;
  /** Verbatim contracts copied into both the paid image request and Tier 2 review. */
  bindingRequirements?: readonly string[];
  /** Concrete positive subjects Tier 2 can answer present/absent from pixels. */
  reviewRequirements?: readonly string[];
  /** Broad named-cast fallback; exact tagged identities supersede this checklist. */
  reviewScope?: "named-cast";
  /** Curated themes whose shipped artwork genuinely depicts this subject. */
  compatibleThemeIds: readonly string[];
  /** Broader keyword families absorbed by this more-specific identity. */
  suppresses?: readonly string[];
}

const SUBJECT_FAMILIES: readonly SubjectFamily[] = [
  {
    id: "kpop-demon-hunters",
    label: "KPop Demon Hunters",
    trigger:
      /\b(k[ -]?pop demon hunters?|huntr\/?x|rumi|mira|zoey|saja boys?)\b/i,
    artworkCue:
      /\b(k[ -]?pop demon hunters?|huntr\/?x|rumi|mira|zoey|saja boys?|demon[- ]hunt|supernatural k[ -]?pop)\b/i,
    identityCue:
      /\b(k[ -]?pop demon hunters?|huntr\/?x|rumi|mira|zoey|demon[- ]hunt)\b/i,
    bindingRequirements: [
      "The KPop Demon Hunters identity must be direct and unmistakable through the host's requested named characters and their independently recognizable faces, hair, costume and silhouettes",
      "Preserve the host's exact cast scope, requested scene and activities; property recognition does not require an unrequested trio, weapons, performance stage or supernatural props; generic pop stars, abstract neon or an unnamed girl group do not satisfy a requested named-character identity",
      "Do not include a franchise logo, movie title, character names as rendered text, or copy another invitation's composition",
    ],
    reviewRequirements: [
      "Each specifically requested KPop Demon Hunters character is independently recognizable through visible identity features",
      "The host's requested cast scope, scene and activities are visibly respected",
    ],
    reviewScope: "named-cast",
    compatibleThemeIds: [],
  },
  {
    id: "construction",
    label: "construction / little-builder",
    trigger: /\b(construction|builder|building site|job ?site|digging|digger|excavat|bulldoz|dump truck|hard hat)\b/i,
    // "Blueprint" by itself is deliberately not enough. It is a legitimate
    // graphic-world cue, but the whole-quartet gate still requires a second
    // coherent construction cue plus the full celebration identity.
    artworkCue:
      /\b(excavator|bulldozer|dump truck|backhoe|front loader|digger|crane|hard hat|safety vest|traffic cone|construction vehicle|building site|job ?site|cement mixer|concrete mixer|scaffold|shovel|tool belt|lumber|concrete blocks?|caution stripe|site plan|blueprint|survey grid|builder tools?)\b/i,
    identityCue:
      /\b(construction|builder|building site|job ?site|digging|digger|excavator|bulldozer|dump truck|backhoe|front loader|cement mixer|crane|hard hat)\b/i,
    bindingRequirements: [
      "The construction / little-builder identity must be unmistakable through at least two coherent builder cues suited to the direction — machinery, machine details, jobsite materials, tools, safety gear, or blueprint/site-plan language",
      "Do not make a full construction machine mandatory unless the direction's focal strategy is narrative-scene or iconic-detail",
      "Keep every important builder and celebration cue fully visible within the central 70% of the frame so the invitation layout cannot crop it away",
      "Flowers, botanicals, abstract geometry, paper texture and colour alone do not satisfy or replace the construction identity",
    ],
    // Only positive, binary visual facts belong in the critic's
    // requiredPresent checklist. Framing instructions and negative prompt
    // rules remain binding on generation, but they are not objects a critic
    // can truthfully mark "visibly present" in the finished pixels.
    reviewRequirements: [
      "The construction / little-builder identity is unmistakably visible through at least two coherent builder or jobsite cues",
    ],
    compatibleThemeIds: [],
    // A dump truck is a construction cue, not evidence that the host also
    // requested a separate vehicles/racing theme. Specific identities win
    // over broader keyword families so compound-theme validation is real,
    // not an artefact of overlapping regular expressions.
    suppresses: ["vehicles"],
  },
  {
    id: "dinosaur",
    label: "dinosaur",
    trigger: /\b(dinosaur|dino|jurassic|prehistoric|fossil)\b/i,
    artworkCue: /\b(dinosaur|dino|tyrannosaur|t-?rex|triceratops|stegosaur|brontosaur|raptor|fossil|prehistoric)\b/i,
    compatibleThemeIds: ["dinosaur-museum"],
  },
  {
    id: "space",
    label: "space / celestial",
    trigger: /\b(space|astronaut|rocket|planet|galaxy|cosmic|celestial|moon|stars?)\b/i,
    artworkCue: /\b(astronaut|rocket|planet|orbit|galaxy|cosmic|celestial|moon|constellation|stars?)\b/i,
    compatibleThemeIds: ["celestial-heirloom"],
  },
  {
    id: "western",
    label: "western / cowgirl",
    trigger: /\b(cowgirl|cowboy|western|rodeo|ranch|lariat|lasso)\b/i,
    artworkCue: /\b(cowgirl|cowboy|western|rodeo|ranch|boot|hat|lariat|lasso|horse|sheriff)\b/i,
    compatibleThemeIds: [],
  },
  {
    id: "princess",
    label: "princess / royal",
    trigger: /\b(princess|royal|castle|fairytale|fairy tale)\b/i,
    artworkCue: /\b(princess|crown|tiara|castle|royal|carriage|turret|palace)\b/i,
    compatibleThemeIds: [],
  },
  {
    id: "superhero",
    label: "superhero",
    trigger: /\b(superhero|super hero|comic book|caped)\b/i,
    artworkCue: /\b(superhero|hero|cape|mask|comic|lightning bolt|city skyline|shield)\b/i,
    compatibleThemeIds: [],
  },
  {
    id: "unicorn",
    label: "unicorn",
    trigger: /\b(unicorn|rainbow magic)\b/i,
    artworkCue: /\b(unicorn|horn|rainbow|magical horse)\b/i,
    compatibleThemeIds: [],
  },
  {
    id: "mermaid",
    label: "mermaid / under-the-sea",
    trigger: /\b(mermaid|under the sea|undersea|ocean|sea life)\b/i,
    artworkCue: /\b(mermaid|seashell|coral|ocean|undersea|seaweed|pearl|fish|wave)\b/i,
    compatibleThemeIds: ["pool-editorial"],
  },
  {
    id: "pirate",
    label: "pirate",
    trigger: /\b(pirate|treasure island|buccaneer)\b/i,
    artworkCue: /\b(pirate|treasure|ship|sail|anchor|compass|map|buccaneer)\b/i,
    compatibleThemeIds: [],
  },
  {
    id: "vehicles",
    label: "vehicles / racing",
    trigger: /\b(race car|racing|cars?|trucks?|transportation|train|airplane)\b/i,
    artworkCue: /\b(race car|racing|car|truck|train|airplane|vehicle|road|track|wheel)\b/i,
    compatibleThemeIds: [],
  },
  {
    id: "safari",
    label: "safari / jungle",
    trigger: /\b(safari|jungle|zoo|wild animals?)\b/i,
    artworkCue: /\b(safari|jungle|lion|giraffe|elephant|zebra|leopard|monkey|wild animal)\b/i,
    compatibleThemeIds: [],
  },
  {
    id: "farm",
    label: "farm / barnyard",
    trigger: /\b(farm|barnyard|farmhouse|tractor)\b/i,
    artworkCue: /\b(farm|barn|tractor|cow|pig|chicken|horse|hay bale|field)\b/i,
    compatibleThemeIds: [],
  },
  {
    id: "roller",
    label: "roller-skating / disco",
    trigger: /\b(roller ?skate|roller disco|skating|disco)\b/i,
    artworkCue: /\b(roller ?skate|skating|disco ball|dance floor|disco)\b/i,
    compatibleThemeIds: ["roller-editorial"],
  },
  {
    id: "pool",
    label: "pool / swimming",
    trigger: /\b(pool|poolside|swimming|splash)\b/i,
    artworkCue: /\b(pool|poolside|swimming|water|wave|float|splash|cabana)\b/i,
    compatibleThemeIds: ["pool-editorial"],
  },
  {
    id: "garden",
    label: "garden / floral",
    trigger: /\b(garden|botanical|floral|flower|wildflower|meadow)\b/i,
    artworkCue: /\b(garden|botanical|floral|flower|bloom|leaf|foliage|wildflower|meadow)\b/i,
    compatibleThemeIds: ["garden-editorial", "meadow-storybook"],
  },
];

function matchingFamilies(identity: string): SubjectFamily[] {
  const matches = SUBJECT_FAMILIES.filter((family) => family.trigger.test(identity));
  const suppressed = new Set(matches.flatMap((family) => family.suppresses ?? []));
  return matches.filter((family) => !suppressed.has(family.id));
}

export function subjectFamiliesForText(identity: string): SubjectFamily[] {
  return matchingFamilies(identity);
}

function briefIdentity(brief: EventBrief): string {
  if (brief.visualIdentityOverride) {
    return [brief.visualIdentityOverride, ...brief.requirements.required].join(" ");
  }
  return [brief.eventName, brief.eventType, brief.themeName, brief.vibe, ...brief.requirements.required].join(" ");
}

export function subjectFamiliesForBrief(brief: EventBrief): SubjectFamily[] {
  return matchingFamilies(briefIdentity(brief));
}

/**
 * Turns a newly named concrete subject into the binding visual identity for
 * this generation. Generic refinements ("more elegant", "less literal")
 * continue to steer the existing brief. A newly named character/franchise or
 * subject family replaces an inherited theme so an old event title cannot
 * silently overpower the host's current request.
 */
export function briefForHostDirection(brief: EventBrief, direction?: string): EventBrief {
  if (brief.visualIdentityOverride) return brief;

  const currentDirection = direction?.trim() ?? "";
  const directionFamilies = subjectFamiliesForText(currentDirection);
  const explicitFamilies = directionFamilies.length > 0
    ? directionFamilies
    : subjectFamiliesForText(brief.inspirationNotes.trim());
  if (explicitFamilies.length === 0) return brief;

  const inheritedIds = new Set(subjectFamiliesForBrief(brief).map((family) => family.id));
  if (explicitFamilies.every((family) => inheritedIds.has(family.id))) return brief;

  const visualIdentityOverride = explicitFamilies.map((family) => family.label).join(" + ");
  return {
    ...brief,
    themeName: visualIdentityOverride,
    // Event palettes are derived from the inherited theme. Once the host
    // replaces that identity, carrying its old colours forward turns them
    // into a contradictory pass/fail requirement (for example construction
    // browns against a newly requested supernatural K-pop direction).
    colors: [],
    visualIdentityOverride,
    requirements: classifyRequirements({
      themeName: visualIdentityOverride,
      vibe: visualIdentityOverride,
      colors: [],
      milestone: brief.milestone,
      formality: brief.formality,
    }),
  };
}

export interface ConceptPreflightResult {
  passed: boolean;
  missingSubjects: string[];
  message: string;
}

/**
 * Concrete, visually auditable requirements for the subject families named by
 * the host. These exact sentences are shared by concept generation, the paid
 * image request, and Tier 2 review so the theme cannot weaken between stages.
 */
export function concreteSubjectRequirementsForBrief(brief: EventBrief): string[] {
  return subjectFamiliesForBrief(brief).flatMap((family) => family.bindingRequirements ?? []);
}

/**
 * Binary visual must-haves for Tier 2. This is deliberately narrower than
 * the paid-generation contract: composition instructions, exclusions and
 * holistic identity requirements are audited by their dedicated score or
 * exclusion checks instead of being duplicated as impossible checklist rows.
 */
export function concreteSubjectReviewRequirementsForBrief(brief: EventBrief): string[] {
  const exactNamedTargets = brief.requirements.required.some(r => /^\[VISIBLE NAMED IDENTITY\]\s*\S/i.test(r));
  // Do not ask the critic to invent a second, broader cast interpretation after
  // the server has already supplied exact named targets. Other world checks
  // (e.g. construction cues in a compound brief) remain independent requirements.
  return subjectFamiliesForBrief(brief).flatMap((family) =>
    family.reviewScope === "named-cast" && exactNamedTargets ? [] : family.reviewRequirements ?? []);
}

export function preflightConceptForBrief(concept: AiFirstConcept, brief: EventBrief): ConceptPreflightResult {
  const families = subjectFamiliesForBrief(brief);
  if (families.length === 0) return { passed: true, missingSubjects: [], message: "" };

  // Only the art fields reach the image provider. A themed concept name or a
  // persuasive host description cannot compensate for an unthemed art brief.
  const artBrief = `${concept.art.medium} ${concept.art.composition} ${concept.art.prompt}`;
  // The description is what the host actually reads. A themed concept name
  // cannot compensate for generic customer-facing direction copy.
  const directionIdentity = concept.description;
  const missingSubjects = families
    .filter((family) => {
      if (!family.artworkCue.test(artBrief)) return true;
      if (family.identityCue && !family.identityCue.test(directionIdentity)) return true;
      return false;
    })
    .map((family) => family.label);
  return {
    passed: missingSubjects.length === 0,
    missingSubjects,
    message:
      missingSubjects.length === 0
        ? ""
        : `art brief does not depict the required concrete subject: ${missingSubjects.join(", ")}`,
  };
}

/** A fallback is safe only when its shipped artwork matches a concrete theme. */
export function curatedThemeMatchesBrief(themeId: string, brief: EventBrief): boolean {
  const families = subjectFamiliesForBrief(brief);
  if (families.length === 0) return true;
  // A compound identity is only safe when the shipped artwork carries every
  // named subject. Celestial artwork is not a "space cowgirl" fallback when
  // it contains no western cue, however polished it may be.
  return families.every((family) => family.compatibleThemeIds.includes(themeId));
}

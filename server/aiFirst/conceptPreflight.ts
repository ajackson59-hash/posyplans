// Zero-cost semantic preflight for generated invitation concepts.
//
// A polished image that does not depict the host's theme is still a failed
// image — and it is an especially expensive failure when the omission could
// have been detected in the concept's own art brief before calling the image
// provider. Concrete themes are therefore checked here before any billed
// artwork request is allowed to start.

import type { AiFirstConcept } from "@shared/aiFirstInvite";
import type { EventBrief } from "./brief";

export interface SubjectFamily {
  id: string;
  label: string;
  trigger: RegExp;
  artworkCue: RegExp;
  /** Curated themes whose shipped artwork genuinely depicts this subject. */
  compatibleThemeIds: readonly string[];
}

const SUBJECT_FAMILIES: readonly SubjectFamily[] = [
  {
    id: "construction",
    label: "construction / little-builder",
    trigger: /\b(construction|builder|building site|job ?site|digging|digger|excavat|bulldoz|dump truck|hard hat)\b/i,
    // "Blueprint" by itself is deliberately not enough. It produced three
    // attractive-but-generic paid failures for a three-year-old's party.
    artworkCue: /\b(excavator|bulldozer|dump truck|digger|crane|hard hat|construction vehicle|building site|job ?site|cement mixer|concrete mixer|scaffold|shovel|tool belt)\b/i,
    compatibleThemeIds: [],
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

function briefIdentity(brief: EventBrief): string {
  return [brief.eventName, brief.eventType, brief.themeName, brief.vibe, ...brief.requirements.required].join(" ");
}

export function subjectFamiliesForBrief(brief: EventBrief): SubjectFamily[] {
  const identity = briefIdentity(brief);
  return SUBJECT_FAMILIES.filter((family) => family.trigger.test(identity));
}

export interface ConceptPreflightResult {
  passed: boolean;
  missingSubjects: string[];
  message: string;
}

export function preflightConceptForBrief(concept: AiFirstConcept, brief: EventBrief): ConceptPreflightResult {
  const families = subjectFamiliesForBrief(brief);
  if (families.length === 0) return { passed: true, missingSubjects: [], message: "" };

  // Only the art fields reach the image provider. A themed concept name or a
  // persuasive host description cannot compensate for an unthemed art brief.
  const artBrief = `${concept.art.medium} ${concept.art.composition} ${concept.art.prompt}`;
  const missingSubjects = families.filter((family) => !family.artworkCue.test(artBrief)).map((family) => family.label);
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

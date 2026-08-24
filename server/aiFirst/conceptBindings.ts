// Deterministic event-identity bindings applied before zero-image review.
// Claude supplies the creative direction; Posy owns facts that must never be
// omitted. This keeps milestone and subject compliance out of retry roulette.

import type { AiFirstConcept, FocalStrategy } from "@shared/aiFirstInvite";
import { canonicalTypeGeometry, validateLayoutBeforeGeneration } from "@shared/aiFirstLayout";
import type { EventBrief } from "./brief";
import { subjectFamiliesForBrief } from "./conceptPreflight";

function escaped(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function milestonePattern(milestone: string): RegExp | null {
  const number = /^(\d{1,3})/.exec(milestone)?.[1];
  if (!number) return null;
  const ordinalWords: Record<string, string> = {
    "1": "first", "2": "second", "3": "third", "4": "fourth", "5": "fifth",
    "6": "sixth", "7": "seventh", "8": "eighth", "9": "ninth", "10": "tenth",
  };
  const aliases = [escaped(milestone), `${number}[- ]?year[- ]?old`];
  if (ordinalWords[number]) aliases.push(`${ordinalWords[number]}(?:[- ]birthday)?`);
  return new RegExp(`\\b(?:${aliases.join("|")})\\b`, "i");
}

const CONSTRUCTION_BINDINGS: Record<FocalStrategy, string> = {
  "narrative-scene": "construction jobsite celebration with hard hats, safety cones, lumber and builder activity",
  "iconic-detail": "construction machinery detail with a hydraulic bucket, steel tracks and safety striping",
  "graphic-world": "construction blueprint site plan with survey grid, measured lumber and caution-stripe markings",
  "tactile-still-life": "builder's still life with a hard hat, measuring tape, work gloves and lumber offcuts",
};

const CONSTRUCTION_GROUPS = [
  /\b(excavator|bulldozer|dump truck|backhoe|loader|crane|cement mixer)\b/i,
  /\b(bucket|boom|hydraulic|steel tracks?|machine detail)\b/i,
  /\b(hard hat|safety vest|traffic cones?|caution stripe|construction barrier)\b/i,
  /\b(tool belt|builder tools?|shovel|work gloves?|measuring tape)\b/i,
  /\b(lumber|wood offcuts?|concrete blocks?|scaffold|building materials?)\b/i,
  /\b(blueprint|site plan|survey grid|measurement grid|schematic|architectural plan|construction markings?)\b/i,
  /\b(job ?site|building site|build zone|builder scene|construction scene)\b/i,
] as const;

const NAMED_CONSTRUCTION_MACHINE =
  /\b(?:dump trucks?|excavators?|diggers?|bulldozers?|dozers?|backhoes?|(?:front|wheel)\s+loaders?|loaders?|cranes?|(?:cement|concrete) mixers?)\b/i;
const NAMED_CONSTRUCTION_MACHINE_GLOBAL =
  /\b(?:dump trucks?|excavators?|diggers?|bulldozers?|dozers?|backhoes?|(?:front|wheel)\s+loaders?|loaders?|cranes?|(?:cement|concrete) mixers?)\b/gi;

const MACHINE_FREE_CONSTRUCTION_COMPOSITIONS: Partial<Record<FocalStrategy, string>> = {
  "narrative-scene": "wide backyard jobsite celebration led by builder activity below a calm typography field",
  "graphic-world": "tall construction site-plan system beside a quiet typography panel",
  "tactile-still-life": "centred builder-tool still life with generous quiet space around the type area",
};

function paletteLine(candidate: AiFirstConcept): string {
  const { headlineColor, bodyColor, accentColor, textSurface } = candidate.semanticPalette;
  return `Restrained palette of ${accentColor}, ${headlineColor}, ${bodyColor}, and ${textSurface}`;
}

function machineFreeConstructionPrompt(
  candidate: AiFirstConcept,
  brief: EventBrief,
  milestonePhrase: string,
): string {
  const medium = candidate.art.medium
    .replace(NAMED_CONSTRUCTION_MACHINE_GLOBAL, "")
    .replace(/\s{2,}/g, " ")
    .trim() || "editorial illustration";
  const birthday = milestonePhrase.trim() || brief.eventType.trim() || "birthday";
  const backyard = /\b(backyard|barbecue|bbq|cookout|patio|garden party)\b/i.test(
    `${brief.vibe} ${brief.requirements.required.join(" ")}`,
  );
  const setting = backyard ? "backyard BBQ" : "celebration setting";

  switch (candidate.focalStrategy) {
    case "narrative-scene":
      return `A refined ${medium} narrative of a ${setting} transformed into a ${birthday} little-builder jobsite celebration, led by measured lumber, scaffold frames, child-sized hard hats, safety cones, work gloves, tool belts, picnic tables, restrained bunting and a small cake. Builder activity and construction materials create the story without a full construction vehicle. ${paletteLine(candidate)}; polished, cinematic, age-appropriate editorial stationery.`;
    case "graphic-world":
      return `An intelligent ${medium} construction site-plan world for a ${birthday} ${setting}: survey grids, measured-lumber shapes, architectural marks, caution-stripe rhythm, traffic-cone symbols, a picnic-table footprint and restrained confetti. The construction identity comes from blueprint language and jobsite markings, with no vehicle as a hero object. ${paletteLine(candidate)}; precise, graphic and premium.`;
    case "tactile-still-life":
      return `An elevated ${medium} builder's still life for a ${birthday} ${setting}, arranged from a child-sized hard hat, measuring tape, work gloves, neat lumber offcuts, a small shovel, safety cones, restrained bunting and one birthday candle. Construction tools and materials carry the theme without a full construction vehicle. ${paletteLine(candidate)}; tactile, collected and never clip art.`;
    default:
      return candidate.art.prompt;
  }
}

function appendSentence(value: string, sentence: string, maxLength: number): string {
  const trimmed = value.trim().replace(/[.\s]+$/, "");
  const suffix = `. ${sentence}.`;
  const available = Math.max(0, maxLength - suffix.length);
  return `${trimmed.slice(0, available).trimEnd()}${suffix}`;
}

export function bindConceptsToBrief(
  candidates: readonly AiFirstConcept[],
  brief: EventBrief,
): AiFirstConcept[] {
  const birthday = /\bbirthday\b/i.test(`${brief.eventName} ${brief.eventType} ${brief.vibe}`);
  const milestone = birthday ? milestonePattern(brief.milestone) : null;
  const milestonePhrase = `${brief.milestone} birthday`;
  const construction = subjectFamiliesForBrief(brief).some((family) => family.id === "construction");

  return candidates.map((candidate) => {
    // Layout repair must precede type canonicalization. A wide split concept
    // becomes a banner; geometry derived for split's right panel is invalid
    // after that deterministic move and used to trigger a pointless second
    // text correction even though the server owns both rectangles.
    const layoutRepair = validateLayoutBeforeGeneration(candidate);
    const typeGeometry = canonicalTypeGeometry(candidate, layoutRepair.layoutStyle);
    let description = candidate.description;
    let medium = candidate.art.medium;
    let composition = candidate.art.composition;
    let prompt = candidate.art.prompt;

    if (milestone && !milestone.test(description)) {
      description = appendSentence(description, `Created for a ${milestonePhrase}`, 220);
    }
    if (milestone && !milestone.test(prompt)) {
      prompt = appendSentence(prompt, `Artwork for a ${milestonePhrase} celebration`, 1200);
    }

    if (construction && candidate.focalStrategy) {
      const artBrief = `${candidate.art.medium} ${candidate.art.composition} ${prompt}`;
      // Claude occasionally repeats the theme's named machine in every line
      // even after the one permitted text-only correction. Posy owns the
      // ordered construction subject map, so enforce its three machine-free
      // lanes deterministically before the whole-quartet gate. The iconic
      // detail remains the sole model-led machinery direction.
      if (candidate.focalStrategy !== "iconic-detail" && NAMED_CONSTRUCTION_MACHINE.test(artBrief)) {
        medium = medium
          .replace(NAMED_CONSTRUCTION_MACHINE_GLOBAL, "")
          .replace(/\s{2,}/g, " ")
          .trim() || "editorial illustration";
        composition = MACHINE_FREE_CONSTRUCTION_COMPOSITIONS[candidate.focalStrategy] ?? composition;
        prompt = machineFreeConstructionPrompt(candidate, brief, milestonePhrase);
      }

      const boundArtBrief = `${medium} ${composition} ${prompt}`;
      const cueCount = CONSTRUCTION_GROUPS.filter((pattern) => pattern.test(boundArtBrief)).length;
      if (cueCount < 2) prompt = appendSentence(prompt, CONSTRUCTION_BINDINGS[candidate.focalStrategy], 1200);
      if (!/\b(construction|builder|job ?site|building site|hard hat|dump truck|excavator|bulldozer)\b/i.test(description)) {
        description = appendSentence(description, "An unmistakable construction and little-builder direction", 220);
      }
    }

    return {
      ...candidate,
      description,
      art: { ...candidate.art, medium, composition, prompt },
      layoutStyle: layoutRepair.layoutStyle,
      // The renderer owns the real type box. Do not spend a second text call
      // asking a model to rediscover geometry Posy can derive exactly.
      placementId: typeGeometry.placementId,
      safeTypographyRegion: typeGeometry.safeTypographyRegion,
    };
  });
}

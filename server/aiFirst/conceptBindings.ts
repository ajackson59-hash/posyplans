// Deterministic event-identity bindings applied before zero-image review.
// Claude supplies the creative direction; Posy owns facts that must never be
// omitted. This keeps milestone and subject compliance out of retry roulette.

import type { AiFirstConcept, FocalStrategy } from "@shared/aiFirstInvite";
import { canonicalSafeTypographyRegion } from "@shared/aiFirstLayout";
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
    let description = candidate.description;
    let prompt = candidate.art.prompt;

    if (milestone && !milestone.test(description)) {
      description = appendSentence(description, `Created for a ${milestonePhrase}`, 220);
    }
    if (milestone && !milestone.test(prompt)) {
      prompt = appendSentence(prompt, `Artwork for a ${milestonePhrase} celebration`, 1200);
    }

    if (construction && candidate.focalStrategy) {
      const artBrief = `${candidate.art.medium} ${candidate.art.composition} ${prompt}`;
      const cueCount = CONSTRUCTION_GROUPS.filter((pattern) => pattern.test(artBrief)).length;
      if (cueCount < 2) prompt = appendSentence(prompt, CONSTRUCTION_BINDINGS[candidate.focalStrategy], 1200);
      if (!/\b(construction|builder|job ?site|building site|hard hat|dump truck|excavator|bulldozer)\b/i.test(description)) {
        description = appendSentence(description, "An unmistakable construction and little-builder direction", 220);
      }
    }

    return {
      ...candidate,
      description,
      art: { ...candidate.art, prompt },
      // The renderer owns the real type box. Do not spend a second text call
      // asking a model to rediscover geometry Posy can derive exactly.
      safeTypographyRegion: canonicalSafeTypographyRegion(candidate),
    };
  });
}

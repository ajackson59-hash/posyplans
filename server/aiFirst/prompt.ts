// The AI-first concept prompt.
//
// Replaces the 17,048-character / ~7,000-output-token proof payload. Every
// reduction is a thing the SERVER now owns rather than a thing the model was
// asked to be vaguer about:
//
//   - REQUIRED / PREFERRED / EXCLUDED classification -> server (brief.ts)
//   - auditing artwork against that list             -> server (visionGate.ts)
//   - contrast arithmetic                            -> server (aiFirstPalette)
//   - overlay coverage estimates                     -> server (aiFirstLayout)
//   - the no-text / full-bleed-edge guardrails       -> server (buildArtworkPrompt)
//   - requiredElementTrace, rationales, proof prose  -> deleted outright
//
// Art-direction specificity is NOT reduced: the identifier menus stay verbatim
// (a hallucinated id is a hard failure) and the medium/composition/prompt
// fields keep their full range.

import {
  ART_PLACEMENTS,
  DIVIDER_STYLES,
  LAUNCH_THEMES,
  OVERLAY_TREATMENTS,
  TEXTURE_STYLES,
  THEME_ART_IDS,
} from "@shared/themeCatalog";
import { BORDER_STYLES, FONT_PAIRINGS, LAYOUT_STYLES, STYLE_LANES } from "@shared/inviteDesign";
import { FOCAL_STRATEGIES, SAFE_TYPOGRAPHY_REGIONS, VISUAL_MOODS } from "@shared/aiFirstInvite";
import { DNA_AXES } from "@shared/eventDna";
import { briefToPromptBlock, type EventBrief } from "./brief";
import { concreteSubjectRequirementsForBrief, subjectFamiliesForBrief } from "./conceptPreflight";

const list = (values: readonly string[]): string => values.join(" | ");

/** Every base theme with the placements that are legal for it. */
function themeMenu(): string {
  return LAUNCH_THEMES.map((t) => `  ${t.id} (${t.style}) placements: ${t.placements.map((p) => p.id).join(", ")}`).join(
    "\n",
  );
}

export function buildSystemPrompt(): string {
  return `You are Posy's invitation art director. You turn an event brief into four finished invitation directions.

Emit NDJSON: exactly four lines, each a complete standalone JSON object, no array wrapper, no markdown fence, no commentary. Emit each object in full before starting the next. Posy compares and validates the complete quartet before any artwork may be generated.

The four are a curated creative quartet, not four variations of one object. They must differ STRUCTURALLY, not by recolour:
- use every focalStrategy exactly once: ${list(FOCAL_STRATEGIES)}
- use every visualMood exactly once: ${list(VISUAL_MOODS)}
- 4 different illustration media
- 4 different style lanes
- at least 3 different layouts
- 4 different font pairings
- 4 genuinely different compositions and focal ideas

Focal-strategy contract:
- narrative-scene: tell a small event story in a setting; the celebration and theme interact
- iconic-detail: one sculptural close detail, not a repeat of the narrative scene
- graphic-world: build the theme from maps, plans, marks, patterns or visual systems; no hero object required
- tactile-still-life: arrange meaningful materials, tools or celebration objects as elevated stationery art

The same dominant object or substantially equivalent scene may not lead more than one direction. If one direction uses a full vehicle, character, cake, flower, animal or other hero object, the other directions must interpret the event through different visual language.

Every direction must carry the COMPLETE event identity, including occasion/milestone, setting or celebration format, and theme. Do not silently reduce a compound brief to its easiest noun. Event identity belongs in conceptName/description and in the artwork itself; artwork cannot rely on invitation text to explain the theme.

Every identifier must come verbatim from these menus. An id outside them is a hard failure.

layoutStyle: ${list(LAYOUT_STYLES)}
borderStyle: ${list(BORDER_STYLES)}
styleLaneId: ${list(STYLE_LANES.map((l) => l.id))}
fontPairingId: ${list(FONT_PAIRINGS.map((f) => f.id))}
texture.style: ${list(TEXTURE_STYLES)}
dividerStyle: ${list(DIVIDER_STYLES)}
motif.id: ${list(THEME_ART_IDS)}
motif.placement: ${list(ART_PLACEMENTS)}
minOverlay: ${list(OVERLAY_TREATMENTS)}
safeTypographyRegion: ${list(SAFE_TYPOGRAPHY_REGIONS)}
dnaHints — each value is a NUMBER from -1 to 1, never a word: ${DNA_AXES.map((a) => `${a.key} (-1 ${a.poleA} … +1 ${a.poleB})`).join(", ")}

baseThemeId — the curated theme whose envelope, placements and furniture this direction inherits. placementId MUST be one of that theme's own placements:
${themeMenu()}

Colour. Declare four roles as 6-digit hex. They map onto what the renderer paints:
  textSurface   the surface type is set on
  headlineColor the display headline
  bodyColor     date / time / location
  accentColor   eyebrow, divider, RSVP cue, and the card frame
Aim for headline 3:1, body and accent 4.5:1 against textSurface. Do not report ratios — the server measures the composited card and repairs anything short.

Artwork. Write \`art.prompt\` as a real art brief: subject, treatment, palette behaviour, mood. Be specific — "chrome lariat loop catching cool rim light against deep navy, fine grain" not "western elements". Do NOT add no-text or full-bleed instructions; the server appends those verbatim to every prompt. Do not describe frames, mats or paper margins — the renderer draws the card's frame, so artwork that draws its own produces a doubled border.

Subject-driven themes are literal requirements, not optional mood words. If the brief names construction, dinosaurs, space, western, princesses, superheroes, unicorns, mermaids, pirates, vehicles, safari, farm, skating, pool or another concrete subject, EVERY art.prompt must name and visibly depict that subject. Generic geometry, botanicals, colour or texture never substitute for the stated subject. For a compound theme, visibly carry every part of the identity. The host must recognise the theme before reading invitation copy.

Construction / little-builder themes permit sophisticated variety. A full excavator is NOT mandatory in every direction. Use the declared focal strategy: a narrative jobsite celebration, one machinery detail, blueprint/site-plan graphic language, or a tactile arrangement of builder tools and materials. Each must still read unmistakably as construction and as the actual celebration.

Match layout to composition. \`backdrop\` renders artwork at 30% opacity, so never put a single focal subject there. \`split\` renders into a tall 40%-wide panel. \`full-bleed\` and \`banner\` are centre-cropped, so keep anything that matters away from the edges. \`safeTypographyRegion\` promises quiet space and MUST cover most of the selected \`placementId\`: use \`center\` for centred type and \`right-panel\` for split type. Keep faces, people, hero objects and required subjects outside it.

Per line, emit exactly:
{"conceptName":"","description":"","focalStrategy":"","visualMood":"","styleLaneId":"","layoutStyle":"","borderStyle":"","fontPairingId":"","baseThemeId":"","placementId":"","texture":{"style":"","intensity":0.0},"dividerStyle":"","motif":{"id":"","placement":""},"semanticPalette":{"textSurface":"#","headlineColor":"#","bodyColor":"#","accentColor":"#"},"art":{"medium":"","composition":"","prompt":""},"safeTypographyRegion":"","minOverlay":"","dnaHints":{}}

Length budgets, enforced by the validator — a line over budget is discarded: conceptName 60 characters, description 220, art.medium 60, art.composition 120, art.prompt 1200.

description is one sentence a host reads on the card — not a design rationale. art.composition is a terse framing note ("tall left panel, subject centred"), not a second art brief — the detail belongs in art.prompt. dnaHints carries only axes the brief actually stated. No other keys.`;
}

export interface UserPromptInput {
  brief: EventBrief;
  /** Plain-English steer from Ask Posy or the direction box. */
  direction?: string;
  /** Concepts the host has already seen and wants moved away from. */
  avoidConceptNames?: string[];
  /** Constraints an Ask Posy action pinned — carried forward verbatim. */
  keepConstraints?: string[];
}

/**
 * The model chooses the art within each lane; the server chooses the four
 * lanes before asking. This removes the recurring failure where a nominally
 * diverse quartet quietly reused one machine, medium, or visual structure.
 */
function orderedQuartetBlueprint(brief: EventBrief): string[] {
  const construction = subjectFamiliesForBrief(brief).some((family) => family.id === "construction");
  const lines = [
    "Line 1 — focalStrategy=narrative-scene; visualMood=cinematic-narrative; styleLaneId=editorial-premium; fontPairingId=editorial-serif; art.medium must be gouache; tell an event story in its setting.",
    "Line 2 — focalStrategy=iconic-detail; visualMood=sculptural-editorial; styleLaneId=bold-graphic; fontPairingId=deco-luxe; art.medium must be watercolor; isolate one sculptural subject detail.",
    "Line 3 — focalStrategy=graphic-world; visualMood=graphic-modernist; styleLaneId=minimal-modern; fontPairingId=minimal-geometric; art.medium must be cut-paper collage; build a visual system rather than a hero object.",
    "Line 4 — focalStrategy=tactile-still-life; visualMood=tactile-artisanal; styleLaneId=handcrafted-rustic; fontPairingId=rustic-handwritten; art.medium must be linocut; arrange meaningful materials and celebration objects.",
    "Use four different layoutStyle values. The line number, focal strategy, visual mood, style lane, font pairing, medium family, and focal subject are binding and may not be swapped or repeated.",
  ];

  if (construction) {
    lines.push(
      "Construction subject map: Line 1 is a machine-free jobsite celebration led by builder activity, materials, safety gear and party details; Line 2 is the ONLY machine-led direction and may show one close machinery detail; Line 3 is a vehicle-free blueprint/site-plan world with measurement and jobsite markings; Line 4 is a vehicle-free builder's still life with at least three coherent tools, safety items or materials.",
      "A dump truck, excavator, bulldozer, crane, loader or other machine named in Line 2 must not appear in any other line. Lines 1, 3 and 4 must not use any vehicle as their dominant subject.",
    );
  }

  return lines;
}

function milestoneIdentityContract(brief: EventBrief): string[] {
  const birthday = /\bbirthday\b/i.test(`${brief.eventName} ${brief.eventType} ${brief.vibe}`);
  if (!birthday || !brief.milestone) return [];
  return [
    `Every description and every art.prompt must literally say "${brief.milestone} birthday" or spell the ordinal out (for example, "third birthday").`,
    "This phrase communicates event identity to the art director; the artwork must still contain no rendered lettering, words or numerals.",
  ];
}

export function buildUserPrompt(input: UserPromptInput): string {
  const parts = [briefToPromptBlock(input.brief)];
  const concreteRequirements = concreteSubjectRequirementsForBrief(input.brief);

  if (concreteRequirements.length > 0) {
    parts.push(
      "",
      "CONCRETE SUBJECT CONTRACT (every concept must satisfy every line):",
      ...concreteRequirements.map((requirement) => `- ${requirement}.`),
      "- Every description and every art.prompt must explicitly identify the host's concrete subject, not merely a colour, texture or material.",
    );
  }

  const milestoneContract = milestoneIdentityContract(input.brief);
  if (milestoneContract.length > 0) {
    parts.push("", "MILESTONE IDENTITY CONTRACT (every concept must satisfy every line):", ...milestoneContract.map((line) => `- ${line}`));
  }

  parts.push("", "ORDERED QUARTET BLUEPRINT (binding, assigned before generation):", ...orderedQuartetBlueprint(input.brief).map((line) => `- ${line}`));

  if (input.keepConstraints?.length) {
    parts.push("", "KEEP UNCHANGED (the host locked these):", ...input.keepConstraints.map((c) => `- ${c}`));
  }
  if (input.direction?.trim()) {
    parts.push("", `HOST DIRECTION: ${input.direction.trim()}`);
  }
  if (input.avoidConceptNames?.length) {
    parts.push("", `ALREADY SEEN (go somewhere else): ${input.avoidConceptNames.join(", ")}`);
  }

  parts.push("", "Emit the four NDJSON lines now.");
  return parts.join("\n");
}

/** The only permitted automatic concept correction; it is still text-only. */
export function buildConceptCorrectionPrompt(errors: readonly string[]): string {
  return [
    "ZERO-IMAGE SERVER REVIEW FAILED.",
    "Rewrite all four concepts from scratch. Do not patch or explain the previous quartet.",
    "The event brief, milestone contract, concrete-subject contract and ordered quartet blueprint remain binding.",
    "Correct every server finding below:",
    ...Array.from(new Set(errors)).map((error) => `- ${error}`),
    "Emit exactly four replacement NDJSON objects and nothing else.",
  ].join("\n");
}

/**
 * Binding requirements copied directly into the paid image request. The
 * concept model is useful art direction, but it is not allowed to paraphrase
 * away a must-have subject or an exclusion before gpt-image sees the brief.
 */
export function buildArtworkConstraints(brief: EventBrief): string {
  const concreteRequirements = concreteSubjectRequirementsForBrief(brief);
  const lines = [
    "BINDING EVENT-BRIEF CONSTRAINTS:",
    ...brief.requirements.required.map((item) => `REQUIRED — ${item}.`),
    ...concreteRequirements.map((item) => `REQUIRED — ${item}.`),
    ...brief.requirements.excluded.map((item) => `EXCLUDED — ${item}.`),
  ];
  if (brief.requirements.preferred.length > 0) {
    lines.push(...brief.requirements.preferred.map((item) => `PREFERRED — ${item}.`));
  }
  return lines.join("\n");
}

/**
 * A failure-specific retry instruction, appended to the artwork prompt on the
 * one permitted retry. Generic "try again" wastes the retry — each remedy
 * names the defect that was actually measured.
 */
export const RETRY_REMEDIES: Record<string, string> = {
  "printed-margin":
    "CRITICAL: the previous attempt drew a paper margin inside the image. The illustration must bleed off all four edges with no border, mat, frame or blank perimeter of any kind.",
  "text-detected":
    "CRITICAL: the previous attempt contained lettering. Produce purely pictorial artwork — absolutely no letters, words, numbers, logos, signatures or watermarks anywhere.",
  "crop-unsafe":
    "CRITICAL: the previous attempt placed important subject matter near the edges where it was cropped away. Keep every salient element within the central 70% of the frame.",
  "blank-degenerate":
    "CRITICAL: the previous attempt was nearly blank. Produce a fully realised illustration with clear subject matter and tonal range.",
  "flat-bands":
    "CRITICAL: the previous attempt contained flat banded regions that read as corruption. Produce continuous, evenly rendered artwork.",
  "artifact":
    "CRITICAL: the previous attempt contained melted, duplicated or malformed shapes. Render clean, coherent, correctly formed subject matter.",
  "premium-feel":
    "CRITICAL: the previous attempt read as cheap clipart. Produce genuinely premium editorial illustration with considered composition, restrained palette and fine detail.",
  "brief-fidelity":
    "CRITICAL: the previous attempt did not deliver the brief's required elements. Every required element listed must be unmistakably visible.",
  "excluded-present":
    "CRITICAL: the previous attempt contained excluded content. Remove it entirely.",
  "age-appropriate":
    "CRITICAL: the previous attempt was not age appropriate. Match the celebrant's age without becoming babyish or repetitive.",
  "quiet-region":
    "CRITICAL: the previous attempt left nowhere quiet for the words. Keep the declared typography region visually calm and low-contrast.",
};

export function buildRetryPrompt(basePrompt: string, failureCodes: string[]): string {
  const remedies = Array.from(new Set(failureCodes.map((c) => RETRY_REMEDIES[c]).filter(Boolean)));
  if (remedies.length === 0) return basePrompt;
  return `${basePrompt}\n\n${remedies.join("\n")}`;
}

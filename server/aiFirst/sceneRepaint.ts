import type { EventBrief } from "./brief";
import { buildArtworkConstraints } from "./prompt";
import { resolveArtDirection } from "./artDirection";

/** A whole-scene reconstruction from pixels, not a texture filter or local retouch.
 * The original host brief remains authoritative over the supplied candidate. */
export function buildSceneRepaintPrompt(brief: EventBrief): string {
  const treatment = resolveArtDirection(brief).requestedTreatment;
  if (!treatment) throw new Error("scene-repaint-requires-explicit-treatment");
  return [
    `Repaint the supplied scene from the beginning in ${treatment}.`,
    "Use the image to retain the requested subjects' identities, gestures, relative positions and the requested scene elements. It is an imperfect scene reference, not a style reference or an approved result.",
    "Reconstruct all subjects, clothing, props, architecture and background in the requested medium. Replace the source's rendering decisions throughout; adding a surface texture to unchanged source artwork does not satisfy this task.",
    "The complete host direction below takes precedence wherever the reference differs. Keep all requested details and exact counts independently readable; do not inherit unwanted objects or writing from the reference.",
    "Remove generated lettering by reconstructing the underlying scene surfaces as coherent pictorial materials. Do not leave erased patches, substitute scribbles or introduce replacement words. Keep the requested scene objects themselves.",
    "Preserve the requested palette, framing, density, material variations and region-specific or mixed-medium assignments. Return one finished full-canvas artwork.",
    buildArtworkConstraints(brief),
  ].join("\n\n");
}

/** Separate scene/style context from the authority for one subject's likeness. */
export function buildSceneLikenessPrompt(brief: EventBrief, subject: string): string {
  const treatment = resolveArtDirection(brief).requestedTreatment;
  if (!treatment) throw new Error("scene-likeness-requires-explicit-treatment");
  return [
    `Correct ${subject}'s likeness in image 1 using the official identity reference in image 2. Return one complete finished scene in ${treatment}.`,
    "IMAGE 1 — scene and finish reference. Preserve its composition, palette, painted finish, requested activities and objects. The user considers this finish an acceptable option. The generated face is not an authoritative identity reference.",
    `IMAGE 2 — identity reference for ${subject} only. Match the pictured person's distinctive facial structure and proportions, eye and brow shapes, nose, smile, hairline and curl arrangement. Retain natural adult anatomy and a recognizable expression while adapting the likeness into image 1's painted treatment. Do not blend a different performer or a generic cartoon face into that identity.`,
    "The identity photograph does not request a photographic scene, a pasted photographic face, its pose, framing, white background or typography. Do not copy its letter badge, logo or any other writing. Keep clothing surfaces coherent and text-free.",
    `Preserve ${subject}'s dancing action and position in the scene while correcting likeness. Keep every other requested character and scene element intact; do not introduce another person or extra limbs.`,
    "The complete host brief below remains binding. Preserve all requested details, quantities, exclusions and independently readable scene elements. Return artwork extending to every canvas edge, without a comparison layout or explanatory text.",
    buildArtworkConstraints(brief),
  ].join("\n\n");
}

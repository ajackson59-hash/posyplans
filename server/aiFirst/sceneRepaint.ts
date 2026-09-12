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

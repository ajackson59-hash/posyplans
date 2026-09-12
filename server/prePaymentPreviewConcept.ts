import type { Event } from "@shared/schema";
import type { InviteDesignConcept } from "@shared/inviteDesign";
import { eventStyleSummary } from "@shared/eventStyle";

type PreviewEvent = Pick<
  Event,
  "eventName" | "eventType" | "themeName" | "vibeDescription"
>;

/**
 * Correct a highly likely character-name typo for creative generation
 * without altering the host's saved wording.
 */
export function normalizePrePaymentPreviewBrief(value: string): string {
  if (/\bblippi\b/i.test(value) && /\bmika\b/i.test(value) && !/\bmeekah\b/i.test(value)) {
    return value.replace(/\bmika\b/gi, "Meekah");
  }
  return value;
}

export function prePaymentPreviewSourceBrief(event: PreviewEvent): string {
  const style = eventStyleSummary(event);
  const eventName = event.eventName?.trim() ?? "";
  const combined = style && eventName && !style.toLowerCase().includes(eventName.toLowerCase())
    ? `${style}\nEvent title: ${eventName}`
    : style || eventName || event.eventType || "Celebration";
  return normalizePrePaymentPreviewBrief(combined);
}

function isBlippiBrief(brief: string): boolean {
  return /\bblippi\b/i.test(brief) && /\bmeekah\b/i.test(brief);
}

/**
 * A pre-payment preview is conversion proof, not a style exploration.
 * Build its one concept directly from the host's wording so an abstract
 * lane cannot erase the literal theme before the image model sees it.
 *
 * Keep this path deliberately separate from the paid four-concept experience:
 * a sales teaser has one job—prove, at a glance, that Posy understood the host.
 */
export function buildPrePaymentPreviewConcept(event: PreviewEvent): {
  sourceBrief: string;
  concept: InviteDesignConcept;
} {
  const sourceBrief = prePaymentPreviewSourceBrief(event);
  const blippi = isBlippiBrief(sourceBrief);
  const subjectFocus = `the literal people, characters, setting, activities and defining objects requested in this host brief: ${sourceBrief}`;
  const identityDirection = "When the host names a specific show, film, game, character universe, performer or cultural property, preserve that exact named identity and every positively requested character. Follow the host's cast scope and exclusions; recognizing a property does not add cast, activities, locations or props. A generic category substitute is a failed result.";
  const medium = blippi ? "polished children's character illustration" : "premium narrative editorial illustration";
  const palette = blippi
    ? ["#1769C2", "#FF7A00", "#F8F3E8", "#8B55C7"]
    : ["#243447", "#C88B67", "#F6F0E7", "#6E8065"];

  const illustrationPrompt = [
    `${medium} for a premium digital invitation.`,
    `ORIGINAL HOST BRIEF — authoritative: ${sourceBrief}`,
    `MAIN SCENE — show visibly: ${subjectFocus}.`,
    identityDirection,
    "The requested subject must dominate the composition and be understandable at a glance. Use a clear, joyful focal scene with expressive figures and environmental storytelling.",
    "Do not substitute an abstract symbol, isolated accessory, bow tie, glasses, circles, dots, color blocks, confetti-only pattern, palette-only shorthand or generic adjacent aesthetic for the actual requested scene.",
    "No franchise logo, title treatment, watermark, invitation wording, letters, words or numbers anywhere in the artwork.",
  ].join(" ");

  return {
    sourceBrief,
    concept: {
      conceptName: `${event.eventName?.trim() || "Personalized event"} — literal preview`,
      description: sourceBrief,
      paletteColors: palette,
      fontPairingId: blippi ? "playful-rounded" : "editorial-serif",
      borderStyle: "none",
      layoutStyle: "centered",
      styleLaneId: blippi ? "playful-illustrated" : "editorial-premium",
      artDirection: {
        illustrationMedium: medium,
        subjectFocus,
        compositionType: "square, scene-led composition with the literal requested subject as the dominant focal point",
        negativeSpace: "modest breathing room around the focal scene without shrinking the subject",
        colorTreatment: blippi
          ? "bright blue, orange and purple accents balanced with warm cream"
          : "event-appropriate, refined color with clear focal contrast",
        texture: "polished editorial storybook finish with clean edges and dimensional detail",
        avoidList: "abstract shorthand, isolated accessories, bow-tie-only imagery, dots-only imagery, generic clipart, fake text, letters, numbers, logos, watermarks",
      },
      illustrationPrompt,
    },
  };
}

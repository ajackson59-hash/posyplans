// Turns an Ask Posy action into pipeline inputs.
//
// The action catalogue itself is in @shared/aiFirstAskPosy because the client
// renders the same labels and posts the same ids back. What lives here is the
// half that only the server can do: reading the selected concept and writing
// the KEEP UNCHANGED sentences that make "keep the layout" a promise rather
// than a suggestion.

import type { AiFirstConcept } from "@shared/aiFirstInvite";
import { INVITATION_ASK_POSY_ACTIONS, type AskPosyAction, type AskPosyPin } from "@shared/aiFirstAskPosy";

export { INVITATION_ASK_POSY_ACTIONS };
export type { AskPosyAction };

/** Constraint sentences for the pinned facets of a selected concept. */
export function constraintsFor(concept: AiFirstConcept, pins: AskPosyPin[]): string[] {
  const out: string[] = [];
  for (const pin of pins) {
    if (pin === "layout") {
      out.push(`layoutStyle must stay "${concept.layoutStyle}" with safeTypographyRegion "${concept.safeTypographyRegion}"`);
    }
    if (pin === "artwork") {
      out.push(`art.medium must stay "${concept.art.medium}" and art.prompt must stay: ${concept.art.prompt}`);
    }
    if (pin === "typography") {
      out.push(`fontPairingId must stay "${concept.fontPairingId}"`);
    }
    if (pin === "palette") {
      const p = concept.semanticPalette;
      out.push(
        `semanticPalette must stay textSurface ${p.textSurface}, headlineColor ${p.headlineColor}, bodyColor ${p.bodyColor}, accentColor ${p.accentColor}`,
      );
    }
  }
  return out;
}

export interface ResolvedAskPosy {
  action?: AskPosyAction;
  direction?: string;
  keepConstraints?: string[];
  avoidConceptNames?: string[];
}

/**
 * Turns a request body into pipeline inputs. An unknown action id falls back
 * to the body's own free-text direction rather than erroring — the host's
 * words are worth more than a strict enum.
 */
export function resolveAskPosyAction(
  actionId: unknown,
  body: { concept?: unknown; direction?: unknown; avoidConceptNames?: unknown; keepConstraints?: unknown } = {},
): ResolvedAskPosy {
  const freeText = typeof body.direction === "string" && body.direction.trim() ? body.direction.trim() : undefined;
  const avoid = Array.isArray(body.avoidConceptNames)
    ? body.avoidConceptNames.filter((n): n is string => typeof n === "string")
    : undefined;
  const explicitConstraints = Array.isArray(body.keepConstraints)
    ? body.keepConstraints.filter((n): n is string => typeof n === "string")
    : [];

  const action = INVITATION_ASK_POSY_ACTIONS.find((a) => a.id === actionId);
  if (!action || action.advisory) {
    return { direction: freeText, avoidConceptNames: avoid, keepConstraints: explicitConstraints };
  }

  const concept = body.concept as AiFirstConcept | undefined;
  const pinned = concept && action.pins.length > 0 ? constraintsFor(concept, action.pins) : [];

  return {
    action,
    direction: [action.direction, freeText].filter(Boolean).join(" "),
    keepConstraints: [...pinned, ...explicitConstraints],
    avoidConceptNames: avoid,
  };
}

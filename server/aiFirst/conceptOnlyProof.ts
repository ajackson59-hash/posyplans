// Preview-only concept proof.
//
// This module deliberately has no dependency on artwork.ts, usage stores,
// run stores, preview stores, or artwork-attempt stores. It can ask Anthropic
// for the same four concepts the paid pipeline uses and run the complete
// zero-image quartet preflight, but there is no image-provider capability in
// its input or imports. The production pipeline also uses this function, so
// the protected proof cannot drift into a weaker concept path.

import Anthropic from "@anthropic-ai/sdk";
import type { AiFirstConcept } from "@shared/aiFirstInvite";
import type { EventBrief } from "./brief";
import { ConceptStreamParser } from "./conceptStream";
import { allErrorsAreSingleConcept, preflightConceptQuartet } from "./conceptQuartet";
import { bindConceptsToBrief } from "./conceptBindings";
import { briefForHostDirection } from "./conceptPreflight";
import { buildConceptCorrectionPrompt, buildSystemPrompt, buildUserPrompt } from "./prompt";

export const CONCEPT_MODEL = "claude-sonnet-4-6";
// Text-only concept correction is cheap and occurs before the image-spend
// boundary. Two bounded repair passes materially improve recovery from a
// malformed/empty provider response without creating a second artwork charge.
export const MAX_TEXT_ONLY_CONCEPT_CORRECTIONS = 2;
export const MIN_VIABLE_CONCEPTS = 1;

export interface ConceptOnlyProofInput {
  brief: EventBrief;
  direction?: string;
  avoidConceptNames?: string[];
  keepConstraints?: string[];
  anthropic?: Anthropic;
  signal?: AbortSignal;
  onFirstConcept?: () => void;
  onReviewingConcepts?: () => void;
  onPreflightWarning?: (message: string) => void;
}

export interface ConceptOnlyProofResult {
  model: typeof CONCEPT_MODEL;
  concepts: AiFirstConcept[];
  conceptRejections: number;
  imageProviderCalls: 0;
  billedArtworkAttempts: 0;
}

function abortError(reason?: unknown): Error {
  if (reason instanceof Error) return reason;
  const error = new Error(typeof reason === "string" ? reason : "Concept proof was disconnected.");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError(signal.reason);
}

export async function runConceptOnlyProof(input: ConceptOnlyProofInput): Promise<ConceptOnlyProofResult> {
  const effectiveBrief = briefForHostDirection(input.brief, input.direction);
  const client = input.anthropic ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let firstConceptReported = false;

  type ConceptMessage = { role: "user" | "assistant"; content: string };
  const requestQuartet = async (messages: ConceptMessage[]) => {
    const parser = new ConceptStreamParser();
    const candidates: AiFirstConcept[] = [];
    const collect = (concepts: ReturnType<ConceptStreamParser["push"]>) => {
      for (const line of concepts) {
        if (!firstConceptReported) {
          firstConceptReported = true;
          input.onFirstConcept?.();
        }
        candidates.push(line.concept);
      }
    };
    const stream = await client.messages.stream({
      model: CONCEPT_MODEL,
      max_tokens: 4000,
      system: buildSystemPrompt(),
      messages,
    });
    for await (const chunk of stream) {
      throwIfAborted(input.signal);
      if (chunk.type !== "content_block_delta" || chunk.delta.type !== "text_delta") continue;
      collect(parser.push(chunk.delta.text));
    }
    throwIfAborted(input.signal);
    collect(parser.flush());
    input.onReviewingConcepts?.();
    const boundCandidates = bindConceptsToBrief(candidates, effectiveBrief);
    const quartet = preflightConceptQuartet(boundCandidates, effectiveBrief);
    const parserErrors = parser.rejections.flatMap((rejection) => rejection.errors);
    return { candidates: boundCandidates, quartet, parserErrors };
  };

  const userPrompt = buildUserPrompt({
    brief: effectiveBrief,
    direction: input.direction,
    avoidConceptNames: input.avoidConceptNames,
    keepConstraints: input.keepConstraints,
  });

  let attempt = await requestQuartet([{ role: "user", content: userPrompt }]);
  let conceptRejections = attempt.parserErrors.length + attempt.quartet.errors.length;

  for (let correction = 0; correction < MAX_TEXT_ONLY_CONCEPT_CORRECTIONS && !attempt.quartet.passed; correction += 1) {
    const currentErrors = [...attempt.parserErrors, ...attempt.quartet.errors];
    const assistantContent = attempt.candidates.length
      ? attempt.candidates.map((concept) => JSON.stringify(concept)).join("\n")
      : "No valid concept objects were parsed from the previous response.";
    const emptyRecovery = attempt.candidates.length === 0
      ? "CRITICAL FORMAT RECOVERY: Return exactly four complete concept JSON objects, one object per line. No prose, no markdown fences, no headings, and no refusal text. Keep the user's named theme as a high-level creative reference while using an original composition and avoiding copied logos or exact protected character likenesses.\n\n"
      : "";

    attempt = await requestQuartet([
      { role: "user", content: userPrompt },
      { role: "assistant", content: assistantContent },
      { role: "user", content: `${emptyRecovery}${buildConceptCorrectionPrompt(currentErrors)}` },
    ]);
    conceptRejections += attempt.parserErrors.length + attempt.quartet.errors.length;
  }

  if (!attempt.quartet.passed) {
    const finalErrors = [...attempt.parserErrors, ...attempt.quartet.errors];
    const canDropBadConcepts =
      attempt.parserErrors.length === 0 &&
      attempt.quartet.concepts.length > 0 &&
      allErrorsAreSingleConcept(attempt.quartet);
    if (canDropBadConcepts) {
      const survivors = attempt.quartet.concepts.filter((_, index) => !attempt.quartet.perConceptErrors.has(index));
      if (survivors.length >= MIN_VIABLE_CONCEPTS) {
        for (const error of finalErrors) {
          input.onPreflightWarning?.(`dropped instead of failing the whole set: ${error}`);
        }
        return {
          model: CONCEPT_MODEL,
          concepts: survivors,
          conceptRejections,
          imageProviderCalls: 0,
          billedArtworkAttempts: 0,
        };
      }
    }

    for (const error of finalErrors) input.onPreflightWarning?.(error);
    throw new Error(
      `creative quartet failed zero-image preflight after ${MAX_TEXT_ONLY_CONCEPT_CORRECTIONS} text-only correction passes: ${finalErrors.join("; ")}`,
    );
  }

  return {
    model: CONCEPT_MODEL,
    concepts: attempt.quartet.concepts,
    conceptRejections,
    imageProviderCalls: 0,
    billedArtworkAttempts: 0,
  };
}

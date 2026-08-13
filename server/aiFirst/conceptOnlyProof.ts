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
import { preflightConceptQuartet } from "./conceptQuartet";
import { buildSystemPrompt, buildUserPrompt } from "./prompt";

export const CONCEPT_MODEL = "claude-sonnet-4-6";

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
  const client = input.anthropic ?? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const parser = new ConceptStreamParser();
  const candidates: AiFirstConcept[] = [];
  let firstConceptReported = false;

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
    messages: [
      {
        role: "user",
        content: buildUserPrompt({
          brief: input.brief,
          direction: input.direction,
          avoidConceptNames: input.avoidConceptNames,
          keepConstraints: input.keepConstraints,
        }),
      },
    ],
  });

  for await (const chunk of stream) {
    throwIfAborted(input.signal);
    if (chunk.type !== "content_block_delta" || chunk.delta.type !== "text_delta") continue;
    collect(parser.push(chunk.delta.text));
  }
  throwIfAborted(input.signal);
  collect(parser.flush());

  input.onReviewingConcepts?.();
  const quartet = preflightConceptQuartet(candidates, input.brief);
  const conceptRejections = parser.rejections.length + quartet.errors.length;
  if (!quartet.passed) {
    for (const error of quartet.errors) input.onPreflightWarning?.(error);
    throw new Error(`creative quartet failed zero-image preflight: ${quartet.errors.join("; ")}`);
  }

  return {
    model: CONCEPT_MODEL,
    concepts: quartet.concepts,
    conceptRejections,
    imageProviderCalls: 0,
    billedArtworkAttempts: 0,
  };
}

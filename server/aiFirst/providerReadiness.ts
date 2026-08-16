// Non-generative model-access checks for the protected Preview review path.
//
// Both providers expose model metadata endpoints. These calls authenticate
// the configured API keys and verify permission to the exact configured
// models without sending a prompt or invoking the image generation endpoint.

import Anthropic from "@anthropic-ai/sdk";
import { CONCEPT_MODEL } from "./conceptOnlyProof";
import type { ArtworkModel } from "./artwork";

export interface ProviderModelCheck {
  provider: "anthropic" | "openai";
  model: string;
  configured: boolean;
  accessible: boolean;
  httpStatus?: number;
  error?: string;
}

export interface AiFirstModelReadiness {
  ready: boolean;
  anthropic: ProviderModelCheck;
  openai: ProviderModelCheck;
  imageProviderCalls: 0;
}

export interface ProviderReadinessInput {
  env: Record<string, string | undefined>;
  artworkModel: ArtworkModel;
  anthropic?: Anthropic;
  fetchImpl?: typeof fetch;
}

function safeError(error: unknown): { httpStatus?: number; error: string } {
  const status = typeof (error as { status?: unknown })?.status === "number"
    ? (error as { status: number }).status
    : undefined;
  const message = error instanceof Error ? error.message : String(error);
  return { httpStatus: status, error: message.slice(0, 500) };
}

export async function checkAiFirstModelReadiness(input: ProviderReadinessInput): Promise<AiFirstModelReadiness> {
  const anthropicKey = input.env.ANTHROPIC_API_KEY?.trim();
  const openAiKey = input.env.OPENAI_API_KEY?.trim();

  let anthropic: ProviderModelCheck = {
    provider: "anthropic",
    model: CONCEPT_MODEL,
    configured: Boolean(anthropicKey),
    accessible: false,
  };
  if (anthropicKey) {
    try {
      const client = input.anthropic ?? new Anthropic({ apiKey: anthropicKey });
      const model = await client.models.retrieve(CONCEPT_MODEL);
      anthropic = { ...anthropic, accessible: model.id === CONCEPT_MODEL };
    } catch (error) {
      anthropic = { ...anthropic, ...safeError(error) };
    }
  }

  let openai: ProviderModelCheck = {
    provider: "openai",
    model: input.artworkModel,
    configured: Boolean(openAiKey),
    accessible: false,
  };
  if (openAiKey) {
    try {
      const response = await (input.fetchImpl ?? fetch)(
        `https://api.openai.com/v1/models/${encodeURIComponent(input.artworkModel)}`,
        { headers: { Authorization: `Bearer ${openAiKey}` } },
      );
      if (!response.ok) {
        const body = await response.text().catch(() => "");
        openai = {
          ...openai,
          httpStatus: response.status,
          error: body.slice(0, 500) || `OpenAI model check failed (${response.status}).`,
        };
      } else {
        const model = (await response.json()) as { id?: string };
        openai = { ...openai, accessible: model.id === input.artworkModel, httpStatus: response.status };
      }
    } catch (error) {
      openai = { ...openai, ...safeError(error) };
    }
  }

  return {
    ready: anthropic.accessible && openai.accessible,
    anthropic,
    openai,
    imageProviderCalls: 0,
  };
}

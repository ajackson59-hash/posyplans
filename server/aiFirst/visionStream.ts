import Anthropic from "@anthropic-ai/sdk";

/** Private, server-measured transport facts. Partial usage is not a final bill. */
export interface VisionRequestTiming {
  transport: "stream";
  headersMs: number | null;
  firstEventMs: number | null;
  firstTextMs: number | null;
  finishedMs: number | null;
  httpStatus: number | null;
  requestId: string | null;
  messageId: string | null;
  textCharacters: number;
  messageStopped: boolean;
  stopReason: string | null;
  outcome: "pending" | "completed" | "aborted" | "failed";
  usageStatus: "none" | "partial" | "complete";
  usage: { inputTokens: number; outputTokens: number };
}

export const newVisionRequestTiming = (): VisionRequestTiming => ({
  transport: "stream", headersMs: null, firstEventMs: null, firstTextMs: null,
  finishedMs: null, httpStatus: null, requestId: null, messageId: null,
  textCharacters: 0, messageStopped: false, stopReason: null, outcome: "pending",
  usageStatus: "none", usage: { inputTokens: 0, outputTokens: 0 },
});

/** One SDK dispatch. Uses the SDK's accumulator; incomplete JSON is never a verdict. */
export async function streamVisionResponse(client: Anthropic,
  body: Anthropic.Messages.MessageCreateParamsNonStreaming,
  timing: VisionRequestTiming, signal?: AbortSignal): Promise<Anthropic.Messages.Message> {
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  try {
    signal?.throwIfAborted();
    const stream = client.messages.stream(body, { signal, maxRetries: 0 });
    stream.on("connect", () => {
      timing.headersMs = elapsed();
      timing.httpStatus = stream.response?.status ?? null;
      timing.requestId = stream.request_id ?? null;
    });
    stream.on("streamEvent", (event, snapshot) => {
      timing.firstEventMs ??= elapsed();
      timing.messageId = snapshot.id;
      // Snapshot usage is cumulative, not an increment to add for every event.
      timing.usage = { inputTokens: snapshot.usage.input_tokens, outputTokens: snapshot.usage.output_tokens };
      timing.usageStatus = "partial";
      timing.stopReason = snapshot.stop_reason;
      if (event.type === "message_stop") timing.messageStopped = true;
    });
    stream.on("text", (delta) => {
      if (delta.length) timing.firstTextMs ??= elapsed();
      timing.textCharacters += delta.length;
    });
    const response = await stream.finalMessage();
    signal?.throwIfAborted();
    if (!timing.messageStopped || !response.stop_reason) throw new Error("Incomplete vision stream");
    timing.usage = { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
    timing.usageStatus = "complete";
    timing.outcome = "completed";
    return response;
  } catch (error) {
    timing.outcome = signal?.aborted || error instanceof Anthropic.APIUserAbortError ? "aborted" : "failed";
    if (error instanceof Anthropic.APIError) {
      timing.httpStatus ??= error.status ?? null;
      timing.requestId ??= error.requestID ?? null;
    }
    throw error;
  } finally {
    timing.finishedMs = elapsed();
  }
}

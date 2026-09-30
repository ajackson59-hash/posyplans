import Anthropic from "@anthropic-ai/sdk";
import { IDENTITY_FEATURES } from "../../server/aiFirst/identityComparison";

export const blindReport = (match = true) => ({
  subjectSelection: { status: "located", candidateLocation: "Right subject", referenceLocation: "Center subject",
    observation: "Offline fixture counterpart, not a visual judgment" },
  identityComparisons: IDENTITY_FEATURES.map(feature => ({ referenceKey: "reference1", feature,
    candidateLocation: "Right subject's head", candidateVisibility: "clear", referenceVisibility: "clear",
    referenceObservation: "Reference geometry fixture", candidateObservation: "Candidate geometry fixture",
    assessment: !match && feature === "hairStructure" ? "mismatch" : "match", explanation: "Offline fixture only" })),
});

/** Exercises the installed SDK and streaming accumulator without network traffic. */
export function blindFixtureClient(reply: (body: any) => unknown, onRequest?: (body: any) => void) {
  return new Anthropic({ apiKey: "offline-no-network", fetch: async (_url, options) => {
    const body = JSON.parse(options!.body as string); onRequest?.(body);
    const report = reply(body);
    const rows = [
      { type: "message_start", message: { id: "msg_offline", type: "message", role: "assistant", model: body.model,
        content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 1 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: JSON.stringify(report) } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 80 } },
      { type: "message_stop" },
    ];
    return new Response(rows.map(row => `event: ${row.type}\ndata: ${JSON.stringify(row)}\n\n`).join(""),
      { headers: { "content-type": "text/event-stream", "request-id": "req_offline" } });
  } });
}

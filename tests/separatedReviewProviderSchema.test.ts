// @vitest-environment node
import Anthropic from "@anthropic-ai/sdk";
import { expect, it, vi } from "vitest";
import { encodePng } from "../server/aiFirst/png";
import { crossThemeProfile } from "../server/crossThemeReviewProfiles";
import { prepareSeparatedReview } from "../server/aiFirst/separatedArtworkReview";

// The real SDK serializer previously sent unsupported minimum/maximum intact.
// Check the wire schema against the documented subset used by these reviewers.
// https://platform.claude.com/docs/en/build-with-claude/structured-outputs#json-schema-limitations
// The installed SDK helper also strips supported enums, so equality with its
// transformed output would incorrectly require weakening our score/criterion domains.
// This is an offline compatibility regression, not a provider acceptance test.
function checkSchema(schema: any): void {
  const allowed = new Set(["type", "properties", "required", "additionalProperties", "items", "enum"]);
  for (const key of Object.keys(schema)) expect(allowed.has(key), `Unsupported schema keyword: ${key}`).toBe(true);
  if (schema.type === "object") {
    expect(schema.additionalProperties).toBe(false);
    for (const row of Object.values(schema.properties)) checkSchema(row);
  }
  if (schema.type === "array") checkSchema(schema.items);
  if (schema.enum) expect(schema.enum.every((v: unknown) => v === null || ["string", "number", "boolean"].includes(typeof v))).toBe(true);
}
it.each(["craft", "fidelity"] as const)("sends a provider-compatible %s schema without weakening the score domain", async role => {
  const bytes = encodePng({ width: 8, height: 8, rgb: new Uint8Array(192).fill(120) });
  const plan = prepareSeparatedReview({ ...await crossThemeProfile("c01"), bytes, reviewMode: "teaser" });
  let wire: any;
  const transport = vi.fn(async (_url: any, init: any) => {
    wire = JSON.parse(init.body);
    return new Response(JSON.stringify({ id: "msg_offline", type: "message", role: "assistant", model: wire.model,
      stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "text", text: "{}" }] }),
      { status: 200, headers: { "Content-Type": "application/json" } });
  });
  const client = new Anthropic({ apiKey: "offline-test", maxRetries: 0, fetch: transport });
  await client.messages.create(plan[role].body as Anthropic.Messages.MessageCreateParamsNonStreaming);
  expect(transport).toHaveBeenCalledTimes(1);
  const schema = wire.output_config.format.schema;
  checkSchema(schema);
  const dimensions = role === "craft" ? schema.properties : schema.properties.assessments.properties;
  for (const row of Object.values(dimensions) as any[]) expect(row.properties.score).toEqual({ type: "integer", enum: [1, 2, 3, 4, 5] });
});

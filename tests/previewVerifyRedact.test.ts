// Tests for tools/preview-verify/redact.ts. No real secrets: every value
// here is a synthetic fixture string, never a live credential.

import { describe, expect, it } from "vitest";
import { isNonEmpty, checkProviderKeys, assertNoSecretSubstring } from "../tools/preview-verify/redact";

describe("isNonEmpty", () => {
  it("is false for undefined", () => {
    expect(isNonEmpty(undefined)).toBe(false);
  });

  it("is false for empty string", () => {
    expect(isNonEmpty("")).toBe(false);
  });

  it("is false for whitespace-only string", () => {
    expect(isNonEmpty("   ")).toBe(false);
  });

  it("is true for a non-empty string", () => {
    expect(isNonEmpty("fixture-value")).toBe(true);
  });
});

describe("checkProviderKeys", () => {
  it("reports both false when neither key is set", () => {
    const facts = checkProviderKeys({});
    expect(facts.openAiKeyPresent).toBe(false);
    expect(facts.anthropicKeyPresent).toBe(false);
  });

  it("reports true only for keys that are present and non-empty", () => {
    const facts = checkProviderKeys({
      OPENAI_API_KEY: "fixture-openai-key",
      ANTHROPIC_API_KEY: "",
    });
    expect(facts.openAiKeyPresent).toBe(true);
    expect(facts.anthropicKeyPresent).toBe(false);
  });

  it("does not leak the key value itself into the returned facts", () => {
    const facts = checkProviderKeys({ OPENAI_API_KEY: "fixture-openai-key" });
    expect(JSON.stringify(facts)).not.toContain("fixture-openai-key");
  });
});

describe("assertNoSecretSubstring", () => {
  it("does not throw when no secrets are present in the output", () => {
    expect(() => assertNoSecretSubstring("PASS environment=preview", ["fixture-secret"])).not.toThrow();
  });

  it("does not throw when secrets are undefined", () => {
    expect(() => assertNoSecretSubstring("PASS", [undefined, undefined])).not.toThrow();
  });

  it("throws when the output contains a secret substring", () => {
    expect(() =>
      assertNoSecretSubstring("oops leaked fixture-secret-value here", ["fixture-secret-value"]),
    ).toThrow();
  });

  it("ignores empty-string secrets", () => {
    expect(() => assertNoSecretSubstring("anything", [""])).not.toThrow();
  });
});

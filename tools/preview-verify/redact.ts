// TEMPORARY, non-public build-time verification instrumentation.
//
// Helpers that make it structurally hard to accidentally print a secret.
// `redactSecretsFromEnv` never returns raw values; `assertNoSecretSubstring`
// is a defense-in-depth guard used in tests and before any console.log call
// in this tool to prove a given output string does not contain a
// known-secret substring.

/** Non-empty (present + not just whitespace) check for a provider key env var. */
export function isNonEmpty(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export interface ProviderKeyFacts {
  openAiKeyPresent: boolean;
  anthropicKeyPresent: boolean;
}

export function checkProviderKeys(env: Record<string, string | undefined>): ProviderKeyFacts {
  return {
    openAiKeyPresent: isNonEmpty(env.OPENAI_API_KEY),
    anthropicKeyPresent: isNonEmpty(env.ANTHROPIC_API_KEY),
  };
}

/**
 * Throws if `output` contains any of the given secret values as a literal
 * substring. Used as a last-line-of-defense assertion immediately before
 * anything from this tool is written to stdout/stderr. Ignores
 * undefined/empty secrets (nothing to leak).
 */
export function assertNoSecretSubstring(output: string, secrets: Array<string | undefined>): void {
  for (const secret of secrets) {
    if (secret && secret.length > 0 && output.includes(secret)) {
      throw new Error(
        "Refusing to emit output: a secret value would appear in the printed text.",
      );
    }
  }
}

/**
 * Redacts a raw connection URL down to a fixed, safe placeholder — used only
 * in error paths where we might otherwise be tempted to echo the input for
 * debugging. Always returns a constant; never derives anything from the URL.
 */
export function redactedPlaceholder(): string {
  return "[redacted]";
}

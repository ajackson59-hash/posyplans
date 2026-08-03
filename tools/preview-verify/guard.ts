// TEMPORARY, non-public build-time verification instrumentation.
//
// This module exists solely to let the deploying agent confirm — from
// inside a single Vercel Preview build — that the Preview environment is
// wired to the Preview Supabase project (not Production), on the pooled
// Supavisor endpoint, with the AI provider keys present. It is not a route,
// not an API endpoint, and it never runs as part of a normal production
// build. It is intended to be removed once Preview verification succeeds.
//
// Hard stop: this file (and everything under tools/preview-verify) must
// refuse to run unless VERCEL_ENV === 'preview'. This guard is the single
// choke point every entrypoint in this directory calls first.

export class PreviewGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreviewGuardError";
  }
}

/**
 * Throws unless env.VERCEL_ENV is exactly 'preview'. Callers pass an
 * explicit env bag (defaulting to process.env) so this is testable without
 * mutating global state.
 */
export function assertPreviewEnv(env: Record<string, string | undefined> = process.env): void {
  const vercelEnv = env.VERCEL_ENV;
  if (vercelEnv !== "preview") {
    throw new PreviewGuardError(
      `Preview verifier refuses to run: VERCEL_ENV is ${JSON.stringify(
        vercelEnv ?? null,
      )}, not "preview". This instrumentation is Preview-only.`,
    );
  }
}

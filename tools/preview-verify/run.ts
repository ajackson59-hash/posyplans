// TEMPORARY, non-public build-time verification instrumentation.
//
// Invoked via `npm run verify:preview` (which runs `tsx
// tools/preview-verify/run.ts`) — not intended to be executed directly.
//
// Purpose: from inside a single Vercel Preview build, confirm — using only
// redacted facts — that this build is wired to the Preview Supabase project
// on its pooled endpoint, with AI provider keys present, and that a
// read-only round trip against the database succeeds. Nothing here is a
// route/endpoint, nothing here calls an AI provider, and nothing here
// writes to the database.
//
// Hard requirements enforced by this file:
//   - Refuses to run unless VERCEL_ENV === 'preview' (see guard.ts).
//   - DATABASE_URL is read only into process memory; only redacted booleans
//     and the port number are ever logged (see parse.ts / redact.ts).
//   - The DB check opens one connection, runs BEGIN READ ONLY; SELECT 1;
//     then rolls back and closes. No writes, no DDL, no migrations.
//   - POSY_FLAG_AI_FIRST_INVITATIONS is never read or set by this file —
//     it has no bearing on this check and stays disabled everywhere.
//   - Output is exactly one PASS/FAIL line followed by redacted metadata.
//
// This file is meant to be invoked via `npm run verify:preview` (see the
// temporary "verify:preview" script in package.json) and nothing else wires
// it into the app. It is never imported by server/ or client/ code.

import { assertPreviewEnv, PreviewGuardError } from "./guard";
import { parseRedactedDbFacts } from "./parse";
import { checkProviderKeys, assertNoSecretSubstring } from "./redact";

export interface VerifierReport {
  status: "PASS" | "FAIL";
  environment: string;
  hostnameHasPreviewRef: boolean;
  hostnameHasProductionRef: boolean;
  isSupabasePooledHost: boolean;
  port: number | null;
  isExpectedPoolerPort: boolean;
  selectOneOk: boolean;
  openAiKeyPresent: boolean;
  anthropicKeyPresent: boolean;
  failureReasons: string[];
}

/**
 * Runs the read-only DB round trip: connect, BEGIN READ ONLY, SELECT 1,
 * ROLLBACK, close. Returns whether the SELECT 1 round trip succeeded.
 * Never mutates data, never runs DDL. Any connection/query error is treated
 * as a failed check (selectOneOk: false), not a thrown crash, so the rest
 * of the report still prints.
 */
async function runReadOnlySelectOne(databaseUrl: string): Promise<boolean> {
  // Lazily imported so environments that exercise only the parser/redaction
  // logic (unit tests) never need a real `postgres` connection or network
  // access.
  const { default: postgres } = await import("postgres");
  const sql = postgres(databaseUrl, {
    prepare: false,
    max: 1,
    connect_timeout: 10,
    idle_timeout: 5,
  });
  try {
    const rows = await sql.begin("read only", async (tx) => {
      return await tx`SELECT 1 as one`;
    });
    // sql.begin with a transaction that only reads and is never committed
    // with a write still issues COMMIT on success; since the transaction
    // is READ ONLY, Postgres permits the commit but no mutation is
    // possible or attempted anywhere in this block.
    return Array.isArray(rows) && rows[0]?.one === 1;
  } catch {
    return false;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

export async function runVerifier(
  env: Record<string, string | undefined> = process.env,
): Promise<VerifierReport> {
  assertPreviewEnv(env);

  const failureReasons: string[] = [];

  const databaseUrl = env.DATABASE_URL; // read once, kept only in this local, never logged
  const dbFacts = parseRedactedDbFacts(databaseUrl);
  const providerFacts = checkProviderKeys(env);

  if (!dbFacts.parsed) failureReasons.push("DATABASE_URL missing or unparseable");
  if (!dbFacts.hostnameHasPreviewRef) failureReasons.push("hostname does not contain Preview project ref");
  if (dbFacts.hostnameHasProductionRef) failureReasons.push("hostname contains Production project ref");
  if (!dbFacts.isSupabasePooledHost) failureReasons.push("hostname is not a Supabase pooled (Supavisor) endpoint");
  if (!dbFacts.isExpectedPoolerPort) failureReasons.push("port is not the expected pooler port 6543");
  if (!providerFacts.openAiKeyPresent) failureReasons.push("OPENAI_API_KEY is empty or unset");
  if (!providerFacts.anthropicKeyPresent) failureReasons.push("ANTHROPIC_API_KEY is empty or unset");

  let selectOneOk = false;
  if (dbFacts.parsed && databaseUrl) {
    selectOneOk = await runReadOnlySelectOne(databaseUrl);
  }
  if (!selectOneOk) failureReasons.push("read-only SELECT 1 round trip failed");

  const status: "PASS" | "FAIL" = failureReasons.length === 0 ? "PASS" : "FAIL";

  return {
    status,
    environment: env.VERCEL_ENV ?? "unknown",
    hostnameHasPreviewRef: dbFacts.hostnameHasPreviewRef,
    hostnameHasProductionRef: dbFacts.hostnameHasProductionRef,
    isSupabasePooledHost: dbFacts.isSupabasePooledHost,
    port: dbFacts.port,
    isExpectedPoolerPort: dbFacts.isExpectedPoolerPort,
    selectOneOk,
    openAiKeyPresent: providerFacts.openAiKeyPresent,
    anthropicKeyPresent: providerFacts.anthropicKeyPresent,
    failureReasons,
  };
}

function formatReport(report: VerifierReport): string {
  const lines = [
    report.status,
    `environment=${report.environment}`,
    `hostnameHasPreviewRef=${report.hostnameHasPreviewRef}`,
    `hostnameHasProductionRef=${report.hostnameHasProductionRef}`,
    `isSupabasePooledHost=${report.isSupabasePooledHost}`,
    `port=${report.port ?? "null"}`,
    `isExpectedPoolerPort=${report.isExpectedPoolerPort}`,
    `selectOneOk=${report.selectOneOk}`,
    `openAiKeyPresent=${report.openAiKeyPresent}`,
    `anthropicKeyPresent=${report.anthropicKeyPresent}`,
  ];
  if (report.failureReasons.length > 0) {
    lines.push(`failureReasons=${JSON.stringify(report.failureReasons)}`);
  }
  return lines.join(" ");
}

async function main() {
  try {
    const report = await runVerifier(process.env);
    const line = formatReport(report);
    // Defense in depth: prove the line we're about to print cannot contain
    // the raw connection string, a bare password-looking value, or either
    // provider key, before it ever reaches stdout.
    assertNoSecretSubstring(line, [
      process.env.DATABASE_URL,
      process.env.OPENAI_API_KEY,
      process.env.ANTHROPIC_API_KEY,
    ]);
    console.log(line);
    process.exit(report.status === "PASS" ? 0 : 1);
  } catch (err) {
    if (err instanceof PreviewGuardError) {
      console.error(`FAIL guard=${err.message}`);
      process.exit(1);
    }
    console.error("FAIL verifier crashed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

// Only run when executed directly (`npm run verify:preview`), never on
// import — this keeps the module safely importable from unit tests.
const isDirectRun = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`;
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  main();
}

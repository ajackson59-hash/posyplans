import { runInternalPreviewCanary } from "../server/emailDiagnosticRoutes";

const environment = process.env.VERCEL_ENV || "local";
const branch = process.env.VERCEL_GIT_COMMIT_REF || "unknown";

if (environment !== "preview" || branch !== "codex/launch-blockers") {
  console.log(`[build-preview-text-first-canary] ${JSON.stringify({ skipped: true, environment, branch })}`);
  process.exit(0);
}

try {
  const result = await runInternalPreviewCanary();
  console.log(`[build-preview-text-first-canary] ${JSON.stringify(result)}`);
} catch (error) {
  console.error(`[build-preview-text-first-canary] ${JSON.stringify({
    status: 500,
    error: error instanceof Error ? error.message : String(error),
  })}`);
} finally {
  process.exit(0);
}

import { runInternalPreviewCanary } from "../server/emailDiagnosticRoutes";

const environment = process.env.VERCEL_ENV || "local";
const branch = process.env.VERCEL_GIT_COMMIT_REF || "unknown";

function databaseIdentity(raw: string | undefined) {
  if (!raw) return { configured: false };
  try {
    const parsed = new URL(raw);
    const username = decodeURIComponent(parsed.username || "");
    const projectRef = username.includes(".")
      ? username.split(".").at(-1) || null
      : /^db\.([a-z0-9]+)\./i.exec(parsed.hostname)?.[1] || null;
    return {
      configured: true,
      hostname: parsed.hostname,
      port: parsed.port || "default",
      database: parsed.pathname.replace(/^\//, "") || null,
      projectRef,
      pooled: parsed.hostname.includes("pooler") || username.includes("."),
    };
  } catch {
    return { configured: true, parseable: false };
  }
}

console.log(`[build-preview-database] ${JSON.stringify({
  environment,
  branch,
  database: databaseIdentity(process.env.DATABASE_URL),
})}`);

if (environment !== "preview" || branch !== "codex/launch-blockers") {
  console.log(`[build-preview-visual-canary] ${JSON.stringify({ skipped: true, environment, branch })}`);
  process.exit(0);
}

try {
  const result = await runInternalPreviewCanary();
  console.log(`[build-preview-visual-canary] ${JSON.stringify(result)}`);
} catch (error) {
  console.error(`[build-preview-visual-canary] ${JSON.stringify({
    status: 500,
    error: error instanceof Error ? error.message : String(error),
  })}`);
} finally {
  process.exit(0);
}

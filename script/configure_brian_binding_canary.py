from pathlib import Path

email_path = Path("server/emailDiagnosticRoutes.ts")
email = email_path.read_text()
old = 'const INTERNAL_PREVIEW_CANARY_OWNER_TOKEN = "qa-preview-brian-premium-lock-20260901-c3";'
new = 'const INTERNAL_PREVIEW_CANARY_OWNER_TOKEN = "qa-preview-brian-binding-lock-20260901-c4";'
if email.count(old) != 1:
    raise SystemExit(f"expected one prior canary owner token, found {email.count(old)}")
email_path.write_text(email.replace(old, new, 1))

runner = '''import { runInternalPreviewCanary } from "../server/emailDiagnosticRoutes";

const environment = process.env.VERCEL_ENV || "local";
const branch = process.env.VERCEL_GIT_COMMIT_REF || "unknown";

function databaseIdentity(raw: string | undefined) {
  if (!raw) return { configured: false };
  try {
    const parsed = new URL(raw);
    const username = decodeURIComponent(parsed.username || "");
    const projectRef = username.includes(".")
      ? username.split(".").at(-1) || null
      : /^db\\.([a-z0-9]+)\\./i.exec(parsed.hostname)?.[1] || null;
    return {
      configured: true,
      hostname: parsed.hostname,
      port: parsed.port || "default",
      database: parsed.pathname.replace(/^\\//, "") || null,
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
  canary: "brian-binding-c4",
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
'''
Path("script/run_preview_build_canary.ts").write_text(runner)
print("Brian binding canary configured")

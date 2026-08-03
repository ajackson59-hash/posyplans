// TEMPORARY, non-public build-time verification instrumentation.
//
// Pure, side-effect-free parsing of a Postgres connection string into
// REDACTED facts only. Nothing in this file's return values may ever
// contain the username, password, full host, or the raw connection string.
// Only booleans, the port number, and a small enum-like string are returned.

export const PREVIEW_PROJECT_REF = "zniggkeyyohniqrccblm";
export const PRODUCTION_PROJECT_REF = "jvioxjetpqafkbwqihto";
export const EXPECTED_POOLER_PORT = 6543;

export interface RedactedDbFacts {
  /** Connection string parsed without throwing. */
  parsed: boolean;
  /**
   * The Preview Supabase project ref is present in the connection
   * authority (hostname, or — for Supabase's pooled Supavisor format,
   * `postgres.<project-ref>` — the username). The project ref is a public
   * identifier, not a secret, so surfacing it here does not leak
   * credentials; the password portion of the URL is never inspected or
   * returned by this module.
   */
  hostnameHasPreviewRef: boolean;
  /** Production Supabase project ref present in the connection authority (must be false). */
  hostnameHasProductionRef: boolean;
  /** Hostname matches Supabase's pooled Supavisor endpoint pattern. */
  isSupabasePooledHost: boolean;
  /** Explicit port parsed from the URL, or null if absent/unparseable. */
  port: number | null;
  /** True iff port === EXPECTED_POOLER_PORT (6543). */
  isExpectedPoolerPort: boolean;
}

const FAILED_PARSE_FACTS: RedactedDbFacts = {
  parsed: false,
  hostnameHasPreviewRef: false,
  hostnameHasProductionRef: false,
  isSupabasePooledHost: false,
  port: null,
  isExpectedPoolerPort: false,
};

/**
 * Supabase's Supavisor pooled endpoint hostnames look like
 * `aws-0-<region>.pooler.supabase.com` (or aws-1-, etc). This checks the
 * *shape*, not any specific project — the project identity is carried in
 * the username (postgres.<ref>), never the host, so ref-matching is done
 * separately against the full connection string below.
 */
function isPoolerHostname(hostname: string): boolean {
  return /^aws-\d+-[a-z0-9-]+\.pooler\.supabase\.com$/i.test(hostname);
}

/**
 * Parses a Postgres connection URL into redacted facts only. Never returns
 * or logs the username, password, or the input string itself. Safe to call
 * with an empty/undefined value — returns all-false facts.
 */
export function parseRedactedDbFacts(databaseUrl: string | undefined): RedactedDbFacts {
  if (!databaseUrl) return { ...FAILED_PARSE_FACTS };

  let url: URL;
  try {
    // node:url's URL parser understands postgres(ql):// URLs structurally
    // (protocol/userinfo/host/port) without needing a Postgres driver.
    url = new URL(databaseUrl);
  } catch {
    return { ...FAILED_PARSE_FACTS };
  }

  const hostname = url.hostname.toLowerCase();
  // The project ref is a public identifier embedded in either the hostname
  // (direct db.<ref>.supabase.co connections) or the username
  // (postgres.<ref>, Supabase's pooled Supavisor format). It is never part
  // of the password, so including the username here does not risk leaking
  // a secret. url.password is intentionally never read by this module.
  const username = decodeURIComponent(url.username).toLowerCase();
  const authority = `${username}@${hostname}`;
  const hostnameHasPreviewRef = authority.includes(PREVIEW_PROJECT_REF.toLowerCase());
  const hostnameHasProductionRef = authority.includes(PRODUCTION_PROJECT_REF.toLowerCase());
  const isSupabasePooledHost = isPoolerHostname(hostname);

  const rawPort = url.port;
  const port = rawPort ? Number.parseInt(rawPort, 10) : null;
  const isExpectedPoolerPort = port === EXPECTED_POOLER_PORT;

  return {
    parsed: true,
    hostnameHasPreviewRef,
    hostnameHasProductionRef,
    isSupabasePooledHost,
    port,
    isExpectedPoolerPort,
  };
}

// Minimal cookie helpers — no cookie-parser dependency needed for the one
// cookie this app sets (consent preferences). Client-side JS never touches
// document.cookie directly (that API is unreliable inside the sandboxed
// preview iframe); the browser's native automatic cookie handling on HTTP
// requests is what we rely on instead.

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (!key) continue;
    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
  }
  return cookies;
}

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export function serializeConsentCookie(value: string): string {
  return `pp_consent=${encodeURIComponent(value)}; Path=/; Max-Age=${ONE_YEAR_SECONDS}; SameSite=Lax`;
}

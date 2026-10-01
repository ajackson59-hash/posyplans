import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/** Never fall back to DATABASE_URL: that variable may identify a hosted app. */
export function postgresIntegrationUrl(env = process.env) {
  if (env.POSY_POSTGRES_INTEGRATION !== '1') throw new Error('Set POSY_POSTGRES_INTEGRATION=1 to opt into the disposable PostgreSQL suite.');
  let url;
  try { url = new URL(env.POSY_POSTGRES_INTEGRATION_URL ?? ''); }
  catch { throw new Error('POSY_POSTGRES_INTEGRATION_URL must explicitly identify the disposable local test database.'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
    || url.pathname !== '/posy_integration' || url.username !== 'posy_integration'
    || url.password !== 'local-only-test' || url.search || url.hash) {
    throw new Error('PostgreSQL integration is restricted to loopback host, database/user posy_integration and password local-only-test, with no URL options.');
  }
  return url.href;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { postgresIntegrationUrl(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

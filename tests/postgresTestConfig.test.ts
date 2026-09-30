// @vitest-environment node
import { expect, it } from 'vitest';
import { postgresIntegrationUrl } from '../script/postgres-test-config.mjs';

const local = 'postgres://posy_integration:local-only-test@127.0.0.1:5432/posy_integration';
it('requires separate explicit opt-in and never uses an inherited application database', () => {
  expect(() => postgresIntegrationUrl({ DATABASE_URL: local })).toThrow('opt into');
  expect(() => postgresIntegrationUrl({ POSY_POSTGRES_INTEGRATION: '1', DATABASE_URL: local })).toThrow('explicitly');
  expect(postgresIntegrationUrl({ POSY_POSTGRES_INTEGRATION: '1', POSY_POSTGRES_INTEGRATION_URL: local })).toBe(local);
});
it.each([
  local.replace('127.0.0.1', 'db.example.invalid'),
  local.replace('/posy_integration', '/app'),
  local.replace('posy_integration:', 'postgres:'),
  `${local}?host=db.example.invalid`,
  `${local}#other`,
  local.replace('local-only-test', 'different'),
])('rejects a target outside the disposable local contract', url => {
  expect(() => postgresIntegrationUrl({ POSY_POSTGRES_INTEGRATION: '1', POSY_POSTGRES_INTEGRATION_URL: url })).toThrow('restricted');
});

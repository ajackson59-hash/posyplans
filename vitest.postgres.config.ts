import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: { alias: { '@shared': path.resolve(import.meta.dirname, 'shared') } },
  test: {
    environment: 'node',
    include: ['tests/planRegenerationPostgres.integration.test.ts', 'tests/imageSpendPostgres.integration.test.ts', 'tests/plusMembershipPostgres.integration.test.ts', 'tests/plusLinkPostgres.integration.test.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    hookTimeout: 30_000,
    testTimeout: 15_000,
  },
});

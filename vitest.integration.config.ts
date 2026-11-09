import { defineConfig } from 'vitest/config'

// API-client tests against a real OpenBao dev server (BAO_ADDR, BAO_TOKEN).
export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],
    testTimeout: 30000,
    // Generating an SSH CA key in a beforeAll took over 10s on the CI runner.
    hookTimeout: 60000,
    // The files share one OpenBao and one Postgres: concurrent role creation fails with "tuple concurrently updated".
    fileParallelism: false,
  },
})

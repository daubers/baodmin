import { defineConfig } from 'vitest/config'

// API-client tests against a real OpenBao dev server (BAO_ADDR, BAO_TOKEN).
export default defineConfig({
  test: {
    include: ['src/**/*.integration.test.ts'],
    testTimeout: 15000,
  },
})

import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'packages/*/scripts/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    // g11.test.ts holds the engine to a per-tick millisecond budget: half a 4-vCPU box left idle
    // is what keeps it measuring the code. Raise the timeouts before lowering this — never --retry.
    maxWorkers: 2,
  },
})

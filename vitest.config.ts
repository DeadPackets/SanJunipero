import { defineConfig } from 'vitest/config'
export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
    // bonds.test.ts asserts a RATIO of two measured durations: half a 4-vCPU box left idle is
    // what keeps it measuring the code. Raise the timeouts before lowering this — never --retry.
    maxWorkers: 2,
  },
})

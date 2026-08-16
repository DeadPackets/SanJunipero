import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['packages/*/src/**/*.livetest.ts'], testTimeout: 180_000 } })

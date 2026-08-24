import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Ports 8787 and 5173 are held by processes this lane did not start. Removed before the final tree.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { 'node:crypto': new URL('./src/shims/nodeCrypto.ts', import.meta.url).pathname },
  },
  server: {
    port: 5711,
    proxy: {
      '/ws': { target: 'http://localhost:9633', ws: true },
      '/api': { target: 'http://localhost:9633' },
      '/assets': { target: 'http://localhost:9633' },
    },
  },
})

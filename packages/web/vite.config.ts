import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { 'node:crypto': new URL('./src/shims/nodeCrypto.ts', import.meta.url).pathname },
  },
  // NOT vite's default `assets/`: the gateway serves the built client from its own origin, and
  // `/assets/:file` there is the codex PNG route, which 404s anything that is not a png. Kept
  // in step with `CLIENT_ASSET_DIR` in @sj/gateway's staticSite.ts.
  build: { assetsDir: 'client' },
  server: {
    proxy: {
      '/ws': { target: 'http://localhost:8787', ws: true },
      '/api': { target: 'http://localhost:8787' },
      // The gateway forwards this to the loopback operator channel; dev must take the same road.
      '/admin': { target: 'http://localhost:8787' },
      '/assets': { target: 'http://localhost:8787' },
    },
  },
})

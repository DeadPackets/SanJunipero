import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { 'node:crypto': new URL('./src/shims/nodeCrypto.ts', import.meta.url).pathname },
  },
  server: {
    proxy: {
      '/ws': { target: 'http://localhost:8787', ws: true },
      '/api': { target: 'http://localhost:8787' },
      '/assets': { target: 'http://localhost:8787' },
    },
  },
})

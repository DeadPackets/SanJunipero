import { basename } from 'node:path'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

/** The faces the first painted frame needs. They live behind the stylesheet, so without a
 *  preload the browser learns they exist one full round trip late. */
const FIRST_FACES = ['silkscreen-latin-400', 'manrope-latin-400', 'press-start-2p-latin-400']

const firstPaint = (): Plugin => ({
  name: 'sj-first-paint',
  enforce: 'post',
  apply: 'build',
  transformIndexHtml(html, ctx) {
    const faces = Object.keys(ctx.bundle ?? {}).filter(
      (f) => f.endsWith('.woff2') && FIRST_FACES.some((n) => basename(f).startsWith(n)),
    )
    // The whole load order is keyed on emitted filenames; a rename must break the build loudly.
    if (faces.length !== FIRST_FACES.length)
      throw new Error(
        `sj-first-paint: found ${String(faces.length)} first-paint faces, want ${String(FIRST_FACES.length)}`,
      )
    // The sheet stops blocking the first paint: the title card in `#root` carries its own inline
    // CSS, and 14 KB gzip of sheet lands long before 300 KB of entry has React mounting over it.
    const unblocked = html.replace(
      /<link rel="stylesheet"([^>]*)>/,
      (tag, rest: string) =>
        `<link rel="stylesheet"${rest} media="print" onload="this.media='all'"><noscript>${tag}</noscript>`,
    )
    return {
      html: unblocked,
      tags: faces.map((f) => ({
        tag: 'link',
        attrs: { rel: 'preload', as: 'font', type: 'font/woff2', crossorigin: '', href: `/${f}` },
        injectTo: 'head' as const,
      })),
    }
  },
})

/** `@fontsource` ships woff beside woff2. Every browser that can run this app reads woff2, so
 *  the copies were 230 KB nobody fetched and every CDN cached. Cut before Vite resolves the
 *  url, so the file is never emitted rather than emitted and then unpicked. */
const dropWoff1 = (): Plugin => ({
  name: 'sj-drop-woff1',
  enforce: 'pre',
  transform(code, id) {
    if (!id.includes('@fontsource') || !id.endsWith('.css')) return null
    const cut = code.replace(/,\s*url\([^)]*\.woff\)\s*format\(["']woff["']\)/g, '')
    return cut === code ? null : { code: cut, map: null }
  },
})

export default defineConfig({
  plugins: [react(), firstPaint(), dropWoff1()],
  resolve: {
    alias: { 'node:crypto': new URL('./src/shims/nodeCrypto.ts', import.meta.url).pathname },
  },
  build: {
    // NOT vite's default `assets/`: the gateway serves the built client from its own origin, and
    // `/assets/:file` there is the codex PNG route, which 404s anything that is not a png. Kept
    // in step with `CLIENT_ASSET_DIR` in @sj/gateway's staticSite.ts.
    assetsDir: 'client',
    // React is the one slab of the entry that never changes with the town. On its own chunk a
    // returning visitor re-fetches the app, not the framework under it. It keeps its
    // modulepreload: it is a STATIC import of the entry, so dropping the hint does not defer the
    // fetch, it just hides it until the entry has parsed — measured at +220ms to the first town.
    rollupOptions: {
      output: {
        manualChunks: (id) =>
          /node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id) ? 'react' : undefined,
      },
    },
  },
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

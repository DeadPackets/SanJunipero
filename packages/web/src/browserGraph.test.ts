import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The browser bundle is a LAYER, and vitest runs in Node — so nothing in the suite can feel
// a Node-only module leaking into it. `packages/engine`'s index re-exports `db.ts`, which
// imports `better-sqlite3` at module scope; one `from '@sj/engine'` anywhere in the reachable
// graph and the dev server hands the browser a module that throws before React mounts.
// This walks the real graph from the real entry and pins what may cross the wire.

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = resolve(HERE, '..')                 // packages/web
const PACKAGES = resolve(WEB, '..')             // packages
const ENTRY = join(HERE, 'main.tsx')

// Everything a browser may legitimately be handed. Adding to this list is the decision;
// `node:crypto` is here because vite.config.ts aliases it onto src/shims/nodeCrypto.ts.
export const BROWSER_SAFE_IMPORTS: readonly string[] = [
  'react', 'react-dom/client', 'react-force-graph-2d', 'pixi.js', 'zod', 'node:crypto',
  '@fontsource/press-start-2p', '@fontsource/silkscreen', '@fontsource/silkscreen/700.css',
]

// The three the controller's blank page actually died on, named so a regression reads plainly.
const NEVER = ['better-sqlite3', 'node:fs', 'node:util', 'fs', 'util', 'sharp', 'onnxruntime-node']

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\b[^;\n]*?from\s*['"]([^'"]+)['"]/g
const BARE_IMPORT_RE = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g

function specifiersOf(file: string): string[] {
  const src = readFileSync(file, 'utf8')
  const out: string[] = []
  for (const re of [IMPORT_RE, BARE_IMPORT_RE]) {
    re.lastIndex = 0
    for (let m = re.exec(src); m !== null; m = re.exec(src)) out.push(m[1]!)
  }
  return out
}

// './x.js' → './x.ts' | './x.tsx'; a directory → its index
function resolveRelative(spec: string, fromFile: string): string | null {
  const base = resolve(dirname(fromFile), spec)
  const stem = base.replace(/\.js$/, '')
  for (const c of [`${stem}.ts`, `${stem}.tsx`, base, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(c) && !c.endsWith('/')) return c
  }
  return null
}

// '@sj/engine/state' → the file its package.json `exports` map names. Following the map is
// the whole point: '@sj/engine' and '@sj/engine/state' are different files with very
// different dependencies, so a package-level rule cannot tell them apart.
function resolveWorkspace(spec: string): string | null {
  const m = /^@sj\/([^/]+)(\/.*)?$/.exec(spec)
  if (m === null) return null
  const pkgDir = join(PACKAGES, m[1]!)
  const pkgJson = join(pkgDir, 'package.json')
  if (!existsSync(pkgJson)) return null
  const exports = (JSON.parse(readFileSync(pkgJson, 'utf8')) as { exports?: Record<string, string> }).exports ?? {}
  const target = exports[m[2] === undefined ? '.' : `.${m[2]}`]
  return target === undefined ? null : join(pkgDir, target)
}

export type GraphWalk = { files: string[]; externals: Map<string, string[]> }

export function walkBrowserGraph(entry: string): GraphWalk {
  const files: string[] = []
  const externals = new Map<string, string[]>()   // specifier → the files that asked for it
  const seen = new Set<string>()
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.shift()!
    if (seen.has(file)) continue
    seen.add(file)
    files.push(file)
    for (const spec of specifiersOf(file)) {
      const next = spec.startsWith('.') ? resolveRelative(spec, file) : resolveWorkspace(spec)
      if (next !== null) {
        queue.push(next)
        continue
      }
      if (spec.startsWith('@sj/')) throw new Error(`${file}: '${spec}' resolves to no exported file`)
      externals.set(spec, [...(externals.get(spec) ?? []), file])
    }
  }
  return { files, externals }
}

describe('the browser graph', () => {
  const walk = walkBrowserGraph(ENTRY)

  it('starts at the entry the dev server actually serves', () => {
    expect(readFileSync(join(WEB, 'index.html'), 'utf8')).toContain('src="/src/main.tsx"')
    expect(existsSync(ENTRY)).toBe(true)
    expect(walk.files.length).toBeGreaterThan(20)
  })

  it('never reaches a native or Node-only module', () => {
    for (const banned of NEVER) {
      const askers = walk.externals.get(banned)
      expect(
        askers ?? null,
        `${banned} is reachable from the browser entry via:\n  ${(askers ?? []).join('\n  ')}`,
      ).toBeNull()
    }
    // …including through a file of ours that imports it directly
    for (const file of walk.files) {
      for (const spec of specifiersOf(file)) {
        expect(NEVER, `${file} imports ${spec}`).not.toContain(spec)
      }
    }
  })

  it('crosses the wire with nothing but the allowlist', () => {
    expect([...walk.externals.keys()].sort()).toEqual([...BROWSER_SAFE_IMPORTS].sort())
  })

  it('keeps the one aliased builtin actually aliased', () => {
    const config = readFileSync(join(WEB, 'vite.config.ts'), 'utf8')
    expect(config).toContain("'node:crypto'")
    expect(config).toContain('shims/nodeCrypto.ts')
  })
})

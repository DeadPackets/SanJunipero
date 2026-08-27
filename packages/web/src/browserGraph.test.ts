import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// vitest runs in Node, so the suite cannot feel a Node-only module leaking into the browser
// bundle: one `from '@sj/engine'` pulls in better-sqlite3 and the page throws before React
// mounts. Every file under `src` is a root, not just the entry — walking from `main.tsx` alone
// reports a leak only once something imports the file, which is already too late.

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = resolve(HERE, '..') // packages/web
const PACKAGES = resolve(WEB, '..') // packages
const ENTRY = join(HERE, 'main.tsx')

// Everything a browser may legitimately be handed. Adding to this list is the decision;
// `node:crypto` is here because vite.config.ts aliases it onto src/shims/nodeCrypto.ts.
export const BROWSER_SAFE_IMPORTS: readonly string[] = [
  'react',
  'react-dom/client',
  'react-force-graph-2d',
  'pixi.js',
  'zod',
  'node:crypto',
  '@fontsource/press-start-2p',
  '@fontsource/silkscreen',
  '@fontsource/silkscreen/700.css',
]

// The three the controller's blank page actually died on, named so a regression reads plainly.
const NEVER = ['better-sqlite3', 'node:fs', 'node:util', 'fs', 'util', 'sharp', 'onnxruntime-node']

const IMPORT_RE = /(?:^|\n)\s*(?:import|export)\b[^;\n]*?from\s*['"]([^'"]+)['"]/g
const BARE_IMPORT_RE = /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g

export function specifiersOfSource(src: string): string[] {
  const out: string[] = []
  for (const re of [IMPORT_RE, BARE_IMPORT_RE, DYNAMIC_IMPORT_RE]) {
    re.lastIndex = 0
    for (let m = re.exec(src); m !== null; m = re.exec(src)) out.push(m[1]!)
  }
  return out
}

function specifiersOf(file: string): string[] {
  return specifiersOfSource(readFileSync(file, 'utf8'))
}

// './x.js' → './x.ts' | './x.tsx'; a directory → its index
function resolveRelative(spec: string, fromFile: string): string | null {
  const base = resolve(dirname(fromFile), spec)
  const stem = base.replace(/\.js$/, '')
  for (const c of [
    `${stem}.ts`,
    `${stem}.tsx`,
    base,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]) {
    if (existsSync(c) && !c.endsWith('/')) return c
  }
  return null
}

// Follows the package.json `exports` map: '@sj/engine' and '@sj/engine/state' are different
// files with different dependencies, so a package-level rule cannot tell them apart.
function resolveWorkspace(spec: string): string | null {
  const m = /^@sj\/([^/]+)(\/.*)?$/.exec(spec)
  if (m === null) return null
  const pkgDir = join(PACKAGES, m[1]!)
  const pkgJson = join(pkgDir, 'package.json')
  if (!existsSync(pkgJson)) return null
  const exports =
    (JSON.parse(readFileSync(pkgJson, 'utf8')) as { exports?: Record<string, string> }).exports ??
    {}
  const target = exports[m[2] === undefined ? '.' : `.${m[2]}`]
  return target === undefined ? null : join(pkgDir, target)
}

export type GraphWalk = { files: string[]; externals: Map<string, string[]> }

export function walkBrowserGraph(entries: string | readonly string[]): GraphWalk {
  const files: string[] = []
  const externals = new Map<string, string[]>() // specifier → the files that asked for it
  const seen = new Set<string>()
  const queue = typeof entries === 'string' ? [entries] : [...entries]
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
      if (spec.startsWith('@sj/'))
        throw new Error(`${file}: '${spec}' resolves to no exported file`)
      externals.set(spec, [...(externals.get(spec) ?? []), file])
    }
  }
  return { files, externals }
}

/** Every source under `src` the bundler would take. A test file is not one of them; every
 *  other `.ts`/`.tsx` is, whether or not anything imports it TODAY. */
export function webSourceFiles(dir = join(WEB, 'src')): string[] {
  const out: string[] = []
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) {
      out.push(...webSourceFiles(p))
      continue
    }
    if (!/\.(ts|tsx)$/.test(name) || /\.test\.(ts|tsx)$/.test(name)) continue
    out.push(p)
  }
  return out
}

/** The banned modules a bare specifier drags in with it. */
export function bannedReachableFrom(spec: string): string[] {
  const target = resolveWorkspace(spec)
  if (target === null) return NEVER.includes(spec) ? [spec] : []
  const walk = walkBrowserGraph(target)
  return NEVER.filter((b) => walk.externals.has(b))
}

describe('the browser graph', () => {
  const roots = webSourceFiles()
  const walk = walkBrowserGraph(roots)
  const fromEntry = walkBrowserGraph(ENTRY)

  it('starts at the entry the dev server actually serves', () => {
    expect(readFileSync(join(WEB, 'index.html'), 'utf8')).toContain('src="/src/main.tsx"')
    expect(existsSync(ENTRY)).toBe(true)
    expect(fromEntry.files.length).toBeGreaterThan(20)
  })

  it('roots at EVERY bundlable source, not only what the entry reaches today', () => {
    expect(roots.length).toBeGreaterThan(20)
    for (const f of fromEntry.files) expect(walk.files).toContain(f)
    // R2, in one assertion: the widening is load-bearing only if it sees files the entry
    // does not. A module lands, then gets wired up — the guard must judge it at landing.
    const unreached = roots.filter((r) => !fromEntry.files.includes(r))
    expect(walk.files.length).toBeGreaterThanOrEqual(fromEntry.files.length + unreached.length)
  })

  it('never reaches a native or Node-only module', () => {
    for (const banned of NEVER) {
      const askers = walk.externals.get(banned)
      expect(
        askers ?? null,
        `${banned} is reachable from a bundlable web source via:\n  ${(askers ?? []).join('\n  ')}`,
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

  it('THE BATCH-1 LEAK: the engine ROOT is a banned door, its deep paths are not', () => {
    // `openDb`/`EventStore` left the root for './store'; the root still reaches the driver
    // through the scripted-world fixtures it also exports.
    expect(bannedReachableFrom('@sj/engine/store')).toContain('better-sqlite3')
    expect(bannedReachableFrom('@sj/engine')).toContain('better-sqlite3')
    expect(bannedReachableFrom('@sj/engine/state')).toEqual([])
    expect(bannedReachableFrom('@sj/engine/laws')).toEqual([])
    expect(bannedReachableFrom('@sj/engine/verbs')).toEqual([])
    expect(bannedReachableFrom('@sj/engine/perception')).toEqual([])
    expect(bannedReachableFrom('@sj/shared')).toEqual([])
    // and no bundlable source may open a banned door, wherever in src it lives
    for (const file of walk.files) {
      for (const spec of specifiersOf(file)) {
        if (!spec.startsWith('@sj/')) continue
        expect(bannedReachableFrom(spec), `${file} imports ${spec}`).toEqual([])
      }
    }
  })

  it('counts a dynamic import as a wire crossing too', () => {
    expect(specifiersOfSource("const m = await import('@sj/engine')")).toEqual(['@sj/engine'])
    expect(specifiersOfSource("import x from 'a'\nexport * from 'b'\nimport 'c'")).toEqual(
      expect.arrayContaining(['a', 'b', 'c']),
    )
  })

  it('keeps the one aliased builtin actually aliased', () => {
    const config = readFileSync(join(WEB, 'vite.config.ts'), 'utf8')
    expect(config).toContain("'node:crypto'")
    expect(config).toContain('shims/nodeCrypto.ts')
  })
})

// A re-export must name its source: tsc, the suite and the bundler all accept a bare
// `export { X }` after importing X, but the dev ESM graph throws at runtime.

/** The names one source re-exports through a bare `export { … }` after importing them. */
export function bareReexports(source: string): string[] {
  const src = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
  const imported = new Set<string>()
  for (const [, names] of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*['"][^'"]+['"]/g)) {
    for (const raw of (names ?? '').split(',')) {
      const n = raw
        .trim()
        .split(/\s+as\s+/)
        .pop()
        ?.trim()
      if (n !== undefined && n.length > 0) imported.add(n)
    }
  }
  const out: string[] = []
  if (imported.size === 0) return out
  for (const m of src.matchAll(/(?:^|\n)\s*export\s*\{([^}]*)\}\s*(from\s*['"][^'"]+['"])?/g)) {
    if (m[2] !== undefined) continue // `export { … } from '…'` names its source
    for (const raw of (m[1] ?? '').split(',')) {
      const n = raw
        .trim()
        .split(/\s+as\s+/)[0]
        ?.trim()
      if (n !== undefined && imported.has(n)) out.push(n)
    }
  }
  return out
}

/** The same sweep over every bundlable source, as `path — name`. */
export function reexportsWithoutSource(files: readonly string[]): string[] {
  return files.flatMap((f) =>
    bareReexports(readFileSync(f, 'utf8')).map((n) => `${f.slice(WEB.length + 1)} — ${n}`),
  )
}

describe('a re-export names its source', () => {
  it('catches the exact shape that blanked every place name', () => {
    expect(bareReexports("import { A, B } from './x.js'\nexport { A }\n")).toEqual(['A'])
  })

  it('leaves a proper re-export and a locally declared one alone', () => {
    expect(bareReexports("export { A } from './x.js'\n")).toEqual([])
    expect(bareReexports("import { B } from './x.js'\nconst A = 1\nexport { A }\n")).toEqual([])
  })

  it('has no bare re-export of an imported binding anywhere under src', () => {
    expect(reexportsWithoutSource(webSourceFiles())).toEqual([])
  })
})

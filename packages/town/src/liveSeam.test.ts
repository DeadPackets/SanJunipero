// The seam is a fact of the package graph, not a list of filenames.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPO = fileURLToPath(new URL('../../../', import.meta.url))
const HERE = dirname(fileURLToPath(import.meta.url))

const BANNED = [
  '@sj/agents',
  '@sj/arbiter',
  '@sj/narrator',
  '@sj/llm',
  '@sj/forge/gen',
  'ai',
  '@openrouter/ai-sdk-provider',
  '@huggingface/transformers',
]
/** All but the transformer, which `Embedder.create` await-imports rather than loads statically. */
const BANNED_STATICALLY = BANNED.filter((b) => b !== '@huggingface/transformers').sort()

// `[^;'"]` crosses newlines but not another statement's specifier, so every multi-line form is
// seen. `import('x')` is deliberately absent: the seam IS a dynamic import.
const STATIC_RES = [
  /(?:^|\n)\s*(?:import|export)(?!\s+type\b)\b[^;'"]*?\bfrom\s*'([^']+)'/g,
  /(?:^|\n)\s*import\s*'([^']+)'/g,
]

const exportsOf = new Map<string, Record<string, string> | undefined>()
const manifest = (pkg: string): Record<string, unknown> =>
  JSON.parse(readFileSync(join(REPO, 'packages', pkg, 'package.json'), 'utf8')) as Record<
    string,
    unknown
  >

function resolveSpec(spec: string, fromFile: string): string | null {
  if (spec.startsWith('.')) {
    const stem = resolve(dirname(fromFile), spec).replace(/\.js$/, '')
    for (const c of [`${stem}.ts`, join(stem, 'index.ts')]) if (existsSync(c)) return c
    return null
  }
  if (!spec.startsWith('@sj/')) return null
  const [, name = '', ...rest] = spec.split('/')
  if (!exportsOf.has(name))
    exportsOf.set(
      name,
      existsSync(join(REPO, 'packages', name, 'package.json'))
        ? (manifest(name).exports as Record<string, string> | undefined)
        : undefined,
    )
  const target = exportsOf.get(name)?.[rest.length === 0 ? '.' : `./${rest.join('/')}`]
  return target === undefined ? null : join(REPO, 'packages', name, target)
}

type Walk = { banned: string[]; unresolved: string[] }

function walkFrom(entry: string): Walk {
  const seen = new Set<string>()
  const banned = new Set<string>()
  const unresolved = new Set<string>()
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.shift()!
    if (seen.has(file)) continue
    seen.add(file)
    const src = readFileSync(file, 'utf8')
    for (const re of STATIC_RES)
      for (const m of src.matchAll(re)) {
        const spec = m[1]!
        if (BANNED.includes(spec)) banned.add(spec)
        const next = resolveSpec(spec, file)
        // An `@sj/*` the walk cannot open is a hole in the walk, not a clean subtree.
        if (next === null) {
          if (spec.startsWith('@sj/')) unresolved.add(spec)
        } else queue.push(next)
      }
  }
  return { banned: [...banned].sort(), unresolved: [...unresolved].sort() }
}

describe('★ the default stays scripted and free', () => {
  it('the town declares none of the mind packages', () => {
    const deps = manifest('town') as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
    }
    const declared = [
      ...Object.keys(deps.dependencies ?? {}),
      ...Object.keys(deps.devDependencies ?? {}),
    ]
    expect(declared.filter((d) => BANNED.includes(d))).toEqual([])
    // …and it does declare the live half, or the seam below would be vacuous.
    expect(declared).toContain('@sj/live')
  })

  it('nothing static from serve.ts reaches an LLM, its SDK or the mind packages', () => {
    expect(walkFrom(join(HERE, 'serve.ts'))).toEqual({ banned: [], unresolved: [] })
  })

  it('NOT VACUOUS: the same walk from @sj/live reaches all of them', () => {
    // Without this the walk above passes just as well on a walker that resolves nothing —
    // including through `liveWorld.ts`'s multi-line `import {\n …\n} from '@sj/agents'`.
    expect(walkFrom(join(REPO, 'packages/live/src/index.ts'))).toEqual({
      banned: BANNED_STATICALLY,
      unresolved: [],
    })
  })

  it('serve.ts reaches the live world only through a dynamic import behind the flag', () => {
    const s = readFileSync(join(HERE, 'serve.ts'), 'utf8')
    expect(s).not.toMatch(/^import .*@sj\/live/m)
    expect(s).toContain("import('@sj/live')")
    expect(s).toMatch(/process\.env(\.SJ_LIVE|\['SJ_LIVE'\]) === '1'/)
  })

  it('★ turning the god layer off is a flag, and it does not touch the scripted default', () => {
    // `SJ_ARBITER` may only ever be read on the live path. Read in `devWorld.ts` it would be a
    // switch that appears to do something on a stream that has no minds to rule over.
    expect(readFileSync(join(HERE, 'serve.ts'), 'utf8')).toMatch(
      /process\.env(\.SJ_ARBITER|\['SJ_ARBITER'\]) !== '0'/,
    )
    expect(readFileSync(join(HERE, 'devWorld.ts'), 'utf8')).not.toContain('SJ_ARBITER')
  })
})

// The live seam is a fact of the package graph, not a list of filenames: `@sj/town` declares
// none of the mind packages, and a static-import walk from `serve.ts` reaches none of them.
// A sixth file added to this package is guarded on the day it lands.
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const REPO = fileURLToPath(new URL('../../../', import.meta.url))
const HERE = dirname(fileURLToPath(import.meta.url))

/** What the scripted stream must never load: the mind stack and the SDKs behind it. */
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

// `from 'x'` on one line and across a braced list (minus the type-only forms tsc erases), and a
// bare `import 'x'`. `import('x')` is deliberately absent: the seam IS a dynamic import.
const STATIC_RES = [
  /(?:^|\n)\s*(?:import|export)(?!\s+type\b)\b[^;\n]*?from\s*'([^']+)'/g,
  /(?:^|\n)\s*(?:import|export)(?!\s+type\b)\s*\{[^}]*\}\s*from\s*'([^']+)'/g,
  /(?:^|\n)\s*import\s*'([^']+)'/g,
]

/** The file a specifier loads: relative by path, workspace by the package's `exports` map. */
function resolveSpec(spec: string, fromFile: string): string | null {
  if (spec.startsWith('.')) {
    const stem = resolve(dirname(fromFile), spec).replace(/\.js$/, '')
    for (const c of [`${stem}.ts`, join(stem, 'index.ts')]) if (existsSync(c)) return c
    return null
  }
  if (!spec.startsWith('@sj/')) return null
  const [, name, ...rest] = spec.split('/')
  const dir = join(REPO, 'packages', name ?? '')
  if (!existsSync(join(dir, 'package.json'))) return null
  const map = (
    JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as
      | { exports?: Record<string, string> }
      | undefined
  )?.exports
  const target = map?.[rest.length === 0 ? '.' : `./${rest.join('/')}`]
  return target === undefined ? null : join(dir, target)
}

/** Every banned specifier a `from '<entry>'` actually loads, walking the whole static graph. */
function bannedReachedFrom(entry: string): string[] {
  const seen = new Set<string>()
  const hits = new Set<string>()
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.shift()!
    if (seen.has(file)) continue
    seen.add(file)
    const src = readFileSync(file, 'utf8')
    for (const re of STATIC_RES)
      for (const m of src.matchAll(re)) {
        const spec = m[1]!
        if (BANNED.includes(spec)) hits.add(spec)
        const next = resolveSpec(spec, file)
        if (next !== null) queue.push(next)
      }
  }
  return [...hits].sort()
}

const manifest = (
  pkg: string,
): { dependencies?: Record<string, string>; devDependencies?: Record<string, string> } =>
  JSON.parse(readFileSync(join(REPO, 'packages', pkg, 'package.json'), 'utf8')) as never

describe('★ the default stays scripted and free', () => {
  it('the town declares none of the mind packages', () => {
    const { dependencies = {}, devDependencies = {} } = manifest('town')
    const declared = [...Object.keys(dependencies), ...Object.keys(devDependencies)]
    expect(declared.filter((d) => BANNED.includes(d))).toEqual([])
    // …and it does declare the live half, or the seam below would be vacuous.
    expect(declared).toContain('@sj/live')
  })

  it('nothing static from serve.ts reaches an LLM, its SDK or the mind packages', () => {
    expect(bannedReachedFrom(join(HERE, 'serve.ts'))).toEqual([])
  })

  it('NOT VACUOUS: the same walk from @sj/live reaches all of them', () => {
    // Without this the walk above passes just as well on a walker that resolves nothing. The
    // transformer is the one exception: `Embedder.create` await-imports it, and this walk does
    // not follow dynamic imports.
    expect(bannedReachedFrom(join(REPO, 'packages/live/src/index.ts'))).toEqual(
      BANNED.filter((b) => b !== '@huggingface/transformers').sort(),
    )
  })

  it('and it sees a multi-line import, which is how liveWorld.ts writes them', () => {
    // `[^;\n]*?` cannot cross the newline in `import {\n  bootMinds,\n} from '@sj/agents'`, and
    // that is exactly the form the live file uses.
    expect(bannedReachedFrom(join(REPO, 'packages/live/src/liveWorld.ts'))).toContain('@sj/agents')
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

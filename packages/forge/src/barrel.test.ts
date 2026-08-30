import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// `judge.ts` and `visionQa/visionJudge.ts` pull 9.7 MB of LLM SDK, so they live behind
// `@sj/forge/gen`; the free scripted stream imports `@sj/forge` and must stay free of it.
const SDK = ['ai', '@openrouter/ai-sdk-provider']
const HERE = dirname(fileURLToPath(import.meta.url))

// `from 'x'` (minus the type-only forms tsc erases), bare `import 'x'`, and `import('x')`.
const SPEC_RES = [
  /(?:^|\n)\s*(?:import|export)(?!\s+type\b)\b[^;\n]*?from\s*['"]([^'"]+)['"]/g,
  /(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g,
  /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
]

function resolveRelative(spec: string, fromFile: string): string | null {
  const stem = resolve(dirname(fromFile), spec).replace(/\.js$/, '')
  for (const c of [`${stem}.ts`, join(stem, 'index.ts')]) if (existsSync(c)) return c
  return null
}

/** The SDK packages a `from '<entry>'` actually loads, walking every module it reaches. */
function sdkReachedFrom(entry: string): string[] {
  const seen = new Set<string>()
  const sdk = new Set<string>()
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.shift()!
    if (seen.has(file)) continue
    seen.add(file)
    const src = readFileSync(file, 'utf8')
    for (const re of SPEC_RES)
      for (const m of src.matchAll(re)) {
        const spec = m[1]!
        if (SDK.includes(spec)) sdk.add(spec)
        if (!spec.startsWith('.')) continue
        const next = resolveRelative(spec, file)
        if (next !== null) queue.push(next)
      }
  }
  return [...sdk].sort()
}

describe('the forge root barrel', () => {
  it('loads no LLM SDK — the free stream imports it and must stay free', () => {
    expect(sdkReachedFrom(join(HERE, 'index.ts'))).toEqual([])
  })

  it('and the generation subpath is where the SDK does live', () => {
    // Without this the test above passes just as well on a barrel that exports nothing.
    expect(sdkReachedFrom(join(HERE, 'gen.ts'))).toEqual([...SDK].sort())
  })
})

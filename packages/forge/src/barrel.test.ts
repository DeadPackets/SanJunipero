import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// The free scripted stream imports `@sj/forge` for geometry and the codex, and nothing else.
// `judge.ts` and `visionQa/visionJudge.ts` pull 9.7 MB of LLM SDK, so they live behind
// `@sj/forge/gen`, which only the live path loads.
const SDK = ['ai', '@openrouter/ai-sdk-provider']
const HERE = dirname(fileURLToPath(import.meta.url))

const SPEC_RE = /(?:^|\n)\s*(?:import|export)\b[^;\n]*?from\s*['"]([^'"]+)['"]/g

function resolveRelative(spec: string, fromFile: string): string | null {
  const stem = resolve(dirname(fromFile), spec).replace(/\.js$/, '')
  for (const c of [`${stem}.ts`, join(stem, 'index.ts')]) if (existsSync(c)) return c
  return null
}

/** Every module a `from '<entry>'` actually loads, plus the bare specifiers they reach for. */
function walk(entry: string): Set<string> {
  const files = new Set<string>()
  const externals = new Set<string>()
  const queue = [entry]
  while (queue.length > 0) {
    const file = queue.shift()!
    if (files.has(file)) continue
    files.add(file)
    const src = readFileSync(file, 'utf8')
    SPEC_RE.lastIndex = 0
    for (let m = SPEC_RE.exec(src); m !== null; m = SPEC_RE.exec(src)) {
      // A `import type` / `export type` line is erased by tsc and loads nothing at run time.
      if (/^\s*(?:import|export)\s+type\b/.test(m[0])) continue
      const spec = m[1]!
      if (!spec.startsWith('.')) {
        externals.add(spec)
        continue
      }
      const next = resolveRelative(spec, file)
      if (next !== null) queue.push(next)
    }
  }
  return externals
}

describe('the forge root barrel', () => {
  it('loads no LLM SDK — the free stream imports it and must stay free', () => {
    expect([...walk(join(HERE, 'index.ts'))].filter((e) => SDK.includes(e))).toEqual([])
  })

  it('and the generation subpath is where the SDK does live', () => {
    // Without this the test above passes just as well on a barrel that exports nothing.
    expect([...walk(join(HERE, 'gen.ts'))].filter((e) => SDK.includes(e)).sort()).toEqual(
      [...SDK].sort(),
    )
  })
})

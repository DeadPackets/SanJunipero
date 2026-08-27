// Comparing VALUES alone is useless — 145 constants under `packages/web/src` happen to equal
// some config leaf, because 1, 2, 4 and 8 are everywhere. What is meaningful is a constant that
// DECLARES itself a copy, so the config path is read out of its own doc comment and resolved at
// runtime rather than transcribed.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG } from '@sj/shared'
import { BUILD_TICKS_FULL } from './entities.js'
import { EARSHOT_TILES } from '../ui/roster/rosterRow.js'

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = resolve(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if ((p.endsWith('.ts') || p.endsWith('.tsx')) && !p.includes('.test.')) out.push(p)
  }
  return out
}

const leafAt = (path: string): unknown =>
  path
    .split('.')
    .reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], DEFAULT_CONFIG)

type Copy = { file: string; name: string; value: number; path: string }

/** Every `const NAME = <number>` whose own doc comment names a `DEFAULT_CONFIG.<path>`. */
function declaredCopies(): Copy[] {
  const out: Copy[] = []
  for (const f of walk(ROOT)) {
    const lines = readFileSync(f, 'utf8').split('\n')
    lines.forEach((line, i) => {
      const m =
        /^\s*(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*(?::\s*number\s*)?=\s*(-?[0-9]+(?:\.[0-9]+)?)\b/.exec(
          line,
        )
      if (m === null) return
      const doc = lines.slice(Math.max(0, i - 6), i).join(' ')
      const p = /DEFAULT_CONFIG\.([a-zA-Z0-9_.]+)/.exec(doc)
      if (p === null) return
      out.push({
        file: f.slice(ROOT.length + 1),
        name: m[1]!,
        value: Number(m[2]),
        path: p[1]!.replace(/\.$/, ''),
      })
    })
  }
  return out
}

describe('★ a renderer constant that copies a config field still equals it', () => {
  const copies = declaredCopies()

  console.log(
    `CONFIG COPIES IN THE RENDERER — ${copies.length}\n` +
      copies
        .map(
          (c) =>
            `  ${c.file}  ${c.name} = ${c.value}   DEFAULT_CONFIG.${c.path} = ${String(leafAt(c.path))}`,
        )
        .join('\n'),
  )

  // The whole set, named. A third copy arriving is a thing somebody has to decide about, not a
  // thing that slips in behind these two — which is how `BUILD_TICKS_FULL` went stale.
  it('★ there are exactly two, and they are the two that are known about', () => {
    expect(copies.map((c) => `${c.file}:${c.name}`).sort()).toEqual([
      'render/entities.ts:BUILD_TICKS_FULL',
      'ui/roster/rosterRow.ts:EARSHOT_TILES',
    ])
  })

  for (const c of copies) {
    it(`${c.name} = ${c.value} is still DEFAULT_CONFIG.${c.path}`, () => {
      expect(leafAt(c.path), `DEFAULT_CONFIG.${c.path} no longer exists`).toBeTypeOf('number')
      expect(c.value, `${c.file}: ${c.name} has drifted from the field it copies`).toBe(
        leafAt(c.path),
      )
    })
  }

  // Reading the source proves the LITERAL matches; these prove the value the module exports is
  // the same one, so a copy cannot be renamed out of the scan and left behind.
  it('and the exported values are the ones the scan read', () => {
    expect(BUILD_TICKS_FULL).toBe(DEFAULT_CONFIG.construction.houseTicks)
    expect(EARSHOT_TILES).toBe(DEFAULT_CONFIG.movement.earshotRadius)
  })

  // Both are fallbacks for the frames before the snapshot's config has arrived.
  it('★ and each one is a FALLBACK, with the world’s own figure taking precedence', () => {
    for (const [file, fn] of [
      ['render/entities.ts', 'pipsFilled'],
      ['ui/roster/rosterRow.ts', 'companyOf'],
    ] as const) {
      const src = readFileSync(resolve(ROOT, file), 'utf8')
      expect(src, `${file}: ${fn} does not take the world's own figure`).toMatch(
        new RegExp(`function ${fn}\\([^)]*\\n?[^)]*(houseTicks|earshot)`),
      )
    }
  })
})

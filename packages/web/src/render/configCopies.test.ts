// ★ EVERY RENDERER CONSTANT THAT IS A COPY OF A CONFIG FIELD, AND WHETHER IT STILL AGREES.
//
// `BUILD_TICKS_FULL = 2880` was a transcription of `DEFAULT_CONFIG.construction.houseTicks`,
// and it had ALREADY GONE STALE: the dev world raises a house in 240 ticks, so
// `floor((240 / 2880) x 4)` is zero at completion and every house in the demo would have stood
// under scaffolding with not one progress pip lit. Nothing would have failed. It was found by
// somebody going and looking at a house going up.
//
// This is the sweep for the rest of them, landed as a guard instead of run once. MEASURED over
// 97 source files under `packages/web/src`: comparing VALUES alone is useless — 145 constants
// happen to equal some leaf of `DEFAULT_CONFIG`, because 1, 2, 4 and 8 are everywhere. What is
// meaningful is a constant that DECLARES itself a copy, and there are exactly TWO.
//
// ★ AND A CORRECTED NUMBER IS NOT THE FIX. This test derives: it reads the config path out of
// the constant's own doc comment and resolves it at runtime, so the day the field moves the
// copy goes red instead of going quietly wrong.
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
  path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], DEFAULT_CONFIG)

type Copy = { file: string; name: string; value: number; path: string }

/** Every `const NAME = <number>` whose own doc comment names a `DEFAULT_CONFIG.<path>`. */
function declaredCopies(): Copy[] {
  const out: Copy[] = []
  for (const f of walk(ROOT)) {
    const lines = readFileSync(f, 'utf8').split('\n')
    lines.forEach((line, i) => {
      const m = /^\s*(?:export\s+)?const\s+([A-Z][A-Z0-9_]*)\s*(?::\s*number\s*)?=\s*(-?[0-9]+(?:\.[0-9]+)?)\b/.exec(line)
      if (m === null) return
      const doc = lines.slice(Math.max(0, i - 6), i).join(' ')
      const p = /DEFAULT_CONFIG\.([a-zA-Z0-9_.]+)/.exec(doc)
      if (p === null) return
      out.push({ file: f.slice(ROOT.length + 1), name: m[1]!, value: Number(m[2]), path: p[1]!.replace(/\.$/, '') })
    })
  }
  return out
}

describe('★ a renderer constant that copies a config field still equals it', () => {
  const copies = declaredCopies()

  it('publishes the sweep', () => {
    // eslint-disable-next-line no-console
    console.log(`CONFIG COPIES IN THE RENDERER — ${copies.length}\n`
      + copies.map((c) => `  ${c.file}  ${c.name} = ${c.value}   DEFAULT_CONFIG.${c.path} = ${String(leafAt(c.path))}`).join('\n'))
    expect(copies.length).toBeGreaterThan(0)
  })

  // The whole set, named. A third copy arriving is a thing somebody has to decide about, not a
  // thing that slips in behind these two — which is how `BUILD_TICKS_FULL` went stale.
  it('★ there are exactly two, and they are the two that are known about', () => {
    expect(copies.map((c) => `${c.file}:${c.name}`).sort()).toEqual([
      'render/entities.ts:BUILD_TICKS_FULL',
      'ui/roster/rosterRow.ts:EARSHOT_TILES',
    ])
  })

  for (const c of declaredCopies()) {
    it(`${c.name} = ${c.value} is still DEFAULT_CONFIG.${c.path}`, () => {
      expect(leafAt(c.path), `DEFAULT_CONFIG.${c.path} no longer exists`).toBeTypeOf('number')
      expect(c.value, `${c.file}: ${c.name} has drifted from the field it copies`).toBe(leafAt(c.path))
    })
  }

  // Reading the source proves the LITERAL matches; these prove the value the module exports is
  // the same one, so a copy cannot be renamed out of the scan and left behind.
  it('and the exported values are the ones the scan read', () => {
    expect(BUILD_TICKS_FULL).toBe(DEFAULT_CONFIG.construction.houseTicks)
    expect(EARSHOT_TILES).toBe(DEFAULT_CONFIG.movement.earshotRadius)
  })

  // ★ AND NEITHER IS THE AUTHORITY. Both are fallbacks for the frames before the snapshot's
  // config has arrived; the live figure comes off the snapshot the viewer already holds. That
  // is the actual fix — a copy that only ever answers when there is nothing better.
  it('★ and each one is a FALLBACK, with the world’s own figure taking precedence', () => {
    for (const [file, fn] of [
      ['render/entities.ts', 'pipsFilled'], ['ui/roster/rosterRow.ts', 'companyOf'],
    ] as const) {
      const src = readFileSync(resolve(ROOT, file), 'utf8')
      expect(src, `${file}: ${fn} does not take the world's own figure`)
        .toMatch(new RegExp(`function ${fn}\\([^)]*\\n?[^)]*(houseTicks|earshot)`))
    }
  })
})
